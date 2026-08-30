'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { listFolders } from '@/lib/api';

export default function WatchlistPage() {
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!session) { router.push('/login'); return; }

    listFolders().then((folders) => {
      const watchlist = folders.find((f) =>
        f.name.toLowerCase().includes('watch')
      );
      if (watchlist) {
        router.replace(`/folders/${watchlist.id}`);
      } else {
        router.replace('/folders');
      }
    }).catch(() => router.replace('/folders'));
  }, [loading, session, router]);

  return (
    <div className="min-h-screen bg-[#fafaf8] dark:bg-[#0a0a0a] flex items-center justify-center">
      <div className="w-8 h-8 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 animate-spin" />
    </div>
  );
}
