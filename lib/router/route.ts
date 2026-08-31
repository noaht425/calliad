// Normalized inbound event → RouteDecision. Design: specs/hub-skeleton.md §5,
// system-prompt-assembly.md §5-6.

import { config } from '@/lib/hub/config';
import { audit } from '@/lib/hub/audit';
import type { Tier } from './tiers';

export type Surface = 'pwa' | 'cron' | 'webhook';

export interface InboundEvent {
  source: Surface;
  kind: 'message' | 'trigger' | 'webhook';
  text?: string;
  payload?: unknown;
  job?: string;
  conversationId?: string;
  currentMode?: Mode; // sticky mode carried on the conversation
}

export type Mode =
  | 'default' | 'study-coach' | 'italian-tutor' | 'morphology' | 'quiz'
  | 'careful-engineer' | 'document-extraction' | 'brief';

export interface RouteDecision {
  handled: 'rule' | 'brain';
  tier: Tier;
  mode: Mode;
  tools: string[];
  persona: 'full' | 'terse';
  reason: string;
  directReply?: string;
  dropped?: boolean;
  /** if set, persist this as the conversation's mode for future turns */
  setMode?: Mode;
}

type KillLevel = 'off' | 'pause_proactive' | 'pause_all';
const PAUSED_REPLY = "I'm paused right now, Noah — flip the kill switch back when you want me.";
const isProactive = (e: InboundEvent) => e.kind === 'trigger' || e.kind === 'webhook';

// ── mode-switch phrases ─────────────────────────────────────────────────────
const ENTER_ITALIAN = /\b(parl(a|iamo) (in )?italiano|in italiano|italian (mode|practice)|practice (my )?italian|let'?s (do|practice) italian|switch to italian)\b/i;
const EXIT_MODE = /\b(in inglese|back to english|english( please)?|stop( the)? (italian|tutor|quiz|practice)|exit (mode|tutor|quiz)|normal mode|nevermind the (italian|quiz))\b/i;
const ENTER_QUIZ = /\b(quiz me|test me|flashcards?|review (my |the )?(vocab|words|forms|greek|latin|italian)|drill me|keep me sharp)\b/i;
const ENTER_STUDY = /\b(study (plan|help|coach)|help me (study|prep|review) for|focus plan)\b/i;
// morphology is a one-shot, not a sticky mode (stems, no trailing \b — "conjugate"/"declension")
const MORPH = /(conjugat|declin|\bparse\b[^?]{0,40}\b(form|word|verb|noun)|principal parts|what (case|tense|mood|person|number|gender) is|synopsi[sz])/i;

export async function route(event: InboundEvent): Promise<RouteDecision> {
  const decision = await decide(event);
  await audit.log(
    'route_decision',
    actorFor(event),
    event.conversationId ?? event.job ?? null,
    { event: { source: event.source, kind: event.kind, job: event.job }, decision },
  );
  return decision;
}

async function decide(event: InboundEvent): Promise<RouteDecision> {
  const level = (await config.get('killswitch_level')) as KillLevel;
  if (level === 'pause_all') {
    return isProactive(event)
      ? rule('T0', 'killswitch pause_all — proactive event dropped', { dropped: true })
      : rule('T0', 'killswitch pause_all — direct message', { directReply: PAUSED_REPLY });
  }
  if (level === 'pause_proactive' && isProactive(event)) {
    return rule('T0', 'killswitch pause_proactive — proactive event dropped', { dropped: true });
  }

  if (event.kind === 'trigger' && event.job === 'heartbeat') return rule('T0', 'heartbeat — audit only');
  if (event.kind !== 'message') {
    return rule('T0', `no proactive handling for ${event.kind}${event.job ? ` (${event.job})` : ''}`);
  }

  const text = event.text ?? '';
  const sticky: Mode = event.currentMode ?? 'default';

  // 1. explicit mode switches (win over everything)
  if (EXIT_MODE.test(text)) {
    return brain('T2', 'default', 'user exited a mode', { setMode: 'default' });
  }
  if (ENTER_ITALIAN.test(text)) {
    return brain('T2', 'italian-tutor', 'entering italian-tutor', { setMode: 'italian-tutor' });
  }
  if (ENTER_QUIZ.test(text)) {
    return brain('T2', 'quiz', 'entering quiz', { setMode: 'quiz' });
  }
  if (ENTER_STUDY.test(text)) {
    return brain('T2', 'study-coach', 'entering study-coach', { setMode: 'study-coach' });
  }

  // 2. one-shot morphology (doesn't change sticky mode)
  if (MORPH.test(text)) {
    return brain('T2', 'morphology', 'morphology query', { tools: ['morphology'] });
  }

  // 3. otherwise carry the sticky mode
  return brain('T2', sticky, sticky === 'default' ? 'default chat' : `continuing ${sticky}`);
}

function brain(
  tier: Tier,
  mode: Mode,
  reason: string,
  extra: Partial<Pick<RouteDecision, 'setMode' | 'tools'>> = {},
): RouteDecision {
  return {
    handled: 'brain', tier, mode,
    tools: extra.tools ?? [],
    persona: 'full', reason,
    ...(extra.setMode ? { setMode: extra.setMode } : {}),
  };
}

function rule(
  tier: Tier,
  reason: string,
  extra: Partial<Pick<RouteDecision, 'directReply' | 'dropped'>> = {},
): RouteDecision {
  return { handled: 'rule', tier, mode: 'default', tools: [], persona: 'terse', reason, ...extra };
}

function actorFor(e: InboundEvent): 'noah' | 'cron' | 'system' {
  if (e.kind === 'message') return 'noah';
  if (e.source === 'cron') return 'cron';
  return 'system';
}
