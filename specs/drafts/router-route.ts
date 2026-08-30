// Calliad hub — router/route.ts (draft, 2026-08-30)
// Normalized inbound event → RouteDecision. Design: specs/hub-skeleton.md §5.
//
// Phase 0 is deliberately dumb: the INTERFACE is the contract, the intelligence
// comes in Phase 2 (intent classification → tier/mode/tool selection). All this
// version does is enforce the kill switch and pass messages through to T2.
//
// TODO on drop-in:
//   - import real audit + config helpers from the fork (see brain-call.ts stubs)
//   - align the paused one-liner with persona.md's few-shot voice

export type Surface = 'pwa' | 'cron' | 'webhook';

export interface InboundEvent {
  source: Surface;
  kind: 'message' | 'trigger' | 'webhook';
  text?: string;                 // for messages
  payload?: unknown;             // for triggers/webhooks
  job?: string;                  // for triggers: 'heartbeat' | ...
  conversationId?: string;
}

export type Tier = 'T0' | 'T1' | 'T2' | 'T3';
export type Mode =
  | 'default' | 'study-coach' | 'italian-tutor'
  | 'careful-engineer' | 'document-extraction' | 'brief';

export interface RouteDecision {
  handled: 'rule' | 'brain';     // 'rule' → no model call, router (or a canned reply) answered it
  tier: Tier;
  mode: Mode;
  tools: string[];
  persona: 'full' | 'terse';
  reason: string;                // logged verbatim in the route_decision audit row
  /** Present only when handled==='rule' AND a direct reply should be sent to the surface. */
  directReply?: string;
  /** True when a proactive event was dropped by the kill switch (caller logs + no-ops). */
  dropped?: boolean;
}

// ── stand-ins for fork wiring (same pattern as brain-call.ts) ────────────────
declare const config: { get(key: string): Promise<string> };
declare const audit: {
  log(kind: string, actor: string, ref: string | null, payload: unknown): Promise<void>;
};

type KillLevel = 'off' | 'pause_proactive' | 'pause_all';

const PAUSED_REPLY =
  "I'm paused right now, Noah — flip the kill switch back when you want me."; // TODO: match persona.md

const isProactive = (e: InboundEvent) => e.kind === 'trigger' || e.kind === 'webhook';

export async function route(event: InboundEvent): Promise<RouteDecision> {
  const decision = await decide(event);
  await audit.log('route_decision', actorFor(event), event.conversationId ?? event.job ?? null, {
    event: { source: event.source, kind: event.kind, job: event.job },
    decision,
  });
  return decision;
}

async function decide(event: InboundEvent): Promise<RouteDecision> {
  // 1. Kill switch first --------------------------------------------------------
  const level = (await config.get('killswitch_level')) as KillLevel;

  if (level === 'pause_all') {
    if (isProactive(event)) {
      return rule('T0', 'killswitch pause_all — proactive event dropped', { dropped: true });
    }
    return rule('T0', 'killswitch pause_all — direct message', { directReply: PAUSED_REPLY });
  }

  if (level === 'pause_proactive' && isProactive(event)) {
    return rule('T0', 'killswitch pause_proactive — proactive event dropped', { dropped: true });
  }

  // 2. Phase 0 body — dumb on purpose ----------------------------------------
  if (event.kind === 'message') {
    return {
      handled: 'brain',
      tier: 'T2',
      mode: 'default',
      tools: [],
      persona: 'full',
      reason: 'phase0 passthrough',
    };
  }

  if (event.kind === 'trigger' && event.job === 'heartbeat') {
    return rule('T0', 'heartbeat — audit only');
  }

  // Any other trigger/webhook in Phase 0: acknowledged, not acted on.
  return rule('T0', `phase0 — no proactive handling for ${event.kind}${event.job ? ` (${event.job})` : ''}`);
}

// ── helpers ────────────────────────────────────────────────────────────────
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
