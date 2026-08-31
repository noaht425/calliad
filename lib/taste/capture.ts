import { adminClient } from '@/lib/supabase.server';
import { t1Json, t1Available } from '@/lib/llm/gemini';

// Chat → taste_log. When Noah reacts to a specific book / show / film / game,
// file it as a verdict he can lean on later ("would I like X?") instead of
// letting it fall into Open Loops or vanish. Silent tier — he said it directly.

const VERDICTS = ['loved', 'liked', 'fine', 'bailed', 'hated'] as const;
type Verdict = (typeof VERDICTS)[number];
const KINDS = ['book', 'screen', 'game', 'music', 'other'] as const;

/** Cheap gate before spending a T1 call. Reaction-ish phrasing about media. */
export const isTasteReaction = (t: string) =>
  /\b(loved|hated|adored|obsessed with|couldn'?t (get|stand)|bailed on|gave up on|dropped it|dnf|binged|re-?read|re-?watched|finished|just (watched|read|played|finished|started)|been (watching|reading|playing))\b/i.test(t) ||
  /\b(add .{1,60} to (my )?(taste log|the log)|for the taste log|log this[:,]? )/i.test(t) ||
  /\b(was|were|it'?s|that'?s) (so |really |pretty |kind of |such )?(good|great|amazing|incredible|fantastic|excellent|boring|mid|meh|fine|okay|ok|a slog|overrated|underwhelming|disappointing|a letdown|not for me)\b/i.test(t);

export async function saveTasteFromText(userId: string, text: string): Promise<string | null> {
  if (!t1Available()) return null;
  const out = await t1Json<{ ok: boolean; title: string; kind: string; verdict: string; why: string }>(
    'taste_capture',
    `Noah is reacting to a specific creative work (book, TV show, film, video game, or music) he read/watched/played.
Extract it. "${text.slice(0, 600)}"
Return {"ok":true|false,"title":"canonical title only","kind":"book|screen|game|music|other","verdict":"loved|liked|fine|bailed|hated","why":"his reason in a short phrase, or \\"\\" if none given"}
- ok=false if there's no specific named work, or no clear reaction (a plan to watch something is not a reaction).
- "bailed" = started but didn't finish. "fine" = neutral/lukewarm. "hated" = active dislike.`,
    { maxOutputTokens: 120 },
  );
  if (!out?.ok || !out.title?.trim()) return null;

  const title = out.title.trim();
  const kind = (KINDS as readonly string[]).includes(out.kind) ? out.kind : 'other';
  const verdict: Verdict = (VERDICTS as readonly string[]).includes(out.verdict) ? (out.verdict as Verdict) : 'liked';
  const why = out.why?.trim() || null;

  // taste_log has no unique key — match on title, update if it's already there
  // (opinions change: "loved it" → "actually it dragged").
  const { data: existing } = await adminClient
    .from('taste_log')
    .select('id, verdict, why')
    .eq('user_id', userId)
    .ilike('title', title)
    .limit(1);

  if (existing?.length) {
    const row = existing[0];
    await adminClient.from('taste_log').update({ verdict, why: why ?? row.why }).eq('id', row.id);
    return row.verdict === verdict
      ? `Already had ${title} as "${verdict}" — noted.`
      : `Updated ${title}: ${row.verdict} → ${verdict}.`;
  }

  await adminClient.from('taste_log').insert({
    user_id: userId, title, kind, verdict, why, dated: new Date().toISOString().slice(0, 10),
  });
  return `Logged: ${title} — ${verdict}${why ? ` (${why})` : ''}.`;
}
