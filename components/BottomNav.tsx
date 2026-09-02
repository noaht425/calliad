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
function IcTravel({ on }: { on: boolean }) {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={on ? 2.1 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3.5S18 3 16.5 4.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
    </svg>
  );
}
function IcPeople({ on }: { on: boolean }) {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={on ? 2.1 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function IcMore({ on }: { on: boolean }) {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r={on ? 2.1 : 1.9} /><circle cx="12" cy="12" r={on ? 2.1 : 1.9} /><circle cx="19" cy="12" r={on ? 2.1 : 1.9} />
    </svg>
  );
}

const MORE_ROUTES = ['/more', '/pulse', '/notes', '/reading', '/watch', '/watchers', '/unsubscribes', '/settings'];

/* ─── BottomNav — Today / Tasks / Travel / People / More ─────────────────── */
export function BottomNav() {
  const path = usePathname();
  const onHome = path === '/';
  const onTasks = path.startsWith('/tasks');
  const onTravel = path.startsWith('/trips') || path.startsWith('/travel');
  const onPeople = path.startsWith('/people');
  const onMore = MORE_ROUTES.some((r) => path.startsWith(r));

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
        <Link href="/trips" className={tab} style={{ color: color(onTravel) }}>
          <IcTravel on={onTravel} />
          Travel
        </Link>
        <Link href="/people" className={tab} style={{ color: color(onPeople) }}>
          <IcPeople on={onPeople} />
          People
        </Link>
        <Link href="/more" className={tab} style={{ color: color(onMore) }}>
          <IcMore on={onMore} />
          More
        </Link>
      </div>
      <div style={{ height: 'env(safe-area-inset-bottom, 28px)' }} />
    </nav>
  );
}
