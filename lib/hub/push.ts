import webpush from 'web-push';
import { adminClient } from '@/lib/supabase.server';

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails('mailto:noaht425@gmail.com', pub, priv);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  actions?: { action: string; title: string }[]; // notification buttons (max 2 on iOS)
  actionToken?: string;                           // signed token for /api/push/action
}

/** Send a web-push to all of a user's subscriptions; prune expired (410) ones. */
export async function sendPush(userId: string, payload: PushPayload): Promise<{ sent: number; pruned: number }> {
  if (!ensureConfigured()) {
    console.warn('[push] VAPID keys not set — skipping');
    return { sent: 0, pruned: 0 };
  }
  const { data: subs } = await adminClient
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId);

  let sent = 0;
  let pruned = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({
          title: payload.title,
          body: payload.body,
          url: payload.url ?? '/',
          tag: payload.tag ?? 'calliad',
          ...(payload.actions?.length ? { actions: payload.actions.slice(0, 2) } : {}),
          ...(payload.actionToken ? { actionToken: payload.actionToken } : {}),
        }),
      );
      sent++;
    } catch (err: unknown) {
      if ((err as { statusCode?: number }).statusCode === 410) {
        await adminClient.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
        pruned++;
      } else {
        console.error('[push] send failed', err);
      }
    }
  }
  return { sent, pruned };
}
