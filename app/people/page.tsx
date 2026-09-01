'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { BottomNav } from '@/components/BottomNav';
import { PageShell, PageHeader, PageBody } from '@/components/PageLayout';

export const dynamic = 'force-dynamic';

type Rel = 'family' | 'friend' | 'colleague' | 'acquaintance' | null;
interface Contact {
  id: string; name: string; org: string | null; birthday: string | null;
  relationship: Rel; relationship_note: string | null; emails: string[]; phones: string[];
}
interface Counts { all: number; family: number; friend: number; colleague: number; acquaintance: number; unfiled: number }

const TABS: { key: string; label: string; countKey: keyof Counts }[] = [
  { key: 'family', label: 'Family', countKey: 'family' },
  { key: 'friend', label: 'Friends', countKey: 'friend' },
  { key: 'colleague', label: 'Colleagues', countKey: 'colleague' },
  { key: 'all', label: 'All', countKey: 'all' },
];
const REL_CYCLE: Rel[] = ['family', 'friend', 'colleague', 'acquaintance', null];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseBday(b: string | null): { mm: number; dd: number; year: number | null } | null {
  if (!b) return null;
  const full = b.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (full) return { year: +full[1], mm: +full[2], dd: +full[3] };
  const md = b.match(/^(\d{2})-(\d{2})/);
  if (md) return { year: null, mm: +md[1], dd: +md[2] };
  return null;
}
function fmtBday(b: string | null): string {
  const p = parseBday(b);
  if (!p || p.mm < 1 || p.mm > 12) return '';
  return `${MONTHS[p.mm - 1]} ${p.dd}${p.year ? `, ${p.year}` : ''}`;
}
function daysUntilBday(b: string | null): number | null {
  const p = parseBday(b);
  if (!p) return null;
  const now = new Date();
  let next = new Date(now.getFullYear(), p.mm - 1, p.dd);
  if (next.getTime() < now.setHours(0, 0, 0, 0)) next = new Date(now.getFullYear() + 1, p.mm - 1, p.dd);
  return Math.round((next.getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000);
}

export default function PeoplePage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState('family');
  const [bfilter, setBfilter] = useState<'all' | 'bday' | '30d'>('all');
  const [items, setItems] = useState<Contact[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; birthday: string }>({ name: '', birthday: '' });

  useEffect(() => { if (!loading && !session) router.push('/login'); }, [loading, session, router]);

  const h = useMemo(
    () => (session ? { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' } : null),
    [session],
  );
  const load = useCallback(async () => {
    if (!h) return;
    const r = await fetch(`/api/contacts?tab=${tab}`, { headers: h });
    if (r.ok) { const j = await r.json(); setItems(j.items ?? []); setCounts(j.counts ?? null); }
  }, [h, tab]);
  useEffect(() => { void load(); }, [load]);

  const patch = async (id: string, body: Record<string, unknown>) => {
    if (!h) return;
    await fetch('/api/contacts', { method: 'PATCH', headers: h, body: JSON.stringify({ id, ...body }) });
    void load();
  };
  const cycleRel = (c: Contact) => {
    const i = REL_CYCLE.indexOf(c.relationship);
    patch(c.id, { relationship: REL_CYCLE[(i + 1) % REL_CYCLE.length] });
  };

  const shown = items.filter((c) => {
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !(c.org ?? '').toLowerCase().includes(search.toLowerCase())) return false;
    if (bfilter === 'bday' && !parseBday(c.birthday)) return false;
    if (bfilter === '30d') { const d = daysUntilBday(c.birthday); if (d == null || d > 30) return false; }
    return true;
  });
  if (bfilter === '30d') shown.sort((a, b) => (daysUntilBday(a.birthday) ?? 999) - (daysUntilBday(b.birthday) ?? 999));

  return (
    <PageShell>
      <PageHeader title="People" count={counts?.all || undefined} />
      <PageBody className="px-4 pt-2">
        <div className="max-w-xl mx-auto pb-4">
          <div className="flex gap-1.5 mb-3 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className="shrink-0 rounded-lg px-3 py-1.5 text-xs transition-colors"
                style={{
                  background: tab === t.key ? 'var(--accent-wash, var(--surface))' : 'var(--surface)',
                  border: `1px solid ${tab === t.key ? 'var(--accent)' : 'var(--border)'}`,
                  color: 'var(--text)',
                }}
              >
                {t.label} {counts ? <span style={{ color: 'var(--text-quiet)' }}>({counts[t.countKey]})</span> : null}
              </button>
            ))}
          </div>

          <div className="flex gap-2 mb-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
            {(['all', 'bday', '30d'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setBfilter(f)}
                className="shrink-0 rounded-lg px-2.5 text-xs"
                style={{
                  background: bfilter === f ? 'var(--accent)' : 'var(--surface)',
                  color: bfilter === f ? 'var(--on-accent)' : 'var(--text-muted)',
                  border: '1px solid var(--border)',
                }}
              >
                {f === 'all' ? 'All' : f === 'bday' ? 'Bday' : '30d'}
              </button>
            ))}
          </div>

          {shown.length === 0 && <p className="text-sm" style={{ color: 'var(--text-quiet)' }}>No one here.</p>}

          <ul className="space-y-2">
            {shown.map((c) => {
              const bd = fmtBday(c.birthday);
              const soon = bfilter === '30d' ? daysUntilBday(c.birthday) : null;
              return (
                <li
                  key={c.id}
                  className="rounded-xl px-3 py-2.5 flex items-center gap-3"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  <div
                    className="shrink-0 h-9 w-9 rounded-full flex items-center justify-center text-sm font-medium"
                    style={{ background: 'var(--paper)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                  >
                    {c.name.trim().charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    {editing === c.id ? (
                      <div className="flex flex-col gap-1">
                        <input
                          value={draft.name}
                          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                          className="rounded border px-2 py-1 text-sm"
                          style={{ borderColor: 'var(--border)', background: 'var(--paper)', color: 'var(--text)' }}
                        />
                        <input
                          value={draft.birthday}
                          onChange={(e) => setDraft({ ...draft, birthday: e.target.value })}
                          placeholder="YYYY-MM-DD or MM-DD"
                          className="rounded border px-2 py-1 text-xs"
                          style={{ borderColor: 'var(--border)', background: 'var(--paper)', color: 'var(--text)' }}
                        />
                        <div className="flex gap-2 text-xs">
                          <button
                            className="underline"
                            onClick={() => { patch(c.id, { name: draft.name.trim(), birthday: draft.birthday.trim() || null }); setEditing(null); }}
                          >save</button>
                          <button className="underline" style={{ color: 'var(--text-quiet)' }} onClick={() => setEditing(null)}>cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm truncate" style={{ color: 'var(--text)' }}>{c.name}</p>
                        <p className="text-[11px]" style={{ color: 'var(--text-quiet)' }}>
                          {c.relationship ? <span style={{ color: 'var(--accent)' }}>{c.relationship_note || c.relationship}</span> : null}
                          {c.relationship && (bd || c.org) ? ' · ' : ''}
                          {bd}{bd && soon != null ? ` (${soon === 0 ? 'today' : `in ${soon}d`})` : ''}
                          {!bd && c.org ? c.org : ''}
                        </p>
                      </>
                    )}
                  </div>
                  {editing !== c.id && (
                    <div className="shrink-0 flex items-center gap-2 text-[var(--text-quiet)]">
                      <button onClick={() => cycleRel(c)} title="Change relationship" aria-label="Change relationship">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
                      </button>
                      <button onClick={() => { setEditing(c.id); setDraft({ name: c.name, birthday: c.birthday ?? '' }); }} title="Edit" aria-label="Edit">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>
                      </button>
                      <button onClick={() => patch(c.id, { hidden: true })} title="Hide in Calliad" aria-label="Hide">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </PageBody>
      <BottomNav />
    </PageShell>
  );
}
