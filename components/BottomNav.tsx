'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/lib/i18n';

export function BottomNav() {
  const path = usePathname();
  const router = useRouter();
  const t = useT();
  const [moreOpen, setMoreOpen] = useState(false);

  const onHome    = path === '/';
  const onTodos   = path.startsWith('/todos');
  const onReading = path.startsWith('/reading');
  const onTravel  = path.startsWith('/trips');
  const onMore    = !onHome && !onTodos && !onReading && !onTravel;

  function navLink(label: string, href: string) {
    router.push(href);
    setMoreOpen(false);
  }

  return (
    <>
      {/* More sheet backdrop */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/30 backdrop-blur-sm"
          onClick={() => setMoreOpen(false)}
        />
      )}

      {/* More sheet */}
      {moreOpen && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-[#fafaf8] dark:bg-[#111111] rounded-t-2xl border-t border-zinc-200/60 dark:border-zinc-800/60 pb-safe-bottom">
          <div className="max-w-xl mx-auto px-4 pt-5 pb-6">
            <div className="flex items-center justify-between mb-5">
              <span className="text-xs font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">More</span>
              <button onClick={() => setMoreOpen(false)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors p-1">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Inbox',        icon: '📥', href: '/inbox' },
                { label: 'Folders',      icon: '📁', href: '/folders' },
                { label: 'Family',       icon: '🏠', href: '/family' },
                { label: 'Friends',      icon: '👤', href: '/people' },
                { label: 'Projects',     icon: '🗂️', href: '/projects' },
                { label: 'Shopping',     icon: '🛒', href: '/shopping' },
                { label: 'Watch List',   icon: '🎬', href: '/watchlist' },
                { label: 'Unsubscribes', icon: '🚫', href: '/unsubscribes' },
                { label: 'Settings',     icon: '⚙️', href: '/settings' },
              ].map(({ label, icon, href }) => (
                <button
                  key={href}
                  onClick={() => navLink(label, href)}
                  className={`flex flex-col items-center gap-2 py-4 rounded-xl border transition-colors ${
                    path.startsWith(href) && href !== '/'
                      ? 'bg-zinc-900 dark:bg-zinc-100 border-zinc-900 dark:border-zinc-100'
                      : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
                  }`}
                >
                  <span className="text-xl leading-none">{icon}</span>
                  <span className={`text-[11px] font-medium ${
                    path.startsWith(href) && href !== '/'
                      ? 'text-white dark:text-zinc-900'
                      : 'text-zinc-600 dark:text-zinc-400'
                  }`}>{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bottom nav bar */}
      <nav className="fixed bottom-0 inset-x-0 z-20 bg-[#fafaf8]/90 dark:bg-[#0a0a0a]/90 backdrop-blur-xl border-t border-zinc-200/60 dark:border-zinc-800/60">
        <div className="max-w-xl mx-auto flex">
          <Link href="/" className={`flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-medium transition-colors ${onHome ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 dark:text-zinc-600'}`}>
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={onHome ? 2.25 : 1.75} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Today
          </Link>

          <Link href="/todos" className={`flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-medium transition-colors ${onTodos ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 dark:text-zinc-600'}`}>
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={onTodos ? 2.25 : 1.75}>
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
            </svg>
            {t('nav.todo')}
          </Link>

          <Link href="/reading" className={`flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-medium transition-colors ${onReading ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 dark:text-zinc-600'}`}>
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={onReading ? 2.25 : 1.75}>
              <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
              <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
            </svg>
            Reading
          </Link>

          <Link href="/trips" className={`flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-medium transition-colors ${onTravel ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 dark:text-zinc-600'}`}>
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={onTravel ? 2.25 : 1.75}>
              <path d="M17.8 19.2L16 11l3.5-3.5C21 6 21 4 19.5 2.5S18 2 16.5 3.5L13 7 4.8 5.2 3.4 6.6l7.1 3.7-2.3 2.3-3 -.7-1.4 1.4 2.7 2.7 2.7 2.7 1.4-1.4-.7-3 2.3-2.3 3.7 7.1z" />
            </svg>
            Travel
          </Link>

          <button
            onClick={() => setMoreOpen((v) => !v)}
            className={`flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-medium transition-colors ${onMore || moreOpen ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 dark:text-zinc-600'}`}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={onMore || moreOpen ? 2.25 : 1.75}>
              <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
              <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
              <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
            </svg>
            More
          </button>
        </div>
        <div className="h-safe-bottom" />
      </nav>
    </>
  );
}
