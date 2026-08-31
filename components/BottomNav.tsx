'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Phase 1 nav — Today + Reading + Settings. Grows as surfaces return. */
export function BottomNav() {
  const path = usePathname();
  const onHome = path === '/';
  const onReading = path.startsWith('/reading');
  const onSettings = path.startsWith('/settings');

  return (
    <nav className="fixed bottom-0 inset-x-0 z-20 bg-[#fafaf8]/90 dark:bg-[#0a0a0a]/90 backdrop-blur-xl border-t border-zinc-200/60 dark:border-zinc-800/60">
      <div className="max-w-xl mx-auto flex">
        <Link
          href="/"
          className={`flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-medium transition-colors ${onHome ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 dark:text-zinc-600'}`}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={onHome ? 2.25 : 1.75} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          Today
        </Link>
        <Link
          href="/reading"
          className={`flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-medium transition-colors ${onReading ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 dark:text-zinc-600'}`}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={onReading ? 2.25 : 1.75} strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </svg>
          Reading
        </Link>
        <Link
          href="/settings"
          className={`flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-medium transition-colors ${onSettings ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 dark:text-zinc-600'}`}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={onSettings ? 2.25 : 1.75} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          Settings
        </Link>
      </div>
      <div className="h-safe-bottom" />
    </nav>
  );
}
