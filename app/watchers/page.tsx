'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { BottomNav } from '@/components/BottomNav';
import { PageShell, PageHeader, PageBody } from '@/components/PageLayout';

export const dynamic = 'force-dynamic';

interface Row {
  id: string;
  kind: 'page' | 'weather_event' | 'flight';
  label: string;
  spec: { url?: string; for?: string; days?: number; flightNo?: string; date?: string };
  status: 'active' | 'paused' | 'done';
  last_checked_at: string | null;
  last_change_at: string | null;
}

const KIND_LABEL: Record<Row['kind'], string> = { page: 'Page', weather_event: 'Weather', flight: 'Flight' };

function ago(iso: string | null): string {
  if (!iso) return 'not yet';
  const s = Math.floor((Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export default function WatchersPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [url, setUrl] = useState('');
  const [forWhat, setForWhat] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!loading && !session) router.push('/login'); }, [loading, session, router]);
  const h = useMemo(
    () => (session ? { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' } : null),
    [session],
  );

  const load = useCallback(async () => {
    if (!h) return;
    const r = await fetch('/api/watchers', { headers: h });
    if (r.ok) setRows(((await r.json()).items ?? []).filter((x: Row) => x.status !== 'done'));
  }, [h]);
  useEffect(() => { void load(); }, [load]);

  const addPage = async () => {
    if (!h || !url.trim()) return;
    setBusy(true);
    await fetch('/api/watchers', {
      method: 'POST', headers: h,
      body: JSON.stringify({ kind: 'page', url: url.trim(), for: forWhat.trim() || undefined }),
    });
    setUrl(''); setForWhat(''); setBusy(false); void load();
  };
  const addWeather = async () => {
    if (!h) return;
    setBusy(true);
    await fetch('/api/watchers', { method: 'POST', headers: h, body: JSON.stringify({ kind: 'weather_event', days: 3 }) });
    setBusy(false); void load();
  };
  const pause = async (r: Row) => {
    if (!h) return;
    await fetch('/api/watchers', { method: 'PATCH', headers: h, body: JSON.stringify({ id: r.id, paused: r.status === 'active' }) });
    void load();
  };
  const remove = async (id: string) => {
    if (!h) return;
    await fetch(`/api/watchers?id=${id}`, { method: 'DELETE', headers: h });
    void load();
  };

  const hasWeather = rows.some((r) => r.kind === 'weather_event');

  return (
    <PageShell>
      <PageHeader title="Watchers" count={rows.length || undefined} />
      <PageBody className="px-4 pt-2">
        <div className="max-w-xl mx-auto pb-4">
          <p className="text-[13px] mb-3" style={{ color: 'var(--text-muted)' }}>
            Calliad checks these on a schedule and messages you when something moves. You can also just say
            &ldquo;watch this page&rdquo; or &ldquo;tell me if it rains&rdquo; in chat.
          </p>

          <div className="rounded-xl p-3 mb-4 space-y-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Page URL to watch…"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--paper)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
            <input
              value={forWhat}
              onChange={(e) => setForWhat(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void addPage(); }}
              placeholder="Watching for… (optional — e.g. price drop, new date)"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--paper)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
            <div className="flex gap-2">
              <button
                onClick={() => void addPage()}
                disabled={busy || !url.trim()}
                className="flex-1 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-40"
                style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
              >
                Watch page
              </button>
              {!hasWeather && (
                <button
                  onClick={() => void addWeather()}
                  disabled={busy}
                  className="rounded-lg px-3 py-2 text-sm disabled:opacity-40"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
                >
                  Watch weather vs. calendar
                </button>
              )}
            </div>
          </div>

          {rows.length === 0 && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Nothing being watched.</p>}

          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id} className="rounded-xl p-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium break-words" style={{ color: 'var(--text)' }}>
                      {r.label}{r.status === 'paused' ? <span style={{ color: 'var(--text-muted)' }}> · paused</span> : null}
                    </p>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {KIND_LABEL[r.kind]} · checked {ago(r.last_checked_at)}
                      {r.last_change_at ? ` · last change ${ago(r.last_change_at)}` : ''}
                    </p>
                    {r.spec.url && (
                      <a href={r.spec.url} target="_blank" rel="noreferrer" className="text-[11px] underline break-all" style={{ color: 'var(--text-muted)' }}>
                        {r.spec.url}
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex gap-4 text-xs pt-2">
                  <button className="underline" style={{ color: 'var(--text)' }} onClick={() => pause(r)}>
                    {r.status === 'active' ? 'pause' : 'resume'}
                  </button>
                  <button className="underline" style={{ color: '#dc2626' }} onClick={() => remove(r.id)}>remove</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </PageBody>
      <BottomNav />
    </PageShell>
  );
}
