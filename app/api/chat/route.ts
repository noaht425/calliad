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
import { detectFromTurn } from '@/lib/memory/detect';
import { captureLink, listItems } from '@/lib/capture/link';
import { runWebFetch } from '@/lib/tools/webfetch';
import { runMorphology } from '@/lib/tools/morphology';
import { profileSections, learnedFacts } from '@/lib/brain/profile';
import { quizTurn } from '@/lib/quiz/session';
import { addItem as addQuizItem } from '@/lib/quiz/items';
import { upsertLoop, RECUR_LABEL } from '@/lib/memory/loops';
import { isExplicitRemember, saveFactFromText } from '@/lib/memory/facts';
import { isNoteCapture, extractNote, saveNote, isRecallQuestion, isLookupQuestion, searchNotes, notesRecallBlock, maybeIndexTurn } from '@/lib/memory/notes';
import { isTasteReaction, saveTasteFromText } from '@/lib/taste/capture';
import { proposeAction, pendingFor, decideAction } from '@/lib/actions/gate';
import { isAutoAllowed, runAutoCreateEvent, isUndo, undoLastAuto } from '@/lib/actions/auto';
import { isCalendarWrite, isTaskAdd, extractEvent, whenLabel, isYes, isNo, isCalendarChange, extractCalendarChange, findEventByHint } from '@/lib/actions/detect';
import { extractTask } from '@/lib/actions/task';
import { classifyMedReply, recordMed, medContextLine } from '@/lib/health/meds';
import { isEmailDraft, composeEmail } from '@/lib/actions/email';
import { wouldILike } from '@/lib/taste/judge';
import { isFlightQuery, isRestaurantQuery, extractFlight, extractRestaurant } from '@/lib/travel/detect';
import { prefsLine } from '@/lib/profile/prefs';
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
import { isWeatherQuery, runForecast } from '@/lib/tools/weather';
import { isRecipeQuery, runRecipe } from '@/lib/tools/recipes';
import { isRecipeShare, extractShareUrl, shareRecipeToAbentfork } from '@/lib/tools/abentfork';
import { isBeliShare, extractBeli, saveBeliRows, restaurantPrefsBlock, isRestaurantTasteQuery, restaurantTasteBlock } from '@/lib/tools/beli';
import { detectRelationshipMention, relationshipFor, findContacts, contactContextLine, detectContactLog, logContact, occasionsContextLine } from '@/lib/integrations/icloud-contacts';
import { isSaveRequest, sweepConversation, commitSweepItems, type SweepItem } from '@/lib/memory/sweep';
import { isTidyRequest, scanForTidy, applyTidyItems, type TidyItem } from '@/lib/memory/tidy';
import {
  riddleOfTheDay, isRiddleRequest, isRiddleReveal, extractRiddleGuess, checkRiddle,
  newSprint, isMathSprintStart, sprintResult,
  newRootsQuiz, isRootsQuizStart, rootsPrompt, checkRoots, recordRootResult,
  recordScore, bestScore,
  type RiddleState, type SprintState, type RootsState,
} from '@/lib/games/play';
import { RIDDLES } from '@/lib/games/riddles';
import { ROOTS } from '@/lib/games/roots';
import { isTripPlan, extractTrip, createTrip, tripsContextLine } from '@/lib/travel/trips';
import { locationContextLine } from '@/lib/location/rules';
import {
  behaviorContextLine, isBehaviorRuleStatement, saveExplicitRule,
  pendingRulePrompt, resolveRulePrompt,
} from '@/lib/brain/behavior';
import { isUnsubscribeMention, noteUnsubscribeFromChat } from '@/lib/mail/unsubscribes';
import { isSubscriptionAdd, isSubscriptionQuery, extractSubscriptions, upsertSubscription, subscriptionsSummary } from '@/lib/money/subscriptions';
import {
  isWatchAdd, isWatchUpdate, isWatchQuery, extractWatchTitle, addWatchFromText,
  upgradeWatchRowViaWeb, looksVague,
  applyWatchUpdate, listWatch, watchListBlock, watchContextLine,
} from '@/lib/tools/watchlist';
import {
  isWatchPageAdd, extractPageWatch, isWeatherWatchAdd, extractWeatherWatch,
  isFlightWatch, extractFlightWatch,
  isWatcherList, isWatcherRemove, extractWatcherRemoveHint,
} from '@/lib/watch/detect';
import { createWatcher, listWatchers, matchWatcher, removeWatcher } from '@/lib/watch/watchers';
import { flightStatusAvailable } from '@/lib/watch/flight';
import type { TurnState } from '@/lib/brain/prompt';
import { personaExtra, presetOverlay, resolvePreset, detectPresetSwitch, PRESETS } from '@/lib/brain/persona';
import { detectPracticeLang, detectPracticeExit, practiceOverlay, type PracticeLang } from '@/lib/brain/practice';
import { config } from '@/lib/hub/config';

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

  // Internal callers (the Telegram bridge, the tick worker) present TICK_SECRET
  // plus an x-calliad-user header instead of a Supabase session JWT.
  const svcUser = req.headers.get('x-calliad-user');
  let user: { id: string };
  if (process.env.TICK_SECRET && token === process.env.TICK_SECRET && svcUser) {
    user = { id: svcUser };
  } else {
    const { data: { user: authed }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authed) return json({ error: 'Unauthorized' }, 401);
    user = authed;
  }

  let body: { text?: string; conversationId?: string; image?: string; images?: string[]; surface?: string };
  try { body = await req.json(); } catch { return json({ error: 'Body must be JSON' }, 400); }
  const surface = body.surface === 'telegram' ? 'telegram' : 'pwa';

  // optional attached photos — data URLs "data:image/jpeg;base64,…". Accept the
  // legacy single `image` too. Cap at 8 shots and ~5MB raw each.
  const rawImages = [...(body.images ?? []), ...(body.image ? [body.image] : [])].slice(0, 8);
  const images: { media_type: string; data: string }[] = [];
  for (const s of rawImages) {
    const m = s.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
    if (!m) continue;
    if (m[2].length > 7_000_000) return json({ error: 'image too large' }, 413);
    images.push({ media_type: m[1], data: m[2] });
  }
  const text = body.text?.trim() ?? '';
  if (!text && !images.length) return json({ error: 'text or image required' }, 400);

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
      id: conversationId, surface, started_at: new Date().toISOString(), last_at: new Date().toISOString(),
    });
  }

  const loggedText = text || (images.length ? `📷 (${images.length === 1 ? 'photo' : `${images.length} photos`})` : text);
  await audit.log('inbound_message', 'noah', conversationId, { text: loggedText, images: images.length, surface });
  await adminClient.from('messages').insert({ conversation_id: conversationId, role: 'user', content: loggedText });
  await adminClient.from('conversations').update({ last_at: new Date().toISOString() }).eq('id', conversationId);

  const say = async (reply: string, reason: string) => {
    await adminClient.from('messages').insert({ conversation_id: conversationId!, role: 'assistant', content: reply });
    await audit.log('outbound_message', 'calliad', conversationId!, { text: reply, surface, reason });
    return streamResponse(conversationId!, (async function* () { yield sse({ delta: reply }); yield sse({ done: true }); })());
  };

  const medLine = await medContextLine(user.id).catch(() => '');

  // ── pending action awaiting yes/no ──────────────────────────────────────
  const pending = await pendingFor(conversationId);
  if (pending && (isYes(text) || isNo(text))) {
    const r = await decideAction(user.id, pending.id, isYes(text) ? 'approved' : 'rejected', conversationId);
    return say(r.message, 'action-decided');
  }

  // ── undo the last auto-action (trust ladder) ──────────────────────────
  if (!pending && isUndo(text)) {
    const msg = await undoLastAuto(user.id, conversationId).catch(() => null);
    if (msg) return say(msg, 'auto-undo');
    // nothing recent to undo → fall through to the brain
  }

  // ── yes/no on a proposed learned behavior rule ───────────────────────
  if (!pending && (isYes(text) || isNo(text) || /\b(make it a rule|do it|go ahead|leave it|don'?t bother)\b/i.test(text))) {
    const rp = await pendingRulePrompt(user.id).catch(() => null);
    if (rp) {
      const accept = isYes(text) || /\b(make it a rule|do it|go ahead|sure|ok(ay)?)\b/i.test(text);
      const msg = await resolveRulePrompt(user.id, accept).catch(() => null);
      if (msg) return say(msg, 'behavior-rule-resolve');
    }
  }

  // ── medication check-in reply ─────────────────────────────────────────
  const medReply = classifyMedReply(text);
  if (medReply === 'took' || (!pending && medLine && /^\s*(yes|yep|yeah|yup|ya|done|did|took (them|it))\b/i.test(text))) {
    await recordMed(user.id, true);
    return say('Good.', 'med-reply');
  }
  if (medReply === 'not-yet') {
    await recordMed(user.id, false, 'not yet');
    return say('Okay — I’ll check once more later, then leave it.', 'med-reply');
  }

  // ── language practice: "reply to me in French" / "back to English" ────
  const curPractice = modeState.practiceLang as PracticeLang | undefined;
  if (curPractice && detectPracticeExit(text)) {
    // the same message may also carry a riddle guess ("...and the answer is X")
    const rs = modeState.riddle as RiddleState | undefined;
    const g = rs && !rs.revealed ? extractRiddleGuess(text) : null;
    let riddleTail = '';
    if (rs && g) {
      const solved = checkRiddle(rs.id, g);
      modeState.riddle = { ...rs, revealed: solved };
      if (solved) { await recordScore(user.id, 'riddle', 1, { id: rs.id }); riddleTail = ` And yes — the riddle was **${RIDDLES[rs.id].a}**.`; }
      else riddleTail = ` Not the riddle answer, though — say "answer" to give up.`;
    }
    await adminClient.from('conversations')
      .update({ mode_state: { ...modeState, practiceLang: undefined } })
      .eq('id', conversationId);
    return say(`Back to English.${riddleTail}`, 'practice-exit');
  }
  {
    const pl = detectPracticeLang(text);
    if (pl && (!curPractice || curPractice.name !== pl.name || curPractice.level !== pl.level)) {
      await adminClient.from('conversations').update({ mode_state: { ...modeState, practiceLang: pl } }).eq('id', conversationId);
      return say(
        `${pl.name} it is (${pl.level}). I'll reply in ${pl.name} from here — say "back to English" to stop.`,
        'practice-enter',
      );
    }
  }

  // ── personality preset switch ────────────────────────────────────────
  const presetSwitch = detectPresetSwitch(text);
  if (presetSwitch && text.trim().split(/\s+/).length <= 9) {
    const next = presetSwitch === 'default' ? undefined : presetSwitch;
    await adminClient.from('conversations').update({ mode_state: { ...modeState, preset: next } }).eq('id', conversationId);
    return say(next ? `Switched — ${PRESETS[next]?.label ?? next}.` : 'Back to normal.', 'preset-switch');
  }

  // A language-practice thread is a conversation. The English-command intent
  // handlers below (calendar, tasks, watch list, taste, games, capture…) misfire
  // on foreign text and on the user explaining in English what they want to say,
  // so skip them entirely and let the brain (with the practice overlay) answer.
  // "back to English" and language/preset switches above still work.
  if (!modeState.practiceLang) {

  // ── memory games: math sprint (answer flow) ──────────────────────────
  const sprint = modeState.sprint as SprintState | undefined;
  if (sprint?.problems?.length) {
    const patchMode = (extra: Record<string, unknown>) =>
      adminClient.from('conversations').update({ mode_state: { ...modeState, sprint: undefined, ...extra } }).eq('id', conversationId);
    if (/^\s*(stop|done|quit|end|exit)\b/i.test(text)) {
      await patchMode({});
      const r = sprintResult(sprint);
      await recordScore(user.id, 'math_sprint', r.score, { ms: r.ms, of: sprint.problems.length });
      return say(`Stopped — ${r.line}.`, 'sprint-stop');
    }
    const num = text.trim().match(/-?\d+(?:\.\d+)?/);
    if (!num) return say(`Just the number, or "stop". ${sprint.problems[sprint.idx].q} = ?`, 'sprint-reprompt');
    const cur = sprint.problems[sprint.idx];
    const right = Math.abs(parseFloat(num[0]) - cur.a) < 1e-6;
    const next: SprintState = { ...sprint, idx: sprint.idx + 1, correct: sprint.correct + (right ? 1 : 0) };
    if (next.idx >= next.problems.length) {
      await adminClient.from('conversations').update({ mode_state: { ...modeState, sprint: undefined } }).eq('id', conversationId);
      const r = sprintResult(next);
      await recordScore(user.id, 'math_sprint', r.score, { ms: r.ms, of: next.problems.length });
      const pb = await bestScore(user.id, 'math_sprint').catch(() => null);
      const pbLine = pb ? ` Best: ${pb.score}/${next.problems.length}${pb.detail.ms ? ` in ${Math.round(Number(pb.detail.ms) / 1000)}s` : ''}.` : '';
      return say(`${right ? '✓' : `✗ (${cur.a})`} — that's the set. **${r.line}.**${pbLine}`, 'sprint-done');
    }
    await adminClient.from('conversations').update({ mode_state: { ...modeState, sprint: next } }).eq('id', conversationId);
    return say(`${right ? '✓' : `✗ (${cur.a})`}  ·  ${next.idx + 1}/${next.problems.length}:  ${next.problems[next.idx].q} = ?`, 'sprint-next');
  }

  // ── memory games: roots quiz (answer flow) ──────────────────────────
  const rq = modeState.roots as RootsState | undefined;
  if (rq?.order?.length) {
    if (/^\s*(stop|done|quit|end|exit)\b/i.test(text)) {
      await adminClient.from('conversations').update({ mode_state: { ...modeState, roots: undefined } }).eq('id', conversationId);
      return say(`Stopped — ${rq.correct}/${rq.i} so far.`, 'roots-stop');
    }
    const { ok, want } = checkRoots(rq, text);
    await recordRootResult(user.id, ROOTS[rq.order[rq.i]].root, ok).catch(() => {});
    const advanced: RootsState = { ...rq, i: rq.i + 1, correct: rq.correct + (ok ? 1 : 0) };
    const mark = ok ? '✓' : `✗ (${want})`;
    if (advanced.i >= 8 || advanced.i >= advanced.order.length) {
      await adminClient.from('conversations').update({ mode_state: { ...modeState, roots: undefined } }).eq('id', conversationId);
      await recordScore(user.id, 'roots_quiz', advanced.correct, { of: advanced.i });
      const pb = await bestScore(user.id, 'roots_quiz').catch(() => null);
      return say(`${mark} — done. **${advanced.correct}/${advanced.i}.**${pb ? ` Best: ${pb.score}/${pb.detail.of ?? 8}.` : ''}`, 'roots-done');
    }
    await adminClient.from('conversations').update({ mode_state: { ...modeState, roots: advanced } }).eq('id', conversationId);
    const p = rootsPrompt(advanced);
    return say(`${mark}\n\n${advanced.i + 1}. ${p.text}`, 'roots-next');
  }

  // ── memory games: riddle guess / reveal ─────────────────────────────
  const riddleSt = modeState.riddle as RiddleState | undefined;
  // Not while a language-practice thread is live — short replies there are
  // conversation, not riddle guesses.
  if (riddleSt && !riddleSt.revealed && !modeState.practiceLang && Date.now() - riddleSt.at < 12 * 3600000) {
    if (isRiddleReveal(text)) {
      await adminClient.from('conversations').update({ mode_state: { ...modeState, riddle: { ...riddleSt, revealed: true } } }).eq('id', conversationId);
      return say(`${RIDDLES[riddleSt.id].a}`, 'riddle-reveal');
    }
    const guess = extractRiddleGuess(text);
    if (guess) {
      if (checkRiddle(riddleSt.id, guess)) {
        await adminClient.from('conversations').update({ mode_state: { ...modeState, riddle: { ...riddleSt, revealed: true } } }).eq('id', conversationId);
        await recordScore(user.id, 'riddle', 1, { id: riddleSt.id });
        return say(`Got it — ${RIDDLES[riddleSt.id].a}`, 'riddle-solved');
      }
      const hint = RIDDLES[riddleSt.id].hint;
      return say(`Not it.${hint ? ` Hint: ${hint}` : ''} Say "answer" to give up.`, 'riddle-wrong');
    }
    // not a guess → fall through to the brain, riddle stays pending
  }

  // ── context sweep: pick response to a pending "worth saving" list ──────
  const pendingSweep = (modeState.sweep as SweepItem[] | undefined) ?? undefined;
  if (pendingSweep?.length && /^\s*(all|none|no(pe|thing)?|\d+([,\s]+\d+)*|\d+\s*[-–]\s*\d+)\s*$/i.test(text)) {
    const t = text.trim().toLowerCase();
    let chosen: SweepItem[] = [];
    if (t === 'all') chosen = pendingSweep;
    else if (/^(none|no|nope|nothing)$/.test(t)) chosen = [];
    else {
      const rng = t.match(/^(\d+)\s*[-–]\s*(\d+)$/);
      const idxs = rng
        ? Array.from({ length: +rng[2] - +rng[1] + 1 }, (_, k) => +rng[1] + k)
        : t.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n));
      chosen = idxs.map((n) => pendingSweep[n - 1]).filter(Boolean);
    }
    await adminClient.from('conversations').update({ mode_state: { ...modeState, sweep: undefined } }).eq('id', conversationId);
    const recap = chosen.length ? await commitSweepItems(user.id, chosen) : 'Left it all.';
    return say(recap, 'sweep-commit');
  }

  // ── tidy: pick response to a pending "fix these?" list ────────────────
  const pendingTidy = (modeState.tidy as TidyItem[] | undefined) ?? undefined;
  if (pendingTidy?.length && /^\s*(all|none|no(pe|thing)?|\d+([,\s]+\d+)*|\d+\s*[-–]\s*\d+)\s*$/i.test(text)) {
    const t = text.trim().toLowerCase();
    let chosen: TidyItem[] = [];
    if (t === 'all') chosen = pendingTidy;
    else if (/^(none|no|nope|nothing)$/.test(t)) chosen = [];
    else {
      const rng = t.match(/^(\d+)\s*[-–]\s*(\d+)$/);
      const idxs = rng
        ? Array.from({ length: +rng[2] - +rng[1] + 1 }, (_, k) => +rng[1] + k)
        : t.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n));
      chosen = idxs.map((n) => pendingTidy[n - 1]).filter(Boolean);
    }
    await adminClient.from('conversations').update({ mode_state: { ...modeState, tidy: undefined } }).eq('id', conversationId);
    const recap = chosen.length ? await applyTidyItems(user.id, chosen) : 'Left it as is.';
    return say(recap, 'tidy-apply');
  }

  // ── "tidy up / any duplicates" → scan + propose ──────────────────────
  if (isTidyRequest(text)) {
    const items = await scanForTidy(user.id).catch(() => []);
    if (!items.length) return say(`Your lists look clean — nothing to tidy.`, 'tidy-empty');
    await adminClient.from('conversations').update({ mode_state: { ...modeState, tidy: items } }).eq('id', conversationId);
    const list = items.map((it, i) => `${i + 1}. ${it.summary}`).join('\n');
    return say(`Here's what I'd tidy:\n${list}\n\nReply with the numbers to apply (e.g. "1 3"), "all", or "none".`, 'tidy-proposed');
  }

  // ── memory games: start ─────────────────────────────────────────────
  if (isMathSprintStart(text)) {
    const s = newSprint();
    await adminClient.from('conversations').update({ mode_state: { ...modeState, sprint: s } }).eq('id', conversationId);
    return say(`Math sprint — ${s.problems.length} problems, just the number, "stop" to bail.\n\n1/${s.problems.length}:  ${s.problems[0].q} = ?`, 'sprint-start');
  }
  if (isRootsQuizStart(text)) {
    const s = await newRootsQuiz(user.id);
    await adminClient.from('conversations').update({ mode_state: { ...modeState, roots: s } }).eq('id', conversationId);
    return say(`Roots quiz — 8 questions, "stop" to bail.\n\n1. ${rootsPrompt(s).text}`, 'roots-start');
  }
  if (isRiddleRequest(text)) {
    const r = riddleOfTheDay();
    const existing = modeState.riddle as RiddleState | undefined;
    // keep today's if already going and unsolved; otherwise (re)seed
    const st: RiddleState = existing && existing.id === r.id ? existing : { id: r.id, revealed: false, at: Date.now() };
    await adminClient.from('conversations').update({ mode_state: { ...modeState, riddle: st } }).eq('id', conversationId);
    return say(st.revealed ? `${r.q}\n\n(You already had this one — ${r.a})` : r.q, 'riddle');
  }

  // ── "save anything from this chat" → sweep + propose ──────────────────
  if (isSaveRequest(text)) {
    const items = await sweepConversation(user.id, conversationId).catch(() => []);
    if (!items.length) return say(`Nothing here that isn't already on file.`, 'sweep-empty');
    await adminClient.from('conversations').update({ mode_state: { ...modeState, sweep: items } }).eq('id', conversationId);
    const list = items.map((it, i) => `${i + 1}. ${it.summary}`).join('\n');
    return say(`Worth keeping:\n${list}\n\nReply with the numbers to save (e.g. "1 3"), "all", or "none".`, 'sweep-proposed');
  }

  // ── "my niece Jessica" → resolve + offer to fix her relationship ───────
  const relMention = detectRelationshipMention(text);
  if (relMention && !isTaskAdd(text)) {
    const want = relationshipFor(relMention.term);
    const matches = await findContacts(user.id, relMention.name).catch(() => []);
    const exact = matches.filter(
      (c) => c.name.toLowerCase() === relMention.name.toLowerCase() || (c.first_name ?? '').toLowerCase() === relMention.name.toLowerCase().split(' ')[0],
    );
    if (want && exact.length === 1 && exact[0].relationship !== want) {
      const c = exact[0];
      await proposeAction({
        userId: user.id, kind: 'set_relationship', riskTier: 'confirm',
        summary: `Set ${c.name} as ${want} (${relMention.term.toLowerCase()})`,
        payload: { contactId: c.id, name: c.name, from: c.relationship, to: want, note: relMention.term.toLowerCase() },
        createdBy: conversationId,
      });
      const cur = c.relationship ? `You've got them as ${c.relationship_note || c.relationship}` : 'They aren’t filed under a relationship';
      return say(`Did you mean **${c.name}**? ${cur}. Say yes and I’ll set them as ${want} (${relMention.term.toLowerCase()}).`, 'relationship-proposed');
    }
    if (want && exact.length > 1) {
      return say(`A few matches for ${relMention.name}: ${exact.map((c) => c.name + (c.org ? ` (${c.org})` : '')).join(', ')}. Which one?`, 'relationship-ambiguous');
    }
    // 0 matches or already correct → fall through; the brain still gets contact context
  }

  // ── silent tier: "talked to Mom today" / "had lunch with Dave" → log contact ──
  {
    const who = detectContactLog(text);
    if (who) {
      const c = (await findContacts(user.id, who).catch(() => []))[0];
      if (c && (c.name.toLowerCase() === who.toLowerCase() || (c.first_name ?? '').toLowerCase() === who.toLowerCase().split(' ')[0])) {
        await logContact(user.id, c.id).catch(() => {});
        return say(`Noted — last caught up with ${c.name.split(' ')[0]} today.`, 'contact-logged');
      }
      // no known contact by that name → fall through to the brain
    }
  }

  // ── "send this recipe to A Bent Fork" → POST to the recipe site ────────
  if (isRecipeShare(text)) {
    const url = extractShareUrl(text);
    if (url) {
      const notes = text.replace(url, '').replace(/\b(share|send|add|put|post|submit|save|this|the|recipe|to|on|with|into|a[- ]?bent[- ]?fork|abentfork|can you|please|:)\b/gi, ' ').replace(/\s+/g, ' ').trim();
      const r = await shareRecipeToAbentfork(url, notes.length > 4 ? notes : undefined).catch(
        () => ({ ok: false, message: "Something broke sending that to A Bent Fork." }),
      );
      return say(r.message, r.ok ? 'abentfork-share' : 'abentfork-share-failed');
    }
  }

  // ── a Beli screenshot → extract restaurants into restaurant_prefs ───────
  // Explicit ("beli" / "my restaurant rankings") OR a bare screenshot with no
  // caption — in the bare case, a non-restaurant image just falls through to the
  // normal vision answer.
  const beliExplicit = images.length > 0 && isBeliShare(text);
  if (beliExplicit || (images.length > 0 && !text.trim())) {
    const { rows } = await extractBeli(images).catch(() => ({ rows: [] }));
    if (rows.length) {
      const { added, updated } = await saveBeliRows(user.id, rows);
      const top = rows.filter((r) => r.score != null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 4).map((r) => `${r.name} (${r.score})`);
      return say(
        `Got ${added + updated} — ${added} new, ${updated} updated.${top.length ? ` Top of this batch: ${top.join(', ')}.` : ''} Send more screenshots to fill it out.`,
        'beli-extract',
      );
    }
    if (beliExplicit) return say(`I couldn't read a restaurant list off ${images.length > 1 ? 'those' : 'that'} — try a clearer screenshot of the ranked or want-to-try view.`, 'beli-empty');
    // bare screenshot(s), not a restaurant list → let the vision path handle it
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

  // ── silent tier: "I pay $12/mo for X" (one or several) → subscriptions ──
  // Checked before task-add: "…due on the 6th of every month…" would otherwise
  // trip the recurring-task detector.
  if (isSubscriptionAdd(text)) {
    const subs = await extractSubscriptions(text).catch(() => []);
    if (subs.length) {
      const names: string[] = [];
      for (const s of subs) { await upsertSubscription(user.id, s); names.push(s.name); }
      const money = (c: number) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
      const detail = subs.map((s) => `${s.name} ${money(s.amount_cents)}/${s.cadence.replace('ly', '')}${s.next_charge ? ` (next ${s.next_charge})` : ''}`).join(', ');
      return say(`Tracking ${subs.length === 1 ? '' : `${subs.length}: `}${detail}.`, 'subscription-add');
    }
    // couldn't parse any → fall through
  }

  // ── silent tier: add a task → open loop (tagged 'task'), no gate ────────
  if (isTaskAdd(text) && !isSubscriptionAdd(text)) {
    const { title, due_at, recur } = await extractTask(text).catch(() => ({ title: text.trim(), due_at: null, recur: null }));
    if (title) {
      // "remind me to watch <show>" with no time attached is really a watch-list add
      const wm = !due_at && !recur ? /^\s*watch(?:ing)?\s+(.+)$/i.exec(title) : null;
      if (wm) {
        const r = await addWatchFromText(user.id, wm[1], 'want', text).catch(() => null);
        if (r?.row) {
          const upgrading = !r.row.tmdb_id && looksVague(wm[1]);
          if (upgrading) waitUntil(upgradeWatchRowViaWeb(user.id, r.row.id, wm[1]));
          const tail = r.row.tmdb_id
            ? ''
            : upgrading
              ? " I'll pin down the exact title in a moment — check /watch."
              : " (couldn't find it on TMDB — added by name)";
          return say(
            `Put **${r.row.title}**${r.row.year ? ` (${r.row.year})` : ''} on your watch list — want to watch${r.row.streaming[0] ? ` · ${r.row.streaming[0]}` : ''}.${tail}`,
            'watch-add',
          );
        }
        // add failed → fall through and keep it as a task
      }
      await upsertLoop(user.id, { title, due_at, recur, source: 'manual', tags: ['task'] });
      const whenNote = due_at
        ? ` — ${recur ? 'first due ' : 'due '}${new Date(due_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ })}`
        : '';
      const recurNote = recur ? ` (${RECUR_LABEL[recur]})` : '';
      return say(`Added: ${title}${whenNote}${recurNote}.`, 'task-add');
    }
  }

  // ── silent tier: "I'm going to <place> <dates>" → trip record for prep nudges ──
  if (isTripPlan(text) && !isTaskAdd(text)) {
    const t = await extractTrip(text).catch(() => null);
    if (t) {
      const trip = await createTrip(user.id, t);
      const range = t.end_date ? `${fmtDay(t.start_date)}–${fmtDay(t.end_date)}` : fmtDay(t.start_date);
      return say(
        trip
          ? `Noted your trip to ${t.destination}, ${range}. I'll nudge you on prep (bank, mail hold, airport plan, IDP if you'll need one) as it gets closer.`
          : `Already had that ${t.destination} trip on file.`,
        'trip-noted',
      );
    }
    // couldn't pin it down → fall through to the brain
  }

  // ── silent tier: "I unsubscribed from X" → track + verify ────────────
  if (isUnsubscribeMention(text)) {
    const msg = await noteUnsubscribeFromChat(user.id, text).catch(() => null);
    if (msg) return say(msg, 'unsub-noted');
  }

  // ── silent tier: watchers — page / weather / list / remove ────────────
  if (isWatcherRemove(text)) {
    const hint = extractWatcherRemoveHint(text);
    const w = hint ? await matchWatcher(user.id, hint).catch(() => null) : null;
    if (w) {
      await removeWatcher(user.id, w.id);
      return say(`Stopped watching **${w.label}**.`, 'watcher-remove');
    }
    if (hint) return say(`I'm not watching anything matching "${hint}". Say "what are you watching" to see the list.`, 'watcher-remove-nomatch');
  }
  if (isWatcherList(text)) {
    const rows = (await listWatchers(user.id).catch(() => [])).filter((r) => r.status !== 'done');
    if (!rows.length) return say(`Not watching anything right now.`, 'watcher-list');
    const line = rows.map((r) => `• ${r.label}${r.status === 'paused' ? ' (paused)' : ''}`).join('\n');
    return say(`Watching:\n${line}`, 'watcher-list');
  }
  if (isWatchPageAdd(text)) {
    const p = extractPageWatch(text);
    if (p) {
      let host = p.url;
      try { host = new URL(p.url).hostname.replace(/^www\./, ''); } catch { /* keep raw */ }
      const label = p.forWhat ? `${host} — ${p.forWhat}` : `${host} (any change)`;
      const w = await createWatcher(user.id, {
        kind: 'page', label, spec: { url: p.url, ...(p.forWhat ? { for: p.forWhat } : {}) }, intervalMin: 60,
      }).catch(() => null);
      return say(
        w
          ? `Watching **${host}**${p.forWhat ? ` for ${p.forWhat}` : ' for changes'} — I'll ping you here when it moves. (checks hourly)`
          : `Already watching that page.`,
        'watcher-page-add',
      );
    }
  }
  if (isWeatherWatchAdd(text)) {
    const { days, label } = extractWeatherWatch(text);
    const w = await createWatcher(user.id, {
      kind: 'weather_event', label, spec: { days }, intervalMin: 240,
    }).catch(() => null);
    return say(
      w
        ? `Done — I'll watch the forecast against your calendar for the next ${days === 1 ? 'day' : `${days} days`} and warn you if rain or snow lands on a timed event.`
        : `Already watching the weather over your plans.`,
      'watcher-weather-add',
    );
  }
  if (isFlightWatch(text)) {
    if (!flightStatusAvailable()) {
      return say(
        `I can track flights once a flight-status key is set (RAPIDAPI_KEY — AeroDataBox on RapidAPI, free tier). Add that and ask again.`,
        'watcher-flight-nokey',
      );
    }
    const f = extractFlightWatch(text);
    if (f) {
      const nice = new Date(`${f.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ });
      const w = await createWatcher(user.id, {
        kind: 'flight', label: `Flight ${f.flightNo} · ${nice}`, spec: { flightNo: f.flightNo, date: f.date }, intervalMin: 25,
      }).catch(() => null);
      return say(
        w
          ? `Tracking **${f.flightNo}** on ${nice} — I'll ping you on a delay, gate change, or cancellation, and drop it once it lands.`
          : `Already tracking ${f.flightNo} that day.`,
        'watcher-flight-add',
      );
    }
  }

  // ── silent tier: watch list — add / update / query ────────────────────
  if (isWatchAdd(text)) {
    const w = extractWatchTitle(text);
    if (w) {
      const r = await addWatchFromText(user.id, w.raw, w.status, text).catch(() => null);
      if (r?.row) {
        const upgrading = !r.row.tmdb_id && looksVague(w.raw);
        if (upgrading) waitUntil(upgradeWatchRowViaWeb(user.id, r.row.id, w.raw));
        const tail = r.row.tmdb_id
          ? ''
          : upgrading
            ? " I'll pin down the exact title in a moment — check /watch."
            : " (couldn't find it on TMDB — added by name)";
        return say(
          `${r.added ? 'Added' : 'Updated'} **${r.row.title}**${r.row.year ? ` (${r.row.year})` : ''} — ${r.row.status === 'watching' ? 'watching' : 'want to watch'}${r.row.streaming[0] ? ` · ${r.row.streaming[0]}` : ''}.${tail}`,
          'watch-add',
        );
      }
      return say(`Couldn't add "${w.title}" — try the /watch screen.`, 'watch-add-failed');
    }
  }
  if (isWatchUpdate(text)) {
    const msg = await applyWatchUpdate(user.id, text).catch(() => null);
    if (msg) return say(msg, 'watch-update');
    // no match on the list → fall through (maybe it's a taste reaction)
  }

  // ── silent tier: a reaction to a book/show/film/game → taste_log ────────
  // Runs before the profile-fact path so "remember I loved X" lands in the
  // taste log (verdict + why), not as a loose profile fact.
  if (isTasteReaction(text)) {
    const logged = await saveTasteFromText(user.id, text).catch(() => null);
    if (logged) return say(logged, 'taste-logged');
    // not actually a media reaction → fall through
  }

  // ── silent tier: "note that…" / "jot this down" → a searchable note ────
  if (isNoteCapture(text)) {
    const body = extractNote(text);
    if (body.length >= 3) {
      const ok = await saveNote(user.id, body, { source: 'chat' }).catch(() => false);
      if (ok) return say('Noted.', 'note-saved');
    }
    // nothing substantive to save → fall through
  }

  // ── silent tier: "from now on, always ask before…" → a standing behavior rule ──
  if (isBehaviorRuleStatement(text) && !isCalendarWrite(text) && !isCalendarChange(text)) {
    const rule = await saveExplicitRule(user.id, text).catch(() => null);
    if (rule) return say(`Noted — standing rule: "${rule}"`, 'behavior-rule-add');
    // LLM says it's not a real preference → fall through
  }

  // ── silent tier: "remember that I…" → confirmed profile_fact, no gate ────
  if (isExplicitRemember(text) && !isCalendarWrite(text)) {
    const saved = await saveFactFromText(user.id, text).catch(() => null);
    if (saved) return say(`Got it — I'll remember that: ${saved}`, 'fact-saved');
    // nothing concrete to store → fall through to the brain
  }

  // ── confirm / named-consequence: change or cancel a calendar event ──────
  if (isCalendarChange(text) && !isCalendarWrite(text)) {
    const ch = await extractCalendarChange(text).catch(() => null);
    if (!ch) return say(`Which event do you mean — name it and the day?`, 'cal-change-underspecified');
    const found = await findEventByHint(user.id, ch.match).catch(() => ({ none: true as const }));
    if ('none' in found) return say(`I don't see "${ch.match}" on your synced calendar. Try naming it the way it reads there.`, 'cal-change-nomatch');
    if ('ambiguous' in found) {
      const opts = found.ambiguous.map((e) => `${e.title} — ${whenLabel(e.start_at)}`).join('; ');
      return say(`A few could match: ${opts}. Which one?`, 'cal-change-ambiguous');
    }
    const e = found.hit;
    if (ch.op === 'delete') {
      await proposeAction({
        userId: user.id, kind: 'delete_event', riskTier: 'named_consequence',
        summary: `Delete "${e.title}" (${whenLabel(e.start_at)}) from your calendar`,
        payload: { uid: e.uid, title: e.title, start_at: e.start_at }, createdBy: conversationId,
      });
      return say(`Remove **${e.title}** (${whenLabel(e.start_at)}) from your calendar? If it has other guests this cancels for them too — reply **yes, delete it** to confirm.`, 'action-proposed');
    }
    const bits: string[] = [];
    if (ch.new_start) bits.push(`→ ${whenLabel(ch.new_start)}`);
    if (ch.new_title) bits.push(`renamed to "${ch.new_title}"`);
    if (ch.new_location !== null && ch.new_location !== undefined) bits.push(`at ${ch.new_location}`);
    if (!bits.length) return say(`What's the change to **${e.title}** (${whenLabel(e.start_at)})?`, 'cal-change-underspecified');
    await proposeAction({
      userId: user.id, kind: 'update_event', riskTier: 'confirm',
      summary: `Update "${e.title}": ${bits.join(', ')}`,
      payload: { uid: e.uid, new_title: ch.new_title, new_start: ch.new_start, new_end: ch.new_end, new_location: ch.new_location },
      createdBy: conversationId,
    });
    return say(`Update **${e.title}** (${whenLabel(e.start_at)}) — ${bits.join(', ')}? Say yes and I'll change it.`, 'action-proposed');
  }

  // ── calendar write → auto-add if trusted, else propose and wait for yes ──
  if (isCalendarWrite(text)) {
    const ev = await extractEvent(text).catch(() => null);
    if (!ev) return say(`I can put that on your calendar — when, exactly?`, 'calendar-write-underspecified');
    const when = whenLabel(ev.start_at, ev.all_day);
    if (await isAutoAllowed('create_event').catch(() => false)) {
      const r = await runAutoCreateEvent(user.id, ev, conversationId).catch(() => ({ ok: false }));
      if (r.ok) {
        return say(
          `Added **${ev.title}** — **${when}**${ev.location ? ` (${ev.location})` : ''}. Say "undo" if that's wrong.`,
          'calendar-auto',
        );
      }
      // couldn't write → fall through to the confirm path
    }
    await proposeAction({
      userId: user.id, kind: 'create_event', riskTier: 'confirm',
      summary: `${ev.title} — ${when}`,
      payload: { ...ev }, createdBy: conversationId,
    });
    return say(`Put **${ev.title}** on your calendar for **${when}**${ev.location ? ` (${ev.location})` : ''}? Say yes and I'll add it.`, 'action-proposed');
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
    await audit.log('outbound_message', 'calliad', conversationId, { text: reply, surface, reason: 'quiz-add' });
    return streamResponse(conversationId, (async function* () { yield sse({ delta: reply }); yield sse({ done: true }); })());
  }

  } // end: skip intent handlers while in a language-practice thread

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
    await audit.log('outbound_message', 'calliad', conversationId, { text: reply, surface, reason: 'capture' });
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
      await audit.log('outbound_message', 'calliad', conversationId, { text: reply, surface, reason: decision.reason });
    }
    return streamResponse(conversationId, async function* () {
      if (reply) yield sse({ delta: reply });
      yield sse({ done: true });
    }());
  }

  // ── brain ───────────────────────────────────────────────────────────────
  const effectiveMode: Mode = decision.setMode ?? decision.mode;
  const [recent, integrations, loops, morphResult, learned, contactsLine, tripsLine, locationLine, behaviorLine, occasionsLine, rapport, userPreset] = await Promise.all([
    recentTurns(conversationId, text),
    getIntegrationContext(user.id, { daysAhead: 14, emailLimit: 8 }).catch(() => undefined),
    relevantLoops(user.id, { dueWithinDays: 21 }).catch(() => []),
    decision.tools.includes('morphology') ? runMorphology(text).catch(() => undefined) : Promise.resolve(undefined),
    learnedFacts(user.id).catch(() => ''),
    contactContextLine(user.id, text).catch(() => ''),
    tripsContextLine(user.id).catch(() => ''),
    locationContextLine(user.id).catch(() => ''),
    behaviorContextLine(user.id).catch(() => ''),
    occasionsContextLine(user.id).catch(() => ''),
    personaExtra(user.id).catch(() => ''),
    config.get('personality_preset').catch(() => 'default'),
  ]);
  const activePreset = resolvePreset({
    userDefault: userPreset,
    convPreset: modeState.preset as string | undefined,
    mode: effectiveMode,
    drillMode: !!(modeState.roots || modeState.sprint),
    practice: !!modeState.practiceLang,
  });

  const deckUrl =
    text.match(/https?:\/\/(?:www\.)?archidekt\.com\/(?:api\/)?decks\/\d+/)?.[0] ??
    text.match(/https?:\/\/(?:www\.)?moxfield\.com\/decks\/[\w-]+/i)?.[0];
  const moxUrl = /moxfield\.com\/decks\//i.test(text);
  let toolResult = morphResult;
  if (effectiveMode === 'quiz') {
    const q = await quizTurn(user.id, conversationId, text, modeState).catch(() => null);
    if (q) toolResult = q.toolResult;
  } else if (looksLikeDecklist(text) || (isDeckHelp(text) && deckUrl)) {
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
        ? `## Deck analysis\nCouldn't pull that Moxfield deck (it may be private, or Moxfield rejected the request). If it keeps failing, Noah can set MOXFIELD_UA (email support@moxfield.com for an approved user-agent) — or paste the list (Moxfield: "..." menu → Export → copy).`
        : `## Deck analysis\nCouldn't read a decklist from that${deckUrl ? ' link' : ''}. Ask Noah to paste the list or an Archidekt / Moxfield URL.`;
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
    // only pin a tool result if Scryfall actually returned a card — otherwise
    // leave it undefined so web search can pick up a just-spoiled / unreleased
    // card instead of dead-ending.
    if (found.length) toolResult = cardBlock(found);
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
  } else if (isRecallQuestion(text)) {
    const hits = await searchNotes(user.id, text).catch(() => []);
    toolResult = notesRecallBlock(hits);
  } else if (isSubscriptionQuery(text)) {
    toolResult = await subscriptionsSummary(user.id).catch(() => undefined);
  } else if (isWatchQuery(text)) {
    if (/\b(airing|dropping|coming out|new (episode|season)) (soon|this week|next)|what'?s (airing|new|dropping)/i.test(text)) {
      const soon = await watchContextLine(user.id).catch(() => [] as string[]);
      toolResult = soon.length ? `## Airing soon\n${soon.map((s) => `- ${s}`).join('\n')}` : `## Airing soon\nNothing in your watch list has an episode in the next ~10 days.`;
    } else {
      toolResult = watchListBlock(await listWatch(user.id).catch(() => []));
    }
  } else if (isRestaurantTasteQuery(text)) {
    toolResult = await restaurantTasteBlock(user.id, text).catch(() => undefined);
  } else if (/\b(would i (like|enjoy|hate|bounce off)|should i (watch|read|play|start|bother with|eat at|go to)|do you think i'?d (like|enjoy)|worth (watching|reading|playing|a visit|going to)|think i'?d (like|enjoy)|what did i (rate|think of|give)|have i (been (to|there)|tried|eaten at)|my (score|rating) (for|of|on))\b/i.test(text)) {
    // restaurant first (covers "would I like <place>" / "what did I rate <place>"),
    // then books / screen / games
    toolResult =
      (await restaurantTasteBlock(user.id, text).catch(() => undefined)) ??
      (await wouldILike(user.id, text).catch(() => undefined)) ??
      toolResult;
  } else if (isFlightQuery(text)) {
    const fp = await extractFlight(text).catch(() => null);
    toolResult = fp
      ? await flightSearch(fp, await prefsLine(user.id).catch(() => '')).catch(() => undefined)
      : `## Flight search\nCouldn't pin down where/when — ask Noah for the destination and rough dates.`;
  } else if (isRestaurantQuery(text)) {
    const rp = await extractRestaurant(text).catch(() => null);
    const [handoff, prefs] = await Promise.all([
      rp ? restaurantHandoff(rp).catch(() => undefined) : Promise.resolve(undefined),
      restaurantPrefsBlock(user.id).catch(() => ''),
    ]);
    toolResult = [handoff, prefs].filter(Boolean).join('\n\n') || undefined;
  } else if (isWeatherQuery(text)) {
    toolResult = await runForecast(text).catch(() => undefined);
  } else if (isRecipeQuery(text)) {
    toolResult = await runRecipe(text).catch(() => undefined);
  } else if (isLyricQuery(text)) {
    toolResult = await findByLyrics(text).catch(() => undefined);
  } else if (/\b(name that song|what song is (this|that|playing)|shazam|identif(y|ies) (this|the) song|what'?s (this|that) song)\b/i.test(text)) {
    toolResult = `## Song ID\nNoah wants to identify a song that's playing but sent no audio. Tell him to hold the ♪ button in the composer while it plays — a few seconds is enough.`;
  }

  // Fallback: an unanswered factual lookup ("what's the storage code") — check
  // Noah's own notes before the brain guesses.
  if (!toolResult && isLookupQuestion(text)) {
    const hits = (await searchNotes(user.id, text, 5).catch(() => [])).filter((hh) => hh.similarity >= 0.6);
    if (hits.length) toolResult = notesRecallBlock(hits);
  }

  const state: TurnState = {
    now: new Date(), tz: TZ, recent, integrations, loops,
    mode: effectiveMode === 'default' ? undefined : effectiveMode,
    toolResult,
    profileSections: profileSections(text, effectiveMode),
    learned: learned || undefined,
    medStatus: medLine || undefined,
    contacts: contactsLine || undefined,
    trips: tripsLine || undefined,
    location: locationLine || undefined,
    behaviorRules: behaviorLine || undefined,
    occasions: occasionsLine || undefined,
    personaExtra: rapport || undefined,
    presetOverlay: presetOverlay(activePreset) || undefined,
    practiceOverlay: modeState.practiceLang ? practiceOverlay(modeState.practiceLang as PracticeLang) : undefined,
  };
  // A tool result means a longer, denser reply is expected (deck analysis, sim
  // narration, web-page answers). 1024 is stingy there — and with adaptive effort
  // on, too small a budget can be spent entirely on reasoning, yielding no text.
  // A turn that turns on current/outside info → let the model run Anthropic's web
  // search. Broad on purpose: a keyword list like "latest on / news about" keeps
  // missing real phrasings ("look to see if there's any new games coming out",
  // "ran some updates, can you check now?"). Only fires when no other tool already
  // answered the turn.
  const webSearch =
    !toolResult && effectiveMode === 'default' &&
    /\b(search\b|google\b|look (it |this )?up|looking (it |this )?up|look (to see|into)|(go )?(find out|find me|check online)|can you (find|check|look)(?! (my|the calendar|your|at))|latest (on|news|from|version|release)|newest\b|most recent\b|what'?s the latest|any (news|updates?) (on|about|for)|news (on|about|for)|what'?s (going on|happening|new) (with|in|on)(?! my\b)|(coming|come) out\b|just (came out|released|announced|dropped)|recently (released|announced|came out|launched|added)|new releases?|as of (today|now|this)|up[ -]to[- ]date|right now\b|check (again|now)|try (again|now)|now try\b|\b(new|upcoming|latest|just[- ]?spoiled|recently spoiled|previewed) .{0,40}\b(card|set|precon|commander deck)\b|from the .{2,40}\bset\b|\bspoilers?\b)/i.test(text);
  const maxTokens = images.length || toolResult ? Math.min(4096, 1500 + Math.ceil((toolResult?.length ?? 3000) / 8)) : webSearch ? 2000 : 1200;

  const { meta, stream } = await call({
    purpose: 'chat',
    // a photo goes to T2 for vision quality; a search-shaped turn goes to T2
    // because haiku (the T1 chat model) can't run the 2026 web-search tool
    tier: (images.length > 0 || webSearch) && decision.tier === 'T1' ? 'T2' : decision.tier,
    proactive: false,
    conversationId,
    userText: text,
    state,
    maxTokens,
    webSearch,
    images,
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
      text: finalText, surface, tier: meta.tier, model: meta.model, cost_usd: meta.costUsd, capped: meta.capped,
    });
    yield sse({ done: true, costUsd: meta.costUsd, mode: effectiveMode });
    // T1 pass: file any open loop this exchange opened. waitUntil keeps the
    // serverless function alive until it finishes (a bare promise would be reaped).
    waitUntil(
      detectFromTurn(user.id, text, finalText, conversationId).catch((e) =>
        console.error('[chat] loop detect', e),
      ),
    );
    // auto-index a durable fact/detail from this turn into the knowledge base
    waitUntil(maybeIndexTurn(user.id, text, finalText).catch((e) => console.error('[chat] note index', e)));
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

function fmtDay(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ });
}
