import { t1Json, t1Available } from '@/lib/llm/gemini';
import { audit } from '@/lib/hub/audit';

// Inference layer. The chat route dispatches actions off a long chain of regex
// guards (isCalendarWrite, isWatchAdd, …); anything phrased outside those falls
// through to plain chat. This is the safety net: one cheap T1 pass that reads
// the message + recent turns and names the actionable intent behind it, however
// it was worded. It runs ONLY when no regex guard already fired, and the
// existing handlers still do their own extraction + the trust-ladder gate — the
// classifier just widens what reaches them.

export type Intent =
  | 'calendar.create'   // schedule an event, OR state a future plan that has a time ("going to a concert Fri")
  | 'calendar.change'   // move / rename / cancel an event that already exists
  | 'task.add'          // a to-do or reminder (no clock time of its own)
  | 'watchlist.add'     // wants to watch a show / film
  | 'note.remember'     // asking to remember a fact or note something down
  | 'contact.log'       // mentions having seen / talked to / called someone
  | 'recipe.share'      // send a recipe to A Bent Fork
  | 'none';

const ACTION_INTENTS: Intent[] = [
  'calendar.create', 'calendar.change', 'task.add', 'watchlist.add', 'note.remember', 'contact.log', 'recipe.share',
];

export interface IntentGuess {
  intent: Intent;
  confidence: number; // 0–1
}

export interface RecentTurn { role: 'user' | 'assistant'; content: string }

const PROMPT = (convo: string, msg: string) =>
  `You route messages for a personal assistant. Read the latest user message (with recent context) and name the single actionable intent behind it — regardless of exact wording.

Intents:
- calendar.create — wants an event on the calendar. INCLUDES bare statements of a future plan that carry a date or time: "I'm going to a concert at the Garden on the 18th", "dinner with Ana Thursday 7", "I have a dentist thing next Tuesday".
- calendar.change — move, rename, reschedule, or cancel an event that already exists.
- task.add — a to-do or reminder with no clock time of its own ("remind me to email the landlord", "add milk to the list").
- watchlist.add — wants to watch a show or film ("add Lanterns to my list", "I should watch that new Dune").
- note.remember — asking to store a fact or jot something down ("remember the storage code is 4417", "note that the car's due for service").
- contact.log — mentions having just seen / talked to / called / texted someone ("caught up with Dad today", "had lunch with Priya").
- recipe.share — wants to send a recipe link to "A Bent Fork".
- none — a question, an opinion, chit-chat, a request you'd simply answer, or anything ambiguous. When unsure, choose none.

Recent context:
${convo || '(none)'}

Latest user message:
"${msg}"

Reply JSON only: {"intent":"<one of the above>","confidence":0-1}
confidence is how sure you are it's that actionable intent and not just conversation. Be strict: a passing mention of a past or hypothetical event is none; "what's a good venue for a concert?" is none; "should I go to the concert?" is none.`;

/**
 * Best-effort intent for a message no regex guard matched. Returns null when T1
 * is unavailable or fails, or when the guess is `none` — callers treat null as
 * "no inferred intent" and fall through to normal chat.
 */
export async function classifyIntent(
  text: string,
  recent: RecentTurn[] = [],
  conversationId?: string | null,
): Promise<IntentGuess | null> {
  if (!t1Available()) return null;
  const trimmed = text.trim();
  if (trimmed.length < 4 || trimmed.length > 600) return null;

  const convo = recent
    .slice(-4)
    .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content.slice(0, 240)}`)
    .join('\n');

  // Cap it hard — a stalled classifier must never hold up a chat turn; a
  // timeout just falls through to normal chat.
  const g = await Promise.race([
    t1Json<IntentGuess>('intent_classify', PROMPT(convo, trimmed.slice(0, 500)), { conversationId, maxOutputTokens: 60 }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
  ]);

  if (!g || !ACTION_INTENTS.includes(g.intent)) return null;
  const confidence = typeof g.confidence === 'number' ? Math.max(0, Math.min(1, g.confidence)) : 0;
  await audit.log('route_decision', 'noah', conversationId ?? null, {
    stage: 'intent_classify', intent: g.intent, confidence, text: trimmed.slice(0, 120),
  });
  return { intent: g.intent, confidence };
}
