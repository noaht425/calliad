// Normalized inbound event → RouteDecision. Design: specs/hub-skeleton.md §5.
//
// Phase 0 is deliberately dumb: the interface is the contract, the intelligence
// (intent → tier/mode/tool selection) comes in Phase 2. This version only
// enforces the kill switch and passes messages through to T2.

import { config } from '@/lib/hub/config';
import { audit } from '@/lib/hub/audit';
import type { Tier } from './tiers';

export type Surface = 'pwa' | 'cron' | 'webhook';

export interface InboundEvent {
  source: Surface;
  kind: 'message' | 'trigger' | 'webhook';
  text?: string;
  payload?: unknown;
  job?: string; // for triggers: 'heartbeat' | ...
  conversationId?: string;
}

export type Mode =
  | 'default' | 'study-coach' | 'italian-tutor'
  | 'careful-engineer' | 'document-extraction' | 'brief';

export interface RouteDecision {
  handled: 'rule' | 'brain';
  tier: Tier;
  mode: Mode;
  tools: string[];
  persona: 'full' | 'terse';
  reason: string;
  /** handled==='rule' + a canned reply to send straight to the surface. */
  directReply?: string;
  /** a proactive event the kill switch dropped — caller logs + no-ops. */
  dropped?: boolean;
}

type KillLevel = 'off' | 'pause_proactive' | 'pause_all';

const PAUSED_REPLY = "I'm paused right now, Noah — flip the kill switch back when you want me.";

const isProactive = (e: InboundEvent) => e.kind === 'trigger' || e.kind === 'webhook';

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

  // Phase 0 body — dumb on purpose.
  if (event.kind === 'message') {
    return { handled: 'brain', tier: 'T2', mode: 'default', tools: [], persona: 'full', reason: 'phase0 passthrough' };
  }
  if (event.kind === 'trigger' && event.job === 'heartbeat') {
    return rule('T0', 'heartbeat — audit only');
  }
  return rule('T0', `phase0 — no proactive handling for ${event.kind}${event.job ? ` (${event.job})` : ''}`);
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
