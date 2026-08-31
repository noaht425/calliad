'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { BottomNav } from '@/components/BottomNav';
import { PageShell, PageHeader, PageBody, SectionLabel } from '@/components/PageLayout';

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
    <PageShell>
      <PageHeader title="Reading & watch" count={items.length || undefined} />
      <PageBody className="px-4 pt-2">
        <div className="max-w-xl mx-auto">
          {items.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--text-quiet)' }}>
              Nothing yet. Send Calliad a link in chat, or share one to it from another app.
            </p>
          )}

          {groups.map(([kind, label]) => {
            const list = items.filter((i) => i.kind === kind);
            if (!list.length) return null;
            return (
              <section key={kind} className="mb-8">
                <SectionLabel className="mb-3">{label}</SectionLabel>
                <ul className="space-y-4">
                  {list.map((i) => (
                    <li key={i.id} className={i.status === 'done' ? 'opacity-50' : ''}>
                      <a
                        href={i.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-medium underline"
                        style={{ color: 'var(--text)' }}
                      >
                        {i.title ?? i.url}
                      </a>
                      {i.site && <span className="text-xs" style={{ color: 'var(--text-quiet)' }}> · {i.site}</span>}
                      {i.descriptor && (
                        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{i.descriptor}</p>
                      )}
                      <div className="mt-1 flex gap-3 text-xs">
                        <button className="underline" style={{ color: 'var(--text-muted)' }} onClick={() => setStatus(i.id, i.status === 'done' ? 'unread' : 'done')}>
                          {i.status === 'done' ? 'mark unread' : 'mark done'}
                        </button>
                        <button className="underline" style={{ color: 'var(--text-quiet)' }} onClick={() => setStatus(i.id, 'archived')}>remove</button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </PageBody>
      <BottomNav />
    </PageShell>
  );
}
