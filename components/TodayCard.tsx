'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';

interface Ev { title: string; start_at: string; all_day: boolean; location: string | null }
interface Task { id: string; title: string; due_at: string | null }
interface Today {
  tz: string;
  events: Ev[];
  tasks: { overdue: Task[]; today: Task[]; undatedCount: number; openCount: number };
  nextDeadline: { title: string; due_at: string } | null;
}

export function TodayCard() {
  const { session } = useAuth();
  const [d, setD] = useState<Today | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    const r = await fetch('/api/today', { headers: { Authorization: `Bearer ${session.access_token}` } });
    if (r.ok) setD(await r.json());
  }, [session]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    try {
      setCollapsed(sessionStorage.getItem('today-collapsed') === '1');
    } catch { /* ignore */ }
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try { sessionStorage.setItem('today-collapsed', c ? '0' : '1'); } catch { /* ignore */ }
      return !c;
    });
  };

  if (!d) return null;

  const tz = d.tz;
  const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
  const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz });
  const nothing = !d.events.length && !d.tasks.overdue.length && !d.tasks.today.length && !d.nextDeadline;

  const complete = async (id: string) => {
    if (!session) return;
    await fetch('/api/loops', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'done' }),
    });
    load();
  };

  return (
    <div
      className="shrink-0 border-b"
      style={{ borderColor: 'var(--border)', background: 'var(--paper)', maxHeight: collapsed ? undefined : '46vh', overflowY: 'auto' }}
    >
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-4 pt-3 pb-2"
        style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 10, letterSpacing: '0.16em', color: 'var(--text-quiet)' }}
      >
        <span>TODAY</span>
        <span>{collapsed ? '▾' : '▴'}</span>
      </button>

      {!collapsed && (
        <div className="px-4 pb-3 space-y-3 text-sm">
          {nothing && <p style={{ color: 'var(--text-quiet)' }}>Clear day — nothing scheduled, nothing due.</p>}

          {d.events.length > 0 && (
            <div>
              {d.events.map((e, i) => (
                <div key={i} className="flex gap-2 py-0.5" style={{ color: 'var(--text-body)' }}>
                  <span className="tabular-nums shrink-0" style={{ color: 'var(--text-muted)' }}>
                    {e.all_day ? 'all day' : time(e.start_at)}
                  </span>
                  <span className="min-w-0">{e.title}{e.location ? <span style={{ color: 'var(--text-quiet)' }}> · {e.location}</span> : null}</span>
                </div>
              ))}
            </div>
          )}

          {(d.tasks.overdue.length > 0 || d.tasks.today.length > 0) && (
            <div className="space-y-1">
              {[...d.tasks.overdue.map((t) => ({ t, over: true })), ...d.tasks.today.map((t) => ({ t, over: false }))].map(({ t, over }) => (
                <div key={t.id} className="flex items-start gap-2">
                  <button
                    onClick={() => complete(t.id)}
                    aria-label="Mark done"
                    className="mt-[3px] shrink-0 h-[15px] w-[15px] rounded-full border"
                    style={{ borderColor: 'var(--accent-border)' }}
                  />
                  <span className="min-w-0" style={{ color: 'var(--text-body)' }}>
                    {t.title}
                    {over && t.due_at && <span style={{ color: '#EF4444' }}> · {dayLabel(t.due_at)}</span>}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-quiet)' }}>
            {d.nextDeadline && (
              <span>Next: {d.nextDeadline.title} — {dayLabel(d.nextDeadline.due_at)}</span>
            )}
            <Link href="/tasks" className="underline ml-auto">
              {d.tasks.openCount} open{d.tasks.undatedCount ? ` · ${d.tasks.undatedCount} undated` : ''}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
