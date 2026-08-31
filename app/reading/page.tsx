'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { BottomNav } from '@/components/BottomNav';

export const dynamic = 'force-dynamic';

interface Item {
  id: string; kind: string; title: string | null; url: string; descriptor: string | null; site: string | null; status: string;
}

export default function ReadingPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);

  const load = useCallback(async () => {
    if (!session) return;
    const r = await fetch('/api/capture', { headers: { Authorization: `Bearer ${session.access_token}` } });
    if (r.ok) setItems((await r.json()).items ?? []);
  }, [session]);

  useEffect(() => { if (!loading && !session) router.replace('/login'); }, [loading, session, router]);
  useEffect(() => { load(); }, [load]);

  if (loading || !session) return null;

  async function setStatus(id: string, status: string) {
    await fetch('/api/capture', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session!.access_token}` },
      body: JSON.stringify({ id, status }),
    });
    load();
  }

  const groups: [string, string][] = [['reading', 'Reading'], ['watch', 'Watch'], ['link', 'Links']];

  return (
    <div className="min-h-dvh bg-[#fafaf8] dark:bg-[#0a0a0a] px-4 pt-12 pb-24 max-w-xl mx-auto">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-6">Reading &amp; watch</h1>

      {items.length === 0 && (
        <p className="text-sm text-zinc-400">
          Nothing yet. Send Calliad a link in chat, or share one to it from another app.
        </p>
      )}

      {groups.map(([kind, label]) => {
        const list = items.filter((i) => i.kind === kind);
        if (!list.length) return null;
        return (
          <section key={kind} className="mb-8">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-600 mb-3">{label}</h2>
            <ul className="space-y-4">
              {list.map((i) => (
                <li key={i.id} className={i.status === 'done' ? 'opacity-50' : ''}>
                  <a href={i.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-zinc-900 dark:text-zinc-100 underline">
                    {i.title ?? i.url}
                  </a>
                  {i.site && <span className="text-xs text-zinc-400"> · {i.site}</span>}
                  {i.descriptor && <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{i.descriptor}</p>}
                  <div className="mt-1 flex gap-3 text-xs">
                    <button className="underline text-zinc-500" onClick={() => setStatus(i.id, i.status === 'done' ? 'unread' : 'done')}>
                      {i.status === 'done' ? 'mark unread' : 'mark done'}
                    </button>
                    <button className="underline text-zinc-400" onClick={() => setStatus(i.id, 'archived')}>remove</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <BottomNav />
    </div>
  );
}
