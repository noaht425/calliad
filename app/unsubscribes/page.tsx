'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { BottomNav } from '@/components/BottomNav';
import { PageShell, PageHeader, PageBody, SectionLabel } from '@/components/PageLayout';

export const dynamic = 'force-dynamic';

interface Row {
  id: string; sender_name: string; sender_domain: string;
  unsubscribed_at: string; last_marketing_at: string | null;
  watch_days: number; days_watched: number;
  status: 'pending' | 'confirmed' | 'still_coming';
}

const fmt = (d: string | null) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const STATUS_LABEL: Record<Row['status'], string> = { pending: 'PENDING', confirmed: 'STOPPED', still_coming: 'STILL COMING' };

export default function UnsubscribesPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');

  useEffect(() => { if (!loading && !session) router.push('/login'); }, [loading, session, router]);
  const h = useMemo(
    () => (session ? { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' } : null),
    [session],
  );
  const load = useCallback(async () => {
    if (!h) return;
    const r = await fetch('/api/unsubscribes', { headers: h });
    if (r.ok) setRows((await r.json()).items ?? []);
  }, [h]);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!h || !domain.trim()) return;
    await fetch('/api/unsubscribes', { method: 'POST', headers: h, body: JSON.stringify({ sender_name: name.trim(), sender_domain: domain.trim() }) });
    setName(''); setDomain(''); void load();
  };
  const remove = async (id: string) => { if (h) { await fetch(`/api/unsubscribes?id=${id}`, { method: 'DELETE', headers: h }); void load(); } };

  const groups: [string, Row[]][] = [
    ['Watching', rows.filter((r) => r.status === 'pending' || r.status === 'still_coming')],
    ['Confirmed stopped', rows.filter((r) => r.status === 'confirmed')],
  ];

  return (
    <PageShell>
      <PageHeader title="Unsubscribes" count={rows.length || undefined} />
      <PageBody className="px-4 pt-2">
        <div className="max-w-xl mx-auto pb-4">
          {rows.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              None yet. When Calliad sees an unsubscribe confirmation in your promo mail it logs the sender here and watches for 10 days to check it stuck. Or add one below / say &ldquo;I unsubscribed from X&rdquo; in chat.
            </p>
          )}

          {groups.map(([label, list]) =>
            list.length === 0 ? null : (
              <section key={label} className="mb-6">
                <SectionLabel className="mb-2">{label} · {list.length}</SectionLabel>
                <ul className="space-y-2">
                  {list.map((r) => (
                    <li key={r.id} className="rounded-xl px-4 py-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm" style={{ color: 'var(--text)' }}>{r.sender_name}</p>
                          <p className="text-[11px]" style={{ color: 'var(--accent)' }}>{r.sender_domain}</p>
                        </div>
                        <span className="text-[10px] font-mono" style={{ color: r.status === 'still_coming' ? '#ef4444' : r.status === 'confirmed' ? '#16a34a' : 'var(--text-muted)' }}>
                          {STATUS_LABEL[r.status]}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        <span>unsub {fmt(r.unsubscribed_at)} · last marketing {fmt(r.last_marketing_at)}</span>
                      </div>
                      <div className="flex items-center justify-between mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        <span>{r.days_watched} of {r.watch_days} days</span>
                        <button className="underline" onClick={() => remove(r.id)}>remove</button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ),
          )}

          <div className="flex gap-2 mt-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="flex-1 rounded-lg px-3 py-2 text-sm outline-none" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="domain.com" className="flex-1 rounded-lg px-3 py-2 text-sm outline-none" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            <button onClick={() => void add()} disabled={!domain.trim()} className="shrink-0 rounded-lg px-3 text-sm font-medium disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>add</button>
          </div>
        </div>
      </PageBody>
      <BottomNav />
    </PageShell>
  );
}
