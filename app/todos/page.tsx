'use client';
import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { BottomNav } from '@/components/BottomNav';
import { useRouter } from 'next/navigation';

interface TodoItem {
  id: string;
  summary: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export default function TodosPage() {
  const { session } = useAuth();
  const router = useRouter();
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchTodos = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/todos', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) setTodos(await res.json());
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => { fetchTodos(); }, [fetchTodos]);

  const handleDone = useCallback(async (id: string) => {
    setTodos((prev) => prev.filter((t) => t.id !== id));
    await fetch(`/api/captures/${id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${session?.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'archived' }),
    });
  }, [session?.access_token]);

  const remindAt = (item: TodoItem): string | null =>
    (item.metadata?.remind_at as string) ?? null;

  const formatDate = (iso: string) =>
    new Date(iso + (iso.includes('T') ? '' : 'T12:00:00')).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });

  const sorted = [...todos].sort((a, b) => {
    const ra = remindAt(a), rb = remindAt(b);
    if (ra && rb) return ra.localeCompare(rb);
    if (ra) return -1;
    if (rb) return 1;
    return a.created_at.localeCompare(b.created_at);
  });

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
          <span className="text-xs text-zinc-400 dark:text-zinc-600 font-mono shrink-0">
            {todos.length > 0 ? `${todos.length} item${todos.length === 1 ? '' : 's'}` : ''}
          </span>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 pt-4 pb-32">
        {loading && (
          <div className="flex justify-center pt-16">
            <div className="w-6 h-6 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 animate-spin" />
          </div>
        )}

        {!loading && sorted.length === 0 && (
          <div className="text-center pt-16">
            <p className="text-zinc-400 dark:text-zinc-600 text-sm">No to-dos yet.</p>
            <p className="text-zinc-300 dark:text-zinc-700 text-xs mt-1">Voice notes with tasks will appear here automatically.</p>
          </div>
        )}

        {!loading && sorted.length > 0 && (
          <ul className="space-y-1">
            {sorted.map((item) => {
              const date = remindAt(item);
              return (
                <li
                  key={item.id}
                  className="flex items-start gap-3 py-3 px-1 border-b border-zinc-100 dark:border-zinc-900"
                >
                  <button
                    onClick={() => handleDone(item.id)}
                    className="mt-0.5 w-5 h-5 shrink-0 rounded-full border-2 border-zinc-300 dark:border-zinc-700 hover:border-zinc-500 dark:hover:border-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors flex items-center justify-center"
                    aria-label="Mark done"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-zinc-900 dark:text-zinc-100 leading-snug">{item.summary}</p>
                    {date && (
                      <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-0.5">{formatDate(date)}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
