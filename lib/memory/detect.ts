import { t1Json, t1Available } from '@/lib/llm/gemini';
import { upsertLoop } from '@/lib/memory/loops';

interface Detected {
  loops: { title: string; body?: string; due_hint?: string; tags?: string[] }[];
}

/**
 * After a chat turn, a cheap T1 pass: did Noah open (or close) a thread worth
 * tracking? Extracts open loops and files them. Fire-and-forget from /api/chat.
 * No-op when T1 (Gemini) isn't configured.
 */
export async function detectLoopsFromTurn(
  userId: string,
  userText: string,
  assistantText: string,
  conversationId: string | null,
): Promise<void> {
  if (!t1Available()) return;

  const today = new Date().toISOString().slice(0, 10);
  const prompt = `You extract "open loops" — things Noah has committed to, is waiting on, or needs to decide — from one chat exchange. Only real threads worth tracking, not small talk or answered questions.

Today: ${today}

Noah: "${userText.slice(0, 1500)}"
Calliad: "${assistantText.slice(0, 1500)}"

Return JSON only:
{"loops":[{"title":"short handle (<8 words)","body":"one-sentence detail","due_hint":"YYYY-MM-DD if a deadline is stated or clearly implied, else omit","tags":["1-2 lowercase tags"]}]}

Rules:
- 0 loops is normal and common. Return {"loops":[]} unless there's something concrete.
- No loop for a question Calliad already answered, or a fact Noah just stated with nothing pending.
- No loop for a link/article/video Noah saved or bookmarked — that's handled elsewhere.
- due_hint only when a date is actually determinable.`;

  const out = await t1Json<Detected>('detect_loops', prompt, { conversationId, maxOutputTokens: 400 });
  if (!out?.loops?.length) return;

  for (const l of out.loops.slice(0, 4)) {
    if (!l.title?.trim()) continue;
    const due_at =
      l.due_hint && /^\d{4}-\d{2}-\d{2}$/.test(l.due_hint) ? `${l.due_hint}T12:00:00Z` : null;
    await upsertLoop(userId, {
      title: l.title,
      body: l.body ?? null,
      due_at,
      tags: l.tags ?? [],
      source: 'chat',
    });
  }
}
