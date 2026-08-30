'use client';
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { parseVCard } from '@/lib/vcard-parse';

function ShareTargetInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState<'saving' | 'saved' | 'error' | 'auth'>('saving');

  useEffect(() => {
    async function save() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setStatus('auth');
        setTimeout(() => router.push('/login'), 2000);
        return;
      }

      const title = params.get('title') ?? undefined;
      const text = params.get('text') ?? undefined;
      const url = params.get('url') ?? undefined;

      if (!title && !text && !url) {
        router.push('/');
        return;
      }

      // vCard share from iOS Contacts — redirect to People import flow
      if (text && text.includes('BEGIN:VCARD')) {
        const contact = parseVCard(text);
        if (contact) {
          const encoded = btoa(JSON.stringify(contact))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
          router.push(`/people?import=${encoded}`);
          return;
        }
      }

      const res = await fetch('/api/share-capture', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title, text, url }),
      });

      if (res.ok) {
        setStatus('saved');
        setTimeout(() => router.push('/'), 1500);
      } else {
        setStatus('error');
      }
    }
    save();
  }, [params, router]);

  return (
    <div className="min-h-screen bg-[#fafaf8] dark:bg-[#0a0a0a] flex flex-col items-center justify-center gap-3 px-6">
      {status === 'saving' && (
        <>
          <div className="w-8 h-8 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 animate-spin" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Saving to Calliad…</p>
        </>
      )}
      {status === 'saved' && (
        <>
          <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center">
            <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Saved to inbox</p>
        </>
      )}
      {status === 'auth' && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Redirecting to login…</p>
      )}
      {status === 'error' && (
        <>
          <p className="text-sm text-red-500">Couldn&apos;t save this item.</p>
          <button onClick={() => router.push('/')} className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
            Go to inbox
          </button>
        </>
      )}
    </div>
  );
}

export default function ShareTargetPage() {
  return <Suspense><ShareTargetInner /></Suspense>;
}
