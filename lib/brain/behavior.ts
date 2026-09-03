import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';
import { config } from '@/lib/hub/config';
import { t1Json } from '@/lib/llm/gemini';
import { enqueueNotification } from '@/lib/hub/notify';
import { ownerUserIds } from '@/lib/hub/owner';
import { saveNote } from '@/lib/memory/notes';

// Learned behavior rules (ported from dougt425/calliad, adapted to our stack).
//  - reflection: spot standing behavioral corrections in recent chat pairs,
//    track frequency, and at ≥2 propose making it a rule.
//  - compiler: keep the active rule set free of duplicates.
//  - explicit: "from now on, always ask before…" → a rule straight away.
// Active rules ride in the system prompt via behaviorContextLine().

export interface BehaviorRule {
  id: string;
  rule_text: string;
  source: 'explicit' | 'learned';
  status: string;
  created_at: string;
  auto_activated?: boolean;
  pattern_key?: string | null;
}

export async function activeRules(userId: string): Promise<BehaviorRule[]> {
  const sel = (cols: string) =>
    adminClient.from('behavior_rules').select(cols).eq('user_id', userId).eq('status', 'active').order('created_at');
  let res = await sel('id, rule_text, source, status, created_at, auto_activated, pattern_key');
  // 0031 adds auto_activated/pattern_key; fall back if it isn't applied yet
  if (res.error && /column .* does not exist/i.test(res.error.message ?? '')) {
    res = await sel('id, rule_text, source, status, created_at');
  }
  return (res.data ?? []) as unknown as BehaviorRule[];
}

/** The prompt block. Empty string when there are no active rules. */
export async function behaviorContextLine(userId: string): Promise<string> {
  const rules = await activeRules(userId);
  if (!rules.length) return '';
  return (
    `## Standing behavioral preferences\n` +
    `Noah set these — follow them in every interaction where they apply:\n` +
    rules.map((r) => `- ${r.rule_text}`).join('\n')
  );
}

// ── explicit rules from chat ─────────────────────────────────────────────
const RULE_LEAD =
  /\b(from now on|going forward|in the future|in future|next time|as a (standing )?rule|make (it|this) a rule|i('?d| would) prefer (that )?you|i want you to (always|never)|quit|stop)\b/i;
const RULE_IMPER = /^(always|never|please (always|never)|stop|don'?t)\b/i;

export function isBehaviorRuleStatement(t: string): boolean {
  const s = t.trim();
  if (/\bremember\b/i.test(s)) return false; // "remember that I…" is a fact, not a rule
  if (s.split(/\s+/).length > 40) return false;
  const aboutCalliad =
    /\b(you|calliad|ask|tell|remind|reply|respond|answer|confirm|check with me|add|sav(e|ing)|send|show|keep|give me|make|call me|refer to me|assume|includ|mention|summari|abbreviat|shorten|lengthen|be (brief|concise|shorter)|my (name|answers?|replies))/i;
  if (RULE_LEAD.test(s) && aboutCalliad.test(s)) return true;
  return RULE_IMPER.test(s) && aboutCalliad.test(s);
}

/** Save an explicit rule. Returns the stored text, or null if the LLM decides
 *  it isn't really a standing preference (caller then falls through). */
export async function saveExplicitRule(userId: string, text: string): Promise<string | null> {
  const j = await t1Json<{ is_rule: boolean; rule_text: string }>(
    'behavior_rule_extract',
    `The user said this to their assistant Calliad: "${text}"\n\n` +
      `Is it a STANDING instruction about how Calliad should behave from now on (a preference), ` +
      `rather than a one-off request, a fact about the user, or a task? ` +
      `If yes, rewrite it as one clear imperative rule addressed to Calliad, ≤160 chars. ` +
      `Reply JSON: {"is_rule": boolean, "rule_text": "..."}`,
    { maxOutputTokens: 200 },
  );
  if (!j?.is_rule || !j.rule_text?.trim()) return null;
  const rule = j.rule_text.trim().slice(0, 200);

  const { data: dup } = await adminClient
    .from('behavior_rules')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .ilike('rule_text', rule);
  if (dup?.length) return rule;

  await adminClient.from('behavior_rules').insert({ user_id: userId, rule_text: rule, source: 'explicit', status: 'active' });
  await audit.log('tool_call', 'calliad', null, { tool: 'behavior_rule_add', source: 'explicit', rule });
  return rule;
}

// ── a proposed rule awaiting Noah's yes/no ───────────────────────────────
export async function pendingRulePrompt(
  userId: string,
): Promise<{ id: string; proposed_rule: string; pattern_description: string } | null> {
  const { data } = await adminClient
    .from('correction_candidates')
    .select('id, proposed_rule, pattern_description')
    .eq('user_id', userId)
    .eq('status', 'proposed')
    .order('last_seen_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string; proposed_rule: string; pattern_description: string } | null) ?? null;
}

export async function resolveRulePrompt(userId: string, accept: boolean): Promise<string | null> {
  const p = await pendingRulePrompt(userId);
  if (!p) return null;
  if (accept) {
    await adminClient.from('behavior_rules').insert({
      user_id: userId, rule_text: p.proposed_rule, source: 'learned', status: 'active',
    });
    await adminClient.from('correction_candidates').update({ status: 'promoted' }).eq('id', p.id);
    await audit.log('tool_call', 'calliad', null, { tool: 'behavior_rule_add', source: 'learned', rule: p.proposed_rule });
    return `Done — standing rule: "${p.proposed_rule}"`;
  }
  await adminClient.from('correction_candidates').update({ status: 'dismissed' }).eq('id', p.id);
  return `Okay — I won't make that a rule.`;
}

// ── veto an active rule ─────────────────────────────────────────────────
const VETO =
  /\b(stop doing that|stop that\b|don'?t do that( any ?more)?|quit doing that|forget (that|the last|that new) rule|drop (that|the last) rule|cancel that rule|undo that rule|scrap that rule|that rule('?s| is| was) (wrong|off|bad|not right)|stop (following|applying) (that|the last) rule|never ?mind (that|the) rule)\b/i;

export function isRuleVeto(t: string): boolean {
  return VETO.test(t.trim());
}

/**
 * "stop doing that" → retire an active rule. A bare veto drops the most
 * recently activated one (usually the one just announced); a veto that names a
 * behaviour has T1 pick which active rule it means.
 */
export async function vetoRule(userId: string, text: string): Promise<string | null> {
  const rules = await activeRules(userId);
  if (!rules.length) return null;

  const bare = /^(stop (doing )?that|stop that|don'?t do that( any ?more)?|forget (that|the last) rule|drop (that|the last) rule|undo that rule|scrap that rule)\.?\s*$/i.test(
    text.trim(),
  );

  let target = rules[rules.length - 1]; // newest
  if (bare) {
    target = [...rules].reverse().find((r) => r.source === 'learned') ?? target;
  } else {
    const pick = await t1Json<{ id: string | null }>(
      'behavior_rule_veto',
      `The user wants to cancel one of Calliad's standing rules. Which one?\n` +
        rules.map((r) => `[${r.id}] ${r.rule_text}`).join('\n') +
        `\n\nUser said: "${text}"\nReply JSON: {"id":"<matching id, or null if none clearly matches>"}`,
      { maxOutputTokens: 40 },
    ).catch(() => null);
    const hit = pick?.id ? rules.find((r) => r.id === pick.id) : null;
    if (hit) target = hit;
    else if (!bare) return null; // named a rule but nothing matched — let the brain handle it
  }

  await adminClient.from('behavior_rules').update({ status: 'dismissed', updated_at: new Date().toISOString() }).eq('id', target.id).eq('user_id', userId);
  if (target.pattern_key) {
    await adminClient.from('correction_candidates').update({ status: 'dismissed' }).eq('user_id', userId).eq('pattern_key', target.pattern_key);
  }
  await audit.log('tool_call', 'calliad', null, { tool: 'behavior_rule_veto', rule: target.rule_text });
  return `Dropped that rule — "${target.rule_text}". I won't follow it any more.`;
}

// ── reflection ──────────────────────────────────────────────────────────
export interface Pattern {
  pattern_key: string;
  pattern_description: string;
  proposed_rule: string;
}

/**
 * Record one behavioural-correction pattern. At frequency ≥2 it becomes a rule:
 * a narrow, low-risk one activates on its own and Noah is told once ("I've
 * started doing X — say stop if that's wrong"); a broad one still asks first.
 * Called by the nightly sweep AND, in real time, the moment a correction lands
 * in chat, so a repeat reaches the threshold on the spot, not a day later.
 */
export async function trackCorrectionCandidate(
  userId: string,
  p: Pattern,
): Promise<'tracking' | 'proposed' | 'auto' | null> {
  if (!p.pattern_key || !p.proposed_rule) return null;

  const { data: match } = await adminClient
    .from('correction_candidates')
    .select('id, frequency, status')
    .eq('user_id', userId)
    .eq('pattern_key', p.pattern_key)
    .maybeSingle();

  if (!match) {
    await adminClient.from('correction_candidates').upsert(
      {
        user_id: userId,
        pattern_key: p.pattern_key,
        pattern_description: p.pattern_description,
        proposed_rule: p.proposed_rule,
        frequency: 1,
        status: 'tracking',
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,pattern_key', ignoreDuplicates: true },
    );
    return 'tracking';
  }

  if (match.status !== 'tracking') return match.status as 'proposed'; // already proposed / promoted / dismissed

  const freq = (match.frequency as number) + 1;
  await adminClient
    .from('correction_candidates')
    .update({ frequency: freq, last_seen_at: new Date().toISOString() })
    .eq('id', match.id);
  if (freq < 2) return 'tracking';

  // already an active rule saying essentially this? just mark the candidate done.
  const { data: dup } = await adminClient
    .from('behavior_rules')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .ilike('rule_text', p.proposed_rule.slice(0, 60) + '%');
  if (dup?.length) {
    await adminClient.from('correction_candidates').update({ status: 'promoted' }).eq('id', match.id);
    return 'auto';
  }

  // narrow + low-risk → activate now and tell him; broad → ask first
  const j = await t1Json<{ narrow: boolean }>(
    'behavior_rule_scope',
    `Rule for the assistant Calliad: "${p.proposed_rule}"\n\n` +
      `Is this NARROW and low-risk — a concrete do/don't tied to a specific recurring situation, safe to ` +
      `just start following (e.g. "don't call tutors clunky", "ask before adding calendar events")? ` +
      `Or BROAD — a sweeping change to tone, personality, or how Calliad works overall, worth confirming ` +
      `first? Reply JSON: {"narrow": boolean}`,
    { maxOutputTokens: 30 },
  ).catch(() => null);

  if (j?.narrow) {
    const base = { user_id: userId, rule_text: p.proposed_rule.slice(0, 200), source: 'learned', status: 'active' };
    const ins = await adminClient.from('behavior_rules').insert({ ...base, auto_activated: true, pattern_key: p.pattern_key });
    if (ins.error && /column .* does not exist/i.test(ins.error.message ?? '')) {
      await adminClient.from('behavior_rules').insert(base); // pre-0031
    }
    await adminClient.from('correction_candidates').update({ status: 'promoted' }).eq('id', match.id);
    await enqueueNotification(userId, {
      kind: 'behavior',
      title: 'Adjusting how I work',
      body:
        `You've corrected me a couple of times about ${p.pattern_description}, so I've started following: ` +
        `"${p.proposed_rule}". Say "stop doing that" if it's wrong.`,
      dedupeKey: `behavior:auto:${match.id}`,
    });
    return 'auto';
  }

  await adminClient.from('correction_candidates').update({ status: 'proposed' }).eq('id', match.id);
  await enqueueNotification(userId, {
    kind: 'behavior',
    title: 'A pattern I noticed',
    body:
      `You've corrected me a few times about ${p.pattern_description}. ` +
      `Make it a standing rule? Reply "yes, make it a rule" or "no". ` +
      `Proposed: "${p.proposed_rule}"`,
    dedupeKey: `behavior:${match.id}`,
  });
  return 'proposed';
}

async function runReflectionForUser(userId: string): Promise<number> {
  const cutoff = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const { data: convs } = await adminClient.from('conversations').select('id').gte('last_at', cutoff);
  const ids = (convs ?? []).map((c) => c.id as string);
  if (!ids.length) return 0;

  const { data: msgs } = await adminClient
    .from('messages')
    .select('role, content')
    .in('conversation_id', ids)
    .gte('created_at', cutoff)
    .order('created_at')
    .limit(160);

  const m = msgs ?? [];
  const pairs: { assistant: string; user: string }[] = [];
  for (let i = 0; i < m.length - 1; i++) {
    if (m[i].role === 'assistant' && m[i + 1].role === 'user') {
      pairs.push({ assistant: String(m[i].content).slice(0, 400), user: String(m[i + 1].content).slice(0, 250) });
    }
  }
  if (!pairs.length) return 0;

  const out = await t1Json<{ behavioral: Pattern[]; factual: { note: string; topic: string }[] }>(
    'behavior_reflection',
    `Conversation pairs between the user and their assistant Calliad. Find where the user corrected Calliad.\n` +
      `Two kinds:\n` +
      `- behavioural: the user wants Calliad to ACT differently as a standing habit (ask first, be terser…).\n` +
      `- factual: Calliad got something substantively wrong and the user set it straight — a fact, number, ` +
      `name, OR a domain concept (what something is for, how a category works). "You called tutors ` +
      `non-synergistic, but their job is consistency" is factual, not opinion. A REASON why Calliad's ` +
      `characterisation is wrong makes it factual.\n` +
      `Ignore the user fixing their OWN request ("I meant Tuesday"), extra items in one message, plain ` +
      `confusion, and pure matters of taste with no right answer.\n\n` +
      pairs
        .slice(0, 25)
        .map((p, i) => `${i + 1}. Calliad: ${p.assistant}\n   User: ${p.user}`)
        .join('\n') +
      `\n\nReply JSON: {"behavioral":[{"pattern_key":"short_snake_case_slug","pattern_description":"lowercase, e.g. 'adding calendar events without asking'","proposed_rule":"clear imperative to Calliad, <=160 chars"}],` +
      `"factual":[{"note":"one standalone sentence — what Calliad got wrong and what's true, keep specifics, <=240 chars","topic":"2-5 words"}]}. ` +
      `Group duplicates. Empty arrays if none.`,
    { maxOutputTokens: 700 },
  );
  if (!out) return 0;

  let proposed = 0;
  for (const p of out.behavioral ?? []) {
    const s = await trackCorrectionCandidate(userId, p).catch(() => null);
    if (s === 'proposed' || s === 'auto') proposed++;
  }

  // factual corrections → correction notes (deduped against recent ones)
  const facts = (out.factual ?? []).filter((f) => f?.note?.trim());
  if (facts.length) {
    const { data: recent } = await adminClient
      .from('notes')
      .select('content')
      .eq('user_id', userId)
      .eq('kind', 'correction')
      .order('created_at', { ascending: false })
      .limit(50);
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const have = new Set((recent ?? []).map((r) => norm(r.content as string)));
    for (const f of facts) {
      const note = f.note.trim().slice(0, 400);
      if (have.has(norm(note))) continue;
      have.add(norm(note));
      await saveNote(userId, note, { kind: 'correction', source: 'reflection', meta: { topic: f.topic ?? null } }).catch(() => {});
    }
  }
  return proposed;
}

// ── compiler (dedupe / merge) ───────────────────────────────────────────
async function runCompilerForUser(userId: string): Promise<number> {
  const rules = await activeRules(userId);
  if (rules.length < 3) return 0;

  const r = await t1Json<{ merges: { ids: string[]; merged_rule: string }[]; drop: string[] }>(
    'behavior_rule_compiler',
    `Standing behavioural rules for the assistant Calliad:\n` +
      rules.map((x) => `[${x.id}] ${x.rule_text}`).join('\n') +
      `\n\nFind rules that say essentially the same thing (merge into one cleaner rule) and exact ` +
      `duplicates (drop). Be conservative — only genuine redundancy, never merge rules that are ` +
      `merely on the same topic. Reply JSON: ` +
      `{"merges":[{"ids":["<id>","<id>"],"merged_rule":"<combined text>"}],"drop":["<id>"]}. Empty arrays if nothing.`,
    { maxOutputTokens: 400 },
  );
  if (!r) return 0;

  let changes = 0;
  for (const merge of r.merges ?? []) {
    if (!merge.ids || merge.ids.length < 2 || !merge.merged_rule?.trim()) continue;
    const [keep, ...rest] = merge.ids;
    await adminClient
      .from('behavior_rules')
      .update({ rule_text: merge.merged_rule.trim().slice(0, 200), updated_at: new Date().toISOString() })
      .eq('id', keep)
      .eq('user_id', userId);
    await adminClient.from('behavior_rules').update({ status: 'dismissed' }).in('id', rest).eq('user_id', userId);
    changes += rest.length;
  }
  for (const id of r.drop ?? []) {
    await adminClient.from('behavior_rules').update({ status: 'dismissed' }).eq('id', id).eq('user_id', userId);
    changes++;
  }
  return changes;
}

/** Self-gating: reflection ~daily, compiler ~weekly. Called from the tick worker. */
export async function runBehaviorMaintenance(): Promise<{ reflection?: number; compiler?: number }> {
  const out: { reflection?: number; compiler?: number } = {};
  const now = Date.now();

  const reflAt = await config.get('behavior_reflection_at').catch(() => '');
  if (!reflAt || now - Date.parse(reflAt) > 20 * 3600_000) {
    let n = 0;
    for (const uid of await ownerUserIds()) n += await runReflectionForUser(uid).catch(() => 0);
    await config.set('behavior_reflection_at', new Date().toISOString());
    out.reflection = n;
  }

  const compAt = await config.get('behavior_compiler_at').catch(() => '');
  if (!compAt || now - Date.parse(compAt) > 6.5 * 86_400_000) {
    let n = 0;
    for (const uid of await ownerUserIds()) n += await runCompilerForUser(uid).catch(() => 0);
    await config.set('behavior_compiler_at', new Date().toISOString());
    out.compiler = n;
  }
  return out;
}
