import webpush from 'web-push';
import { adminClient } from '@/lib/supabase.server';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://calliad-psi.vercel.app';

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

  // Absolute URL for `navigate` (required by Declarative Web Push).
  const navigate = new URL(payload.url ?? '/', APP_URL).toString();
  const actions = payload.actions?.length ? payload.actions.slice(0, 2) : undefined;
  const tag = payload.tag ?? 'calliad';
  // Dual shape: Safari 18.4+ reads `web_push` + `notification` and displays it
  // WITHOUT waking the service worker (so a missed showNotification() can't get
  // the subscription cancelled); every other browser's SW `push` handler reads
  // the same `notification` object (see public/sw.js).
  const body = JSON.stringify({
    web_push: 8030,
    notification: {
      title: payload.title,
      body: payload.body,
      navigate,
      tag,
      ...(actions ? { actions } : {}),
      data: { url: navigate, actionToken: payload.actionToken ?? null },
    },
    // legacy flat mirror — harmless for declarative UAs, kept for older clients
    title: payload.title,
    body: payload.body,
    url: navigate,
    tag,
    ...(actions ? { actions } : {}),
    ...(payload.actionToken ? { actionToken: payload.actionToken } : {}),
  });

  let sent = 0;
  let pruned = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
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
