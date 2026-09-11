import { t1Json, t1Available } from '@/lib/llm/gemini';
import { adminClient } from '@/lib/supabase.server';
import { upsertLoop } from '@/lib/memory/loops';
import { recordCapabilityGap } from '@/lib/dev/capability-gaps';

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';

const FACT_SECTIONS = ['identity', 'health', 'academics', 'work', 'languages', 'food', 'geographic', 'travel', 'people', 'recurring', 'daily rhythm', 'projects', 'interests', 'working style'];

interface Detected {
  loops: { title: string; body?: string; due_hint?: string; tags?: string[] }[];
  facts: { section: string; key: string; value: string }[];
  checkins?: { what: string; when: string; tone?: string }[];
  gap?: { title: string; why_not_possible: string; rough_approach?: string } | null;
}

/** Local wall-clock "YYYY-MM-DDTHH:mm" → UTC ISO, DST-correct (two-pass offset). */
function localToUtcISO(local: string): string | null {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  const approx = new Date(Date.UTC(y, mo - 1, d, h, mi, 0));
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(approx);
  const g = (t: string) => parseInt(parts.find((p) => p.type === t)!.value, 10);
  const rendered = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
  const wanted = Date.UTC(y, mo - 1, d, h, mi, 0);
  const iso = new Date(approx.getTime() + (wanted - rendered)).toISOString();
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/**
 * After a chat turn, one cheap T1 pass that (a) files any open loop Noah opened,
 * and (b) captures durable facts he mentioned in passing — no "remember that"
 * needed. Facts land UNCONFIRMED (source 'chat'); they show up in Settings →
 * "Learned about me" for a one-tap keep/drop and don't reach the brain until
 * confirmed. Fire-and-forget from /api/chat. No-op without T1 (Gemini).
 */
export async function detectFromTurn(
  userId: string,
  userText: string,
  assistantText: string,
  conversationId: string | null,
): Promise<void> {
  if (!t1Available()) return;

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const localNow = now.toLocaleString('en-US', { timeZone: TZ, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const prompt = `From one chat exchange, extract a few things about Noah. Be conservative — empty arrays are the common case.

Today: ${today}. Right now: ${localNow} (${TZ}).

Noah: "${userText.slice(0, 1500)}"
Calliad: "${assistantText.slice(0, 1500)}"

Return JSON only:
{"loops":[{"title":"short handle (<8 words)","body":"one-sentence detail","due_hint":"YYYY-MM-DD if a deadline is stated/implied else omit","tags":["1-2 lowercase tags"]}],
 "facts":[{"section":"one of: ${FACT_SECTIONS.join(', ')}","key":"short slug e.g. coffee_order","value":"the fact as a complete sentence"}],
 "checkins":[{"what":"the thing to follow up on, Noah's words","when":"YYYY-MM-DDTHH:mm local, when to check in AFTERWARD","tone":"one phrase, e.g. 'light and warm' or 'gentle, he was anxious'"}],
 "gap": null}

LOOPS = things Noah committed to, is waiting on, or must decide. Not answered questions, not saved links, not bare facts.
FACTS = durable, stable things about Noah HIMSELF that he stated as true (a preference, allergy, habit, routine, relationship, where he lives/works/studies, a tool he uses, a constraint). NOT:
- transient state ("I'm tired", "busy this week")
- reactions to books/shows/films/games (handled elsewhere)
- tasks, plans, or one-off events
- anything he asked about rather than asserted
- guesses — only what he plainly said about himself
CHECKINS = a friend would remember to ask how this went. A dated stressful/notable thing ("interview Tuesday 2pm", "first shift Monday", "big presentation Friday", "date this weekend"), or Noah being unwell ("came down with something", "migraine again"). Set "when" to shortly AFTER it should be over: ~2h after a timed event; the next morning (09:00) for an all-day or vague-time thing; ~24h later for illness. Skip anything routine, anything already far in the past, and anything with no natural "how did it go". Most exchanges yield [].
GAP = Noah asked Calliad to do or fetch something entirely outside what it can do today, and it plainly said so. Be strict — this files a GitHub issue, false positives are expensive. A real gap is a request for an ACTION or an INTEGRATION that's plausibly a feature to build: "can you order me an Uber", "check my bank balance", "add this to my Spotify queue", "set a kitchen timer", "text my landlord for me". NOT a gap, return null:
- no DATA for something Calliad already handles (no Beli entry for a place, nothing on the calendar, no note on file — the capability exists, the data doesn't)
- general knowledge / trivia Calliad just doesn't know
- something Calliad deliberately declined by design (a financial trade, entering a password, anything it should refuse) — correct behavior, not a gap
- a pending confirmation ("say yes and I'll…") or a "which one did you mean" — the system working as intended
- a physical-world impossibility ("I can't taste it for you")
- small talk, a joke, a rhetorical question
If (and only if) a real gap: {"title":"short handle, <6 words","why_not_possible":"one sentence","rough_approach":"one short paragraph on how it might be built — omit the key entirely if you have no real idea"}. Otherwise gap is null. This should be null in almost every exchange.
Most exchanges yield {"loops":[],"facts":[],"checkins":[],"gap":null}.`;

  const out = await t1Json<Detected>('detect_turn', prompt, { conversationId, maxOutputTokens: 700 });
  if (!out) return;

  for (const l of (out.loops ?? []).slice(0, 4)) {
    if (!l.title?.trim()) continue;
    const due_at = l.due_hint && /^\d{4}-\d{2}-\d{2}$/.test(l.due_hint) ? `${l.due_hint}T12:00:00Z` : null;
    await upsertLoop(userId, { title: l.title, body: l.body ?? null, due_at, tags: l.tags ?? [], source: 'chat' });
  }

  // Social follow-ups: a loop tagged 'checkin', due at the follow-up time. The
  // tick worker (runCheckins) turns each into a short "how did that go?" once
  // it comes due, then closes it. Guard against a check-in scheduled in the
  // past or absurdly far out.
  for (const c of (out.checkins ?? []).slice(0, 3)) {
    if (!c.what?.trim() || !c.when) continue;
    const dueIso = localToUtcISO(c.when);
    if (!dueIso) continue;
    const ms = Date.parse(dueIso) - Date.now();
    if (ms < -3 * 3600_000 || ms > 45 * 86400_000) continue; // >3h stale, or >45d out
    await upsertLoop(userId, {
      title: `check in: ${c.what.trim()}`.slice(0, 120),
      body: c.tone?.trim() || null,
      due_at: dueIso,
      tags: ['checkin'],
      source: 'chat',
    });
  }

  for (const f of (out.facts ?? []).slice(0, 4)) {
    if (!f.key?.trim() || !f.value?.trim()) continue;
    const section = FACT_SECTIONS.includes(f.section) ? f.section : 'identity';
    // don't clobber a fact Noah already confirmed
    const { data: existing } = await adminClient
      .from('profile_facts').select('id, confirmed')
      .eq('user_id', userId).eq('section', section).eq('key', f.key.trim()).maybeSingle();
    if (existing?.confirmed) continue;
    await adminClient.from('profile_facts').upsert(
      { user_id: userId, section, key: f.key.trim(), value: f.value.trim(), source: 'chat', confirmed: false, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,section,key' },
    );
  }

  // "Self-improve, step 1": a genuine capability miss gets drafted into a spec
  // and filed as a GitHub issue (recordCapabilityGap dedupes repeats and
  // no-ops without GITHUB_TOKEN) instead of just evaporating in the thread.
  if (out.gap?.title?.trim() && out.gap.why_not_possible?.trim()) {
    await recordCapabilityGap(userId, {
      title: out.gap.title.trim(),
      whyNotPossible: out.gap.why_not_possible.trim(),
      roughApproach: out.gap.rough_approach?.trim() || undefined,
      exampleText: userText,
    }).catch((e) => console.error('[detect] capability gap', e));
  }
}

