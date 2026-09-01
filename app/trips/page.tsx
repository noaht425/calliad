'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { BottomNav } from '@/components/BottomNav';
import { PageShell, PageHeader, PageBody, SectionLabel } from '@/components/PageLayout';

export const dynamic = 'force-dynamic';

interface Trip {
  id: string; destination: string; start_date: string; end_date: string | null;
  status: 'planned' | 'active' | 'done' | 'cancelled'; has_pet: boolean;
}

const DAY = 86400000;
function relLabel(start: string): string {
  const d = Math.round((new Date(start + 'T12:00:00').getTime() - new Date().setHours(0, 0, 0, 0)) / DAY);
  if (d < 0) return '';
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d < 7) return `in ${d} days`;
  if (d < 35) return `in ${Math.round(d / 7)} weeks`;
  if (d < 320) return `in ${Math.round(d / 30)} months`;
  return `in ${Math.round(d / 365)} year${d < 550 ? '' : 's'}`;
}
function dateRange(a: string, b: string | null): string {
  const f = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return b && b !== a ? `${f(a)} – ${f(b)}` : f(a);
}

export default function TripsPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<Trip[]>([]);

  useEffect(() => { if (!loading && !session) router.push('/login'); }, [loading, session, router]);
  const h = useMemo(() => (session ? { Authorization: `Bearer ${session.access_token}` } : null), [session]);
  const load = useCallback(async () => {
    if (!h) return;
    const r = await fetch('/api/trips', { headers: h });
    if (r.ok) setItems((await r.json()).items ?? []);
  }, [h]);
  useEffect(() => { void load(); }, [load]);

  const today = new Date().toISOString().slice(0, 10);
  const planned = items.filter((t) => (t.status === 'planned' || t.status === 'active') && (t.end_date ?? t.start_date) >= today);
  const past = items.filter((t) => !planned.includes(t));

  return (
    <PageShell>
      <PageHeader title="Travel" count={planned.length || undefined} />
      <PageBody className="px-4 pt-2">
        <div className="max-w-xl mx-auto pb-4">
          {items.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              No trips yet. Say &ldquo;I&rsquo;m flying to Rome May 3–12&rdquo; in chat and it lands here.
            </p>
          )}

          {planned.length > 0 && (
            <section className="mb-7">
              <SectionLabel className="mb-2">Planned · {planned.length}</SectionLabel>
              <ul className="space-y-2">
                {planned.map((t) => (
                  <li key={t.id}>
                    <Link href={`/trips/${t.id}`} className="block rounded-xl px-4 py-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{t.destination}</p>
                        <span className="text-[11px]" style={{ color: 'var(--accent)' }}>{relLabel(t.start_date)}</span>
                      </div>
                      <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {dateRange(t.start_date, t.end_date)}{t.has_pet ? ' · pet' : ''}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {past.length > 0 && (
            <section>
              <SectionLabel className="mb-2">Past & archived · {past.length}</SectionLabel>
              <ul className="space-y-2">
                {past.map((t) => (
                  <li key={t.id}>
                    <Link href={`/trips/${t.id}`} className="block rounded-xl px-4 py-2.5 text-xs" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                      {t.destination} <span style={{ color: 'var(--text-muted)' }}>· {dateRange(t.start_date, t.end_date)}{t.status === 'cancelled' ? ' · cancelled' : ''}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </PageBody>
      <BottomNav />
    </PageShell>
  );
}
