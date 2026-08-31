'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/* ─── Tab icons ──────────────────────────────────────────────────────────── */
function IcToday({ on }: { on: boolean }) {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={on ? 2.1 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function IcTasks({ on }: { on: boolean }) {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={on ? 2.1 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}
function IcReading({ on }: { on: boolean }) {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={on ? 2.1 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}
function IcSettings({ on }: { on: boolean }) {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={on ? 2.1 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="8" x2="20" y2="8" /><circle cx="15" cy="8" r="2.5" />
      <line x1="4" y1="16" x2="20" y2="16" /><circle cx="9" cy="16" r="2.5" />
    </svg>
  );
}

/* ─── BottomNav — Today / Tasks / Reading / Settings ─────────────────────── */
export function BottomNav() {
  const path = usePathname();
  const onHome = path === '/';
  const onTasks = path.startsWith('/tasks');
  const onReading = path.startsWith('/reading');
  const onSettings = path.startsWith('/settings');

  const color = (active: boolean) => (active ? 'var(--tab-active, var(--text))' : 'var(--tab-off)');
  const tab = 'flex-1 flex flex-col items-center justify-center gap-[4px] text-[10px] transition-colors';

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-20"
      style={{ height: 86, background: 'var(--paper)', borderTop: '1px solid var(--border)' }}
    >
      <div className="max-w-xl mx-auto flex h-[58px]">
        <Link href="/" className={tab} style={{ color: color(onHome) }}>
          <IcToday on={onHome} />
          Today
        </Link>
        <Link href="/tasks" className={tab} style={{ color: color(onTasks) }}>
          <IcTasks on={onTasks} />
          Tasks
        </Link>
        <Link href="/reading" className={tab} style={{ color: color(onReading) }}>
          <IcReading on={onReading} />
          Reading
        </Link>
        <Link href="/settings" className={tab} style={{ color: color(onSettings) }}>
          <IcSettings on={onSettings} />
          Settings
        </Link>
      </div>
      <div style={{ height: 'env(safe-area-inset-bottom, 28px)' }} />
    </nav>
  );
}
