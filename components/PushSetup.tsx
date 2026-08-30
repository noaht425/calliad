'use client';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const arr = Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  return arr.buffer;
}

export function PushSetup() {
  const { session } = useAuth();

  useEffect(() => {
    if (!session || !('serviceWorker' in navigator) || !('PushManager' in window)) return;

    async function setup() {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;

        // Don't prompt — only subscribe if permission already granted
        if (Notification.permission !== 'granted') return;

        const existing = await reg.pushManager.getSubscription();
        if (existing) return; // Already subscribed on this device

        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });

        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session!.access_token}`,
          },
          body: JSON.stringify(sub),
        });
      } catch (err) {
        console.error('[push] setup error:', err);
      }
    }

    setup();
  }, [session]);

  return null;
}

export async function requestPushPermission(accessToken: string): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) return true;

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(sub),
    });
    return res.ok;
  } catch {
    return false;
  }
}
