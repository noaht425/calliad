'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { BottomNav } from '@/components/BottomNav';
import { PageShell, PageHeader, PageBody } from '@/components/PageLayout';

export const dynamic = 'force-dynamic';

interface Pulse {
  location: { place: string; event: string; at: string } | null;
  watchers: { id: string; kind: string; label: string; last_checked_at: string | null; last_change_at: string | null }[];
  flights: { label: string; line: string }[];
  weather: { now: string; tempNow: number | null; hi: number | null; lo: number | null; rainHours: number; clashes: string[] } | null;
  renewing: string[];
}

function ago(iso: string | null): string {
  if (!iso) return 'not checked yet';
  const s = Math.floor((Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <h2 className="text-[11px] font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>{title}</h2>
      {children}
    </section>
  );
}

export default function PulsePage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<Pulse | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => { if (!loading && !session) router.push('/login'); }, [loading, session, router]);
  const h = useMemo(() => (session ? { Authorization: `Bearer ${session.access_token}` } : null), [session]);

  const load = useCallback(async () => {
    if (!h) return;
    try {
      const r = await fetch('/api/pulse', { headers: h });
      if (r.ok) { setData(await r.json()); setErr(false); } else setErr(true);
    } catch { setErr(true); }
  }, [h]);
  useEffect(() => {
    void load();
    const iv = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60_000);
    return () => clearInterval(iv);
  }, [load]);

  const T = 'var(--text)';
  const TM = 'var(--text-muted)';

  return (
    <PageShell>
      <PageHeader title="Pulse" />
      <PageBody className="px-4 pt-2">
        <div className="max-w-xl mx-auto pb-4 space-y-3">
          {err && <p className="text-sm" style={{ color: TM }}>Couldn’t load — pull to refresh.</p>}
          {!data && !err && <p className="text-sm" style={{ color: TM }}>Loading…</p>}

          {data && (
            <>
              {data.location && (
                <Card title="Where you are">
                  <p className="text-sm" style={{ color: T }}>
                    {data.location.event === 'arrive' ? 'At' : 'Left'} <span className="font-medium">{data.location.place}</span>
                    <span style={{ color: TM }}> · {ago(data.location.at)}</span>
                  </p>
                </Card>
              )}

              {data.weather && (
                <Card title="Weather · next 24h">
                  <p className="text-sm" style={{ color: T }}>
                    {data.weather.tempNow != null ? `${Math.round(data.weather.tempNow)}° now, ` : ''}
                    {data.weather.now}
                    {data.weather.hi != null ? <span style={{ color: TM }}> · {data.weather.hi}° / {data.weather.lo}°</span> : null}
                  </p>
                  {data.weather.rainHours > 0 && (
                    <p className="text-[13px] mt-1" style={{ color: TM }}>{data.weather.rainHours}h with rain likely</p>
                  )}
                  {data.weather.clashes.map((c, i) => (
                    <p key={i} className="text-[13px] mt-1" style={{ color: '#b45309' }}>⚠ {c}</p>
                  ))}
                </Card>
              )}

              {data.flights.length > 0 && (
                <Card title="Flights">
                  {data.flights.map((f, i) => (
                    <p key={i} className="text-[13px] mb-1 last:mb-0" style={{ color: T }}>{f.line}</p>
                  ))}
                </Card>
              )}

              <Card title={`Watchers · ${data.watchers.length}`}>
                {data.watchers.length === 0 ? (
                  <p className="text-[13px]" style={{ color: TM }}>Nothing being watched. Say “watch this page…” or “tell me if it rains”.</p>
                ) : (
                  data.watchers.map((w) => (
                    <div key={w.id} className="py-1.5 border-b last:border-0" style={{ borderColor: 'var(--border-quiet, var(--border))' }}>
                      <p className="text-[13px]" style={{ color: T }}>{w.label}</p>
                      <p className="text-[11px]" style={{ color: TM }}>
                        checked {ago(w.last_checked_at)}{w.last_change_at ? ` · changed ${ago(w.last_change_at)}` : ''}
                      </p>
                    </div>
                  ))
                )}
              </Card>

              {data.renewing.length > 0 && (
                <Card title="Renewing soon">
                  {data.renewing.map((r, i) => (
                    <p key={i} className="text-[13px] mb-1 last:mb-0" style={{ color: T }}>{r}</p>
                  ))}
                </Card>
              )}
            </>
          )}
        </div>
      </PageBody>
      <BottomNav />
    </PageShell>
  );
}
