'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { BottomNav } from '@/components/BottomNav';
import { getTrip, updateTrip } from '@/lib/api';
import type { Trip, Capture } from '@/lib/types';

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

interface TravelEvent {
  type: string;
  title: string;
  start_date: string;
  start_time: string | null;
  end_date: string | null;
  end_time: string | null;
  location: string;
  confirmation_number: string | null;
  notes: string | null;
}

function formatDate(date: string | null | undefined, time?: string | null): string {
  if (!date) return '';
  const d = new Date(date + 'T12:00:00');
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  if (time) {
    const [h, m] = time.split(':').map(Number);
    const t = new Date(0, 0, 0, h, m);
    return `${dateStr} · ${t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }
  return dateStr;
}

function eventIcon(type: string) {
  if (type === 'flight') return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
  if (type === 'hotel') return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
  if (type === 'car_rental') return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
      <rect x="1" y="3" width="15" height="13" rx="2" /><path d="M16 8h4l3 3v5h-7V8z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  );
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function eventLabel(type: string) {
  if (type === 'flight') return 'Flight';
  if (type === 'hotel') return 'Hotel';
  if (type === 'car_rental') return 'Car rental';
  return type;
}

function statusBadge(status: string) {
  const base = 'text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full';
  if (status === 'planned') return <span className={`${base} bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40`}>Planned</span>;
  if (status === 'active') return <span className={`${base} bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40`}>Active</span>;
  if (status === 'completed') return <span className={`${base} bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700`}>Completed</span>;
  return <span className={`${base} bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 border border-zinc-200 dark:border-zinc-700`}>{status}</span>;
}

export default function TripPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const [trip, setTrip] = useState<Trip | null>(null);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [archiving, setArchiving] = useState(false);
  const [gmailScanning, setGmailScanning] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { trip: t, captures: caps } = await getTrip(id);
      setTrip(t);
      setCaptures(caps);
    } catch {}
  }, [id]);

  useEffect(() => { if (!loading && !session) router.push('/login'); }, [loading, session, router]);
  useEffect(() => { if (session) refresh(); }, [session, refresh]);

  const handleDismissCheck = async (element: string) => {
    if (!trip || !session) return;
    const meta = (trip.metadata ?? {}) as Record<string, unknown>;
    const dismissed = [...((meta.dismissed_completeness as string[]) ?? []), element];
    // Optimistic update so banner disappears immediately
    setTrip((t) => t ? { ...t, metadata: { ...meta, dismissed_completeness: dismissed } } : t);
    await fetch(`/api/trips/${trip.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ metadata: { ...meta, dismissed_completeness: dismissed } }),
    });
  };

  const handleCheckGmail = async () => {
    if (!session) return;
    setGmailScanning(true);
    try {
      await fetch('/api/gmail/scan', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxResults: 50 }),
      });
      await refresh();
    } catch {}
    setGmailScanning(false);
  };

  const handleArchive = async () => {
    if (!trip) return;
    setArchiving(true);
    try {
      await updateTrip(trip.id, { status: 'archived' });
      router.push('/folders');
    } catch { setArchiving(false); }
  };

  if (loading || !session || !trip) {
    return (
      <div className="min-h-screen bg-[#fafaf8] dark:bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 animate-spin" />
      </div>
    );
  }

  // Extract all travel events from email captures, sorted by date
  const allEvents: (TravelEvent & { captureId: string })[] = [];
  for (const cap of captures) {
    if (cap.source !== 'email') continue;
    const meta = (cap.metadata ?? {}) as Record<string, unknown>;
    const events = (meta.calendar_events as TravelEvent[] | undefined) ?? [];
    for (const ev of events) {
      allEvents.push({ ...ev, captureId: cap.id });
    }
  }
  // Sort by date then time so itinerary reads in travel order
  allEvents.sort((a, b) => {
    const da = `${a.start_date} ${a.start_time ?? '00:00'}`;
    const db = `${b.start_date} ${b.start_time ?? '00:00'}`;
    return da.localeCompare(db);
  });

  // Deduplicate: same type + same date + (same confirmation number OR same location prefix)
  // Catches duplicate emails for the same event (booking conf, check-in reminder, status update)
  const seen = new Set<string>();
  const uniqueEvents = allEvents.filter((ev) => {
    const locKey = (ev.location ?? '').toLowerCase().slice(0, 25);
    const key = ev.confirmation_number
      ? `${ev.type}|${ev.confirmation_number}|${ev.start_date}`
      : `${ev.type}|${ev.start_date}|${locKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const actionCards = captures.filter((c) => c.source === 'action' && c.status === 'inbox');
  const sourceDocs = captures.filter((c) => c.source !== 'action' && c.source !== 'assistant');

  // Trip completeness check — only for active/planned trips with at least one itinerary event
  const tripMeta = (trip.metadata ?? {}) as Record<string, unknown>;
  const dismissed = (tripMeta.dismissed_completeness as string[]) ?? [];
  const eventTypes = new Set(uniqueEvents.map((e) => e.type));
  const CHECKS: { type: string; label: string }[] = [
    { type: 'hotel', label: 'hotel' },
    { type: 'car_rental', label: 'car rental' },
  ];
  const missingChecks = (trip.status === 'planned' || trip.status === 'active') && uniqueEvents.length > 0
    ? CHECKS.filter((c) => !eventTypes.has(c.type) && !dismissed.includes(c.type))
    : [];

  const dest = trip.destination
    ? trip.destination.split(',').slice(0, 2).join(',').trim()
    : trip.title;

  const startStr = trip.start_date
    ? new Date(trip.start_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null;
  const endStr = trip.end_date
    ? new Date(trip.end_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <div className="min-h-screen bg-[#fafaf8] dark:bg-[#0a0a0a]">
      <header className="sticky top-0 z-10 bg-[#fafaf8]/80 dark:bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-zinc-200/60 dark:border-zinc-800/60 px-4 py-3">
        <div className="max-w-xl mx-auto flex items-center gap-3">
          <button onClick={() => router.push('/folders')}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 className="flex-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">{dest}</h1>
          {statusBadge(trip.status)}
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 pt-4 pb-32 space-y-6">

        {/* Trip header */}
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900/40 rounded-xl p-4 space-y-2">
          {startStr && (
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {startStr}{endStr && startStr !== endStr ? ` – ${endStr}` : ''}
            </p>
          )}
          {trip.travelers.length > 0 && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {deduplicateTravelers(trip.travelers).join(', ')}
            </p>
          )}
          {trip.destination && (
            <p className="text-xs font-mono text-amber-600 dark:text-amber-500">{trip.destination}</p>
          )}
        </div>

        {/* Completeness checks */}
        {missingChecks.map((check) => (
          <div key={check.type} className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/50 rounded-xl p-4 space-y-3">
            <p className="text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed">
              I don&apos;t see a {check.label} booked for {dest}. Want me to check Gmail for a recent confirmation?
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleCheckGmail}
                disabled={gmailScanning}
                className="flex-1 py-2 text-xs font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg disabled:opacity-50 transition-opacity"
              >
                {gmailScanning ? 'Checking…' : 'Check Gmail'}
              </button>
              <button
                onClick={() => handleDismissCheck(check.type)}
                className="flex-1 py-2 text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 border border-zinc-200 dark:border-zinc-700 rounded-lg transition-colors"
              >
                No {check.label} needed
              </button>
            </div>
          </div>
        ))}

        {/* Pending action cards */}
        {actionCards.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-xs font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">Needs attention</h2>
            {actionCards.map((card) => (
              <div key={card.id} className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl p-4">
                <p className="text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed whitespace-pre-wrap">{card.transcript}</p>
              </div>
            ))}
          </section>
        )}

        {/* Itinerary */}
        {uniqueEvents.length > 0 ? (
          <section className="space-y-2">
            <h2 className="text-xs font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">Itinerary</h2>
            <div className="space-y-2">
              {uniqueEvents.map((ev, i) => (
                <div key={i} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500 dark:text-zinc-400 shrink-0 mt-0.5">
                      {eventIcon(ev.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wide">{eventLabel(ev.type)}</span>
                        {ev.confirmation_number && (
                          <span className="text-[10px] font-mono text-zinc-300 dark:text-zinc-600">{ev.confirmation_number}</span>
                        )}
                      </div>
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mt-0.5 leading-snug">{ev.title}</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{formatDate(ev.start_date, ev.start_time)}</p>
                      {ev.location && <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5 truncate">{ev.location}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <section>
            <h2 className="text-xs font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest mb-2">Itinerary</h2>
            <p className="text-zinc-400 dark:text-zinc-600 text-sm">No itinerary details yet.</p>
          </section>
        )}

        {/* Sources */}
        {sourceDocs.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-xs font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">Sources</h2>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
              {sourceDocs.map((cap) => {
                const label = cap.summary ?? (cap.transcript ?? '').slice(0, 80);
                const srcDate = new Date(cap.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                const srcIcon = cap.source === 'email' ? (
                  <svg className="w-3.5 h-3.5 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
                  </svg>
                );
                const capMeta = (cap.metadata ?? {}) as Record<string, unknown>;
                // Prefer thread ID — Gmail URLs navigate by thread, not message
                const gmailId = cap.source === 'email'
                  ? ((capMeta.gmail_thread_id ?? capMeta.gmail_message_id) as string | undefined)
                  : undefined;
                const gmailUrl = gmailId ? `https://mail.google.com/mail/u/0/#all/${gmailId}` : undefined;
                const RowEl = gmailUrl ? 'a' : 'div';
                return (
                  <RowEl
                    key={cap.id}
                    {...(gmailUrl ? { href: gmailUrl, target: '_blank', rel: 'noopener noreferrer' } : {})}
                    className="flex items-center gap-3 px-4 py-2.5 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-colors"
                  >
                    {srcIcon}
                    <p className="flex-1 text-xs text-zinc-600 dark:text-zinc-400 truncate">{label}</p>
                    <span className="shrink-0 text-[10px] font-mono text-zinc-300 dark:text-zinc-600">{srcDate}</span>
                    {gmailUrl && (
                      <svg className="shrink-0 w-3 h-3 text-zinc-300 dark:text-zinc-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                        <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    )}
                  </RowEl>
                );
              })}
            </div>
          </section>
        )}

        {/* Archive */}
        {trip.status !== 'archived' && (
          <div className="pt-2 border-t border-zinc-200/60 dark:border-zinc-800/60">
            <button onClick={handleArchive} disabled={archiving}
              className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors disabled:opacity-50">
              {archiving ? 'Archiving…' : 'Archive this trip'}
            </button>
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
