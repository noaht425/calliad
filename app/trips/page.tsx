'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { listTrips } from '@/lib/api';
import { BottomNav } from '@/components/BottomNav';
import type { Trip } from '@/lib/types';

function deduplicateTravelers(travelers: string[]): string[] {
  const byFirstName = new Map<string, string>();
  for (const t of travelers) {
    const first = t.trim().split(/\s+/)[0].toLowerCase();
    const existing = byFirstName.get(first);
    if (!existing || t.trim().split(/\s+/).length > existing.trim().split(/\s+/).length) {
      byFirstName.set(first, t.trim());
    }
  }
  return Array.from(byFirstName.values());
}

function tripStatusColor(status: string) {
  if (status === 'completed') return 'text-zinc-400 dark:text-zinc-600';
  if (status === 'active') return 'text-emerald-600 dark:text-emerald-400';
  return 'text-amber-600 dark:text-amber-400';
}

function formatTripDate(date: string | null | undefined): string {
  if (!date) return '';
  const d = new Date(date + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function TripRow({ trip, onClick }: { trip: Trip; onClick: () => void }) {
  const start = formatTripDate(trip.start_date);
  const end = formatTripDate(trip.end_date);
  const dateRange = start && end && start !== end ? `${start} – ${end}` : start;
  const dest = trip.destination ? trip.destination.split(',').slice(0, 2).join(',').trim() : trip.title;
  const travelers = deduplicateTravelers(trip.travelers);

  return (
    <button onClick={onClick}
      className="w-full text-left bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 flex items-center gap-3 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors">
      <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-900/40 flex items-center justify-center shrink-0">
        <svg className="w-4 h-4 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
          <path d="M17.8 19.2L16 11l3.5-3.5C21 6 21 4 19.5 2.5S18 2 16.5 3.5L13 7 4.8 5.2 3.4 6.6l7.1 3.7-2.3 2.3-3-.7-1.4 1.4 2.7 2.7 2.7 2.7 1.4-1.4-.7-3 2.3-2.3 3.7 7.1z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{dest}</p>
        <p className="text-[11px] font-mono text-zinc-400 dark:text-zinc-500">
          {dateRange}
          {travelers.length > 1 && <span className="ml-2">· {travelers.length} travelers</span>}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={`text-[10px] font-mono uppercase tracking-wide ${tripStatusColor(trip.status)}`}>{trip.status}</span>
        <svg className="w-4 h-4 text-zinc-300 dark:text-zinc-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
    </button>
  );
}

export default function TripsPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [fetching, setFetching] = useState(true);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    if (!loading && !session) router.push('/login');
  }, [loading, session, router]);

  const load = useCallback(async () => {
    setFetching(true);
    try {
      const all = await listTrips(true);
      setTrips(all);
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => { if (session) load(); }, [session, load]);

  if (loading || !session) {
    return (
      <div className="min-h-screen bg-[#fafaf8] dark:bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 animate-spin" />
      </div>
    );
  }

  const active = trips.filter((t) => t.status === 'planned' || t.status === 'active');
  const completed = trips.filter((t) => t.status === 'completed' || t.status === 'archived');

  return (
    <div className="min-h-screen bg-[#fafaf8] dark:bg-[#0a0a0a]">
      <header className="sticky top-0 z-10 bg-[#fafaf8]/80 dark:bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-zinc-200/60 dark:border-zinc-800/60 px-4 py-3">
        <div className="max-w-xl mx-auto flex items-center gap-3">
          <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex-1">Travel</h1>
          <span className="text-[11px] font-mono text-zinc-400 dark:text-zinc-600">{active.length} active</span>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 pt-4 pb-32 space-y-6">
        {fetching ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 animate-spin" />
          </div>
        ) : (
          <>
            {active.length === 0 && completed.length === 0 ? (
              <p className="text-center text-zinc-400 dark:text-zinc-600 text-sm py-12">
                No trips yet — forward a booking confirmation email to get started.
              </p>
            ) : (
              <>
                {active.length > 0 && (
                  <section className="space-y-2">
                    <h2 className="text-xs font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest px-1">Upcoming</h2>
                    {active.map((trip) => (
                      <TripRow key={trip.id} trip={trip} onClick={() => router.push(`/trips/${trip.id}`)} />
                    ))}
                  </section>
                )}

                {completed.length > 0 && (
                  <section className="space-y-2">
                    <button
                      onClick={() => setShowArchived((v) => !v)}
                      className="flex items-center gap-2 px-1 w-full text-left hover:opacity-70 transition-opacity"
                    >
                      <h2 className="text-xs font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">Completed</h2>
                      <span className="text-[10px] font-mono text-zinc-300 dark:text-zinc-700">{completed.length}</span>
                      <svg className={`w-3 h-3 text-zinc-300 dark:text-zinc-700 ml-auto transition-transform ${showArchived ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                    {showArchived && completed.map((trip) => (
                      <TripRow key={trip.id} trip={trip} onClick={() => router.push(`/trips/${trip.id}`)} />
                    ))}
                  </section>
                )}
              </>
            )}
          </>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
