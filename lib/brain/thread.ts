import { t1Text, t1Available } from '@/lib/llm/gemini';

// A rolling, plain-language summary of what the current conversation is actually
// about. Rebuilt each turn from (previous summary + latest exchange) by one
// cheap T1 pass, stored on conversations.mode_state.threadSummary, and fed back
// into the next turn's prompt. This is what lets "it", "that one", and abrupt
// topic switches resolve the way they would with a person who was in the room.

export async function summarizeThread(
  prev: string | undefined,
  userText: string,
  assistantText: string,
): Promise<string | null> {
  if (!t1Available()) return null;
  const u = userText.trim().slice(0, 1200);
  const a = assistantText.trim().slice(0, 1200);
  if (!u && !a) return prev ?? null;

  const out = await t1Text(
    'thread_summary',
    `You keep a running note of what an ongoing chat between Noah and his assistant is about, so the assistant can follow references like "it" or "that one" and handle topic changes.

Previous note:
${prev?.trim() || '(none yet)'}

Latest exchange:
Noah: "${u}"
Assistant: "${a}"

Rewrite the note. 2 to 4 sentences, plain and specific: what Noah is trying to do right now, any decision he's weighing, anything still open or unanswered, and the current topic if it just changed. Drop threads that are clearly resolved or abandoned. Keep concrete names, numbers, and dates. No preamble, just the note. If nothing meaningful is going on, reply with the single word NONE.`,
    [],
    { maxOutputTokens: 240 },
  );
  const s = out?.trim();
  if (!s || /^none\.?$/i.test(s)) return null;
  return s.slice(0, 900);
}
