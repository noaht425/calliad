'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { BottomNav } from '@/components/BottomNav';
import { PageShell, PageHeader, PageBody, SectionLabel } from '@/components/PageLayout';

export const dynamic = 'force-dynamic';

interface Loop {
  id: string;
  title: string;
  body: string | null;
  due_at: string | null;
  tags: string[];
  source: string;
}

const DAY = 86400000;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

function bucket(due: string | null): 'overdue' | 'today' | 'week' | 'later' | 'none' {
  if (!due) return 'none';
  const t = Date.parse(due);
  const s = startOfToday();
  if (t < s) return 'overdue';
  if (t < s + DAY) return 'today';
  if (t < s + 7 * DAY) return 'week';
  return 'later';
}
const fmtDue = (due: string) =>
  new Date(due).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

export default function TasksPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [loops, setLoops] = useState<Loop[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const h = useMemo(
    () => (session ? { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' } : undefined),
    [session],
  );

  const load = useCallback(async () => {
    if (!session) return;
    const r = await fetch('/api/loops', { headers: { Authorization: `Bearer ${session.access_token}` } });
    if (r.ok) setLoops((await r.json()).loops ?? []);
  }, [session]);

  useEffect(() => { if (!loading && !session) router.replace('/login'); }, [loading, session, router]);
  useEffect(() => { load(); }, [load]);

  if (loading || !session) return null;

  async function add() {
    const title = input.trim();
    if (!title || !h) return;
    setBusy(true);
    setInput('');
    await fetch('/api/loops', { method: 'POST', headers: h, body: JSON.stringify({ title, tags: ['task'] }) });
    await load();
    setBusy(false);
  }
  const patch = async (id: string, body: Record<string, unknown>) => {
    if (!h) return;
    await fetch('/api/loops', { method: 'PATCH', headers: h, body: JSON.stringify({ id, ...body }) });
    load();
  };
  const done = (id: string) => patch(id, { status: 'done' });
  const drop = (id: string) => patch(id, { status: 'dropped' });
  const setDue = (id: string, base: number, addDays: number) =>
    patch(id, { due_at: new Date(base + addDays * DAY + 9 * 3600000).toISOString() });

  const groups: [string, Loop[]][] = [
    ['Overdue', []], ['Today', []], ['This week', []], ['Later', []], ['No date', []],
  ];
  const idx = { overdue: 0, today: 1, week: 2, later: 3, none: 4 } as const;
  for (const l of loops) groups[idx[bucket(l.due_at)]][1].push(l);
  for (const [, list] of groups)
    list.sort((a, b) => (a.due_at ? Date.parse(a.due_at) : Infinity) - (b.due_at ? Date.parse(b.due_at) : Infinity));

  const s = startOfToday();

  return (
    <PageShell>
      <PageHeader title="Tasks" count={loops.length || undefined} />
      <PageBody className="px-4 pt-2">
        <div className="max-w-xl mx-auto">
          <div className="flex gap-2 mb-6">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
              placeholder="Add a task…"
              className="flex-1 rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
            <button
              onClick={() => void add()}
              disabled={busy || !input.trim()}
              className="shrink-0 rounded-xl px-4 text-sm font-medium disabled:opacity-40"
              style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
            >
              Add
            </button>
          </div>

          {loops.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--text-quiet)' }}>
              Nothing on your plate. Add one above, or say &ldquo;remind me to…&rdquo; in chat.
            </p>
          )}

          {groups.map(([name, list]) =>
            list.length === 0 ? null : (
              <section key={name} className="mb-7">
                <SectionLabel className="mb-2">{name} · {list.length}</SectionLabel>
                <ul className="space-y-2.5">
                  {list.map((l) => (
                    <li key={l.id} className="flex items-start gap-2.5">
                      <button
                        onClick={() => done(l.id)}
                        aria-label="Mark done"
                        className="mt-0.5 shrink-0 h-[18px] w-[18px] rounded-full border transition-colors"
                        style={{ borderColor: 'var(--accent-border)' }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm" style={{ color: 'var(--text)' }}>{l.title}</p>
                        {l.body && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{l.body}</p>}
                        <div className="mt-1 flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-quiet)' }}>
                          {l.due_at
                            ? <span style={{ color: name === 'Overdue' ? '#EF4444' : 'var(--text-quiet)' }}>{fmtDue(l.due_at)}</span>
                            : (
                              <>
                                <button className="underline" onClick={() => setDue(l.id, s, 0)}>today</button>
                                <button className="underline" onClick={() => setDue(l.id, s, 1)}>tomorrow</button>
                                <button className="underline" onClick={() => setDue(l.id, s, 7)}>+1w</button>
                              </>
                            )}
                          {l.due_at && (
                            <button className="underline" onClick={() => setDue(l.id, Date.parse(l.due_at!), 1)}>+1d</button>
                          )}
                          {l.source === 'syllabus' && <span>· syllabus</span>}
                          <button className="underline ml-auto" onClick={() => drop(l.id)}>drop</button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ),
          )}
        </div>
      </PageBody>
      <BottomNav />
    </PageShell>
  );
}
