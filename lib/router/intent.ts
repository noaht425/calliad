import { t1Json, t1Available } from '@/lib/llm/gemini';
import { audit } from '@/lib/hub/audit';

// Inference layer. The chat route dispatches off a long chain of regex guards
// (isCalendarWrite, isWatchAdd, …); anything phrased outside those falls through
// to plain chat. This is the safety net: one cheap T1 pass that reads the
// message + recent turns and names the intent behind it, however it was worded.
// It runs ONLY when no regex guard already fired, and the existing handlers
// still do their own extraction + the trust-ladder gate — this only widens what
// reaches them.

export type Intent =
  // ── actions (a handler does something) ──
  | 'calendar.create'   // schedule an event, OR state a future plan that has a time
  | 'calendar.change'   // move / rename / cancel an event that already exists
  | 'task.add'          // a to-do or reminder (no clock time of its own)
  | 'watchlist.add'     // wants to watch a show / film
  | 'watchlist.update'  // "on season 3 of X", "rate X 4 stars", "finished X"
  | 'note.remember'     // asking to remember a fact or note something down
  | 'contact.log'       // mentions having seen / talked to / called someone
  | 'taste.reaction'    // a verdict on a book/show/film/game they finished ("loved X")
  | 'beli.share'        // sharing screenshots of their Beli place list to be logged
  | 'recipe.share'      // send a recipe to A Bent Fork
  // ── lookups (a handler gathers ground data for the reply) ──
  | 'card.question'     // MTG: "what do we think of X", "how does X work / interact"
  | 'sim.request'       // "who wins between rocco and hamza", "sim the pod"
  | 'watchlist.query'   // "what's on my list", "what should I watch next"
  | 'restaurant.reco'   // "where should I eat", "somewhere good for Thai near X"
  | 'weather.query'     // "what's the weather", "will it rain tomorrow"
  | 'subscription.query'// "what am I paying for", "list my subscriptions"
  | 'recall.question'   // "what's the storage code", "what did I say about X"
  | 'none';

const ACTION_INTENTS: Intent[] = [
  'calendar.create', 'calendar.change', 'task.add', 'watchlist.add', 'watchlist.update',
  'note.remember', 'contact.log', 'taste.reaction', 'beli.share', 'recipe.share',
  'card.question', 'sim.request', 'watchlist.query', 'restaurant.reco', 'weather.query',
  'subscription.query', 'recall.question',
];

export interface IntentGuess {
  intent: Intent;
  confidence: number;   // 0–1
  person?: string | null; // contact.log — the name mentioned
}

export interface RecentTurn { role: 'user' | 'assistant'; content: string }

const PROMPT = (convo: string, msg: string) =>
  `You route messages for a personal assistant. Read the latest user message (with recent context) and name the single intent behind it — regardless of exact wording.

ACTIONS:
- calendar.create — wants an event on the calendar. INCLUDES bare statements of a future plan carrying a date/time: "concert at the Garden on the 18th", "dinner with Ana Thursday 7".
- calendar.change — move, rename, reschedule, or cancel an event that already exists.
- task.add — a to-do / reminder with no clock time ("remind me to email the landlord", "add milk to the list").
- watchlist.add — wants to watch a show/film ("add Lanterns to my list", "I should watch that new Dune").
- watchlist.update — progress or a rating on something already on the list ("I'm on season 3 of X", "rate Severance 5 stars", "finished The Bear").
- note.remember — store a fact / jot something down ("remember the storage code is 4417", "note the car's due for service").
- contact.log — mentions having just seen / talked to / called / texted someone ("caught up with Dad", "lunch with Priya"). Put the name in "person".
- taste.reaction — a verdict on a book/show/film/game they consumed ("loved Piranesi", "that movie was mid", "hated the ending").
- beli.share — sharing screenshots of their restaurant / café / bakery / dessert / bar list (from the Beli app) to be saved ("here's more of my list", "adding these bakeries", "the rest of my rankings", "my dessert spots").
- recipe.share — wants to send a recipe link to "A Bent Fork".

LOOKUPS (assistant should gather data, not act):
- card.question — Magic: the Gathering: an opinion on or mechanics of a specific card ("what do we think of the new X", "how does X interact with Y", "is X good in my deck").
- sim.request — run / ask about the EDH deck simulator ("who wins between rocco and hamza", "sim the pod 500 times", "goldfish archelos").
- watchlist.query — "what's on my watch list", "what should I watch next", "anything airing this week".
- restaurant.reco — wants a place to eat/drink/dessert ("where should I eat", "somewhere good for tacos near Cambridge", "would I like <restaurant>").
- weather.query — "what's the weather", "will it rain tomorrow", "how cold this weekend".
- subscription.query — "what am I paying for", "list my subscriptions", "how much am I spending on streaming".
- recall.question — asking for a detail he told the assistant before ("what's the storage code", "what did I say about the landlord", "when's the deadline for X").

- none — a general question, an opinion, chit-chat, a request you'd simply answer, or anything ambiguous. When unsure, choose none.

Recent context:
${convo || '(none)'}

Latest user message:
"${msg}"

Reply JSON only: {"intent":"<one of the above>","confidence":0-1,"person":"<name for contact.log, else null>"}
Be strict: a passing mention of a past or hypothetical thing is none; "what's a good venue for a concert?" is none; a general knowledge question is none.`;

/**
 * Best-effort intent for a message no regex guard matched. Returns null when T1
 * is unavailable/fails or the guess is `none` — callers treat null as "no
 * inferred intent" and fall through to normal chat.
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

  // Cap it hard — a stalled classifier must never hold up a chat turn.
  const g = await Promise.race([
    t1Json<IntentGuess>('intent_classify', PROMPT(convo, trimmed.slice(0, 500)), { conversationId, maxOutputTokens: 80 }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
  ]);

  if (!g || !ACTION_INTENTS.includes(g.intent)) return null;
  const confidence = typeof g.confidence === 'number' ? Math.max(0, Math.min(1, g.confidence)) : 0;
  await audit.log('route_decision', 'noah', conversationId ?? null, {
    stage: 'intent_classify', intent: g.intent, confidence, text: trimmed.slice(0, 120),
  });
  return { intent: g.intent, confidence, person: typeof g.person === 'string' ? g.person : null };
}
