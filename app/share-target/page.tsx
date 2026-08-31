'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default function ShareTargetPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [state, setState] = useState<'working' | 'done' | 'error' | 'nourl'>('working');
  const [detail, setDetail] = useState('');

  useEffect(() => {
    if (loading) return;
    if (!session) { router.replace('/login'); return; }

    const q = new URLSearchParams(window.location.search);
    const raw = q.get('url') || q.get('text') || q.get('title') || '';
    const url = raw.match(/https?:\/\/[^\s<>"')]+/)?.[0];
    if (!url) { setState('nourl'); return; }

    fetch('/api/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ url, source: 'share' }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          setState('done');
          setDetail(
            j.deduped
              ? `Already on your ${j.item.kind} list.`
              : `Filed under ${j.item.kind}${j.item.title ? `: ${j.item.title}` : ''}.${j.item.descriptor ? `\n${j.item.descriptor}` : ''}`,
          );
        } else {
          setState('error');
          setDetail(j.error ?? 'failed');
        }
      })
      .catch((e) => { setState('error'); setDetail(String(e)); });
  }, [loading, session, router]);

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="w-8 h-8 rounded-full bg-[var(--accent)] flex items-center justify-center">
        <span className="text-xs font-bold text-[var(--on-accent)]">C</span>
      </div>
      {state === 'working' && <p className="text-sm text-[var(--text-muted)]">Saving…</p>}
      {state === 'nourl' && <p className="text-sm text-[var(--text-muted)]">No link found in what you shared.</p>}
      {state === 'error' && <p className="text-sm text-red-500 whitespace-pre-wrap">Couldn&apos;t save it: {detail}</p>}
      {state === 'done' && <p className="text-sm text-[var(--text-body)] whitespace-pre-wrap">{detail}</p>}
      {state !== 'working' && (
        <button onClick={() => router.replace('/reading')} className="text-sm underline text-[var(--text-muted)]">
          Open reading list
        </button>
      )}
    </main>
  );
}
