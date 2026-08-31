'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { requestPushPermission } from '@/components/PushSetup';
import { BottomNav } from '@/components/BottomNav';
import { PageShell, PageHeader, PageBody } from '@/components/PageLayout';
import { THEMES, useTheme } from '@/components/ThemeProvider';

export const dynamic = 'force-dynamic';

type KillLevel = 'off' | 'pause_proactive' | 'pause_all';

interface IntegrationsState {
  gmail: { connected: boolean; email?: string; label?: string; lastScannedAt?: string | null };
  icloud: { connected: boolean; calendars?: string[]; lastSyncedAt?: string | null };
  counts: { calendar_events: number; schedule_events: number; email_items: number; contacts: number };
}

const btn = 'rounded-lg bg-[var(--accent)] text-[var(--on-accent)] text-sm font-medium px-3 py-2 disabled:opacity-40';
const field = 'w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] px-3 py-2 text-sm';
const label = 'text-[10px] font-mono uppercase tracking-[0.16em] text-[var(--text-quiet)] mb-3';

function WeatherLocation({ token }: { token: string }) {
  const [label, setLabel] = useState<string>('…');
  const [city, setCity] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const load = useCallback(async () => {
    const r = await fetch('/api/weather-location', { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) setLabel((await r.json()).label);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function save(body: Record<string, unknown>) {
    setBusy(true); setMsg(null);
    const r = await fetch('/api/weather-location', { method: 'POST', headers: h, body: JSON.stringify(body) });
    const j = await r.json();
    setBusy(false);
    if (r.ok) { setLabel(j.label); setCity(''); setMsg(`Set to ${j.label}.`); }
    else setMsg(j.error ?? 'Failed.');
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-[var(--text-muted)]">Brief weather is for <span className="font-medium text-[var(--text)]">{label}</span>.</p>
      <div className="flex flex-wrap gap-2">
        <input className={field + ' flex-1 min-w-[10rem]'} placeholder="city (e.g. Seattle)" value={city}
          onChange={(e) => setCity(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && city.trim()) save({ city }); }} />
        <button className={btn} disabled={busy || !city.trim()} onClick={() => save({ city })}>Set</button>
        <button className="text-xs underline text-[var(--text-muted)]" disabled={busy}
          onClick={() => navigator.geolocation?.getCurrentPosition(
            (p) => save({ lat: p.coords.latitude, lon: p.coords.longitude }),
            () => setMsg('Location permission denied.'),
          )}>
          use my location
        </button>
      </div>
      {msg && <p className="text-xs text-[var(--text-muted)]">{msg}</p>}
    </div>
  );
}

function Contacts({ token }: { token: string }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<{ id: string; name: string; org: string | null; relationship: string | null; relationship_note: string | null }[]>([]);
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const search = useCallback(async (query: string) => {
    const url = query.trim() ? `/api/contacts?q=${encodeURIComponent(query)}` : '/api/contacts?filed=1';
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) setItems((await r.json()).items ?? []);
  }, [token]);
  useEffect(() => { search(''); }, [search]);

  const setRel = async (id: string, relationship: string | null, note?: string) => {
    await fetch('/api/contacts', { method: 'PATCH', headers: h, body: JSON.stringify({ id, relationship, note }) });
    search(q);
  };

  return (
    <div className="space-y-3">
      <input
        className={field}
        placeholder="search contacts…"
        value={q}
        onChange={(e) => { setQ(e.target.value); search(e.target.value); }}
      />
      <p className="text-xs text-[var(--text-quiet)]">{q.trim() ? 'matches' : 'contacts with a relationship set'}</p>
      <ul className="text-xs text-[var(--text-muted)] space-y-1.5 max-h-72 overflow-y-auto">
        {items.map((c) => (
          <li key={c.id} className="flex items-center gap-2">
            <span className="flex-1 min-w-0">{c.name}{c.org ? <span className="text-[var(--text-quiet)]"> · {c.org}</span> : null}</span>
            <select
              className="bg-transparent border border-[var(--border)] rounded px-1 py-0.5 text-[11px]"
              value={c.relationship ?? ''}
              onChange={(e) => setRel(c.id, e.target.value || null, c.relationship_note ?? undefined)}
            >
              <option value="">—</option>
              <option value="family">family</option>
              <option value="friend">friend</option>
              <option value="colleague">colleague</option>
              <option value="acquaintance">acquaintance</option>
            </select>
          </li>
        ))}
        {!items.length && <li className="text-[var(--text-quiet)]">{q.trim() ? 'no match' : 'none filed yet — Calliad asks as people come up in chat'}</li>}
      </ul>
    </div>
  );
}

function Restaurants({ token }: { token: string }) {
  const [items, setItems] = useState<{ id: string; name: string; city: string | null; score: number | null; category: string | null; status: string }[]>([]);
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const load = useCallback(async () => {
    const r = await fetch('/api/restaurants', { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) setItems((await r.json()).items ?? []);
  }, [token]);
  useEffect(() => { load(); }, [load]);
  if (!items.length)
    return <p className="text-sm text-[var(--text-quiet)]">Empty — send Calliad your Beli screenshots in chat (say &ldquo;here&rsquo;s my beli list&rdquo;) and it&rsquo;ll pull them in here.</p>;
  return (
    <div className="space-y-2">
      <p className="text-sm text-[var(--text-muted)]">{items.filter((i) => i.status === 'ranked').length} rated · {items.filter((i) => i.status === 'want').length} want-to-try</p>
      <ul className="text-xs text-[var(--text-muted)] space-y-1 max-h-64 overflow-y-auto">
        {items.map((i) => (
          <li key={i.id} className="flex gap-2">
            <span className="flex-1">
              {i.name}{i.city ? <span className="text-[var(--text-quiet)]">, {i.city}</span> : null}
              {i.score != null ? <span className="font-medium"> — {i.score}</span> : <span className="text-[var(--text-quiet)]"> — want</span>}
              {i.category ? <span className="text-[var(--text-quiet)]"> · {i.category}</span> : null}
            </span>
            <button className="underline" onClick={async () => { await fetch(`/api/restaurants?id=${i.id}`, { method: 'DELETE', headers: h }); load(); }}>del</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Subscriptions({ token }: { token: string }) {
  const [items, setItems] = useState<{ id: string; name: string; amount_cents: number; currency: string; cadence: string; next_charge: string | null }[]>([]);
  const [total, setTotal] = useState(0);
  const [name, setName] = useState(''); const [amt, setAmt] = useState(''); const [cad, setCad] = useState('monthly');
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const money = (c: number) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const load = useCallback(async () => {
    const r = await fetch('/api/subscriptions', { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) { const j = await r.json(); setItems(j.items ?? []); setTotal(j.monthlyTotalCents ?? 0); }
  }, [token]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <>
          <p className="text-sm text-[var(--text-muted)]">{items.length} tracked · ~{money(total)}/mo · {money(total * 12)}/yr</p>
          <ul className="text-xs text-[var(--text-muted)] space-y-1 max-h-64 overflow-y-auto">
            {items.map((i) => (
              <li key={i.id} className="flex gap-2">
                <span className="flex-1">{i.name} <span className="font-medium">{money(i.amount_cents)}</span><span className="text-[var(--text-quiet)]">/{i.cadence.replace('ly', '')}{i.next_charge ? ` · next ${i.next_charge}` : ''}</span></span>
                <button className="underline" onClick={async () => { await fetch(`/api/subscriptions?id=${i.id}`, { method: 'DELETE', headers: h }); load(); }}>del</button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="flex flex-wrap gap-2 items-center">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="rounded border px-2 py-1 text-xs" style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--text)' }} />
        <input value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="$" inputMode="decimal" className="w-16 rounded border px-2 py-1 text-xs" style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--text)' }} />
        <select value={cad} onChange={(e) => setCad(e.target.value)} className="rounded border px-2 py-1 text-xs" style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--text)' }}>
          <option value="weekly">weekly</option><option value="monthly">monthly</option><option value="quarterly">quarterly</option><option value="yearly">yearly</option>
        </select>
        <button
          className="underline text-xs"
          onClick={async () => {
            const a = parseFloat(amt);
            if (!name.trim() || !a || a <= 0) return;
            await fetch('/api/subscriptions', { method: 'POST', headers: h, body: JSON.stringify({ name: name.trim(), amount: a, cadence: cad }) });
            setName(''); setAmt(''); load();
          }}
        >add</button>
      </div>
      {!items.length && <p className="text-xs text-[var(--text-quiet)]">Or just tell Calliad in chat: &ldquo;I pay $12/mo for Spotify&rdquo;.</p>}
    </div>
  );
}

function ThemePicker() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="flex flex-wrap gap-2">
      {THEMES.map((t) => (
        <button
          key={t.id}
          onClick={() => setTheme(t.id)}
          className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors"
          style={{
            borderColor: theme === t.id ? 'var(--accent)' : 'var(--border)',
            background: theme === t.id ? 'var(--accent-wash)' : 'var(--surface)',
            color: 'var(--text)',
          }}
        >
          <span className="inline-flex h-4 w-4 rounded-full border" style={{ background: t.paper, borderColor: t.accent }}>
            <span className="m-auto h-1.5 w-1.5 rounded-full" style={{ background: t.accent }} />
          </span>
          {t.label}
        </button>
      ))}
    </div>
  );
}

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
      <p className="text-sm text-[var(--text-muted)]">{items.length} entries. Ask &ldquo;would I like X?&rdquo; in chat.</p>
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
      <ul className="text-xs text-[var(--text-muted)] space-y-1 max-h-48 overflow-y-auto">
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
    return <p className="text-sm text-[var(--text-quiet)]">None yet — say &ldquo;remember that I…&rdquo; in chat and it lands here.</p>;
  return (
    <ul className="text-xs text-[var(--text-muted)] space-y-1 max-h-56 overflow-y-auto">
      {items.map((i) => (
        <li key={i.id} className="flex gap-2">
          <span className="flex-1">
            <span className="text-[var(--text-quiet)]">{i.section}/</span>{i.key}: {i.value}
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

function MedLog({ token }: { token: string }) {
  const [hist, setHist] = useState<{ day: string; taken: boolean; sent_count: number; note: string | null }[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const load = useCallback(async () => {
    const r = await fetch('/api/med', { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) setHist((await r.json()).history ?? []);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const todayStr = new Date().toLocaleDateString('en-CA');
  const today = hist.find((d) => d.day === todayStr);

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--text-muted)]">
        Today: {today?.taken ? 'taken ✓' : today?.sent_count ? `asked ${today.sent_count}×, not confirmed` : 'not asked yet'}
      </p>
      <div className="flex flex-wrap gap-2">
        <button className={btn} onClick={async () => { await fetch('/api/med', { method: 'POST', headers: h, body: JSON.stringify({ taken: true }) }); load(); }}>Took it today</button>
        <button className="text-xs underline text-[var(--text-muted)]" onClick={async () => { await fetch('/api/med', { method: 'POST', headers: h, body: JSON.stringify({ taken: false, note: 'not yet' }) }); load(); }}>not yet</button>
        <button className="text-xs underline text-[var(--text-muted)]" onClick={async () => { const r = await fetch('/api/med?checkin=1', { headers: { Authorization: `Bearer ${token}` } }); setMsg((await r.json()).reason ?? ''); load(); }}>send check-in now</button>
      </div>
      {msg && <p className="text-xs text-[var(--text-quiet)]">{msg}</p>}
      <div className="flex gap-1">
        {[...hist].reverse().slice(-14).map((d) => (
          <span
            key={d.day}
            title={`${d.day}: ${d.taken ? 'taken' : d.sent_count ? 'unconfirmed' : 'no data'}`}
            className="h-4 w-4 rounded-[3px]"
            style={{ background: d.taken ? 'var(--accent)' : d.sent_count ? 'var(--warm-wash)' : 'var(--neutral-tile)' }}
          />
        ))}
      </div>
      <p className="text-[11px] text-[var(--text-quiet)]">
        The 11am check-in needs an external ping to <code>/api/cron/med</code> (Vercel Hobby is capped at 2 crons). The 2pm nudge cron sends a backstop.
      </p>
    </div>
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
      <p className="text-sm text-[var(--text-muted)]">{c.due} due · {c.total} in deck. Say &ldquo;quiz me&rdquo; in chat to review.</p>
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
        <ul className="text-xs text-[var(--text-muted)] space-y-1 max-h-48 overflow-y-auto">
          {items.map((i) => (
            <li key={i.id} className="flex gap-2">
              <span className="flex-1">[{i.lang}] {i.prompt} → {i.answer} <span className="text-[var(--text-quiet)]">(box {i.box})</span></span>
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
      <p className="text-sm text-[var(--text-muted)]">Set a password so you can sign into the home-screen app without the email step.</p>
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
      {msg && <p className="text-xs text-[var(--text-muted)]">{msg}</p>}
    </div>
  );
}

export default function SettingsPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [gmailParam, setGmailParam] = useState<string | null>(null);
  const [pushState, setPushState] = useState<'unknown' | 'granted' | 'denied' | 'default'>('unknown');
  const [pushMsg, setPushMsg] = useState('');
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
    <PageShell>
      <PageHeader title="Settings" />
      <PageBody className="px-4 pt-2">
        <div className="max-w-xl mx-auto pb-4">

      {/* ── Appearance ──────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className={label}>Appearance</h2>
        <ThemePicker />
      </section>

      {/* ── Weather ─────────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className={label}>Weather</h2>
        <WeatherLocation token={session.access_token} />
      </section>

      {/* ── Integrations ─────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className={label}>Integrations</h2>

        {/* Gmail */}
        <div className="mb-4">
          <p className="text-sm font-medium text-[var(--text-body)]">Gmail</p>
          {gmailParam === 'connected' && <p className="text-xs text-emerald-600">Connected ✓</p>}
          {gmailParam === 'error' && <p className="text-xs text-red-500">Connection failed — try again.</p>}
          {ints?.gmail.connected ? (
            <p className="text-xs text-[var(--text-muted)]">
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
          <p className="text-sm font-medium text-[var(--text-body)]">iCloud Calendar</p>
          {ints?.icloud.connected ? (
            <p className="text-xs text-[var(--text-muted)]">
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
                  <p className="text-xs text-[var(--text-muted)]">Pick the calendars to sync:</p>
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
              {icloudMsg && <p className="text-xs text-[var(--text-muted)]">{icloudMsg}</p>}
            </div>
          )}
        </div>

        {/* Class schedule (materialised from the profile, not a live calendar) */}
        <div className="mb-4">
          <p className="text-sm font-medium text-[var(--text-body)]">Class schedule</p>
          <p className="text-xs text-[var(--text-muted)]">
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
            <span className="text-xs text-[var(--text-muted)]">
              {ints?.counts.calendar_events ?? 0} calendar · {ints?.counts.contacts ?? 0} contacts · {ints?.counts.email_items ?? 0} emails
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
            <p className="mt-2 text-sm text-[var(--text-body)] whitespace-pre-wrap border-l-2 border-[var(--border)] pl-3">
              {briefText}
            </p>
          )}
        </div>
      </section>

      {/* ── Syllabi ─────────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className={label}>Syllabi</h2>
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
        {syllabusMsg && <p className="text-xs text-[var(--text-muted)] mt-2">{syllabusMsg}</p>}
        {syllabi.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm text-[var(--text-muted)]">
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
        <h2 className={label}>Learned about you</h2>
        <LearnedFacts token={session.access_token} />
      </section>

      {/* ── Taste log ───────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className={label}>Taste log</h2>
        <TasteLog token={session.access_token} />
      </section>

      {/* ── Contacts ──────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className={label}>Contacts</h2>
        <Contacts token={session.access_token} />
      </section>

      {/* ── Restaurants ────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className={label}>Restaurants</h2>
        <Restaurants token={session.access_token} />
      </section>

      {/* ── Subscriptions ─────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className={label}>Subscriptions</h2>
        <Subscriptions token={session.access_token} />
      </section>

      {/* ── Quiz deck ───────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className={label}>Quiz deck</h2>
        <QuizDeck token={session.access_token} />
      </section>

      {/* ── Open loops ──────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className={label}>Open loops</h2>
        <div className="mb-3">
          <button className="text-xs underline" disabled={busy !== null} onClick={testDetection}>
            {busy === 'loopdiag' ? 'testing…' : 'test detection'}
          </button>
          {loopDiag && <span className="text-xs text-[var(--text-muted)] ml-2">{loopDiag}</span>}
        </div>
        {loops.length === 0 ? (
          <p className="text-sm text-[var(--text-quiet)]">None — Calliad files these as they come up in chat.</p>
        ) : (
          <ul className="space-y-2">
            {loops.map((l) => (
              <li key={l.id} className="text-sm text-[var(--text-body)] flex items-start gap-2">
                <span className="flex-1">
                  {l.title}
                  {l.due_at && <span className="text-[var(--text-quiet)]"> · due {new Date(l.due_at).toLocaleDateString()}</span>}
                  {l.body && <span className="block text-xs text-[var(--text-muted)]">{l.body}</span>}
                </span>
                <button className="text-xs underline shrink-0" onClick={() => closeLoop(l.id, 'done')}>done</button>
                <button className="text-xs underline shrink-0 text-[var(--text-quiet)]" onClick={() => closeLoop(l.id, 'dropped')}>drop</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Medication ──────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className={label}>Medication</h2>
        <MedLog token={session.access_token} />
      </section>

      {/* ── Notifications ────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className={label}>Notifications</h2>
        <p className="text-sm text-[var(--text-muted)] mb-2">Push permission: <span className="font-medium">{pushState}</span></p>
        <div className="flex flex-wrap gap-2">
          <button
            className={btn}
            onClick={async () => {
              setPushMsg('Setting up…');
              const r = await requestPushPermission(session.access_token);
              setPushState(typeof Notification !== 'undefined' ? (Notification.permission as typeof pushState) : 'unknown');
              if (r.ok) setPushMsg('Subscribed on this device. Try the test below.');
              else setPushMsg(
                r.reason === 'not-installed'
                  ? 'On iPhone/iPad, add Calliad to your Home Screen first, then open it from that icon and try again.'
                  : r.reason === 'denied'
                    ? 'Permission was denied — enable notifications for Calliad in your browser/site settings, then retry.'
                    : r.reason === 'unsupported'
                      ? 'This browser can’t do web push. On iOS you need the Home Screen app (iOS 16.4+).'
                      : r.reason === 'save-failed'
                        ? 'Subscribed in the browser but the server didn’t save it — try again.'
                        : 'Couldn’t subscribe — try again, or reinstall the Home Screen app.',
              );
            }}
          >
            {pushState === 'granted' ? 'Re-subscribe this device' : 'Enable push notifications'}
          </button>
          <button
            className={btn}
            onClick={async () => {
              setPushMsg('Sending…');
              try {
                const res = await fetch('/api/push/test', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } });
                const j = await res.json();
                setPushMsg(
                  j.sent > 0
                    ? `Sent to ${j.sent} device${j.sent === 1 ? '' : 's'}${j.pruned ? ` (${j.pruned} stale removed)` : ''} — you should see it now.`
                    : 'No active subscriptions on the server. Tap “Enable / Re-subscribe” above first.',
                );
              } catch {
                setPushMsg('Test request failed.');
              }
            }}
          >
            Send test notification
          </button>
        </div>
        {pushMsg && <p className="text-xs text-[var(--text-muted)] mt-2">{pushMsg}</p>}
      </section>

      {/* ── Hub status ───────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className={label}>Hub status</h2>
        {health ? (
          <ul className="text-sm text-[var(--text-muted)] space-y-1">
            <li>Kill switch: <span className="font-medium">{health.killswitch}</span></li>
            <li>Spend this month: <span className="font-medium">${health.spendMonthToDate?.toFixed(4)} / ${health.spendCap}</span></li>
          </ul>
        ) : (
          <p className="text-sm text-[var(--text-quiet)]">Unavailable.</p>
        )}
      </section>

      <section className="mb-6">
        <h2 className={label}>Account</h2>
        <SetPassword />
      </section>

      <button
        onClick={async () => { await supabase.auth.signOut(); router.push('/login'); }}
        className="text-sm text-[var(--text-muted)] underline"
      >
        Sign out
      </button>

        </div>
      </PageBody>
      <BottomNav />
    </PageShell>
  );
}
