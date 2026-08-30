'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { requestPushPermission } from '@/components/PushSetup';
import { BottomNav } from '@/components/BottomNav';

type KillLevel = 'off' | 'pause_proactive' | 'pause_all';

export default function SettingsPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [pushState, setPushState] = useState<'unknown' | 'granted' | 'denied' | 'default'>('unknown');
  const [health, setHealth] = useState<{ killswitch: KillLevel; spendMonthToDate: number; spendCap: number } | null>(null);

  useEffect(() => {
    if (!loading && !session) router.push('/login');
  }, [loading, session, router]);

  useEffect(() => {
    if (typeof Notification !== 'undefined') setPushState(Notification.permission as typeof pushState);
    fetch('/api/health').then((r) => r.json()).then(setHealth).catch(() => {});
  }, []);

  if (loading || !session) return null;

  return (
    <div className="min-h-dvh bg-[#fafaf8] dark:bg-[#0a0a0a] px-4 pt-12 pb-24 max-w-xl mx-auto">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-6">Settings</h1>

      <section className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-600 mb-3">Notifications</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">Push permission: <span className="font-medium">{pushState}</span></p>
        {pushState !== 'granted' && (
          <button
            onClick={async () => {
              const ok = await requestPushPermission(session.access_token);
              setPushState(ok ? 'granted' : (Notification.permission as typeof pushState));
            }}
            className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium px-3 py-2"
          >
            Enable push notifications
          </button>
        )}
      </section>

      <section className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-600 mb-3">Hub status</h2>
        {health ? (
          <ul className="text-sm text-zinc-600 dark:text-zinc-400 space-y-1">
            <li>Kill switch: <span className="font-medium">{health.killswitch}</span></li>
            <li>Spend this month: <span className="font-medium">${health.spendMonthToDate?.toFixed(4)} / ${health.spendCap}</span></li>
          </ul>
        ) : (
          <p className="text-sm text-zinc-400">Unavailable.</p>
        )}
        <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-2">
          Change the kill switch: <code className="font-mono">POST /api/admin/killswitch</code> with the admin secret. A UI toggle lands in Phase 0 wrap-up.
        </p>
      </section>

      <button
        onClick={async () => { await supabase.auth.signOut(); router.push('/login'); }}
        className="text-sm text-zinc-500 dark:text-zinc-400 underline"
      >
        Sign out
      </button>

      <BottomNav />
    </div>
  );
}
