'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { BottomNav } from '@/components/BottomNav';
import { PageShell, PageHeader, PageBody } from '@/components/PageLayout';

export const dynamic = 'force-dynamic';

type Rel = 'family' | 'friend' | 'colleague' | 'acquaintance' | null;
type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly' | null;
interface Contact {
  id: string; name: string; org: string | null; birthday: string | null;
  relationship: Rel; relationship_note: string | null; emails: string[]; phones: string[];
  anniversary?: string | null; last_contact_at?: string | null; contact_cadence?: Cadence;
}

const CADENCE_OPTS: { value: string; label: string }[] = [
  { value: '', label: 'no reminder' },
  { value: 'weekly', label: 'weekly' },
  { value: 'biweekly', label: 'every 2 weeks' },
  { value: 'monthly', label: 'monthly' },
  { value: 'quarterly', label: 'every few months' },
  { value: 'yearly', label: 'yearly' },
];
function agoDays(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - Date.parse(iso)) / 86400000);
}
interface Counts { all: number; family: number; friend: number; colleague: number; acquaintance: number; unfiled: number }

const TABS: { key: string; label: string; countKey: keyof Counts }[] = [
  { key: 'family', label: 'Family', countKey: 'family' },
  { key: 'friend', label: 'Friends', countKey: 'friend' },
  { key: 'colleague', label: 'Colleagues', countKey: 'colleague' },
  { key: 'all', label: 'All', countKey: 'all' },
];
const REL_OPTS: { value: string; label: string }[] = [
  { value: '', label: '— none —' },
  { value: 'family', label: 'Family' },
  { value: 'friend', label: 'Friend' },
  { value: 'colleague', label: 'Colleague' },
  { value: 'acquaintance', label: 'Acquaintance' },
];
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
  const [draft, setDraft] = useState<{ name: string; birthday: string; anniversary: string }>({ name: '', birthday: '', anniversary: '' });

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
  const setRel = (c: Contact, v: string) => patch(c.id, { relationship: v || null });

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
                {t.label} {counts ? <span style={{ color: 'var(--text-muted)' }}>({counts[t.countKey]})</span> : null}
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

          {shown.length === 0 && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No one here.</p>}

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
                          placeholder="Birthday — YYYY-MM-DD or MM-DD"
                          className="rounded border px-2 py-1 text-xs"
                          style={{ borderColor: 'var(--border)', background: 'var(--paper)', color: 'var(--text)' }}
                        />
                        <input
                          value={draft.anniversary}
                          onChange={(e) => setDraft({ ...draft, anniversary: e.target.value })}
                          placeholder="Anniversary — MM-DD (optional)"
                          className="rounded border px-2 py-1 text-xs"
                          style={{ borderColor: 'var(--border)', background: 'var(--paper)', color: 'var(--text)' }}
                        />
                        <div className="flex gap-2 text-xs">
                          <button
                            className="underline"
                            onClick={() => {
                              patch(c.id, {
                                name: draft.name.trim(),
                                birthday: draft.birthday.trim() || null,
                                anniversary: draft.anniversary.trim() || null,
                              });
                              setEditing(null);
                            }}
                          >save</button>
                          <button className="underline" style={{ color: 'var(--text-muted)' }} onClick={() => setEditing(null)}>cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm truncate" style={{ color: 'var(--text)' }}>{c.name}</p>
                        {(bd || c.org || fmtBday(c.anniversary ?? null)) && (
                          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                            {bd ? `🎂 ${bd}${soon != null ? ` · ${soon === 0 ? 'today' : `in ${soon}d`}` : ''}` : ''}
                            {fmtBday(c.anniversary ?? null) ? `${bd ? '  ·  ' : ''}💍 ${fmtBday(c.anniversary ?? null)}` : ''}
                            {!bd && !fmtBday(c.anniversary ?? null) && c.org ? c.org : ''}
                          </p>
                        )}
                        {c.contact_cadence && (
                          <p className="text-[11px]" style={{ color: agoDays(c.last_contact_at) != null && agoDays(c.last_contact_at)! > 45 ? '#b45309' : 'var(--text-muted)' }}>
                            {agoDays(c.last_contact_at) == null
                              ? `no contact logged · reminder: ${c.contact_cadence}`
                              : `last talked ${agoDays(c.last_contact_at)}d ago · ${c.contact_cadence}`}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <select
                            value={c.relationship ?? ''}
                            onChange={(e) => setRel(c, e.target.value)}
                            className="rounded-md border px-1.5 py-1 text-[11px]"
                            style={{ borderColor: 'var(--border)', background: 'var(--paper)', color: c.relationship ? 'var(--accent)' : 'var(--text-muted)' }}
                            aria-label="Relationship"
                          >
                            {REL_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                          <select
                            value={c.contact_cadence ?? ''}
                            onChange={(e) => patch(c.id, { contact_cadence: e.target.value || null })}
                            className="rounded-md border px-1.5 py-1 text-[11px]"
                            style={{ borderColor: 'var(--border)', background: 'var(--paper)', color: c.contact_cadence ? 'var(--accent)' : 'var(--text-muted)' }}
                            aria-label="Keep-in-touch reminder"
                          >
                            {CADENCE_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                          <button
                            className="text-[11px] underline"
                            style={{ color: 'var(--text-muted)' }}
                            onClick={() => patch(c.id, { logContact: true })}
                          >talked today</button>
                          <button
                            className="text-[11px] underline"
                            style={{ color: 'var(--text-muted)' }}
                            onClick={() => { setEditing(c.id); setDraft({ name: c.name, birthday: c.birthday ?? '', anniversary: c.anniversary ?? '' }); }}
                          >edit</button>
                          <button
                            className="text-[11px] underline"
                            style={{ color: 'var(--text-muted)' }}
                            onClick={() => patch(c.id, { hidden: true })}
                          >hide</button>
                        </div>
                      </>
                    )}
                  </div>
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
