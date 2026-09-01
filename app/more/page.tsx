'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { BottomNav } from '@/components/BottomNav';
import { PageShell, PageHeader, PageBody } from '@/components/PageLayout';

export const dynamic = 'force-dynamic';

const LINKS: { href: string; label: string; sub: string }[] = [
  { href: '/reading', label: 'Reading & watch', sub: 'Saved articles, books, links' },
  { href: '/watch', label: 'Watch list', sub: 'TV & film — progress, ratings, what’s airing' },
  { href: '/unsubscribes', label: 'Unsubscribes', sub: 'Newsletters you’ve dropped — did they stop?' },
  { href: '/settings', label: 'Settings', sub: 'About you, integrations, notifications' },
];

export default function MorePage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  useEffect(() => { if (!loading && !session) router.push('/login'); }, [loading, session, router]);

  return (
    <PageShell>
      <PageHeader title="More" />
      <PageBody className="px-4 pt-2">
        <div className="max-w-xl mx-auto pb-4 space-y-2">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="block rounded-xl px-4 py-3"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <p className="text-sm" style={{ color: 'var(--text)' }}>{l.label}</p>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-quiet)' }}>{l.sub}</p>
            </Link>
          ))}
        </div>
      </PageBody>
      <BottomNav />
    </PageShell>
  );
}
