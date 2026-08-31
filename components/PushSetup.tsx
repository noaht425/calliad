'use client';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;

function vapidKey(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

async function syncSubscription(sub: PushSubscription, accessToken: string): Promise<boolean> {
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(sub),
  });
  return res.ok;
}

export function PushSetup() {
  const { session } = useAuth();

  useEffect(() => {
    if (!session || !('serviceWorker' in navigator) || !('PushManager' in window)) return;

    async function setup() {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;

        if (Notification.permission !== 'granted') return;

        // Re-sync EVERY load. A server row can vanish (410 prune, DB reset) while
        // the browser still holds the subscription — without this, getSubscription()
        // returns non-null forever and the server never hears about it again.
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: vapidKey(VAPID_PUBLIC_KEY),
          });
        }
        await syncSubscription(sub, session!.access_token);
      } catch (err) {
        console.error('[push] setup error:', err);
      }
    }

    setup();
  }, [session]);

  return null;
}

export type PushResult =
  | { ok: true; endpoint: string }
  | { ok: false; reason: 'unsupported' | 'denied' | 'not-installed' | 'subscribe-failed' | 'save-failed' };

/** Prompt for permission and (re)subscribe. Returns a reason on failure so the UI can explain. */
export async function requestPushPermission(accessToken: string): Promise<PushResult> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
    return { ok: false, reason: 'unsupported' };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKey(VAPID_PUBLIC_KEY),
      });
    }
    const saved = await syncSubscription(sub, accessToken);
    return saved ? { ok: true, endpoint: sub.endpoint } : { ok: false, reason: 'save-failed' };
  } catch (err) {
    // iOS throws here when the page isn't running as an installed (Home Screen) PWA.
    const msg = String((err as Error)?.message ?? err);
    if (/gesture|denied|not allowed|Notifications/i.test(msg) && !window.matchMedia('(display-mode: standalone)').matches) {
      return { ok: false, reason: 'not-installed' };
    }
    console.error('[push] subscribe error:', err);
    return { ok: false, reason: 'subscribe-failed' };
  }
}
