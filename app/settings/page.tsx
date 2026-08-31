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

function TasteLog({ token }: { token: string }) {
  const [items, setItems] = useState<{ id: string; title: string; kind: string; verdict: string; why: string | null }[]>([]);
  const [t, setT] = useState(''); const [v, setV] = useState('liked'); const [k, setK] = useState('screen'); const [w, setW] = useState('');
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const load = useCallback(async () => {
    const r = await fetch('/api/taste', { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) setItems((await r.json()).items ?? []);
  }, [token]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{items.length} entries. Ask &ldquo;would I like X?&rdquo; in chat.</p>
      <div className="flex flex-wrap gap-2">
        <input className={field + ' flex-1 min-w-[8rem]'} placeholder="title" value={t} onChange={(e) => setT(e.target.value)} />
        <select className={field + ' w-auto'} value={k} onChange={(e) => setK(e.target.value)}>
          <option value="screen">screen</option><option value="book">book</option><option value="game">game</option><option value="other">other</option>
        </select>
        <select className={field + ' w-auto'} value={v} onChange={(e) => setV(e.target.value)}>
          <option>loved</option><option>liked</option><option>fine</option><option>bailed</option><option>hated</option>
        </select>
        <input className={field + ' flex-1 min-w-[8rem]'} placeholder="why (optional)" value={w} onChange={(e) => setW(e.target.value)} />
        <button className={btn} disabled={!t} onClick={async () => {
          await fetch('/api/taste', { method: 'POST', headers: h, body: JSON.stringify({ title: t, kind: k, verdict: v, why: w || null }) });
          setT(''); setW(''); load();
        }}>Add</button>
      </div>
      <ul className="text-xs text-zinc-500 dark:text-zinc-400 space-y-1 max-h-48 overflow-y-auto">
        {items.slice(0, 40).map((i) => (
          <li key={i.id} className="flex gap-2">
            <span className="flex-1">{i.title} [{i.kind}] — <span className="font-medium">{i.verdict}</span></span>
            <button className="underline" onClick={async () => { await fetch(`/api/taste?id=${i.id}`, { method: 'DELETE', headers: h }); load(); }}>del</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LearnedFacts({ token }: { token: string }) {
  const [items, setItems] = useState<{ id: string; section: string; key: string; value: string; confirmed: boolean; source: string }[]>([]);
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const load = useCallback(async () => {
    const r = await fetch('/api/facts', { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) setItems((await r.json()).items ?? []);
  }, [token]);
  useEffect(() => { load(); }, [load]);
  if (!items.length)
    return <p className="text-sm text-zinc-400">None yet — say &ldquo;remember that I…&rdquo; in chat and it lands here.</p>;
  return (
    <ul className="text-xs text-zinc-500 dark:text-zinc-400 space-y-1 max-h-56 overflow-y-auto">
      {items.map((i) => (
        <li key={i.id} className="flex gap-2">
          <span className="flex-1">
            <span className="text-zinc-400">{i.section}/</span>{i.key}: {i.value}
            {!i.confirmed && <span className="text-amber-600"> · unconfirmed</span>}
          </span>
          {!i.confirmed && (
            <button className="underline" onClick={async () => {
              await fetch('/api/facts', { method: 'PATCH', headers: h, body: JSON.stringify({ id: i.id, confirmed: true }) });
              load();
            }}>keep</button>
          )}
          <button className="underline" onClick={async () => { await fetch(`/api/facts?id=${i.id}`, { method: 'DELETE', headers: h }); load(); }}>del</button>
        </li>
      ))}
    </ul>
  );
}

function QuizDeck({ token }: { token: string }) {
  const [c, setC] = useState<{ total: number; due: number }>({ total: 0, due: 0 });
  const [items, setItems] = useState<{ id: string; lang: string; prompt: string; answer: string; box: number }[]>([]);
  const [p, setP] = useState(''); const [a, setA] = useState(''); const [lang, setLang] = useState('lat');
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const load = useCallback(async () => {
    const r = await fetch('/api/quiz', { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) { const j = await r.json(); setC({ total: j.total, due: j.due }); setItems(j.items ?? []); }
  }, [token]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{c.due} due · {c.total} in deck. Say &ldquo;quiz me&rdquo; in chat to review.</p>
      <div className="flex flex-wrap gap-2">
        <select className={field + ' w-auto'} value={lang} onChange={(e) => setLang(e.target.value)}>
          <option value="lat">Latin</option><option value="grc">Greek</option><option value="ita">Italian</option>
        </select>
        <input className={field + ' flex-1 min-w-[8rem]'} placeholder="prompt" value={p} onChange={(e) => setP(e.target.value)} />
        <input className={field + ' flex-1 min-w-[8rem]'} placeholder="answer" value={a} onChange={(e) => setA(e.target.value)} />
        <button className={btn} disabled={!p || !a} onClick={async () => {
          await fetch('/api/quiz', { method: 'POST', headers: h, body: JSON.stringify({ lang, prompt: p, answer: a }) });
          setP(''); setA(''); load();
        }}>Add</button>
      </div>
      {items.length > 0 && (
        <ul className="text-xs text-zinc-500 dark:text-zinc-400 space-y-1 max-h-48 overflow-y-auto">
          {items.map((i) => (
            <li key={i.id} className="flex gap-2">
              <span className="flex-1">[{i.lang}] {i.prompt} → {i.answer} <span className="text-zinc-400">(box {i.box})</span></span>
              <button className="underline" onClick={async () => { await fetch(`/api/quiz?id=${i.id}`, { method: 'DELETE', headers: h }); load(); }}>del</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SetPassword() {
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <div className="space-y-2 max-w-xs">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">Set a password so you can sign into the home-screen app without the email step.</p>
      <input className={field} type="password" placeholder="new password (8+ chars)" value={pw} onChange={(e) => setPw(e.target.value)} />
      <button
        className={btn}
        disabled={saving || pw.length < 8}
        onClick={async () => {
          setSaving(true); setMsg(null);
          const { error } = await supabase.auth.updateUser({ password: pw });
          setSaving(false);
          setMsg(error ? error.message : 'Password set. Use it on the login screen.');
          if (!error) setPw('');
        }}
      >
        {saving ? 'Saving…' : 'Set password'}
      </button>
      {msg && <p className="text-xs text-zinc-500">{msg}</p>}
    </div>
  );
}

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
  const [loops, setLoops] = useState<{ id: string; title: string; body: string | null; due_at: string | null }[]>([]);
  const [loopDiag, setLoopDiag] = useState<string | null>(null);
  const [syllabi, setSyllabi] = useState<{ id: string; filename: string; course: string | null; extracted: { exams?: unknown[]; assignments?: unknown[] } }[]>([]);
  const [syllabusMsg, setSyllabusMsg] = useState<string | null>(null);

  const authHeader = useCallback(
    () => ({ Authorization: `Bearer ${session!.access_token}`, 'Content-Type': 'application/json' }),
    [session],
  );

  const loadInts = useCallback(async () => {
    if (!session) return;
    const r = await fetch('/api/integrations', { headers: { Authorization: `Bearer ${session.access_token}` } });
    if (r.ok) setInts(await r.json());
  }, [session]);

  const loadLoops = useCallback(async () => {
    if (!session) return;
    const r = await fetch('/api/loops', { headers: { Authorization: `Bearer ${session.access_token}` } });
    if (r.ok) setLoops((await r.json()).loops ?? []);
  }, [session]);

  const loadSyllabi = useCallback(async () => {
    if (!session) return;
    const r = await fetch('/api/ingest/syllabus', { headers: { Authorization: `Bearer ${session.access_token}` } });
    if (r.ok) setSyllabi((await r.json()).documents ?? []);
  }, [session]);

  async function uploadSyllabus(file: File) {
    setBusy('syllabus'); setSyllabusMsg(null);
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch('/api/ingest/syllabus', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session!.access_token}` },
      body: fd,
    });
    const j = await r.json();
    setBusy(null);
    setSyllabusMsg(j.ok ? `${j.course ?? 'course'}: ${j.loopsFiled} deadline(s) filed` : (j.error ?? 'failed'));
    loadSyllabi(); loadLoops();
  }

  async function closeLoop(id: string, status: 'done' | 'dropped') {
    await fetch('/api/loops', { method: 'PATCH', headers: authHeader(), body: JSON.stringify({ id, status }) });
    loadLoops();
  }

  async function testDetection() {
    setBusy('loopdiag'); setLoopDiag(null);
    const r = await fetch('/api/loops', {
      method: 'POST', headers: authHeader(),
      body: JSON.stringify({ probe: 'I need to email Prof. Tomasso about the seminar reading by Friday.' }),
    });
    const j = await r.json();
    setBusy(null);
    setLoopDiag(`T1 key configured: ${j.t1Available ? 'yes' : 'NO'} · filed this run: ${j.filed ?? 0}`);
    loadLoops();
  }

  useEffect(() => {
    if (!loading && !session) router.push('/login');
  }, [loading, session, router]);

  useEffect(() => {
    if (typeof Notification !== 'undefined') setPushState(Notification.permission as typeof pushState);
    setGmailParam(new URLSearchParams(window.location.search).get('gmail'));
    fetch('/api/health').then((r) => r.json()).then(setHealth).catch(() => {});
    loadInts();
    loadLoops();
    loadSyllabi();
  }, [loadInts, loadLoops, loadSyllabi]);

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

  async function runNudge() {
    setBusy('nudge'); setBriefText(null);
    // force=1 so the preview shows a composed nudge even if nothing's strictly in-window yet
    const r = await fetch('/api/nudge?force=1', { headers: { Authorization: `Bearer ${session!.access_token}` } });
    const j = await r.json();
    setBusy(null);
    setBriefText(j.text ?? j.note ?? j.error ?? 'nothing to nudge');
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

        <div className="flex flex-wrap gap-2">
          <button className={btn} disabled={busy !== null} onClick={runBrief}>
            {busy === 'brief' ? 'Composing…' : 'Run morning brief now'}
          </button>
          <button className={btn} disabled={busy !== null} onClick={runNudge}>
            {busy === 'nudge' ? 'Checking…' : 'Run nudge check'}
          </button>
        </div>
        <div>
          {briefText && (
            <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap border-l-2 border-zinc-300 dark:border-zinc-700 pl-3">
              {briefText}
            </p>
          )}
        </div>
      </section>

      {/* ── Syllabi ─────────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-600 mb-3">Syllabi</h2>
        <label className={`${btn} inline-block cursor-pointer`}>
          {busy === 'syllabus' ? 'Reading…' : 'Upload a syllabus (PDF)'}
          <input
            type="file"
            accept="application/pdf,.pdf,.txt,.md"
            className="hidden"
            disabled={busy !== null}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadSyllabus(f); e.target.value = ''; }}
          />
        </label>
        {syllabusMsg && <p className="text-xs text-zinc-500 mt-2">{syllabusMsg}</p>}
        {syllabi.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
            {syllabi.map((s) => (
              <li key={s.id}>
                {s.course ?? s.filename} — {(s.extracted?.exams?.length ?? 0)} exams, {(s.extracted?.assignments?.length ?? 0)} assignments
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Learned facts ──────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-600 mb-3">Learned about you</h2>
        <LearnedFacts token={session.access_token} />
      </section>

      {/* ── Taste log ───────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-600 mb-3">Taste log</h2>
        <TasteLog token={session.access_token} />
      </section>

      {/* ── Quiz deck ───────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-600 mb-3">Quiz deck</h2>
        <QuizDeck token={session.access_token} />
      </section>

      {/* ── Open loops ──────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-600 mb-3">Open loops</h2>
        <div className="mb-3">
          <button className="text-xs underline" disabled={busy !== null} onClick={testDetection}>
            {busy === 'loopdiag' ? 'testing…' : 'test detection'}
          </button>
          {loopDiag && <span className="text-xs text-zinc-500 ml-2">{loopDiag}</span>}
        </div>
        {loops.length === 0 ? (
          <p className="text-sm text-zinc-400">None — Calliad files these as they come up in chat.</p>
        ) : (
          <ul className="space-y-2">
            {loops.map((l) => (
              <li key={l.id} className="text-sm text-zinc-700 dark:text-zinc-300 flex items-start gap-2">
                <span className="flex-1">
                  {l.title}
                  {l.due_at && <span className="text-zinc-400"> · due {new Date(l.due_at).toLocaleDateString()}</span>}
                  {l.body && <span className="block text-xs text-zinc-500">{l.body}</span>}
                </span>
                <button className="text-xs underline shrink-0" onClick={() => closeLoop(l.id, 'done')}>done</button>
                <button className="text-xs underline shrink-0 text-zinc-400" onClick={() => closeLoop(l.id, 'dropped')}>drop</button>
              </li>
            ))}
          </ul>
        )}
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

      <section className="mb-6">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-600 mb-3">Account</h2>
        <SetPassword />
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
