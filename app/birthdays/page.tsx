'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { BottomNav } from '@/components/BottomNav';

interface Contact {
  id: string;
  full_name: string;
  birthday: string | null;   // MM-DD
  anniversary: string | null; // MM-DD
  birth_year: number | null;
}

interface ContactRow {
  contact: Contact;
  type: 'Birthday' | 'Anniversary';
  mmdd: string;
  daysUntil: number;
  nextDate: Date;
}

function nextOccurrence(mmdd: string): Date {
  const [mm, dd] = mmdd.split('-').map(Number);
  const now = new Date();
  const thisYear = new Date(now.getFullYear(), mm - 1, dd);
  if (thisYear >= now) return thisYear;
  return new Date(now.getFullYear() + 1, mm - 1, dd);
}

function daysUntil(date: Date): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86400000);
}


export default function BirthdaysPage() {
  const { session, loading } = useAuth();
  const token = session?.access_token;
  const router = useRouter();
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [filter, setFilter] = useState<'All' | 'Birthdays' | 'Anniversaries'>('All');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [fetching, setFetching] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null); // `${contactId}:${field}`

  useEffect(() => { if (!loading && !session) router.push('/login'); }, [loading, session, router]);

  useEffect(() => {
    if (!session) return;
    fetchContacts();
  }, [session]);

  async function fetchContacts() {
    setFetching(true);
    try {
      if (!token) { setSyncMsg('No session token — try logging out and back in.'); return; }
      const res = await fetch('/api/contacts', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSyncMsg(`Error ${res.status}: ${body.error ?? 'unknown'}`);
        return;
      }
      const contacts: Contact[] = await res.json();

      const built: ContactRow[] = [];
      for (const c of contacts) {
        if (c.birthday) {
          const next = nextOccurrence(c.birthday);
          built.push({ contact: c, type: 'Birthday', mmdd: c.birthday, daysUntil: daysUntil(next), nextDate: next });
        }
        if (c.anniversary) {
          const next = nextOccurrence(c.anniversary);
          built.push({ contact: c, type: 'Anniversary', mmdd: c.anniversary, daysUntil: daysUntil(next), nextDate: next });
        }
      }
      built.sort((a, b) => a.daysUntil - b.daysUntil);
      setRows(built);
      if (contacts.length === 0) setSyncMsg('No contacts in DB yet — tap Sync.');
    } catch (err) {
      setSyncMsg(`Error loading contacts: ${String(err)}`);
    } finally {
      setFetching(false);
    }
  }

  async function handleDelete(contactId: string, field: 'birthday' | 'anniversary') {
    const key = `${contactId}:${field}`;
    if (confirmDelete !== key) { setConfirmDelete(key); return; }
    setConfirmDelete(null);
    if (!token) return;
    await fetch('/api/contacts', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: contactId, field }),
    });
    await fetchContacts();
  }

  async function handleSync() {
    setSyncing(true);
    try {
      if (!token) return;
      const res = await fetch('/api/contacts/sync', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json().catch(() => ({}));
      if (json.error) {
        setSyncMsg(`Error: ${json.error}`);
      } else {
        const pruned = json.pruned ?? 0;
        const base = `Synced ${json.synced ?? 0} contact${json.synced === 1 ? '' : 's'} with birthdays/anniversaries`;
        setSyncMsg(pruned > 0 ? `${base} · removed ${pruned}` : base);
      }
      await fetchContacts();
    } catch (err) {
      setSyncMsg(`Error: ${String(err)}`);
    } finally {
      setSyncing(false);
    }
  }

  const visible = rows.filter((r) =>
    filter === 'All' ? true :
    filter === 'Birthdays' ? r.type === 'Birthday' :
    r.type === 'Anniversary'
  );

  if (loading || !session) {
    return (
      <div className="min-h-screen bg-[#fafaf8] dark:bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fafaf8] dark:bg-[#0a0a0a]">
      <header className="sticky top-0 z-10 bg-[#fafaf8]/80 dark:bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-zinc-200/60 dark:border-zinc-800/60 px-4 py-3">
        <div className="max-w-xl mx-auto flex items-center gap-3">
          <button onClick={() => router.push('/folders')}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 className="flex-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Birthdays & Anniversaries</h1>
          <button onClick={handleSync} disabled={syncing}
            className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 disabled:opacity-40 transition-colors">
            {syncing ? 'Syncing…' : 'Sync'}
          </button>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 pt-4 pb-32 space-y-4">
        {/* Filter pills */}
        <div className="flex gap-2">
          {(['All', 'Birthdays', 'Anniversaries'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filter === f ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'}`}>
              {f}
            </button>
          ))}
        </div>

        {syncMsg && (
          <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center">{syncMsg}</p>
        )}

        {fetching && (
          <div className="flex justify-center pt-8">
            <div className="w-6 h-6 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 animate-spin" />
          </div>
        )}

        {!fetching && visible.length === 0 && (
          <div className="text-center pt-16 space-y-2">
            <p className="text-zinc-400 dark:text-zinc-600 text-sm">No {filter === 'All' ? 'birthdays or anniversaries' : filter.toLowerCase()} found.</p>
            <p className="text-zinc-300 dark:text-zinc-700 text-xs">Tap Sync to pull from iCloud Contacts.</p>
          </div>
        )}

        {!fetching && visible.length > 0 && (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
            {visible.map((row, i) => {
              const due = row.daysUntil;
              const urgency = due === 0 ? 'text-rose-500 dark:text-rose-400' : due <= 7 ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-400 dark:text-zinc-500';
              const [mm, dd] = row.mmdd.split('-');
              const monthDay = new Date(2000, parseInt(mm) - 1, parseInt(dd)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              const yearLabel = row.type === 'Birthday'
                ? row.contact.birth_year
                  ? ` · ${new Date().getFullYear() - row.contact.birth_year} yrs`
                  : ' · unknown'
                : '';
              const field = row.type === 'Birthday' ? 'birthday' : 'anniversary';
              const deleteKey = `${row.contact.id}:${field}`;
              const isPending = confirmDelete === deleteKey;
              return (
                <div key={i} className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-zinc-900">
                  <div className="shrink-0 w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-sm">
                    {row.type === 'Birthday' ? '🎂' : '💍'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{row.contact.full_name}</p>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">{row.type} · {monthDay}{yearLabel}</p>
                  </div>
                  <span className={`shrink-0 text-xs font-medium ${urgency}`}>
                    {due === 0 ? 'Today' : due === 1 ? 'Tomorrow' : due < 30 ? `${due}d` : `${Math.round(due / 30)}mo`}
                  </span>
                  <button
                    onClick={() => handleDelete(row.contact.id, field)}
                    onBlur={() => { if (isPending) setConfirmDelete(null); }}
                    className={`shrink-0 text-xs px-2 py-0.5 rounded transition-colors ${isPending ? 'text-rose-500 dark:text-rose-400 font-medium' : 'text-zinc-300 dark:text-zinc-600 hover:text-rose-400 dark:hover:text-rose-400'}`}>
                    {isPending ? 'Delete?' : '✕'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
