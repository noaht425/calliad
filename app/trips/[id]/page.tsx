'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { BottomNav } from '@/components/BottomNav';
import { PageShell, SubPageHeader, PageBody, SectionLabel } from '@/components/PageLayout';

export const dynamic = 'force-dynamic';

interface Trip {
  id: string; destination: string; start_date: string; end_date: string | null;
  home_airport: string | null; has_pet: boolean; notes: string | null;
  status: 'planned' | 'active' | 'done' | 'cancelled'; prep_state: Record<string, string>;
}

const PREP_LABELS: Record<string, string> = {
  pet_boarding: 'Pet boarding / sitter',
  idp: 'International Driving Permit',
  amazon_subscribe_save: 'Pause Amazon Subscribe & Save',
  mail_hold: 'Mail / package holds',
  bank_and_rx: 'Notify bank · refill prescriptions',
  airport_transport: 'Airport transport plan',
};

function fmt(s: string) {
  return new Date(s + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TripDetailPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => { if (!loading && !session) router.push('/login'); }, [loading, session, router]);
  const h = useMemo(
    () => (session ? { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' } : null),
    [session],
  );
  const load = useCallback(async () => {
    if (!h) return;
    const r = await fetch(`/api/trips?id=${id}`, { headers: h });
    if (r.ok) setTrip((await r.json()).trip);
    else setNotFound(true);
  }, [h, id]);
  useEffect(() => { void load(); }, [load]);

  const setStatus = async (status: Trip['status']) => {
    if (!h) return;
    await fetch('/api/trips', { method: 'PATCH', headers: h, body: JSON.stringify({ id, status }) });
    void load();
  };
  const del = async () => {
    if (!h || !confirm('Delete this trip?')) return;
    await fetch(`/api/trips?id=${id}`, { method: 'DELETE', headers: h });
    router.push('/trips');
  };

  return (
    <PageShell>
      <SubPageHeader title="Trip" onBack={() => router.push('/trips')} />
      <PageBody className="px-4 pt-2">
        <div className="max-w-xl mx-auto pb-4">
          {notFound && <p className="text-sm" style={{ color: 'var(--text-quiet)' }}>Trip not found.</p>}
          {trip && (
            <>
              <div className="rounded-xl px-4 py-4 mb-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="flex items-baseline justify-between gap-2">
                  <h1 className="text-lg font-medium" style={{ color: 'var(--text)' }}>{trip.destination}</h1>
                  <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--text-quiet)' }}>{trip.status}</span>
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  {fmt(trip.start_date)}{trip.end_date && trip.end_date !== trip.start_date ? ` – ${fmt(trip.end_date)}` : ''}
                </p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-quiet)' }}>
                  {trip.home_airport ? `Home airport ${trip.home_airport}` : ''}{trip.home_airport && trip.has_pet ? ' · ' : ''}{trip.has_pet ? 'traveling with a pet' : ''}
                </p>
                {trip.notes && <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>{trip.notes}</p>}
              </div>

              <section className="mb-6">
                <SectionLabel className="mb-2">Prep</SectionLabel>
                <ul className="space-y-1.5">
                  {Object.keys(PREP_LABELS).map((k) => {
                    const done = trip.prep_state?.[k] === 'sent';
                    return (
                      <li key={k} className="flex items-center gap-2 text-xs" style={{ color: done ? 'var(--text-quiet)' : 'var(--text-muted)' }}>
                        <span style={{ color: done ? '#16a34a' : 'var(--border)' }}>{done ? '✓' : '○'}</span>
                        {PREP_LABELS[k]}{done ? ' — nudged' : ''}
                      </li>
                    );
                  })}
                </ul>
                <p className="text-[11px] mt-2" style={{ color: 'var(--text-quiet)' }}>
                  Calliad pushes each of these as the trip nears. Email-parsed flights, hotels and car rentals will show here in a later update.
                </p>
              </section>

              <section>
                <SectionLabel className="mb-2">Status</SectionLabel>
                <div className="flex flex-wrap gap-2 text-xs">
                  {(['planned', 'active', 'done', 'cancelled'] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatus(s)}
                      className="rounded-lg px-3 py-1.5 capitalize"
                      style={{
                        background: trip.status === s ? 'var(--accent)' : 'var(--surface)',
                        color: trip.status === s ? 'var(--on-accent)' : 'var(--text-muted)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      {s}
                    </button>
                  ))}
                  <button onClick={del} className="rounded-lg px-3 py-1.5 underline" style={{ color: 'var(--text-quiet)' }}>delete</button>
                </div>
              </section>
            </>
          )}
        </div>
      </PageBody>
      <BottomNav />
    </PageShell>
  );
}
