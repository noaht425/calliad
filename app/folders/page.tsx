'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { BottomNav } from '@/components/BottomNav';
import { listFolders, createFolder, listTrips } from '@/lib/api';
import { PROJECT_COLORS, colorBg } from '@/lib/projectColors';
import type { Folder, Trip } from '@/lib/types';

const DEFAULT_ICONS = ['◐', '📋', '🏠', '🏥', '✈️', '🍽️', '💡', '🌿', '📚', '🎯', '🔧', '⭐'];

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

export default function FoldersPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState('blue');
  const [icon, setIcon] = useState('◐');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loading && !session) router.push('/login');
  }, [loading, session, router]);

  const refresh = useCallback(async () => {
    try {
      const [projs, trps] = await Promise.all([listFolders(), listTrips(true)]);
      setFolders(projs);
      setTrips(trps);
    } catch {}
  }, []);

  useEffect(() => {
    if (session) refresh();
  }, [session, refresh]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const folder = await createFolder({ name: name.trim(), color, icon });
      setFolders((prev) => [...prev, folder]);
      setName(''); setColor('blue'); setIcon('◐'); setShowForm(false);
    } catch {}
    setSaving(false);
  };

  if (loading || !session) {
    return (
      <div className="min-h-screen bg-[#fafaf8] dark:bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 animate-spin" />
      </div>
    );
  }

  const entityFolders = folders.filter((p) => p.entity_type === 'folder');
  const plainProjects = folders.filter((p) => p.entity_type !== 'folder');

  const activeTrips = trips.filter((t) => t.status !== 'archived' && t.status !== 'completed');
  const archivedTrips = trips.filter((t) => t.status === 'archived' || t.status === 'completed');

  function tripsForFolder(folderId: string) {
    return trips.filter((t) => t.folder_id === folderId && (showArchived || (t.status !== 'archived' && t.status !== 'completed')));
  }

  const unattachedTrips = (showArchived ? trips : activeTrips).filter((t) => !t.folder_id);

  return (
    <div className="min-h-screen bg-[#fafaf8] dark:bg-[#0a0a0a]">
      <header className="sticky top-0 z-10 bg-[#fafaf8]/80 dark:bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-zinc-200/60 dark:border-zinc-800/60 px-4 py-3">
        <div className="max-w-xl mx-auto flex items-center gap-3">
          <div className="flex-1 relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="search"
              placeholder="Search everything…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && searchQuery.trim()) router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`); }}
              onFocus={() => { if (searchQuery.trim()) router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`); }}
              className="w-full pl-9 pr-8 py-2 text-sm rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-transparent focus:border-zinc-300 dark:focus:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none transition-colors"
            />
          </div>
          <button
            onClick={() => { setShowForm(true); setName(''); setColor('blue'); setIcon('◐'); }}
            className="text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors flex items-center gap-1 shrink-0"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Folder
          </button>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 pt-4 pb-32 space-y-6">

        {showForm && (
          <form onSubmit={handleCreate} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-lg ${colorBg(color)} flex items-center justify-center text-white text-sm shrink-0`}>{icon}</div>
              <input autoFocus type="text" placeholder="Folder name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
                className="flex-1 text-sm bg-transparent text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none" />
            </div>
            <div>
              <p className="text-[10px] font-mono text-zinc-400 mb-2 uppercase tracking-wide">Icon</p>
              <div className="flex flex-wrap gap-2">
                {DEFAULT_ICONS.map((i) => (
                  <button key={i} type="button" onClick={() => setIcon(i)}
                    className={`w-8 h-8 rounded-lg text-sm flex items-center justify-center transition-colors ${icon === i ? 'bg-zinc-200 dark:bg-zinc-700' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>{i}</button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-mono text-zinc-400 mb-2 uppercase tracking-wide">Color</p>
              <div className="flex gap-2 flex-wrap">
                {PROJECT_COLORS.map((c) => (
                  <button key={c.name} type="button" onClick={() => setColor(c.name)}
                    className={`w-6 h-6 rounded-full ${c.bg} transition-transform ${color === c.name ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-zinc-900 ' + c.ring + ' scale-110' : 'hover:scale-110'}`} />
                ))}
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2 text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">Cancel</button>
              <button type="submit" disabled={!name.trim() || saving} className="flex-1 py-2 text-sm font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg disabled:opacity-40 transition-opacity">
                {saving ? 'Creating…' : 'Create'}
              </button>
            </div>
          </form>
        )}

        {/* Quick-access lists: always visible whether or not the folder exists in DB */}
        <section className="space-y-1">
          <div className="flex items-center gap-2 px-1 mb-2">
            <svg className="w-3.5 h-3.5 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
              <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
            <h2 className="text-xs font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">Lists</h2>
          </div>
          {[
            { label: 'Reading List', icon: '📚', href: '/reading',   desc: 'articles & links to read' },
            { label: 'Watch List',   icon: '🎬', href: '/watchlist', desc: 'shows & movies to watch' },
            { label: 'Shopping',     icon: '🛒', href: '/shopping',  desc: 'grocery & shopping items' },
          ].map(({ label, icon, href, desc }) => (
            <button key={href} onClick={() => router.push(href)}
              className="w-full text-left bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 flex items-center gap-3 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors">
              <div className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-base shrink-0">{icon}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</p>
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500 font-mono">{desc}</p>
              </div>
              <svg className="w-4 h-4 text-zinc-300 dark:text-zinc-700 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          ))}
        </section>

        {/* Other entity folders (trips, user-created) */}
        {entityFolders
          .filter((f) => !trips.some((t) => t.folder_id === f.id)
            && !['reading', 'shopping', 'watch'].some((k) => f.name.toLowerCase().includes(k)))
          .sort((a, b) => {
            const order = ['to-do', 'todo'];
            const ai = order.findIndex((k) => a.name.toLowerCase().includes(k));
            const bi = order.findIndex((k) => b.name.toLowerCase().includes(k));
            return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
          })
          .map((folder) => {
            const isDefaultIcon = !folder.icon || folder.icon === '◐';
            return (
              <section key={folder.id} className="space-y-1">
                <button
                  onClick={() => router.push(`/folders/${folder.id}`)}
                  className="flex items-center gap-2 px-1 mb-2 w-full text-left hover:opacity-70 transition-opacity"
                >
                  {isDefaultIcon ? (
                    <svg className="w-3.5 h-3.5 text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                    </svg>
                  ) : (
                    <span className="text-sm leading-none shrink-0">{folder.icon}</span>
                  )}
                  <h2 className="text-xs font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">{folder.name}</h2>
                  {folder.capture_count != null && folder.capture_count > 0 && (
                    <span className="text-[10px] font-mono text-zinc-300 dark:text-zinc-700 ml-1">{folder.capture_count}</span>
                  )}
                  <svg className="w-3 h-3 text-zinc-300 dark:text-zinc-700 ml-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </section>
            );
          })
        }

        {/* Travel folders — collapsible, shows trip list inline */}
        {entityFolders
          .filter((f) => trips.some((t) => t.folder_id === f.id))
          .map((folder) => {
            const folderTrips = tripsForFolder(folder.id);
            const totalTrips = trips.filter((t) => t.folder_id === folder.id).length;
            const isOpen = openFolders.has(folder.id);
            const toggle = () => setOpenFolders((prev) => {
              const next = new Set(prev);
              if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id);
              return next;
            });
            return (
              <section key={folder.id} className="space-y-1">
                <button
                  onClick={toggle}
                  className="flex items-center gap-2 px-1 mb-2 w-full text-left hover:opacity-70 transition-opacity"
                >
                  <svg className="w-3.5 h-3.5 text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                  </svg>
                  <h2 className="text-xs font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">{folder.name}</h2>
                  {totalTrips > 0 && (
                    <span className="text-[10px] font-mono text-zinc-300 dark:text-zinc-700 ml-1">{totalTrips}</span>
                  )}
                  <svg className={`w-3 h-3 text-zinc-300 dark:text-zinc-700 ml-auto transition-transform ${isOpen ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
                {isOpen && (
                  <>
                    {folderTrips.length === 0 ? (
                      <p className="text-xs text-zinc-300 dark:text-zinc-700 px-1 py-2">No active trips.</p>
                    ) : (
                      folderTrips.map((trip) => (
                        <TripRow key={trip.id} trip={trip} onClick={() => router.push(`/trips/${trip.id}`)} />
                      ))
                    )}
                    {archivedTrips.filter((t) => t.folder_id === folder.id).length > 0 && (
                      <button onClick={() => setShowArchived((v) => !v)}
                        className="w-full text-xs text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors py-1 flex items-center justify-center gap-1.5">
                        <svg className={`w-3 h-3 transition-transform ${showArchived ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                        {showArchived ? 'Hide' : 'Show'} completed trips
                      </button>
                    )}
                  </>
                )}
              </section>
            );
          })
        }

        {/* Unattached trips (no folder) */}
        {unattachedTrips.length > 0 && (
          <section className="space-y-1">
            <h2 className="text-xs font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest px-1 mb-2">Trips</h2>
            {unattachedTrips.map((trip) => (
              <TripRow key={trip.id} trip={trip} onClick={() => router.push(`/trips/${trip.id}`)} />
            ))}
          </section>
        )}

        {/* People */}
        <section className="space-y-1">
          <div className="flex items-center gap-2 px-1 mb-2">
            <svg className="w-3.5 h-3.5 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
            </svg>
            <h2 className="text-xs font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">People</h2>
          </div>
          <button onClick={() => router.push('/family')}
            className="w-full text-left bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 flex items-center gap-3 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors">
            <div className="w-9 h-9 rounded-xl bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center text-base shrink-0">🏠</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Family</p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 font-mono">birthdays, anniversaries & more</p>
            </div>
            <svg className="w-4 h-4 text-zinc-300 dark:text-zinc-700 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          <button onClick={() => router.push('/people')}
            className="w-full text-left bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 flex items-center gap-3 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors">
            <div className="w-9 h-9 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center text-base shrink-0">👤</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Friends</p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 font-mono">birthdays, anniversaries & more</p>
            </div>
            <svg className="w-4 h-4 text-zinc-300 dark:text-zinc-700 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </section>

        {/* Unsubscribes */}
        <section className="space-y-1">
          <div className="flex items-center gap-2 px-1 mb-2">
            <svg className="w-3.5 h-3.5 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
            </svg>
            <h2 className="text-xs font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">Unsubscribes</h2>
          </div>
          <button onClick={() => router.push('/unsubscribes')}
            className="w-full text-left bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 flex items-center gap-3 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors">
            <div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-950/30 flex items-center justify-center text-base shrink-0">🚫</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Unsubscribes</p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 font-mono">track & verify email unsubscribes</p>
            </div>
            <svg className="w-4 h-4 text-zinc-300 dark:text-zinc-700 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </section>

        {/* Projects — top-level with optional nested children */}
        {plainProjects.length > 0 && (() => {
          const topLevel = plainProjects.filter((p) => !p.parent_folder_id);
          const childrenMap = new Map<string, typeof plainProjects>();
          for (const child of plainProjects.filter((p) => p.parent_folder_id)) {
            const arr = childrenMap.get(child.parent_folder_id!) ?? [];
            arr.push(child);
            childrenMap.set(child.parent_folder_id!, arr);
          }
          return (
            <section className="space-y-1">
              <div className="flex items-center gap-2 px-1 mb-2">
                <svg className="w-3.5 h-3.5 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
                </svg>
                <h2 className="text-xs font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">Projects</h2>
              </div>
              {topLevel.map((project) => {
                const children = childrenMap.get(project.id) ?? [];
                const isOpen = openFolders.has(project.id);
                const toggle = () => setOpenFolders((prev) => {
                  const next = new Set(prev);
                  if (next.has(project.id)) next.delete(project.id); else next.add(project.id);
                  return next;
                });
                return (
                  <div key={project.id} className="space-y-1">
                    <button
                      onClick={children.length > 0 ? toggle : () => router.push(project.entity_type === 'project' ? `/projects/${project.id}` : `/folders/${project.id}`)}
                      className="w-full text-left bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 flex items-center gap-3 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors">
                      <div className={`w-9 h-9 rounded-xl ${colorBg(project.color)} flex items-center justify-center text-base shrink-0`}>{project.icon}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{project.name}</p>
                        <p className="text-[11px] text-zinc-400 dark:text-zinc-500 font-mono">
                          {children.length > 0
                            ? `${children.length} project${children.length === 1 ? '' : 's'}`
                            : project.capture_count === 0 ? 'empty' : `${project.capture_count} item${project.capture_count === 1 ? '' : 's'}`}
                        </p>
                      </div>
                      <svg className={`w-4 h-4 text-zinc-300 dark:text-zinc-700 shrink-0 transition-transform ${children.length > 0 && isOpen ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                    {children.length > 0 && isOpen && (
                      <div className="ml-6 space-y-1">
                        {children.map((child) => (
                          <button key={child.id} onClick={() => router.push(child.entity_type === 'project' ? `/projects/${child.id}` : `/folders/${child.id}`)}
                            className="w-full text-left bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex items-center gap-3 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors">
                            <div className={`w-7 h-7 rounded-lg ${colorBg(child.color)} flex items-center justify-center text-sm shrink-0`}>{child.icon}</div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{child.name}</p>
                              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 font-mono">
                                {child.capture_count === 0 ? 'empty' : `${child.capture_count} item${child.capture_count === 1 ? '' : 's'}`}
                              </p>
                            </div>
                            <svg className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-700 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                              <polyline points="9 18 15 12 9 6" />
                            </svg>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })()}

        {folders.length === 0 && trips.length === 0 && !showForm && (
          <div className="text-center pt-16 space-y-2">
            <p className="text-zinc-400 dark:text-zinc-600 text-sm">Nothing here yet.</p>
            <p className="text-zinc-300 dark:text-zinc-700 text-xs">Trips appear here automatically. Create a project to file captures.</p>
          </div>
        )}

      </main>
      <BottomNav />
    </div>
  );
}

function TripRow({ trip, onClick }: { trip: Trip; onClick: () => void }) {
  const start = formatTripDate(trip.start_date);
  const end = formatTripDate(trip.end_date);
  const dateRange = start && end && start !== end ? `${start} – ${end}` : start;
  const dest = trip.destination ? trip.destination.split(',').slice(0, 2).join(',').trim() : trip.title;

  return (
    <button onClick={onClick}
      className="w-full text-left bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 flex items-center gap-3 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors">
      <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-900/40 flex items-center justify-center shrink-0">
        <svg className="w-4.5 h-4.5 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
          <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{dest}</p>
        <p className="text-[11px] font-mono text-zinc-400 dark:text-zinc-500">
          {dateRange}
          {trip.travelers.length > 1 && <span className="ml-2">· {trip.travelers.length} travelers</span>}
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
