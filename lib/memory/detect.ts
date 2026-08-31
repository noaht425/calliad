import { t1Json, t1Available } from '@/lib/llm/gemini';
import { adminClient } from '@/lib/supabase.server';
import { upsertLoop } from '@/lib/memory/loops';

const FACT_SECTIONS = ['identity', 'health', 'academics', 'work', 'languages', 'food', 'geographic', 'travel', 'people', 'recurring', 'daily rhythm', 'projects', 'interests', 'working style'];

interface Detected {
  loops: { title: string; body?: string; due_hint?: string; tags?: string[] }[];
  facts: { section: string; key: string; value: string }[];
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

  const today = new Date().toISOString().slice(0, 10);
  const prompt = `From one chat exchange, extract two things about Noah. Be conservative — empty arrays are the common case.

Today: ${today}

Noah: "${userText.slice(0, 1500)}"
Calliad: "${assistantText.slice(0, 1500)}"

Return JSON only:
{"loops":[{"title":"short handle (<8 words)","body":"one-sentence detail","due_hint":"YYYY-MM-DD if a deadline is stated/implied else omit","tags":["1-2 lowercase tags"]}],
 "facts":[{"section":"one of: ${FACT_SECTIONS.join(', ')}","key":"short slug e.g. coffee_order","value":"the fact as a complete sentence"}]}

LOOPS = things Noah committed to, is waiting on, or must decide. Not answered questions, not saved links, not bare facts.
FACTS = durable, stable things about Noah HIMSELF that he stated as true (a preference, allergy, habit, routine, relationship, where he lives/works/studies, a tool he uses, a constraint). NOT:
- transient state ("I'm tired", "busy this week")
- reactions to books/shows/films/games (handled elsewhere)
- tasks, plans, or one-off events
- anything he asked about rather than asserted
- guesses — only what he plainly said about himself
Most exchanges yield {"loops":[],"facts":[]}.`;

  const out = await t1Json<Detected>('detect_turn', prompt, { conversationId, maxOutputTokens: 500 });
  if (!out) return;

  for (const l of (out.loops ?? []).slice(0, 4)) {
    if (!l.title?.trim()) continue;
    const due_at = l.due_hint && /^\d{4}-\d{2}-\d{2}$/.test(l.due_hint) ? `${l.due_hint}T12:00:00Z` : null;
    await upsertLoop(userId, { title: l.title, body: l.body ?? null, due_at, tags: l.tags ?? [], source: 'chat' });
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
}

