import { randomUUID } from 'node:crypto';
import { adminClient } from '@/lib/supabase.server';
import { call } from '@/lib/brain/call';
import { audit } from '@/lib/hub/audit';
import { loopsDueForNudge, markNudged, allOpenLoops } from '@/lib/memory/loops';
import { getIntegrationContext } from '@/lib/integrations/context';
import type { TurnState } from '@/lib/brain/prompt';

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';

export interface NudgeResult {
  text: string;
  costUsd: number;
  deferred: boolean;
  loopTitle: string;
  conversationId: string;
}

/**
 * Nudge the single most urgent loop that's entered its deadline window and
 * hasn't been nudged. One loop, one next action — never a digest. Returns null
 * if nothing's due. Marks the loop nudged.
 */
export async function composeNudge(userId: string, opts: { force?: boolean } = {}): Promise<NudgeResult | null> {
  let due = await loopsDueForNudge(userId);
  let real = due.length > 0;
  if (!due.length && opts.force) {
    // Testing: nudge the soonest dated open loop even if it's outside the window.
    // Don't mark it nudged — this is a preview, not the real one.
    due = (await allOpenLoops(userId)).filter((l) => l.due_at);
    real = false;
  }
  if (!due.length) return null;
  const loop = due[0];

  const now = new Date();
  const integrations = await getIntegrationContext(userId, { daysAhead: 5, emailLimit: 5 }).catch(() => undefined);

  const whenStr = loop.due_at
    ? new Date(loop.due_at).toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ })
    : 'soon';

  const instruction =
    `A deadline's approaching. Open loop: "${loop.title}"${loop.body ? ` — ${loop.body}` : ''}. Due ${whenStr}.\n\n` +
    `Nudge Noah about this ONE thing, once. Calm, level, non-alarmist — follow the reminder-tone rules in the persona (he has ADHD/OCD/anxiety; reminders are load-bearing but must not feed a re-check spiral). Give exactly one clear next action. A sentence or two, not a digest — don't bring in anything else on his plate. If a short focus plan would genuinely help, offer it as a question.`;

  const conversationId = randomUUID();
  await adminClient.from('conversations').insert({
    id: conversationId, surface: 'cron', started_at: now.toISOString(), last_at: now.toISOString(),
    title: `Nudge: ${loop.title}`.slice(0, 80),
  });

  const { profileSections } = await import('@/lib/brain/profile');
  const state: TurnState = {
    now, tz: TZ, recent: [], integrations, loops: [loop],
    profileSections: profileSections('assignment exam due study deadline', 'study-coach'),
  };
  const { meta, stream } = await call({
    purpose: 'brief', tier: 'T2', proactive: true, conversationId, userText: instruction, state, maxTokens: 400,
  });

  let text = '';
  for await (const d of stream) text += d;

  if (meta.deferred) {
    return { text: '', costUsd: 0, deferred: true, loopTitle: loop.title, conversationId };
  }

  if (real) await markNudged(userId, loop.id);
  await adminClient.from('messages').insert({ conversation_id: conversationId, role: 'assistant', content: text });
  await audit.log('outbound_message', 'calliad', conversationId, {
    text, surface: 'cron', purpose: 'nudge', loop: loop.title, tier: meta.tier, model: meta.model, cost_usd: meta.costUsd,
  });

  return { text, costUsd: meta.costUsd, deferred: false, loopTitle: loop.title, conversationId };
}
