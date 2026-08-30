import { randomUUID } from 'node:crypto';
import { adminClient } from '@/lib/supabase.server';
import { call } from '@/lib/brain/call';
import { audit } from '@/lib/hub/audit';
import { getIntegrationContext } from '@/lib/integrations/context';
import { getBriefExtras } from '@/lib/brief/extras';
import { relevantLoops } from '@/lib/memory/loops';
import type { TurnState } from '@/lib/brain/prompt';

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';

const COMMON = `Follow the "Morning brief" example in the persona: a short greeting, today's schedule from the Live data block, anything due soon, a birthday if one falls within about three weeks, and anything from the recent conversation or watched mail that needs a decision. Then a one-line weather note for today, and 2–3 news headlines from the last day — just the gist, no editorializing, skip any that are trivial. One message; keep it tight. If the day is quiet, say so in one plain line — don't pad it, and don't list things that aren't on the calendar. Only mention events that are actually in the Live data. Match the greeting to the current time of day; don't comment on what time it is.`;

function extrasBlock(w: Awaited<ReturnType<typeof getBriefExtras>>): string {
  const lines: string[] = ['## Weather + news (for the brief)'];
  lines.push(
    w.weather
      ? `Weather ${w.weather.label}: ${w.weather.summary}, ${w.weather.lowF}–${w.weather.highF}°F, ${w.weather.precipPct}% precip.`
      : 'Weather: unavailable.',
  );
  if (w.headlines.length) {
    lines.push('', 'Recent headlines:', '<untrusted source="rss">');
    for (const h of w.headlines) lines.push(`- ${h}`);
    lines.push('</untrusted>');
  } else {
    lines.push('', 'Headlines: unavailable.');
  }
  return lines.join('\n');
}

const INSTRUCTION = {
  scheduled: `It's the daily brief. Write Noah's rundown for today in your normal voice. ${COMMON}`,
  manual: `Noah just asked for a rundown. Give him today plus the week ahead in your normal voice — no "morning brief" framing, it's on demand. ${COMMON}`,
};

export interface BriefResult {
  text: string;
  costUsd: number;
  deferred: boolean;
  conversationId: string;
}

/** Compose the brief for a user. Persists it as a 'cron' conversation. */
export async function composeBrief(
  userId: string,
  occasion: 'scheduled' | 'manual' = 'scheduled',
): Promise<BriefResult> {
  const now = new Date();

  const dayAgo = new Date(now.getTime() - 36 * 3600 * 1000).toISOString();
  const [integrations, recentUser, extras, loops] = await Promise.all([
    getIntegrationContext(userId, { daysAhead: 8, emailLimit: 10 }).catch(() => undefined),
    // Only what NOAH said recently — never feed the brief its own past output back
    // in (that echoes hallucinations forward). This is "things he mentioned",
    // labelled as such, not a task list.
    adminClient
      .from('messages')
      .select('content, created_at')
      .eq('role', 'user')
      .gte('created_at', dayAgo)
      .order('created_at', { ascending: false })
      .limit(8),
    getBriefExtras().catch(() => ({ weather: null, headlines: [] as string[] })),
    relevantLoops(userId, { dueWithinDays: 14 }).catch(() => []),
  ]);

  const notes = (recentUser.data ?? [])
    .map((m) => m.content.trim())
    .filter((c) => c && c.length < 500 && !/^(run|what'?s|show|test)\b/i.test(c)); // drop bare commands

  const recent: TurnState['recent'] = notes.length
    ? [{
        role: 'user',
        content:
          `Background — things Noah said in the last day or so (not tasks, not questions to answer here; only surface one if it genuinely needs a decision today):\n${notes.map((n) => `- ${n}`).join('\n')}`,
      }]
    : [];

  const state: TurnState = { now, tz: TZ, recent, integrations, loops };

  const conversationId = randomUUID();
  await adminClient.from('conversations').insert({
    id: conversationId,
    surface: 'cron',
    started_at: now.toISOString(),
    last_at: now.toISOString(),
    title: `Brief ${now.toLocaleDateString('en-CA', { timeZone: TZ })}`,
  });

  const { meta, stream } = await call({
    purpose: 'brief',
    tier: 'T2',
    proactive: true,
    conversationId,
    userText: `${INSTRUCTION[occasion]}\n\n${extrasBlock(extras)}`,
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
