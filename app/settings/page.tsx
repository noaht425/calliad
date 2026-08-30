'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { requestPushPermission } from '@/components/PushSetup';
import { BottomNav } from '@/components/BottomNav';

export const dynamic = 'force-dynamic';

type KillLevel = 'off' | 'pause_proactive' | 'pause_all';

interface IntegrationsState {
  gmail: { connected: boolean; email?: string; label?: string; lastScannedAt?: string | null };
  icloud: { connected: boolean; calendars?: string[]; lastSyncedAt?: string | null };
  counts: { calendar_events: number; schedule_events: number; email_items: number };
}

const btn = 'rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium px-3 py-2 disabled:opacity-40';
const field = 'w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-2 text-sm';

export default function SettingsPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [gmailParam, setGmailParam] = useState<string | null>(null);
  const [pushState, setPushState] = useState<'unknown' | 'granted' | 'denied' | 'default'>('unknown');
  const [health, setHealth] = useState<{ killswitch: KillLevel; spendMonthToDate: number; spendCap: number } | null>(null);
  const [ints, setInts] = useState<IntegrationsState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // iCloud connect form
  const [appleId, setAppleId] = useState('');
  const [appPw, setAppPw] = useState('');
  const [cals, setCals] = useState<{ url: string; name: string }[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [icloudMsg, setIcloudMsg] = useState('');
  const [briefText, setBriefText] = useState<string | null>(null);

  const authHeader = useCallback(
    () => ({ Authorization: `Bearer ${session!.access_token}`, 'Content-Type': 'application/json' }),
    [session],
  );

  const loadInts = useCallback(async () => {
    if (!session) return;
    const r = await fetch('/api/integrations', { headers: { Authorization: `Bearer ${session.access_token}` } });
    if (r.ok) setInts(await r.json());
  }, [session]);

  useEffect(() => {
    if (!loading && !session) router.push('/login');
  }, [loading, session, router]);

  useEffect(() => {
    if (typeof Notification !== 'undefined') setPushState(Notification.permission as typeof pushState);
    setGmailParam(new URLSearchParams(window.location.search).get('gmail'));
    fetch('/api/health').then((r) => r.json()).then(setHealth).catch(() => {});
    loadInts();
  }, [loadInts]);

  if (loading || !session) return null;

  async function testICloud() {
    setBusy('icloud-test'); setIcloudMsg('');
    const r = await fetch('/api/auth/icloud/connect', {
      method: 'POST', headers: authHeader(), body: JSON.stringify({ apple_id: appleId, app_password: appPw }),
    });
    const j = await r.json();
    setBusy(null);
    if (!r.ok) { setIcloudMsg(j.error ?? 'Failed'); return; }
    setCals(j.calendars ?? []);
    setPicked(new Set());
  }

  async function saveICloud() {
    setBusy('icloud-save'); setIcloudMsg('');
    const r = await fetch('/api/auth/icloud/connect', {
      method: 'POST', headers: authHeader(),
      body: JSON.stringify({ apple_id: appleId, app_password: appPw, calendar_urls: [...picked] }),
    });
    const j = await r.json();
    setBusy(null);
    if (!r.ok) { setIcloudMsg(j.error ?? 'Failed'); return; }
    setCals(null); setAppPw(''); setPicked(new Set());
    setIcloudMsg(`Connected: ${(j.calendars ?? []).join(', ')} (synced ${j.firstSync?.synced ?? 0})`);
    loadInts();
  }

  async function syncNow() {
    setBusy('sync');
    await fetch('/api/integrations', { method: 'POST', headers: authHeader(), body: JSON.stringify({ what: 'all' }) });
    setBusy(null);
    loadInts();
  }

  async function loadSchedule() {
    setBusy('schedule');
    await fetch('/api/integrations', { method: 'POST', headers: authHeader(), body: JSON.stringify({ what: 'schedule' }) });
    setBusy(null);
    loadInts();
  }

  async function runBrief() {
    setBusy('brief'); setBriefText(null);
    const r = await fetch('/api/brief?push=1', { headers: { Authorization: `Bearer ${session!.access_token}` } });
    const j = await r.json();
    setBusy(null);
    setBriefText(j.deferred ? '(deferred — spend cap reached)' : (j.text ?? j.error ?? 'failed'));
  }

  async function disconnect(service: 'gmail' | 'icloud_calendar') {
    setBusy(`disc-${service}`);
    await fetch(`/api/integrations?service=${service}`, { method: 'DELETE', headers: authHeader() });
    setBusy(null);
    setCals(null); setIcloudMsg('');
    loadInts();
  }

  return (
    <div className="min-h-dvh bg-[#fafaf8] dark:bg-[#0a0a0a] px-4 pt-12 pb-24 max-w-xl mx-auto">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-6">Settings</h1>

      {/* ── Integrations ─────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-600 mb-3">Integrations</h2>

        {/* Gmail */}
        <div className="mb-4">
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Gmail</p>
          {gmailParam === 'connected' && <p className="text-xs text-emerald-600">Connected ✓</p>}
          {gmailParam === 'error' && <p className="text-xs text-red-500">Connection failed — try again.</p>}
          {ints?.gmail.connected ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {ints.gmail.email} · label <span className="font-mono">{ints.gmail.label}</span> ·{' '}
              {ints.gmail.lastScannedAt ? `scanned ${new Date(ints.gmail.lastScannedAt).toLocaleString()}` : 'not scanned yet'}
              {' · '}
              <button className="underline" disabled={busy !== null} onClick={() => disconnect('gmail')}>disconnect</button>
            </p>
          ) : (
            <a href={`/api/auth/gmail/authorize?token=${session.access_token}`} className={`${btn} inline-block mt-1 no-underline`}>
              Connect Gmail
            </a>
          )}
        </div>

        {/* iCloud calendar */}
        <div className="mb-4">
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">iCloud Calendar</p>
          {ints?.icloud.connected ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {(ints.icloud.calendars ?? []).join(', ') || 'no calendars'} ·{' '}
              {ints.icloud.lastSyncedAt ? `synced ${new Date(ints.icloud.lastSyncedAt).toLocaleString()}` : 'not synced yet'}
              {' · '}
              <button className="underline" disabled={busy !== null} onClick={() => disconnect('icloud_calendar')}>disconnect &amp; re-pick</button>
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              <input className={field} placeholder="Apple ID email" value={appleId} onChange={(e) => setAppleId(e.target.value)} />
              <input className={field} type="password" placeholder="App-specific password (appleid.apple.com)" value={appPw} onChange={(e) => setAppPw(e.target.value)} />
              {!cals && (
                <button className={btn} disabled={busy !== null || !appleId || !appPw} onClick={testICloud}>
                  {busy === 'icloud-test' ? 'Checking…' : 'Check calendars'}
                </button>
              )}
              {cals && (
                <div className="space-y-1">
                  <p className="text-xs text-zinc-500">Pick the calendars to sync:</p>
                  {cals.map((c) => (
                    <label key={c.url} className="flex items-center gap-2 text-sm py-1">
                      <input
                        type="checkbox"
                        checked={picked.has(c.url)}
                        onChange={(e) => setPicked((p) => {
                          const n = new Set(p);
                          if (e.target.checked) n.add(c.url); else n.delete(c.url);
                          return n;
                        })}
                      />
                      {c.name}
                    </label>
                  ))}
                  <button className={btn} disabled={busy !== null || picked.size === 0} onClick={saveICloud}>
                    {busy === 'icloud-save' ? 'Connecting…' : `Connect ${picked.size || ''} calendar${picked.size === 1 ? '' : 's'}`}
                  </button>
                </div>
              )}
              {icloudMsg && <p className="text-xs text-zinc-500">{icloudMsg}</p>}
            </div>
          )}
        </div>

        {/* Class schedule (materialised from the profile, not a live calendar) */}
        <div className="mb-4">
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Class schedule</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {ints?.counts.schedule_events ?? 0} meetings loaded (Fall 2026 term) ·{' '}
            <button className="underline" disabled={busy !== null} onClick={loadSchedule}>
              {busy === 'schedule' ? 'loading…' : 'reload'}
            </button>
          </p>
        </div>

        {(ints?.gmail.connected || ints?.icloud.connected) && (
          <div className="flex items-center gap-3 mb-3">
            <button className={btn} disabled={busy !== null} onClick={syncNow}>
              {busy === 'sync' ? 'Syncing…' : 'Sync now'}
            </button>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {ints?.counts.calendar_events ?? 0} calendar · {ints?.counts.email_items ?? 0} emails
            </span>
          </div>
        )}

        <div>
          <button className={btn} disabled={busy !== null} onClick={runBrief}>
            {busy === 'brief' ? 'Composing…' : 'Run morning brief now'}
          </button>
          {briefText && (
            <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap border-l-2 border-zinc-300 dark:border-zinc-700 pl-3">
              {briefText}
            </p>
          )}
        </div>
      </section>

      {/* ── Notifications ────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-600 mb-3">Notifications</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">Push permission: <span className="font-medium">{pushState}</span></p>
        {pushState !== 'granted' && (
          <button
            className={btn}
            onClick={async () => {
              const ok = await requestPushPermission(session.access_token);
              setPushState(ok ? 'granted' : (Notification.permission as typeof pushState));
            }}
          >
            Enable push notifications
          </button>
        )}
      </section>

      {/* ── Hub status ───────────────────────────────────────────────── */}
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
