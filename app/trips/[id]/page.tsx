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
interface Item { id: string; kind: string; title: string; start_at: string | null; end_at: string | null; location: string | null; confirmation_number: string | null }
interface Source { id: string; subject: string | null; received_at: string | null }
interface Card { id: string; subject: string; options: string[] }

const KIND_ICON: Record<string, string> = { flight: '✈', hotel: '🏨', car: '🚗', train: '🚆', activity: '◆' };

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
  const [items, setItems] = useState<Item[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [cardMsg, setCardMsg] = useState('');

  useEffect(() => { if (!loading && !session) router.push('/login'); }, [loading, session, router]);
  const h = useMemo(
    () => (session ? { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' } : null),
    [session],
  );
  const load = useCallback(async () => {
    if (!h) return;
    const r = await fetch(`/api/trips?id=${id}`, { headers: h });
    if (r.ok) {
      const j = await r.json();
      setTrip(j.trip); setItems(j.items ?? []); setSources(j.sources ?? []); setCards(j.cards ?? []);
    } else setNotFound(true);
  }, [h, id]);
  const answerCard = async (cardId: string, choice: string) => {
    if (!h) return;
    setCardMsg('…');
    const r = await fetch('/api/trips/curation', { method: 'POST', headers: h, body: JSON.stringify({ cardId, choice }) });
    const j = await r.json().catch(() => ({}));
    setCardMsg(j.message ?? '');
    void load();
  };
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
          {notFound && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Trip not found.</p>}
          {trip && (
            <>
              <div className="rounded-xl px-4 py-4 mb-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="flex items-baseline justify-between gap-2">
                  <h1 className="text-lg font-medium" style={{ color: 'var(--text)' }}>{trip.destination}</h1>
                  <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{trip.status}</span>
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  {fmt(trip.start_date)}{trip.end_date && trip.end_date !== trip.start_date ? ` – ${fmt(trip.end_date)}` : ''}
                </p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  {trip.home_airport ? `Home airport ${trip.home_airport}` : ''}{trip.home_airport && trip.has_pet ? ' · ' : ''}{trip.has_pet ? 'traveling with a pet' : ''}
                </p>
                {trip.notes && <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>{trip.notes}</p>}
              </div>

              {cards.map((c) => (
                <div key={c.id} className="rounded-xl px-4 py-3 mb-4" style={{ background: 'var(--accent-wash, var(--surface))', border: '1px solid var(--accent)' }}>
                  <p className="text-sm mb-2" style={{ color: 'var(--text)' }}>{c.subject}</p>
                  <div className="flex gap-2">
                    {c.options.map((o) => (
                      <button
                        key={o}
                        onClick={() => answerCard(c.id, o)}
                        className="rounded-lg px-3 py-1.5 text-xs"
                        style={o.toLowerCase().includes('check') ? { background: 'var(--accent)', color: 'var(--on-accent)' } : { background: 'var(--surface)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {cardMsg && <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>{cardMsg}</p>}

              <section className="mb-6">
                <SectionLabel className="mb-2">Itinerary</SectionLabel>
                {items.length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Nothing parsed from email yet. Confirmations from your inbox show up here automatically.</p>
                ) : (
                  <ul className="space-y-2">
                    {items.map((i) => (
                      <li key={i.id} className="rounded-lg px-3 py-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                        <p className="text-[11px] font-mono uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                          {KIND_ICON[i.kind] ?? '•'} {i.kind}{i.confirmation_number ? ` · ${i.confirmation_number}` : ''}
                        </p>
                        <p className="text-sm" style={{ color: 'var(--text)' }}>{i.title}</p>
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {i.start_at ? new Date(i.start_at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
                          {i.location ? ` · ${i.location}` : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {sources.length > 0 && (
                <section className="mb-6">
                  <SectionLabel className="mb-2">Sources</SectionLabel>
                  <ul className="space-y-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {sources.map((s) => (
                      <li key={s.id}>✉ {s.subject ?? '(email)'}{s.received_at ? ` · ${new Date(s.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="mb-6">
                <SectionLabel className="mb-2">Prep</SectionLabel>
                <ul className="space-y-1.5">
                  {Object.keys(PREP_LABELS).map((k) => {
                    const done = trip.prep_state?.[k] === 'sent';
                    return (
                      <li key={k} className="flex items-center gap-2 text-xs" style={{ color: done ? 'var(--text-muted)' : 'var(--text-muted)' }}>
                        <span style={{ color: done ? '#16a34a' : 'var(--border)' }}>{done ? '✓' : '○'}</span>
                        {PREP_LABELS[k]}{done ? ' — nudged' : ''}
                      </li>
                    );
                  })}
                </ul>
                <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
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
                  <button onClick={del} className="rounded-lg px-3 py-1.5 underline" style={{ color: 'var(--text-muted)' }}>delete</button>
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
