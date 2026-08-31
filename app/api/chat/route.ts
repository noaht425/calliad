import { NextRequest } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { route, type Mode } from '@/lib/router/route';
import { call } from '@/lib/brain/call';
import { audit } from '@/lib/hub/audit';
import { getIntegrationContext } from '@/lib/integrations/context';
import { relevantLoops } from '@/lib/memory/loops';
import { detectLoopsFromTurn } from '@/lib/memory/detect';
import { captureLink, listItems } from '@/lib/capture/link';
import { runWebFetch } from '@/lib/tools/webfetch';
import { runMorphology } from '@/lib/tools/morphology';
import { profileSections, learnedFacts } from '@/lib/brain/profile';
import { quizTurn } from '@/lib/quiz/session';
import { addItem as addQuizItem } from '@/lib/quiz/items';
import { upsertLoop } from '@/lib/memory/loops';
import { isExplicitRemember, saveFactFromText } from '@/lib/memory/facts';
import { isTasteReaction, saveTasteFromText } from '@/lib/taste/capture';
import { proposeAction, pendingFor, decideAction } from '@/lib/actions/gate';
import { isCalendarWrite, isTaskAdd, extractEvent, whenLabel, isYes, isNo } from '@/lib/actions/detect';
import { isEmailDraft, composeEmail } from '@/lib/actions/email';
import { wouldILike } from '@/lib/taste/judge';
import { isFlightQuery, isRestaurantQuery, extractFlight, extractRestaurant } from '@/lib/travel/detect';
import { flightSearch } from '@/lib/travel/flights';
import { restaurantHandoff } from '@/lib/travel/restaurant';
import { isLyricQuery, findByLyrics } from '@/lib/tools/song';
import {
  analyzeDeck, deckBlock, getCards, cardBlock, fetchDeckFromUrl,
  looksLikeDecklist, isDeckHelp, isCardQuestion, extractCardNames,
} from '@/lib/tools/mtg';
import {
  runSimulation, runTranscript, parseSimRequest, isSimRequest, isTranscriptRequest,
} from '@/lib/tools/mtgsim';
import { getCommanderRecs, recDiff, recBlock, isEdhrecQuery } from '@/lib/tools/edhrec';
import type { TurnState } from '@/lib/brain/prompt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// a sim run polls the sim service for up to ~50s before the reply streams
export const maxDuration = 60;

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';
const enc = new TextEncoder();
const sse = (obj: unknown) => enc.encode(`data: ${JSON.stringify(obj)}\n\n`);

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return json({ error: 'Unauthorized' }, 401);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

  let body: { text?: string; conversationId?: string };
  try { body = await req.json(); } catch { return json({ error: 'Body must be JSON' }, 400); }
  const text = body.text?.trim();
  if (!text) return json({ error: 'text required' }, 400);

  // ── conversation ────────────────────────────────────────────────────────
  let conversationId = body.conversationId;
  let currentMode: Mode = 'default';
  let modeState: Record<string, unknown> = {};
  if (conversationId) {
    const { data } = await adminClient.from('conversations').select('id, mode, mode_state').eq('id', conversationId).maybeSingle();
    if (!data) conversationId = undefined;
    else { currentMode = (data.mode as Mode) ?? 'default'; modeState = (data.mode_state as Record<string, unknown>) ?? {}; }
  }
  if (!conversationId) {
    conversationId = randomUUID();
    await adminClient.from('conversations').insert({
      id: conversationId, surface: 'pwa', started_at: new Date().toISOString(), last_at: new Date().toISOString(),
    });
  }

  await audit.log('inbound_message', 'noah', conversationId, { text, surface: 'pwa' });
  await adminClient.from('messages').insert({ conversation_id: conversationId, role: 'user', content: text });
  await adminClient.from('conversations').update({ last_at: new Date().toISOString() }).eq('id', conversationId);

  const say = async (reply: string, reason: string) => {
    await adminClient.from('messages').insert({ conversation_id: conversationId!, role: 'assistant', content: reply });
    await audit.log('outbound_message', 'calliad', conversationId!, { text: reply, surface: 'pwa', reason });
    return streamResponse(conversationId!, (async function* () { yield sse({ delta: reply }); yield sse({ done: true }); })());
  };

  // ── pending action awaiting yes/no ──────────────────────────────────────
  const pending = await pendingFor(conversationId);
  if (pending && (isYes(text) || isNo(text))) {
    const r = await decideAction(user.id, pending.id, isYes(text) ? 'approved' : 'rejected', conversationId);
    return say(r.message, 'action-decided');
  }
  // a pending email draft + anything that isn't yes/no → treat it as a revision
  if (pending?.kind === 'draft_email') {
    await decideAction(user.id, pending.id, 'rejected', conversationId);
    const prior = String((pending.payload as Record<string, unknown>).request ?? '');
    const d = await composeEmail(user.id, `${prior}\n\nNoah's revision: ${text}`).catch(() => null);
    if (!d) return say(`Couldn't revise that one — say it again with a bit more detail.`, 'email-draft-failed');
    await proposeAction({
      userId: user.id, kind: 'draft_email', riskTier: 'confirm',
      summary: `Draft email to ${d.to_email ?? d.to_name ?? '(unspecified)'} — "${d.subject}"`,
      payload: { to_name: d.to_name, to_email: d.to_email, subject: d.subject, body: d.body, request: `${prior}\n\nNoah's revision: ${text}` },
      createdBy: conversationId,
    });
    return say(
      `Revised — still nothing sent.\n\n**To:** ${d.to_email ?? d.to_name ?? "(you'll need to add this)"}\n**Subject:** ${d.subject}\n\n${d.body}\n\nSay yes for the link, or keep tweaking.`,
      'email-draft-revised',
    );
  }

  // ── silent tier: add a task/reminder → open loop, no gate ───────────────
  if (isTaskAdd(text)) {
    const task = text.replace(/^.*?\b(add (a )?(task|reminder|to-?do)( to)?|remind me to|add to (my )?(to-?do|task list)|put on my to-?do)\b[:,]?\s*/i, '').trim();
    if (task) {
      await upsertLoop(user.id, { title: task.slice(0, 120), source: 'manual', tags: ['task'] });
      return say(`Added: ${task}.`, 'task-add');
    }
  }

  // ── silent tier: a reaction to a book/show/film/game → taste_log ────────
  // Runs before the profile-fact path so "remember I loved X" lands in the
  // taste log (verdict + why), not as a loose profile fact.
  if (isTasteReaction(text)) {
    const logged = await saveTasteFromText(user.id, text).catch(() => null);
    if (logged) return say(logged, 'taste-logged');
    // not actually a media reaction → fall through
  }

  // ── silent tier: "remember that I…" → confirmed profile_fact, no gate ────
  if (isExplicitRemember(text) && !isCalendarWrite(text)) {
    const saved = await saveFactFromText(user.id, text).catch(() => null);
    if (saved) return say(`Got it — I'll remember that: ${saved}`, 'fact-saved');
    // nothing concrete to store → fall through to the brain
  }

  // ── confirm tier: calendar write → propose, wait for yes ────────────────
  if (isCalendarWrite(text)) {
    const ev = await extractEvent(text).catch(() => null);
    if (!ev) return say(`I can put that on your calendar — when, exactly?`, 'calendar-write-underspecified');
    await proposeAction({
      userId: user.id, kind: 'create_event', riskTier: 'confirm',
      summary: `${ev.title} — ${whenLabel(ev.start_at, ev.all_day)}`,
      payload: { ...ev }, createdBy: conversationId,
    });
    return say(`Put **${ev.title}** on your calendar for **${whenLabel(ev.start_at, ev.all_day)}**${ev.location ? ` (${ev.location})` : ''}? Say yes and I'll add it.`, 'action-proposed');
  }

  // ── confirm tier: draft an email → compose, show it, wait for yes ───────
  if (isEmailDraft(text)) {
    const d = await composeEmail(user.id, text).catch(() => null);
    if (!d) return say(`I couldn't put that draft together — try again, or give me a bit more to go on.`, 'email-draft-failed');
    await proposeAction({
      userId: user.id, kind: 'draft_email', riskTier: 'confirm',
      summary: `Draft email to ${d.to_email ?? d.to_name ?? '(unspecified)'} — "${d.subject}"`,
      payload: { to_name: d.to_name, to_email: d.to_email, subject: d.subject, body: d.body, request: text },
      createdBy: conversationId,
    });
    return say(
      `Here's a draft — nothing's sent yet.\n\n**To:** ${d.to_email ?? d.to_name ?? "(you'll need to add this)"}\n**Subject:** ${d.subject}\n\n${d.body}\n\nSay yes and I'll hand you a link that opens it in your mail app, or tell me what to change.`,
      'email-draft-proposed',
    );
  }

  // ── inline quiz-item add: "quiz: PROMPT = ANSWER" ("greek quiz: ..." sets lang) ──
  const qm = text.match(/^(?:(latin|greek|italian|lat|grc|ita)\s+)?quiz[:\-]\s*(.+?)\s*=\s*(.+)$/i);
  if (qm) {
    const langMap: Record<string, string> = { latin: 'lat', greek: 'grc', italian: 'ita', lat: 'lat', grc: 'grc', ita: 'ita' };
    const r = await addQuizItem(user.id, { lang: langMap[qm[1]?.toLowerCase() ?? ''] ?? 'lat', prompt: qm[2], answer: qm[3] });
    const reply = r === 'added' ? `Added to your quiz deck: ${qm[2]} → ${qm[3]}.` : r === 'exists' ? `Already in the deck.` : `Couldn't add that.`;
    await adminClient.from('messages').insert({ conversation_id: conversationId, role: 'assistant', content: reply });
    await audit.log('outbound_message', 'calliad', conversationId, { text: reply, surface: 'pwa', reason: 'quiz-add' });
    return streamResponse(conversationId, (async function* () { yield sse({ delta: reply }); yield sse({ done: true }); })());
  }

  // ── frictionless capture: one URL, not a question, little other text ──
  const urls = text.match(/https?:\/\/[^\s<>"')]+/g);
  const withoutUrls = text.replace(/https?:\/\/[^\s<>"')]+/g, ' ').replace(/\s+/g, ' ').trim();
  const looksLikeQuestion = /\?\s*$/.test(text) || /^(what|who|why|how|when|where|is|are|should|can|could|do|does|tell me|explain|summar)\b/i.test(withoutUrls);
  const isCapture =
    urls?.length === 1 && !looksLikeQuestion && withoutUrls.split(' ').filter(Boolean).length <= 10;
  if (urls && isCapture) {
    const r = await captureLink(user.id, urls[0], { source: 'chat' });
    const reply = r.ok
      ? r.deduped
        ? `Already on your ${r.item.kind} list: ${r.item.title ?? r.item.url}.`
        : `Filed under ${r.item.kind}: ${r.item.title ?? r.item.url}.${r.item.descriptor ? ` ${r.item.descriptor}` : ''}`
      : `Couldn't grab that link — ${r.error}.`;
    await adminClient.from('messages').insert({ conversation_id: conversationId, role: 'assistant', content: reply });
    await audit.log('outbound_message', 'calliad', conversationId, { text: reply, surface: 'pwa', reason: 'capture' });
    return streamResponse(conversationId, (async function* () { yield sse({ delta: reply }); yield sse({ done: true }); })());
  }

  // ── web fetch: a link + a question about it, or "read the last thing I saved" ──
  const readVerb = /\b(summar(y|ise|ize|ize it)|tl;?dr|recap|what does (it|this|that|the (article|page|link)) say|what'?s (in |it about)|read (it|this|that|me)|explain (this|that|the) (article|page|link|post)|according to (this|that|the) (link|article|page)|go read)\b/i.test(text);
  const savedRef = /\b(that|the last|the latest|my (last|latest|most recent)) (link|article|page|thing i saved|bookmark)\b/i.test(text);
  const wantsWebFetch =
    !isCapture && (((urls?.length ?? 0) > 0 && (looksLikeQuestion || readVerb)) || (readVerb && savedRef));
  const webFetchUrl = urls?.[0];

  // ── route ───────────────────────────────────────────────────────────────
  const decision = await route({ source: 'pwa', kind: 'message', text, conversationId, currentMode });
  if (decision.setMode && decision.setMode !== currentMode) {
    await adminClient.from('conversations').update({ mode: decision.setMode }).eq('id', conversationId);
  }

  if (decision.handled === 'rule') {
    const reply = decision.directReply ?? '';
    if (reply) {
      await adminClient.from('messages').insert({ conversation_id: conversationId, role: 'assistant', content: reply });
      await audit.log('outbound_message', 'calliad', conversationId, { text: reply, surface: 'pwa', reason: decision.reason });
    }
    return streamResponse(conversationId, async function* () {
      if (reply) yield sse({ delta: reply });
      yield sse({ done: true });
    }());
  }

  // ── brain ───────────────────────────────────────────────────────────────
  const effectiveMode: Mode = decision.setMode ?? decision.mode;
  const [recent, integrations, loops, morphResult, learned] = await Promise.all([
    recentTurns(conversationId, text),
    getIntegrationContext(user.id, { daysAhead: 14, emailLimit: 8 }).catch(() => undefined),
    relevantLoops(user.id, { dueWithinDays: 21 }).catch(() => []),
    decision.tools.includes('morphology') ? runMorphology(text).catch(() => undefined) : Promise.resolve(undefined),
    learnedFacts(user.id).catch(() => ''),
  ]);

  const deckUrl = text.match(/https?:\/\/(?:www\.)?archidekt\.com\/(?:api\/)?decks\/\d+/)?.[0];
  const moxUrl = /https?:\/\/(?:www\.)?moxfield\.com\/decks\/[\w-]+/.test(text);
  let toolResult = morphResult;
  if (effectiveMode === 'quiz') {
    const q = await quizTurn(user.id, conversationId, text, modeState).catch(() => null);
    if (q) toolResult = q.toolResult;
  } else if (looksLikeDecklist(text) || (isDeckHelp(text) && (deckUrl || moxUrl))) {
    const listText = deckUrl ? await fetchDeckFromUrl(deckUrl).catch(() => null) : looksLikeDecklist(text) ? text : null;
    const a = listText ? await analyzeDeck(listText).catch(() => null) : null;
    if (a) {
      let block = deckBlock(a) + `\n\nNoah's message: ${text.slice(0, 500)}`;
      if (a.commander) {
        const recs = await getCommanderRecs(a.commander.name).catch(() => null);
        if (recs) block += '\n\n' + recBlock(recs, recDiff(a, recs));
      }
      toolResult = block;
    } else {
      toolResult = moxUrl
        ? `## Deck analysis\nMoxfield blocks automated access now, so Noah needs to paste the decklist text (Moxfield: "..." menu → Export → copy), or share an Archidekt link.`
        : `## Deck analysis\nCouldn't read a decklist from that${deckUrl ? ' link' : ''}. Ask Noah to paste the list or an Archidekt URL.`;
    }
  } else if (isEdhrecQuery(text)) {
    const name = extractCardNames(text)[0];
    const recs = name ? await getCommanderRecs(name).catch(() => null) : null;
    toolResult = recs
      ? recBlock(recs)
      : `## EDHREC\nCouldn't tell which commander Noah means${name ? ` ("${name}" — not found on EDHREC)` : ''}. Ask him to name it.`;
  } else if (isCardQuestion(text)) {
    const names = extractCardNames(text);
    const { found } = names.length ? await getCards(names) : { found: [] };
    toolResult = found.length ? cardBlock(found) : `## Card data\nCouldn't identify which card(s) Noah means — ask him to name them exactly.`;
  } else if (isTranscriptRequest(text)) {
    const { decks } = parseSimRequest(text);
    toolResult = await runTranscript(decks).catch(() => undefined);
  } else if (isSimRequest(text)) {
    const { decks, games } = parseSimRequest(text);
    toolResult = await runSimulation(decks, games).catch(() => undefined);
  } else if (wantsWebFetch) {
    let target = webFetchUrl;
    if (!target) target = (await listItems(user.id).catch(() => []))[0]?.url;
    toolResult = target
      ? await runWebFetch(target, text).catch(() => undefined)
      : `## Web fetch\nNoah asked about a saved link but his reading list is empty.`;
  } else if (/\b(would i (like|enjoy|hate|bounce off)|should i (watch|read|play|start|bother with)|do you think i'?d (like|enjoy)|worth (watching|reading|playing)|think i'?d (like|enjoy))\b/i.test(text)) {
    toolResult = (await wouldILike(user.id, text).catch(() => undefined)) ?? toolResult;
  } else if (isFlightQuery(text)) {
    const fp = await extractFlight(text).catch(() => null);
    toolResult = fp ? await flightSearch(fp).catch(() => undefined) : `## Flight search\nCouldn't pin down where/when — ask Noah for the destination and rough dates.`;
  } else if (isRestaurantQuery(text)) {
    const rp = await extractRestaurant(text).catch(() => null);
    if (rp) toolResult = await restaurantHandoff(rp).catch(() => undefined);
  } else if (isLyricQuery(text)) {
    toolResult = await findByLyrics(text).catch(() => undefined);
  } else if (/\b(name that song|what song is (this|that|playing)|shazam|identif(y|ies) (this|the) song|what'?s (this|that) song)\b/i.test(text)) {
    toolResult = `## Song ID\nNoah wants to identify a song that's playing but sent no audio. Tell him to hold the ♪ button in the composer while it plays — a few seconds is enough.`;
  }

  const state: TurnState = {
    now: new Date(), tz: TZ, recent, integrations, loops,
    mode: effectiveMode === 'default' ? undefined : effectiveMode,
    toolResult,
    profileSections: profileSections(text, effectiveMode),
    learned: learned || undefined,
  };
  // A tool result means a longer, denser reply is expected (deck analysis, sim
  // narration, web-page answers). 1024 is stingy there — and with adaptive effort
  // on, too small a budget can be spent entirely on reasoning, yielding no text.
  const maxTokens = toolResult ? Math.min(4096, 1500 + Math.ceil(toolResult.length / 8)) : 1200;

  const { meta, stream } = await call({
    purpose: 'chat',
    tier: decision.tier,
    proactive: false,
    conversationId,
    userText: text,
    state,
    maxTokens,
  });

  const body$ = async function* () {
    try {
      for await (const delta of stream) yield sse({ delta });
    } catch (err) {
      yield sse({ error: String(err) });
    }
    // stream is fully drained here → meta.text / meta.costUsd populated
    const finalText = meta.text || 'Something broke on my end — try that again in a minute.';
    await adminClient.from('messages').insert({ conversation_id: conversationId, role: 'assistant', content: finalText });
    await audit.log('outbound_message', 'calliad', conversationId, {
      text: finalText, surface: 'pwa', tier: meta.tier, model: meta.model, cost_usd: meta.costUsd, capped: meta.capped,
    });
    yield sse({ done: true, costUsd: meta.costUsd, mode: effectiveMode });
    // T1 pass: file any open loop this exchange opened. waitUntil keeps the
    // serverless function alive until it finishes (a bare promise would be reaped).
    waitUntil(
      detectLoopsFromTurn(user.id, text, finalText, conversationId).catch((e) =>
        console.error('[chat] loop detect', e),
      ),
    );
  }();

  return streamResponse(conversationId, body$);
}

// ── helpers ───────────────────────────────────────────────────────────────
async function recentTurns(conversationId: string, currentText: string) {
  // Last ~24 messages, chronological. (Must be newest-first + limit, then reverse —
  // ascending+limit would return the OLDEST 21 and lose the recent thread.)
  const { data } = await adminClient
    .from('messages')
    .select('role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(24);
  return (data ?? [])
    .reverse()
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    // drop the just-inserted current user message — brain.call adds it back as the turn
    .filter((m, i, arr) => !(i === arr.length - 1 && m.role === 'user' && m.content === currentText));
}

function streamResponse(conversationId: string, gen: AsyncGenerator<Uint8Array>) {
  const stream = new ReadableStream({
    async pull(controller) {
      const { value, done } = await gen.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'x-conversation-id': conversationId,
    },
  });
}

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
