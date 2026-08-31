'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { BottomNav } from '@/components/BottomNav';
import { PageShell } from '@/components/PageLayout';
import { Chat } from '@/components/Chat';

export default function HomePage() {
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !session) router.push('/login');
  }, [loading, session, router]);

  if (loading || !session) return null;

  return (
    <PageShell>
      {/* Chat owns the space between the top and the 86px fixed BottomNav. */}
      <div className="flex-1 min-h-0" style={{ paddingBottom: 'calc(86px + env(safe-area-inset-bottom, 0px))' }}>
        <Chat />
      </div>
      <BottomNav />
    </PageShell>
  );
}
