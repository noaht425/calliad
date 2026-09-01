import Anthropic from '@anthropic-ai/sdk';
import { adminClient } from '@/lib/supabase.server';
import { config } from '@/lib/hub/config';
import { audit } from '@/lib/hub/audit';
import { anthropicCostUsd } from '@/lib/router/tiers';
import { learnedFacts } from '@/lib/brain/profile';
import type { Mode } from '@/lib/router/route';

const anthropic = new Anthropic();

// ── Layer 1: familiarity dial (automatic) ──────────────────────────────────
export type FamLevel = 'new' | 'warming' | 'established';

const FAM_LINES: Record<FamLevel, string> = {
  new: '',
  warming:
    "You and Noah have been talking for a few weeks. Drop the throat-clearing and stop re-explaining how you work — assume he remembers. A shade more familiar, a shade terser.",
  established:
    "You and Noah have real history. Terse is fine, dry is fine. Lean on shared context and don't narrate your reasoning. Familiar and direct — never deferential.",
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export async function familiarity(userId: string): Promise<{ level: FamLevel; score: number; weeks: number; facts: number; turns: number }> {
  const [firstConv, factCount, turnCount] = await Promise.all([
    adminClient.from('conversations').select('started_at').order('started_at', { ascending: true }).limit(1).maybeSingle(),
    adminClient.from('profile_facts').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('confirmed', true),
    adminClient.from('messages').select('id', { count: 'exact', head: true }).eq('role', 'user'),
  ]);
  const startedAt = firstConv.data?.started_at ? Date.parse(firstConv.data.started_at) : Date.now();
  const weeks = Math.max(0, (Date.now() - startedAt) / (7 * 86400000));
  const facts = factCount.count ?? 0;
  const turns = turnCount.count ?? 0;
  const score = clamp01(weeks / 8) * 0.5 + clamp01(facts / 25) * 0.3 + clamp01(turns / 400) * 0.2;
  const level: FamLevel = score < 0.34 ? 'new' : score < 0.67 ? 'warming' : 'established';
  return { level, score: Math.round(score * 100) / 100, weeks: Math.round(weeks * 10) / 10, facts, turns };
}

// ── Layer 2: generated voice profile ──────────────────────────────────────
export async function getVoiceProfile(): Promise<string> {
  return (await config.get('persona_addendum').catch(() => '')).trim();
}

/** Weekly-ish regeneration. Needs some history first; no-op otherwise. */
export async function regenerateVoiceProfile(userId: string): Promise<string | null> {
  const fam = await familiarity(userId);
  if (fam.weeks < 2 || fam.facts < 6) return null;

  const [learned, msgs, taste] = await Promise.all([
    learnedFacts(userId).catch(() => ''),
    adminClient.from('messages').select('content').eq('role', 'user').order('created_at', { ascending: false }).limit(80),
    adminClient.from('taste_log').select('title, verdict').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
  ]);
  const userMsgs = (msgs.data ?? []).map((m) => String(m.content)).filter((c) => c && c.length < 600);
  const avgLen = userMsgs.length ? Math.round(userMsgs.reduce((a, c) => a + c.length, 0) / userMsgs.length) : 0;
  const qRate = userMsgs.length ? userMsgs.filter((c) => c.includes('?')).length / userMsgs.length : 0;
  const politeRate = userMsgs.length ? userMsgs.filter((c) => /\b(please|thanks|thank you|appreciate)\b/i.test(c)).length / userMsgs.length : 0;
  const styleNote = `~${fam.weeks} weeks of history; avg message ${avgLen} chars; ${Math.round(qRate * 100)}% are questions; "please/thanks" in ${Math.round(politeRate * 100)}% of messages.`;
  const tasteNote = (taste.data ?? []).map((t) => `${t.title} (${t.verdict})`).join(', ');

  const started = Date.now();
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 300,
    system:
      "Write a 3-4 sentence 'voice profile' for an assistant's persona — how to talk to this specific user, based on accumulated signal. " +
      'Cover: his register and how terse/formal to be; specific shared context worth leaning on; what he responds well to and what falls flat. ' +
      'Concrete and second-person imperative ("Match his...", "Lean on..."). No preamble, no bullet points, no headers — just the paragraph. ' +
      'It adjusts tone and what to assume ONLY; it must not contradict the core persona or imply any change to rules or behaviour.',
    messages: [
      {
        role: 'user',
        content: `Style signal: ${styleNote}\n\nWhat's on file about him:\n${learned || '(little yet)'}\n\nMedia reactions: ${tasteNote || '(none)'}\n\nWrite the voice profile.`,
      },
    ],
  });
  const text = msg.content.filter((b) => b.type === 'text').map((b) => (b as Anthropic.TextBlock).text).join('').trim();
  await audit.modelCall({
    conversation_id: null, purpose: 'voice_profile', tier: 'T2', model: 'claude-sonnet-5',
    input_tokens: msg.usage.input_tokens, cached_read_tokens: msg.usage.cache_read_input_tokens ?? 0,
    cache_write_tokens: msg.usage.cache_creation_input_tokens ?? 0, output_tokens: msg.usage.output_tokens,
    cost_usd: anthropicCostUsd('claude-sonnet-5', msg.usage), latency_ms: Date.now() - started,
  });
  if (!text || text.length < 40) return null;
  await config.set('persona_addendum', text);
  await config.set('persona_addendum_at', new Date().toISOString());
  return text;
}

// ── Layer 0: personality axes (1–5 dials) ─────────────────────────────────
export interface Axes { warmth: number; directness: number; wit: number; verbosity: number; proactivity: number }
export const AXES_DEFAULT: Axes = { warmth: 3, directness: 3, wit: 3, verbosity: 3, proactivity: 3 };
export const AXES_META: { key: keyof Axes; label: string; low: string; high: string }[] = [
  { key: 'warmth', label: 'Warmth', low: 'Cool, professional', high: 'Friendly, personal' },
  { key: 'directness', label: 'Directness', low: 'Hedged, exploratory', high: 'Blunt, assertive' },
  { key: 'wit', label: 'Wit', low: 'Purely functional', high: 'Dry humour, wordplay' },
  { key: 'verbosity', label: 'Verbosity', low: 'One-liners', high: 'Full context + reasoning' },
  { key: 'proactivity', label: 'Proactivity', low: "Only what's asked", high: 'Surfaces extra observations' },
];

export async function getAxes(): Promise<Axes> {
  try {
    const raw = await config.get('personality_axes').catch(() => '');
    const p = raw ? JSON.parse(raw) : {};
    return {
      warmth: clampAxis(p.warmth), directness: clampAxis(p.directness), wit: clampAxis(p.wit),
      verbosity: clampAxis(p.verbosity), proactivity: clampAxis(p.proactivity),
    };
  } catch { return { ...AXES_DEFAULT }; }
}
export async function setAxes(a: Partial<Axes>): Promise<Axes> {
  const cur = await getAxes();
  const next = { ...cur, ...Object.fromEntries(Object.entries(a).map(([k, v]) => [k, clampAxis(v)])) } as Axes;
  await config.set('personality_axes', JSON.stringify(next));
  return next;
}
const clampAxis = (v: unknown) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(1, Math.min(5, n)) : 3; };

function axesLines(a: Axes): string[] {
  const out: string[] = [];
  if (a.warmth <= 2) out.push('Keep it cool and professional — minimal personalising, skip empathy filler.');
  else if (a.warmth >= 4) out.push('Be warm and personal — address Noah directly, acknowledge how something lands when it fits.');
  if (a.directness <= 2) out.push('Hedge and explore — offer options and caveats rather than a single verdict.');
  else if (a.directness >= 4) out.push("Be blunt — say what he should do, don't soften it with \"you might consider\".");
  if (a.wit <= 2) out.push('Stay purely functional — no jokes or asides.');
  else if (a.wit >= 4) out.push('Dry humour and the odd wordplay are welcome when they land.');
  if (a.verbosity <= 2) out.push('Very terse — one or two lines, no visible reasoning.');
  else if (a.verbosity >= 4) out.push('Give full context and walk through the reasoning.');
  if (a.proactivity <= 2) out.push("Answer only what's asked — don't volunteer tangents or \"by the way\" notes.");
  else if (a.proactivity >= 4) out.push('Volunteer useful observations and "by the way…" notes liberally.');
  return out;
}

/** The block folded into the cached persona layer. Stable for days at a time. */
export async function personaExtra(userId: string): Promise<string> {
  const [fam, voice, axes] = await Promise.all([familiarity(userId), getVoiceProfile(), getAxes()]);
  const parts: string[] = [];
  if (FAM_LINES[fam.level]) parts.push(FAM_LINES[fam.level]);
  const al = axesLines(axes);
  if (al.length) parts.push(al.join(' '));
  if (voice) parts.push(voice);
  return parts.length ? `## Rapport\n${parts.join('\n\n')}` : '';
}

// ── Layer 3: stance presets ──────────────────────────────────────────────
export const PRESETS: Record<string, { label: string; overlay: string }> = {
  default: { label: 'Default', overlay: '' },
  'harsh-professor': {
    label: 'Harsh professor',
    overlay:
      "## Stance: exacting instructor\nHold Noah to a high bar. No credit for the expected answer; name sloppy reasoning, hand-waving, and gaps directly and right away. Demand precision and push for the *why*. Keep it terse. Withhold praise unless he's genuinely nailed something hard. Rigor, not contempt — exacting, never demeaning.",
  },
  warm: {
    label: 'Warm',
    overlay:
      '## Stance: warm\nBe patient and encouraging. More scaffolding, more reassurance, acknowledge the effort. Gentle with mistakes — frame them as steps, not failures.',
  },
  playful: {
    label: 'Playful',
    overlay:
      '## Stance: playful\nLighter touch. Jokes, wordplay, and the occasional tangent are welcome. Still useful and still honest — just less buttoned-up.',
  },
};
const PRESET_GUARD =
  '\n\nThis stance shifts tone and standards only. It never overrides the operating rules, the safety rules, tool behaviour, or the graduated-authorization gate.';

export function presetOverlay(key: string | undefined): string {
  if (!key || key === 'default') return '';
  if (key.startsWith('custom:')) {
    const body = key.slice(7).trim();
    return body ? `## Stance (custom)\n${body}${PRESET_GUARD}` : '';
  }
  const p = PRESETS[key];
  return p?.overlay ? p.overlay + PRESET_GUARD : '';
}

/** conversation override > mode/drill/practice auto > user default > 'default'. */
export function resolvePreset(opts: {
  userDefault?: string; convPreset?: string; mode?: Mode; drillMode?: boolean; practice?: boolean;
}): string {
  if (opts.convPreset) return opts.convPreset;
  if (opts.mode === 'quiz' || opts.mode === 'italian-tutor' || opts.drillMode || opts.practice) return 'harsh-professor';
  return opts.userDefault || 'default';
}

// chat: "be a harsh professor" / "lighten up" / "back to normal"
const SWITCHES: [RegExp, string][] = [
  [/\bbe (a |an )?(harsh|strict|tough|demanding|brutal|hard) (professor|teacher|instructor|critic|grader|coach)\b|professor mode|drill (sergeant|instructor)|don'?t go easy( on me)?|be brutal|tear it apart|rip it apart\b/i, 'harsh-professor'],
  [/\bbe (nicer|kinder|gentler|warmer|more encouraging|supportive)\b|go easy on me\b|ease up\b|warm(er)? mode\b/i, 'warm'],
  [/\b(lighten up|loosen up|be (playful|silly|goofy|funny)|have (some )?fun with it|playful mode)\b/i, 'playful'],
  [/\b(back to normal|be yourself|normal mode|default (mode|personality|stance)|drop the (act|persona|stance|professor)|stop being (a |so )?(professor|harsh|mean|strict))\b/i, 'default'],
];
export function detectPresetSwitch(text: string): string | null {
  for (const [re, key] of SWITCHES) if (re.test(text)) return key;
  return null;
}
