'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { BottomNav } from '@/components/BottomNav';
import { PageShell, PageHeader, PageBody } from '@/components/PageLayout';

export const dynamic = 'force-dynamic';

type SeasonState = 'pending' | 'watching' | 'watched';
interface Row {
  id: string; media_type: 'tv' | 'movie'; title: string; year: number | null;
  poster_path: string | null; overview: string | null; cast_names: string[]; streaming: string[];
  status: 'watching' | 'want' | 'done'; rating: number | null;
  air_status: string | null; next_air_date: string | null; total_seasons: number | null;
  seasons: { season: number; episodes: number; state: SeasonState }[];
}

const NEXT_STATE: Record<SeasonState, SeasonState> = { pending: 'watching', watching: 'watched', watched: 'pending' };
const STATE_STYLE: Record<SeasonState, { bg: string; fg: string }> = {
  pending: { bg: 'var(--surface)', fg: 'var(--text-quiet)' },
  watching: { bg: 'var(--accent)', fg: 'var(--on-accent)' },
  watched: { bg: 'transparent', fg: '#16a34a' },
};

function fmtDate(d: string | null): string {
  if (!d) return '';
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function WatchPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [tab, setTab] = useState<'watching' | 'want'>('watching');
  const [search, setSearch] = useState('');
  const [add, setAdd] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => { if (!loading && !session) router.push('/login'); }, [loading, session, router]);
  const h = useMemo(
    () => (session ? { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' } : null),
    [session],
  );
  const load = useCallback(async () => {
    if (!h) return;
    const r = await fetch('/api/watchlist', { headers: h });
    if (r.ok) setRows((await r.json()).items ?? []);
  }, [h]);
  useEffect(() => { void load(); }, [load]);

  const patch = async (body: Record<string, unknown>) => {
    if (!h) return;
    await fetch('/api/watchlist', { method: 'PATCH', headers: h, body: JSON.stringify(body) });
    void load();
  };
  const addTitle = async () => {
    if (!h || !add.trim()) return;
    setBusy(true);
    await fetch('/api/watchlist', { method: 'POST', headers: h, body: JSON.stringify({ title: add.trim(), status: tab }) });
    setAdd(''); setBusy(false); void load();
  };
  const remove = async (id: string) => { if (h) { await fetch(`/api/watchlist?id=${id}`, { method: 'DELETE', headers: h }); void load(); } };

  const counts = { watching: rows.filter((r) => r.status === 'watching').length, want: rows.filter((r) => r.status === 'want').length };
  const shown = rows
    .filter((r) => r.status === tab)
    .filter((r) => !search || r.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <PageShell>
      <PageHeader title="Watch list" count={rows.length || undefined} />
      <PageBody className="px-4 pt-2">
        <div className="max-w-xl mx-auto pb-4">
          <div className="flex gap-1.5 mb-3">
            {(['watching', 'want'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="flex-1 rounded-lg px-3 py-1.5 text-sm transition-colors"
                style={{
                  background: tab === t ? 'var(--accent-wash, var(--surface))' : 'var(--surface)',
                  border: `1px solid ${tab === t ? 'var(--accent)' : 'var(--border)'}`,
                  color: 'var(--text)',
                }}
              >
                {t === 'watching' ? 'Watching' : 'Want to Watch'} <span style={{ color: 'var(--text-quiet)' }}>({counts[t]})</span>
              </button>
            ))}
          </div>

          <div className="flex gap-2 mb-3">
            <input
              value={add}
              onChange={(e) => setAdd(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void addTitle(); }}
              placeholder="Add a show or movie…"
              className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
            <button onClick={() => void addTitle()} disabled={busy || !add.trim()} className="shrink-0 rounded-lg px-3 text-sm font-medium disabled:opacity-40"
              style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>Add</button>
          </div>
          {rows.length > 3 && (
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none mb-3"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
          )}

          {shown.length === 0 && <p className="text-sm" style={{ color: 'var(--text-quiet)' }}>Nothing here yet.</p>}

          <ul className="space-y-2.5">
            {shown.map((r) => {
              const watched = r.seasons.filter((s) => s.state === 'watched').length;
              const expanded = open === r.id;
              return (
                <li key={r.id} className="rounded-xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <div className="flex gap-3 p-3">
                    {r.poster_path ? (
                      <img src={`https://image.tmdb.org/t/p/w92${r.poster_path}`} alt="" className="w-12 h-[72px] rounded object-cover shrink-0" />
                    ) : (
                      <div className="w-12 h-[72px] rounded shrink-0" style={{ background: 'var(--paper)', border: '1px solid var(--border)' }} />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2">
                        <p className="flex-1 text-sm font-medium" style={{ color: 'var(--text)' }}>
                          {r.title}{r.year ? <span style={{ color: 'var(--text-quiet)' }}> ({r.year})</span> : null}
                        </p>
                        {r.streaming[0] && (
                          <span className="shrink-0 text-[10px] rounded px-1.5 py-0.5" style={{ background: 'var(--paper)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                            {r.streaming[0]}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[11px]" style={{ color: 'var(--text-quiet)' }}>
                        {r.media_type === 'tv' && r.total_seasons ? <span>{watched}/{r.total_seasons} seasons</span> : null}
                        {r.next_air_date ? <span>· next {fmtDate(r.next_air_date)}</span> : null}
                        {r.air_status && /ended|canceled/i.test(r.air_status) ? <span>· ended</span> : null}
                      </div>
                      <div className="flex items-center gap-0.5 mt-1">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button key={n} onClick={() => patch({ id: r.id, rating: r.rating === n ? null : n })} aria-label={`Rate ${n}`}
                            style={{ color: (r.rating ?? 0) >= n ? '#f59e0b' : 'var(--border)' }}>
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" /></svg>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  {r.overview && (
                    <button onClick={() => setOpen(expanded ? null : r.id)} className="block w-full text-left px-3 pb-2 text-[12.5px] leading-snug" style={{ color: 'var(--text-muted)' }}>
                      <span className={expanded ? '' : 'line-clamp-2'}>{r.overview}</span>
                      <span className="text-[11px]" style={{ color: 'var(--text-quiet)' }}> {expanded ? 'Less ↑' : 'More ↓'}</span>
                    </button>
                  )}
                  {expanded && (
                    <div className="px-3 pb-3 pt-1 space-y-2" style={{ borderTop: '1px solid var(--border-quiet, var(--border))' }}>
                      {r.cast_names.length > 0 && (
                        <p className="text-[11px]" style={{ color: 'var(--text-quiet)' }}>Cast · {r.cast_names.slice(0, 4).join(', ')}</p>
                      )}
                      {r.seasons.map((s) => (
                        <div key={s.season} className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                          <span className="w-16 shrink-0">S{s.season} · {s.episodes} ep</span>
                          <button
                            onClick={() => patch({ id: r.id, season: s.season, state: NEXT_STATE[s.state] })}
                            className="rounded-md px-2 py-0.5 text-[11px] capitalize"
                            style={{ background: STATE_STYLE[s.state].bg, color: STATE_STYLE[s.state].fg, border: '1px solid var(--border)' }}
                          >
                            {s.state}
                          </button>
                        </div>
                      ))}
                      {r.air_status && <p className="text-[11px]" style={{ color: 'var(--text-quiet)' }}>Status · {r.air_status}</p>}
                      <div className="flex gap-3 text-[11px] pt-1">
                        {r.status === 'want'
                          ? <button className="underline" onClick={() => patch({ id: r.id, status: 'watching' })}>start watching</button>
                          : <button className="underline" style={{ color: 'var(--text-quiet)' }} onClick={() => patch({ id: r.id, status: 'want' })}>move to want</button>}
                        <button className="underline" style={{ color: 'var(--text-quiet)' }} onClick={() => remove(r.id)}>remove</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </PageBody>
      <BottomNav />
    </PageShell>
  );
}
