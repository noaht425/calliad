'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { BottomNav } from '@/components/BottomNav';
import { Chat } from '@/components/Chat';

export default function HomePage() {
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !session) router.push('/login');
  }, [loading, session, router]);

  if (loading || !session) return null;

  return (
    <div className="flex flex-col h-dvh">
      <div className="flex-1 min-h-0 pb-16">
        <Chat />
      </div>
      <BottomNav />
    </div>
  );
}
