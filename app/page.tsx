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
    // BottomNav is position:fixed (~56px). pb-14 keeps the chat input above it.
    <main className="h-dvh pb-14">
      <Chat />
      <BottomNav />
    </main>
  );
}
