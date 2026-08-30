'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { BottomNav } from '@/components/BottomNav';
import { InboxCard } from '@/components/InboxCard';
import { listFolders, listFolderCaptures, updateCapture, deleteCapture, updateFolder, deleteFolder } from '@/lib/api';
import { PROJECT_COLORS, colorBg } from '@/lib/projectColors';
import type { Capture, Folder } from '@/lib/types';

export default function FolderDetailPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [expandedSummaries, setExpandedSummaries] = useState<Set<string>>(new Set());
  const toggleSummary = (captureId: string) =>
    setExpandedSummaries((prev) => { const n = new Set(prev); n.has(captureId) ? n.delete(captureId) : n.add(captureId); return n; });

  const [folder, setFolder] = useState<Folder | null>(null);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('blue');
  const [editIcon, setEditIcon] = useState('◐');
  const [confirmDeleteProject, setConfirmDeleteProject] = useState(false);
  const [watchedCaptures, setWatchedCaptures] = useState<Capture[]>([]);
  const [showWatched, setShowWatched] = useState(false);
  const [watchSearch, setWatchSearch] = useState('');
  const [watchTab, setWatchTab] = useState<'watching' | 'want'>('watching');

  useEffect(() => {
    if (!loading && !session) router.push('/login');
  }, [loading, session, router]);

  const refresh = useCallback(async () => {
    try {
      const [all, caps] = await Promise.all([listFolders(), listFolderCaptures(id)]);
      const found = all.find((p) => p.id === id) ?? null;
      setFolder(found);
      setCaptures(caps);
      return found;
    } catch { return null; }
  }, [id]);

  const loadWatched = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch(`/api/captures?status=archived&folder_id=${id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) setWatchedCaptures(await res.json());
    } catch {}
  }, [session, id]);

  useEffect(() => {
    if (!session) return;
    const token = session.access_token;
    const ac = new AbortController();
    refresh().then(async (found) => {
      if (ac.signal.aborted) return;
      const name = found?.name?.toLowerCase() ?? '';
      if (name.includes('reading')) {
        fetch('/api/reading-list/refresh', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          signal: ac.signal,
        }).then((r) => r.ok ? r.json() : null).then((j) => {
          if (j?.enriched > 0 || j?.refreshed > 0) refresh();
        }).catch(() => {});
      } else if (name.includes('watch')) {
        fetch('/api/watch-list/enrich', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          signal: ac.signal,
        }).then((r) => r.ok ? r.json() : null).then((j) => {
          if (j?.enriched > 0) refresh();
        }).catch(() => {});
        fetch(`/api/captures?status=archived&folder_id=${id}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: ac.signal,
        }).then((r) => r.ok ? r.json() : []).then(setWatchedCaptures).catch(() => {});
      }
    });
    return () => ac.abort();
  }, [session, refresh, id]);

  const startEdit = () => {
    if (!folder) return;
    setEditName(folder.name);
    setEditColor(folder.color);
    setEditIcon(folder.icon);
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!folder || !editName.trim()) return;
    try {
      const updated = await updateFolder(folder.id, { name: editName.trim(), color: editColor, icon: editIcon });
      setFolder((p) => p ? { ...p, ...updated } : p);
      setEditing(false);
    } catch {}
  };

  const handleArchive = useCallback(async (captureId: string) => {
    setCaptures((prev) => prev.filter((c) => c.id !== captureId));
    try { await updateCapture(captureId, { status: 'archived' }); }
    catch { refresh(); }
  }, [refresh]);

  const handleDelete = useCallback(async (captureId: string) => {
    setCaptures((prev) => prev.filter((c) => c.id !== captureId));
    try { await deleteCapture(captureId); }
    catch { refresh(); }
  }, [refresh]);

  const handleDeleteProject = async () => {
    try {
      await deleteFolder(id);
      router.push('/folders');
    } catch {}
  };

  const patchCaptureMeta = useCallback(async (capture: Capture, mergedMeta: Record<string, unknown>, extraPatch?: Record<string, unknown>) => {
    await fetch(`/api/captures/${capture.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ metadata: mergedMeta, ...extraPatch }),
    });
  }, [session]);

  const handleCycleMovieState = useCallback(async (capture: Capture) => {
    const meta = (capture.metadata ?? {}) as Record<string, unknown>;
    const cur = (meta.watch_state as string | undefined) ?? 'Pending';
    const next = cur === 'Pending' ? 'Watching' : cur === 'Watching' ? 'Watched' : 'Pending';
    const mergedMeta: Record<string, unknown> = { ...meta, watch_state: next };
    if (next === 'Watched') {
      mergedMeta.watched_at = new Date().toISOString();
      setCaptures((prev) => prev.filter((c) => c.id !== capture.id));
      setWatchedCaptures((prev) => [{ ...capture, status: 'archived', metadata: mergedMeta }, ...prev]);
      try { await patchCaptureMeta(capture, mergedMeta, { status: 'archived' }); } catch { refresh(); }
    } else {
      setCaptures((prev) => prev.map((c) => c.id === capture.id ? { ...c, metadata: mergedMeta } : c));
      try { await patchCaptureMeta(capture, mergedMeta); } catch { refresh(); }
    }
  }, [patchCaptureMeta, refresh]);

  const handleCycleSeasonState = useCallback(async (capture: Capture, season: number) => {
    const meta = (capture.metadata ?? {}) as Record<string, unknown>;
    const seasonStates = ((meta.watch_season_states ?? {}) as Record<string, string>);
    const cur = seasonStates[String(season)] ?? 'Pending';
    const next = cur === 'Pending' ? 'Watching' : cur === 'Watching' ? 'Watched' : 'Pending';
    const newSeasonStates = { ...seasonStates, [String(season)]: next };
    const seasons = (meta.watch_seasons as { season: number; episodes: number | null }[] | undefined) ?? [];
    const watchStatus = meta.watch_status as string | undefined;
    const allWatched = seasons.length > 0 && seasons.every((s) => (newSeasonStates[String(s.season)] ?? 'Pending') === 'Watched');
    const isReturning = watchStatus === 'Returning';
    const mergedMeta: Record<string, unknown> = { ...meta, watch_season_states: newSeasonStates };
    if (allWatched && !isReturning) {
      mergedMeta.watch_state = 'Watched';
      mergedMeta.watched_at = new Date().toISOString();
      setCaptures((prev) => prev.filter((c) => c.id !== capture.id));
      setWatchedCaptures((prev) => [{ ...capture, status: 'archived', metadata: mergedMeta }, ...prev]);
      try { await patchCaptureMeta(capture, mergedMeta, { status: 'archived' }); } catch { refresh(); }
    } else {
      setCaptures((prev) => prev.map((c) => c.id === capture.id ? { ...c, metadata: mergedMeta } : c));
      try { await patchCaptureMeta(capture, mergedMeta); } catch { refresh(); }
    }
  }, [patchCaptureMeta, refresh]);

  const handleReenrich = useCallback(async (capture: Capture) => {
    if (!session) return;
    const res = await fetch('/api/watch-list/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ capture_id: capture.id }),
    });
    if (res.ok) {
      const j = await res.json();
      if (j?.enriched > 0) refresh();
    }
  }, [session, refresh]);

  const handleSetRating = useCallback(async (capture: Capture, rating: number, inWatched = false) => {
    const meta = (capture.metadata ?? {}) as Record<string, unknown>;
    const cur = (meta.watch_rating as number | undefined) ?? 0;
    const newRating = cur === rating ? 0 : rating;
    const mergedMeta = { ...meta, watch_rating: newRating };
    const updater = (prev: Capture[]) => prev.map((c) => c.id === capture.id ? { ...c, metadata: mergedMeta } : c);
    if (inWatched) setWatchedCaptures(updater); else setCaptures(updater);
    try { await patchCaptureMeta(capture, mergedMeta); } catch {}
  }, [patchCaptureMeta]);

  if (loading || !session) {
    return (
      <div className="min-h-screen bg-[#fafaf8] dark:bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 animate-spin" />
      </div>
    );
  }

  function streamingBadgeClass(service: string): string {
    const s = service.toLowerCase();
    if (s.includes('netflix')) return 'bg-red-600 text-white';
    if (s.includes('max') || (s.includes('hbo') && !s.includes('max'))) return 'bg-blue-700 text-white';
    if (s.includes('hulu')) return 'bg-green-500 text-white';
    if (s.includes('apple')) return 'bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900';
    if (s.includes('prime') || s.includes('amazon')) return 'bg-sky-500 text-white';
    if (s.includes('disney')) return 'bg-blue-800 text-white';
    if (s.includes('peacock')) return 'bg-purple-600 text-white';
    if (s.includes('paramount')) return 'bg-blue-600 text-white';
    if (s.includes('rent') || s.includes('buy')) return 'bg-amber-500 text-white';
    return 'bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300';
  }

  function streamingShortLabel(service: string): string {
    const s = service.toLowerCase();
    if (s.includes('amazon prime') || (s.includes('amazon') && s.includes('prime'))) return 'Prime';
    if (s.includes('apple')) return 'Apple TV+';
    if (s.includes('paramount')) return 'Paramount+';
    return service;
  }

  function statePillClass(state: string): string {
    if (state === 'Watching') return 'border-blue-400 bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400';
    if (state === 'Watched') return 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400';
    return 'border-zinc-300 dark:border-zinc-600 text-zinc-500 dark:text-zinc-400';
  }

  function formatWatchDate(iso: string): string {
    const d = new Date(iso + 'T12:00:00'); // noon local to avoid timezone-off-by-one
    const thisYear = new Date().getFullYear();
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric',
      ...(d.getFullYear() !== thisYear ? { year: 'numeric' } : {}),
    });
  }

  function derivedTVState(seasonStates: Record<string, string>, seasons: { season: number }[]): string {
    if (!seasons.length) return 'Pending';
    const states = seasons.map((s) => seasonStates[String(s.season)] ?? 'Pending');
    if (states.every((s) => s === 'Watched')) return 'Watched';
    if (states.some((s) => s === 'Watching')) return 'Watching';
    return 'Pending';
  }

  const isReadingList = !!folder?.name?.toLowerCase().includes('reading');
  const isWatchList = !!folder?.name?.toLowerCase().includes('watch');
  const isTodoList = !!folder?.name?.toLowerCase().includes('to-do') || !!folder?.name?.toLowerCase().includes('todo');
  const isShoppingList = !!folder?.name?.toLowerCase().includes('shopping');

  function extractShoppingItem(capture: Capture): string {
    const meta = (capture.metadata ?? {}) as Record<string, unknown>;
    const items = meta.shopping_items as string[] | undefined;
    if (items?.length) return items.map((i) => i.replace(/\b\w/g, (c) => c.toUpperCase())).join(', ');
    const t = capture.transcript ?? '';
    const match = t.match(/^(?:add\s+)?(.+?)\s+to\s+(?:my\s+|the\s+)?(?:shopping\s+list|groceries?)\.?$/i);
    if (match) return match[1].trim().replace(/\b\w/g, (c) => c.toUpperCase());
    const s = capture.summary ?? t;
    return s.replace(/^the user wants to add\s+/i, '').replace(/\s+to their shopping list\.?$/i, '').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  return (
    <div className="min-h-screen bg-[#fafaf8] dark:bg-[#0a0a0a]">
      <header className="sticky top-0 z-10 bg-[#fafaf8]/80 dark:bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-zinc-200/60 dark:border-zinc-800/60 px-4 py-3">
        <div className="max-w-xl mx-auto flex items-center gap-3">
          <button
            onClick={() => router.push('/folders')}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
            aria-label="Back"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          {folder && (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className={`w-7 h-7 rounded-lg ${colorBg(folder.color)} flex items-center justify-center text-sm shrink-0`}>
                {folder.icon}
              </div>
              <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">{folder.name}</h1>
            </div>
          )}

          <button
            onClick={startEdit}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
            aria-label="Edit folder"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
        </div>
      </header>

      {/* Edit sheet */}
      {editing && (
        <div className="fixed inset-0 z-30 flex items-end">
          <div className="absolute inset-0 bg-black/20 dark:bg-black/40" onClick={() => setEditing(false)} />
          <div className="relative w-full max-w-xl mx-auto bg-white dark:bg-zinc-900 rounded-t-2xl p-5 space-y-4 pb-10">
            <div className="flex items-center gap-3 pb-1">
              <div className={`w-9 h-9 rounded-xl ${colorBg(editColor)} flex items-center justify-center text-base shrink-0`}>
                {editIcon}
              </div>
              <input
                autoFocus
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={60}
                className="flex-1 text-sm font-medium bg-transparent text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none border-b border-zinc-200 dark:border-zinc-700 pb-1"
              />
            </div>

            <div>
              <p className="text-[10px] font-mono text-zinc-400 mb-2 uppercase tracking-wide">Color</p>
              <div className="flex gap-2 flex-wrap">
                {PROJECT_COLORS.map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => setEditColor(c.name)}
                    className={`w-6 h-6 rounded-full ${c.bg} transition-transform ${
                      editColor === c.name ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-zinc-900 ' + c.ring + ' scale-110' : 'hover:scale-110'
                    }`}
                  />
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setConfirmDeleteProject(true)}
                className="py-2 px-3 text-sm text-red-400 hover:text-red-500 transition-colors"
              >
                Delete
              </button>
              <button
                onClick={() => setEditing(false)}
                className="flex-1 py-2 text-sm text-zinc-400 hover:text-zinc-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={!editName.trim()}
                className="flex-1 py-2 text-sm font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg disabled:opacity-40"
              >
                Save
              </button>
            </div>

            {confirmDeleteProject && (
              <div className="border-t border-zinc-200 dark:border-zinc-800 pt-3 flex items-center justify-between">
                <span className="text-xs text-zinc-500">Captures return to inbox. Delete folder?</span>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmDeleteProject(false)} className="text-xs text-zinc-400 px-2 py-1">Cancel</button>
                  <button onClick={handleDeleteProject} className="text-xs font-medium text-red-500 px-2 py-1">Delete</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <main className="max-w-xl mx-auto px-4 pt-4 pb-32 space-y-3">
        {captures.length === 0 && !isWatchList && (
          <div className="text-center pt-16 space-y-2">
            <p className="text-zinc-400 dark:text-zinc-600 text-sm">No captures yet.</p>
            <p className="text-zinc-300 dark:text-zinc-700 text-xs">File captures here from the inbox.</p>
          </div>
        )}

        {isWatchList ? (
          <div className="space-y-3">
            {/* Search bar */}
            <div className="relative">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 dark:text-zinc-500 pointer-events-none">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                value={watchSearch}
                onChange={(e) => setWatchSearch(e.target.value)}
                placeholder="Search watch list…"
                className="w-full pl-9 pr-9 py-2 text-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-700 transition-shadow"
              />
              {watchSearch && (
                <button
                  onClick={() => setWatchSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-zinc-100 dark:bg-zinc-800/60 p-1 rounded-xl">
              {(['watching', 'want'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setWatchTab(tab)}
                  className={`flex-1 text-xs font-medium py-1.5 rounded-lg transition-colors ${watchTab === tab ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
                >
                  {tab === 'watching' ? 'Watching' : 'Want to Watch'}
                </button>
              ))}
            </div>

            {(() => {
              const q = watchSearch.toLowerCase().trim();
              const hasActivity = (c: Capture) => {
                const meta = (c.metadata ?? {}) as Record<string, unknown>;
                const seasons = (meta.watch_seasons as { season: number }[] | undefined) ?? [];
                const seasonStates = ((meta.watch_season_states ?? {}) as Record<string, string>);
                const movieState = (meta.watch_state as string | undefined) ?? 'Pending';
                if (seasons.length > 0) {
                  return seasons.some((s) => {
                    const ss = seasonStates[String(s.season)] ?? 'Pending';
                    return ss === 'Watching' || ss === 'Watched';
                  });
                }
                return movieState === 'Watching' || movieState === 'Watched';
              };
              const matchesSearch = (c: Capture) => {
                if (!q) return true;
                const meta = (c.metadata ?? {}) as Record<string, unknown>;
                const title = (meta.watch_title as string | undefined) ?? (c.transcript ?? c.summary ?? '');
                return title.toLowerCase().includes(q);
              };
              const tabCaptures = captures.filter((c) =>
                watchTab === 'watching' ? hasActivity(c) : !hasActivity(c)
              ).filter(matchesSearch);
              const filteredWatched = watchedCaptures.filter(matchesSearch);
              return (
                <>

            {tabCaptures.length === 0 && (watchTab === 'want' || filteredWatched.length === 0) && (
              <div className="text-center pt-8">
                {q ? (
                  <p className="text-zinc-400 dark:text-zinc-600 text-sm">No results for &ldquo;{watchSearch}&rdquo;</p>
                ) : watchTab === 'watching' ? (
                  <p className="text-zinc-400 dark:text-zinc-600 text-sm">Nothing started yet — pick something from Want to Watch.</p>
                ) : (
                  <>
                    <p className="text-zinc-400 dark:text-zinc-600 text-sm">Nothing saved yet.</p>
                    <p className="text-zinc-300 dark:text-zinc-700 text-xs mt-1">Ask Calliad to add a show or movie.</p>
                  </>
                )}
              </div>
            )}

            {tabCaptures.length > 0 && (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                {tabCaptures.map((capture) => {
                  const meta = (capture.metadata ?? {}) as Record<string, unknown>;
                  const title = (meta.watch_title as string | undefined) ?? (capture.transcript ?? capture.summary ?? 'Untitled').trim();
                  const synopsis = meta.watch_synopsis as string | undefined;
                  const actors = meta.watch_actors as string[] | undefined;
                  const streaming = [...new Set((meta.watch_streaming as string[] | undefined) ?? [])];
                  const watchType = meta.watch_type as string | undefined;
                  const seasons = (meta.watch_seasons as { season: number; episodes: number | null }[] | undefined) ?? [];
                  const watchStatus = meta.watch_status as string | undefined;
                  const nextSeason = meta.watch_next_season as string | undefined;
                  const nextEpisodeSeason = meta.watch_next_episode_season as number | null | undefined;
                  const seasonStates = ((meta.watch_season_states ?? {}) as Record<string, string>);
                  const rating = (meta.watch_rating as number | undefined) ?? 0;
                  const isTV = watchType === 'TV Series';
                  const movieState = (meta.watch_state as string | undefined) ?? 'Pending';
                  const tvDerivedState = derivedTVState(seasonStates, seasons);
                  const dateStr = new Date(capture.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                  const expanded = expandedSummaries.has(capture.id);
                  const hasDetail = !!(synopsis || actors?.length || seasons.length || watchStatus);
                  const watchedSeasonCount = seasons.filter((s) => (seasonStates[String(s.season)] ?? 'Pending') === 'Watched').length;
                  const allCaughtUp = isTV && seasons.length > 0 && watchedSeasonCount === seasons.length && watchStatus === 'Returning';

                  return (
                    <div key={capture.id} className="px-4 py-3.5 bg-white dark:bg-zinc-900 group">
                      {/* Row 1: title + streaming badges + delete */}
                      <div className="flex items-start gap-2">
                        <p className="flex-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100 leading-snug min-w-0">{title}</p>
                        <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                          {streaming.map((s) => (
                            <span key={s} className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none ${streamingBadgeClass(s)}`}>
                              {streamingShortLabel(s)}
                            </span>
                          ))}
                          <button
                            onClick={() => handleReenrich(capture)}
                            title="Refresh data from Gemini"
                            className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center text-zinc-300 dark:text-zinc-700 hover:text-blue-400 dark:hover:text-blue-500 transition-all"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-3.5 h-3.5">
                              <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDelete(capture.id)}
                            title="Remove from list"
                            className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center text-zinc-300 dark:text-zinc-700 hover:text-red-400 dark:hover:text-red-500 transition-all"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-3.5 h-3.5">
                              <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" />
                            </svg>
                          </button>
                        </div>
                      </div>

                      {/* Next season notice (caught up on a returning show) */}
                      {allCaughtUp && (
                        <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 font-medium">
                          {nextSeason ? `Next season: ${nextSeason}` : 'New season expected'}
                        </p>
                      )}

                      {/* Row 2: state + rating + date */}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {isTV && seasons.length > 0 ? (
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${statePillClass(tvDerivedState)}`}>
                            {watchedSeasonCount}/{seasons.length} seasons
                          </span>
                        ) : (
                          <button
                            onClick={() => handleCycleMovieState(capture)}
                            title="Tap to change status"
                            className={`text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors ${statePillClass(isTV ? tvDerivedState : movieState)}`}
                          >
                            {isTV ? tvDerivedState : movieState}
                          </button>
                        )}
                        <div className="flex items-center gap-0.5">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <button
                              key={n}
                              onClick={() => handleSetRating(capture, n)}
                              title={`${n} star${n > 1 ? 's' : ''}`}
                              className={`text-base leading-none transition-colors ${n <= rating ? 'text-amber-400' : 'text-zinc-200 dark:text-zinc-700 hover:text-amber-300'}`}
                            >★</button>
                          ))}
                        </div>
                        <span className="text-zinc-300 dark:text-zinc-700 text-xs">·</span>
                        <span className="text-xs text-zinc-400 dark:text-zinc-500">{dateStr}</span>
                      </div>

                      {/* Expandable details */}
                      {hasDetail && (
                        <button onClick={() => toggleSummary(capture.id)} className="mt-2 text-left w-full">
                          {synopsis && (
                            <p className={`text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed ${expanded ? '' : 'line-clamp-2'}`}>
                              {synopsis}
                            </p>
                          )}
                          {expanded && (
                            <div className="mt-2.5 space-y-2">
                              {actors && actors.length > 0 && (
                                <p className="text-xs text-zinc-500 dark:text-zinc-500">
                                  <span className="font-medium text-zinc-400 dark:text-zinc-600">Cast · </span>
                                  {actors.join(', ')}
                                </p>
                              )}
                              {isTV && seasons.length > 0 && (
                                <div className="space-y-1.5 pt-0.5">
                                  {seasons.map((s) => {
                                    const ss = seasonStates[String(s.season)] ?? 'Pending';
                                    // Show next-episode date if this season is the one with the upcoming episode
                                    const isNextEpSeason = nextEpisodeSeason != null && s.season === nextEpisodeSeason;
                                    return (
                                      <div key={s.season} className="flex items-center gap-2">
                                        <span className="text-xs text-zinc-500 dark:text-zinc-500 w-20 shrink-0">
                                          S{s.season}{s.episodes != null ? ` · ${s.episodes} ep` : ''}
                                        </span>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); handleCycleSeasonState(capture, s.season); }}
                                          className={`text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors ${statePillClass(ss)}`}
                                        >
                                          {ss}
                                        </button>
                                        {isNextEpSeason && nextSeason && (
                                          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">· Next {formatWatchDate(nextSeason)}</span>
                                        )}
                                      </div>
                                    );
                                  })}
                                  {allCaughtUp && (
                                    <div className="flex items-center gap-2 opacity-70">
                                      <span className="text-xs text-zinc-400 dark:text-zinc-500 w-20 shrink-0">
                                        S{(seasons[seasons.length - 1]?.season ?? 0) + 1} · Upcoming
                                      </span>
                                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border border-zinc-300 dark:border-zinc-600 text-zinc-400 dark:text-zinc-500">
                                        Pending
                                      </span>
                                      {nextSeason && nextEpisodeSeason == null && (
                                        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">· {formatWatchDate(nextSeason)}</span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                              {watchStatus && (
                                <p className="text-xs text-zinc-500 dark:text-zinc-500">
                                  <span className="font-medium text-zinc-400 dark:text-zinc-600">Status · </span>
                                  {watchStatus}
                                  {/* Next date moved to season row — only show here for movies or edge cases */}
                                  {nextSeason && !nextEpisodeSeason && !allCaughtUp && (
                                    <span className="text-zinc-400 dark:text-zinc-600"> · Premieres {formatWatchDate(nextSeason)}</span>
                                  )}
                                </p>
                              )}
                            </div>
                          )}
                          <span className="text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors mt-1.5 inline-block">
                            {expanded ? 'Less ↑' : (synopsis ? 'More ↓' : 'Details ↓')}
                          </span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Watched history — only visible on Watching tab */}
            {watchTab === 'watching' && (
              <button
                onClick={() => { setShowWatched((p) => !p); if (!showWatched) loadWatched(); }}
                className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors w-full py-1 px-1"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-3 h-3 transition-transform ${showWatched ? 'rotate-90' : ''}`}>
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <span>Watched{filteredWatched.length > 0 ? ` (${filteredWatched.length})` : ''}</span>
              </button>
            )}

            {watchTab === 'watching' && showWatched && (
              filteredWatched.length === 0 ? (
                <p className="text-xs text-zinc-400 dark:text-zinc-600 px-1 pb-1">{watchSearch ? 'No matches.' : 'Nothing watched yet.'}</p>
              ) : (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                  {filteredWatched.map((capture) => {
                    const meta = (capture.metadata ?? {}) as Record<string, unknown>;
                    const title = (meta.watch_title as string | undefined) ?? (capture.transcript ?? capture.summary ?? 'Untitled').trim();
                    const rating = (meta.watch_rating as number | undefined) ?? 0;
                    const watchedAt = meta.watched_at as string | undefined;
                    const streaming = (meta.watch_streaming as string[] | undefined) ?? [];
                    const watchedDateStr = watchedAt
                      ? new Date(watchedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      : null;
                    return (
                      <div key={capture.id} className="px-4 py-3 bg-white dark:bg-zinc-900 flex items-start gap-3 group">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 leading-snug">{title}</p>
                            {streaming.slice(0, 2).map((s) => (
                              <span key={s} className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none ${streamingBadgeClass(s)}`}>
                                {streamingShortLabel(s)}
                              </span>
                            ))}
                          </div>
                          {watchedDateStr && <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">Watched {watchedDateStr}</p>}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                          <div className="flex items-center gap-0.5">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <button
                                key={n}
                                onClick={() => handleSetRating(capture, n, true)}
                                title={`${n} star${n > 1 ? 's' : ''}`}
                                className={`text-sm leading-none transition-colors ${n <= rating ? 'text-amber-400' : 'text-zinc-200 dark:text-zinc-700 hover:text-amber-300'}`}
                              >★</button>
                            ))}
                          </div>
                          <button
                            onClick={() => {
                              setWatchedCaptures((prev) => prev.filter((c) => c.id !== capture.id));
                              deleteCapture(capture.id).catch(() => loadWatched());
                            }}
                            title="Delete"
                            className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center text-zinc-300 dark:text-zinc-700 hover:text-red-400 dark:hover:text-red-500 transition-all"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-3.5 h-3.5">
                              <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            )}
                </>
              );
            })()}
          </div>
        ) : isReadingList ? (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
            {captures.map((capture) => {
              const meta = (capture.metadata ?? {}) as Record<string, unknown>;
              const url = meta.url as string | undefined;

              // Prefer og_title (fetched from page), fall back to shared title, then derive from URL
              const storedTitle = (meta.og_title as string | undefined) ?? (meta.title as string | undefined);
              const rawTitle = storedTitle ?? url ?? 'Untitled';
              const title = rawTitle.startsWith('http')
                ? (() => { try { const u = new URL(rawTitle); const slug = u.pathname.replace(/\/$/, '').split('/').filter(Boolean).pop() ?? ''; return slug ? slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : u.hostname.replace(/^www\./, ''); } catch { return rawTitle; } })()
                : rawTitle;

              const domain = url ? (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } })() : null;
              const dateStr = new Date(capture.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

              // Use stored summary; exclude obvious non-summaries (raw URLs, single words, exact title matches)
              const rawSummary = capture.summary ?? '';
              const summary = (!rawSummary.startsWith('http') && rawSummary !== rawTitle && rawSummary !== 'Shared item' && rawSummary.length > 15)
                ? rawSummary : null;

              const expanded = expandedSummaries.has(capture.id);

              return (
                <div key={capture.id} className="px-4 py-3.5 bg-white dark:bg-zinc-900 group">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      {/* Title — tappable opens article */}
                      {url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer"
                          className="text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors leading-snug">
                          {title}
                        </a>
                      ) : (
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 leading-snug">{title}</p>
                      )}

                      {/* Source + date */}
                      <div className="flex items-center gap-2 mt-1">
                        {domain && <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 truncate">{domain}</span>}
                        {domain && <span className="text-zinc-300 dark:text-zinc-700 text-xs">·</span>}
                        <span className="text-xs text-zinc-400 dark:text-zinc-500">{dateStr}</span>
                      </div>

                      {/* Collapsible summary */}
                      {summary && (
                        <button onClick={() => toggleSummary(capture.id)}
                          className="mt-2 text-left w-full">
                          <p className={`text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed transition-all ${expanded ? '' : 'line-clamp-2'}`}>
                            {summary}
                          </p>
                          <span className="text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors mt-0.5 inline-block">
                            {expanded ? 'Less ↑' : 'More ↓'}
                          </span>
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => handleArchive(capture.id)}
                      className="shrink-0 mt-0.5 w-7 h-7 flex items-center justify-center rounded-lg text-zinc-300 dark:text-zinc-700 hover:text-zinc-500 dark:hover:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors opacity-0 group-hover:opacity-100"
                      aria-label="Mark as read"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : isShoppingList ? (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
            {captures.map((capture) => {
              const item = extractShoppingItem(capture);
              return (
                <div key={capture.id} className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-zinc-900 group">
                  <button
                    onClick={() => handleArchive(capture.id)}
                    className="shrink-0 w-5 h-5 rounded border-2 border-zinc-300 dark:border-zinc-600 hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors flex items-center justify-center"
                    aria-label="Got it"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3 h-3 text-transparent group-hover:text-emerald-500 transition-colors">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </button>
                  <p className="flex-1 text-sm text-zinc-900 dark:text-zinc-100">{item}</p>
                </div>
              );
            })}
          </div>
        ) : isTodoList ? (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
            {[...captures].sort((a, b) => {
              const ra = ((a.metadata ?? {}) as Record<string, unknown>).remind_at as string | undefined;
              const rb = ((b.metadata ?? {}) as Record<string, unknown>).remind_at as string | undefined;
              if (ra && rb) return ra.localeCompare(rb);
              if (ra) return -1;
              if (rb) return 1;
              return 0;
            }).map((capture) => {
              const meta = (capture.metadata ?? {}) as Record<string, unknown>;
              const remindAt = meta.remind_at as string | undefined;
              const dueStr = remindAt
                ? new Date(remindAt + (remindAt.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                : null;
              const isOverdue = remindAt ? new Date(remindAt) < new Date() : false;
              return (
                <div key={capture.id} className="flex items-start gap-3 px-4 py-3 bg-white dark:bg-zinc-900 group">
                  <button
                    onClick={() => handleArchive(capture.id)}
                    className="shrink-0 mt-0.5 w-5 h-5 rounded border-2 border-zinc-300 dark:border-zinc-600 hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors flex items-center justify-center"
                    aria-label="Complete"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3 h-3 text-transparent group-hover:text-emerald-500 transition-colors">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-zinc-900 dark:text-zinc-100 leading-snug">{capture.transcript}</p>
                    {dueStr && (
                      <span className={`mt-1 inline-block text-[10px] font-mono px-1.5 py-0.5 rounded ${isOverdue ? 'bg-red-50 dark:bg-red-950/30 text-red-500 dark:text-red-400' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500'}`}>
                        {isOverdue ? 'overdue · ' : ''}{dueStr}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          captures.map((capture) => (
            <InboxCard
              key={capture.id}
              capture={capture}
              onArchive={handleArchive}
              onDelete={handleDelete}
            />
          ))
        )}
      </main>

      <BottomNav />
    </div>
  );
}
