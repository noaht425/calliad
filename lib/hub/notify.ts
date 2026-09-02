// Unified outbound delivery. Two ways in:
//   notifyUser()          — deliver now, to web push + Telegram
//   enqueueNotification() — queue a row; the tick worker (/api/cron/tick)
//                           delivers it and holds it through quiet hours
//
// Proactive senders should prefer enqueueNotification so nothing is lost when
// Calliad has no live surface. notifyUser stays for the cron paths that already
// run at a sensible hour.

import { adminClient } from '@/lib/supabase.server';
import { sendPush, type PushPayload } from '@/lib/hub/push';
import { sendTelegram, telegramEnabled } from '@/lib/integrations/telegram';

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';

export function isQuietHours(now = new Date()): boolean {
  const hour = parseInt(
    now.toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).replace(/\D/g, ''),
    10,
  );
  return hour >= 1 && hour < 7;
}

/** 07:00 local as a UTC instant — where held notifications land. Only meaningful
 *  when called during quiet hours (local hour 1–6), which is the only caller. */
function nextMorning(now = new Date()): Date {
  const hour = parseInt(
    now.toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).replace(/\D/g, ''), 10,
  );
  const minute = parseInt(now.toLocaleString('en-US', { timeZone: TZ, minute: 'numeric' }).replace(/\D/g, ''), 10);
  const hoursLeft = hour >= 7 ? 24 - hour + 7 : 7 - hour;
  return new Date(now.getTime() + (hoursLeft * 60 - minute) * 60_000);
}

async function telegramChatId(userId: string): Promise<number | null> {
  const { data } = await adminClient.from('telegram_links').select('chat_id').eq('user_id', userId).maybeSingle();
  return (data?.chat_id as number) ?? null;
}

/** Deliver immediately to every channel we can reach. Returns per-channel result. */
export async function notifyUser(
  userId: string,
  payload: PushPayload,
  channels: ('telegram' | 'push')[] = ['telegram', 'push'],
): Promise<{ push: number; telegram: boolean }> {
  let pushed = 0;
  let tg = false;

  if (channels.includes('push')) {
    const r = await sendPush(userId, payload).catch(() => ({ sent: 0, pruned: 0 }));
    pushed = r.sent;
  }
  if (channels.includes('telegram') && telegramEnabled()) {
    const chatId = await telegramChatId(userId);
    if (chatId) {
      const text = payload.title ? `*${payload.title}*\n${payload.body}` : payload.body;
      tg = await sendTelegram(chatId, text.replace(/\*/g, '')).catch(() => false);
    }
  }
  return { push: pushed, telegram: tg };
}

export interface QueueInput {
  kind: string;
  title: string;
  body: string;
  url?: string;
  dedupeKey?: string;
  channels?: ('telegram' | 'push')[];
  scheduledFor?: Date;
}

/** Queue a proactive message. De-dupes against unsent rows with the same key. */
export async function enqueueNotification(userId: string, n: QueueInput): Promise<'queued' | 'duplicate'> {
  if (n.dedupeKey) {
    const { data: dup } = await adminClient
      .from('notifications')
      .select('id')
      .eq('user_id', userId)
      .eq('dedupe_key', n.dedupeKey)
      .in('status', ['queued', 'held'])
      .maybeSingle();
    if (dup) return 'duplicate';
  }
  await adminClient.from('notifications').insert({
    user_id: userId,
    kind: n.kind,
    title: n.title,
    body: n.body,
    url: n.url ?? null,
    dedupe_key: n.dedupeKey ?? null,
    channels: n.channels ?? ['telegram', 'push'],
    scheduled_for: (n.scheduledFor ?? new Date()).toISOString(),
  });
  return 'queued';
}

/** Drain due notifications. Called by the tick worker every ~10 min. */
export async function drainNotifications(limit = 25): Promise<{ sent: number; held: number; failed: number }> {
  const nowIso = new Date().toISOString();
  const { data: rows } = await adminClient
    .from('notifications')
    .select('id, user_id, kind, title, body, url, channels, attempts')
    .in('status', ['queued', 'held'])
    .lte('scheduled_for', nowIso)
    .order('scheduled_for', { ascending: true })
    .limit(limit);

  let sent = 0;
  let held = 0;
  let failed = 0;

  for (const row of rows ?? []) {
    if (isQuietHours()) {
      await adminClient
        .from('notifications')
        .update({ status: 'held', scheduled_for: nextMorning().toISOString() })
        .eq('id', row.id);
      held++;
      continue;
    }
    const res = await notifyUser(
      row.user_id as string,
      { title: row.title as string, body: row.body as string, url: (row.url as string) ?? undefined, tag: row.kind as string },
      (row.channels as ('telegram' | 'push')[]) ?? ['telegram', 'push'],
    ).catch(() => ({ push: 0, telegram: false }));

    const delivered = res.push > 0 || res.telegram;
    if (delivered) {
      await adminClient.from('notifications').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', row.id);
      sent++;
    } else {
      const attempts = ((row.attempts as number) ?? 0) + 1;
      await adminClient
        .from('notifications')
        .update({
          status: attempts >= 5 ? 'failed' : 'queued',
          attempts,
          scheduled_for: new Date(Date.now() + 15 * 60_000).toISOString(),
        })
        .eq('id', row.id);
      attempts >= 5 ? failed++ : held++;
    }
  }
  return { sent, held, failed };
}
