import { randomUUID } from 'node:crypto';
import { adminClient } from '@/lib/supabase.server';
import { call } from '@/lib/brain/call';
import { audit } from '@/lib/hub/audit';
import { getIntegrationContext } from '@/lib/integrations/context';
import type { TurnState } from '@/lib/brain/prompt';

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';

const BRIEF_INSTRUCTION = `It's the morning brief. Write Noah's brief for today in your normal voice — follow the "Morning brief" example in the persona: a short greeting, today's schedule from the Live data block, anything due soon, a birthday if one falls within about three weeks, and anything from the recent conversation or watched mail that needs a decision. One message, a few sentences. If the day is quiet, say so in one plain line and stop — don't pad it, and don't list things that aren't on the calendar. Only mention events that are actually in the Live data.`;

export interface BriefResult {
  text: string;
  costUsd: number;
  deferred: boolean;
  conversationId: string;
}

/** Compose the morning brief for a user. Persists it as a 'cron' conversation. */
export async function composeBrief(userId: string): Promise<BriefResult> {
  const now = new Date();

  const [integrations, recentConv] = await Promise.all([
    getIntegrationContext(userId, { daysAhead: 8, emailLimit: 10 }).catch(() => undefined),
    adminClient
      .from('messages')
      .select('role, content, conversation_id, created_at')
      .in('role', ['user', 'assistant'])
      .order('created_at', { ascending: false })
      .limit(6),
  ]);

  const recent = (recentConv.data ?? [])
    .reverse()
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const state: TurnState = { now, tz: TZ, recent, integrations };

  const conversationId = randomUUID();
  await adminClient.from('conversations').insert({
    id: conversationId,
    surface: 'cron',
    started_at: now.toISOString(),
    last_at: now.toISOString(),
    title: `Morning brief ${now.toLocaleDateString('en-CA', { timeZone: TZ })}`,
  });

  const { meta, stream } = await call({
    purpose: 'brief',
    tier: 'T2',
    proactive: true,
    conversationId,
    userText: BRIEF_INSTRUCTION,
    state,
    maxTokens: 600,
  });

  let text = '';
  for await (const d of stream) text += d;

  if (meta.deferred) {
    return { text: '', costUsd: 0, deferred: true, conversationId };
  }

  await adminClient.from('messages').insert({ conversation_id: conversationId, role: 'assistant', content: text });
  await audit.log('outbound_message', 'calliad', conversationId, {
    text, surface: 'cron', purpose: 'brief', tier: meta.tier, model: meta.model, cost_usd: meta.costUsd,
  });

  return { text, costUsd: meta.costUsd, deferred: false, conversationId };
}
