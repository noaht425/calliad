'use client';
import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useAuth } from '@/lib/auth';
import { BottomNav } from '@/components/BottomNav';
import { searchCaptures } from '@/lib/api';
import type { Capture } from '@/lib/types';
import { useRouter, useSearchParams } from 'next/navigation';
import { useT, useTimeAgo } from '@/lib/i18n';

type GroupedResults = {
  inbox: Capture[];
  todos: Capture[];
  folders: Capture[];
  other: Capture[];
};

function groupResults(results: Capture[]): GroupedResults {
  const groups: GroupedResults = { inbox: [], todos: [], folders: [], other: [] };
  for (const c of results) {
    if (c.source === 'action' || c.source === 'assistant') continue; // skip meta captures
    if (c.status === 'inbox') groups.inbox.push(c);
    else if (c.status === 'folder' && c.folder_id) {
      const tags = c.tags ?? [];
      if (tags.includes('todo') || tags.includes('reminder')) groups.todos.push(c);
      else groups.folders.push(c);
    }
    else if (c.status === 'tasked') groups.todos.push(c);
    else groups.other.push(c);
  }
  return groups;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function ResultCard({ capture, onClick }: { capture: Capture; onClick?: () => void }) {
  const text = capture.summary || capture.transcript || '';
  const timeAgo = useTimeAgo();
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
    >
      <p className="text-sm text-zinc-800 dark:text-zinc-200 line-clamp-2">{text}</p>
      <div className="flex items-center gap-2 mt-1">
        {capture.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="text-[10px] text-zinc-400 dark:text-zinc-600 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded-full">{tag}</span>
        ))}
        <span className="text-[10px] text-zinc-300 dark:text-zinc-700 ml-auto">{timeAgo(capture.created_at)}</span>
      </div>
    </button>
  );
}

function Section({ title, items, onItemClick }: { title: string; items: Capture[]; onItemClick: (c: Capture) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest px-1">{title}</p>
      {items.map((c) => <ResultCard key={c.id} capture={c} onClick={() => onItemClick(c)} />)}
    </div>
  );
}

function SearchContent() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const t = useT();
  const searchParams = useSearchParams();
  const initialQ = searchParams.get('q') ?? '';
  const [query, setQuery] = useState(initialQ);
  const [results, setResults] = useState<Capture[] | null>(null);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading && !session) router.push('/login');
  }, [loading, session, router]);

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const search = useCallback(async (q: string) => {
    if (q.length <= 2) { setResults(null); return; }
    setSearching(true);
    try {
      const data = await searchCaptures(q);
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  // Debounce 300ms
  useEffect(() => {
    const timer = setTimeout(() => search(query), 300);
    return () => clearTimeout(timer);
  }, [query, search]);

  const handleItemClick = useCallback((capture: Capture) => {
    if (capture.trip_id) {
      router.push(`/trips/${capture.trip_id}`);
    } else if (capture.folder_id) {
      router.push(`/folders`);
    } else {
      router.push('/');
    }
  }, [router]);

  const grouped = results ? groupResults(results) : null;
  const totalCount = grouped ? grouped.inbox.length + grouped.todos.length + grouped.folders.length + grouped.other.length : 0;

  if (loading || !session) return null;

  return (
    <div className="min-h-screen bg-[#fafaf8] dark:bg-[#0a0a0a]">
      <header className="sticky top-0 z-10 bg-[#fafaf8]/80 dark:bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-zinc-200/60 dark:border-zinc-800/60 px-4 py-3">
        <div className="max-w-xl mx-auto flex items-center gap-3">
          <div className="flex-1 relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              ref={inputRef}
              type="search"
              placeholder={t('search.placeholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 text-sm rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-transparent focus:border-zinc-300 dark:focus:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none transition-colors"
            />
            {searching && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-600 dark:border-t-zinc-300 animate-spin" />
            )}
          </div>
          {results !== null && (
            <span className="text-xs font-mono text-zinc-400 dark:text-zinc-600 shrink-0">{t(totalCount === 1 ? 'search.result' : 'search.results', { n: totalCount })}</span>
          )}
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-5 pb-32 space-y-6">
        {!query && (
          <p className="text-center text-sm text-zinc-400 dark:text-zinc-600 pt-16">{t('search.hint')}</p>
        )}
        {query.length > 0 && query.length <= 2 && (
          <p className="text-center text-sm text-zinc-400 dark:text-zinc-600 pt-16">{t('search.keepTyping')}</p>
        )}
        {grouped && totalCount === 0 && (
          <p className="text-center text-sm text-zinc-400 dark:text-zinc-600 pt-16">{t('search.noResults', { query })}</p>
        )}
        {grouped && (
          <>
            <Section title={t('search.sectionInbox')} items={grouped.inbox} onItemClick={handleItemClick} />
            <Section title={t('search.sectionTodo')} items={grouped.todos} onItemClick={handleItemClick} />
            <Section title={t('search.sectionFolders')} items={grouped.folders} onItemClick={handleItemClick} />
            <Section title={t('search.sectionOther')} items={grouped.other} onItemClick={handleItemClick} />
          </>
        )}
      </main>

      <BottomNav />
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchContent />
    </Suspense>
  );
}
