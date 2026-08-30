'use client';
import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { BottomNav } from '@/components/BottomNav';
import type { ParsedContact } from '@/lib/vcard-parse';

interface FamilyMember {
  id: string;
  name: string;
  email?: string | null;
  location_city?: string | null;
  birthday?: string | null;   // MM-DD
  anniversary?: string | null; // MM-DD
  birth_year?: number | null;
  notes?: string | null;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatBirthday(mmdd: string | null | undefined, year: number | null | undefined): string {
  if (!mmdd) return '';
  const [mm, dd] = mmdd.split('-').map(Number);
  const month = MONTHS[mm - 1] ?? '';
  return year ? `${month} ${dd}, ${year}` : `${month} ${dd}`;
}

function daysUntil(mmdd: string): number {
  const [mm, dd] = mmdd.split('-').map(Number);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  let next = new Date(now.getFullYear(), mm - 1, dd);
  if (next < now) next = new Date(now.getFullYear() + 1, mm - 1, dd);
  return Math.round((next.getTime() - now.getTime()) / 86400000);
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const fieldClass = 'w-full px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none focus:border-zinc-400 dark:focus:border-zinc-600 transition-colors';

function MemberForm({ draft, onChange, onSubmit, onCancel, submitLabel, saving }: {
  draft: Partial<FamilyMember>;
  onChange: (v: Partial<FamilyMember>) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
  saving: boolean;
}) {
  return (
    <div className="p-4 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-3">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Name</label>
        <input className={fieldClass} value={draft.name ?? ''} onChange={(e) => onChange({ ...draft, name: e.target.value })} placeholder="Mom, Dad, Sarah…" />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Birthday MM-DD (optional)</label>
        <input className={fieldClass} value={draft.birthday ?? ''} onChange={(e) => onChange({ ...draft, birthday: e.target.value || null })} placeholder="08-15" maxLength={5} />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Birth year (optional)</label>
        <input className={fieldClass} type="number" value={draft.birth_year ?? ''} onChange={(e) => onChange({ ...draft, birth_year: e.target.value ? parseInt(e.target.value) : null })} placeholder="1975" />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Email (optional)</label>
        <input className={fieldClass} type="email" value={draft.email ?? ''} onChange={(e) => onChange({ ...draft, email: e.target.value || null })} placeholder="mom@example.com" />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">City (optional)</label>
        <input className={fieldClass} value={draft.location_city ?? ''} onChange={(e) => onChange({ ...draft, location_city: e.target.value || null })} placeholder="Portland, OR" />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Notes (optional)</label>
        <input className={fieldClass} value={draft.notes ?? ''} onChange={(e) => onChange({ ...draft, notes: e.target.value || null })} placeholder="Prefers texts, allergic to…" />
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={onSubmit} disabled={saving} className="flex-1 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium disabled:opacity-40">{submitLabel}</button>
        <button onClick={onCancel} className="flex-1 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-sm">Cancel</button>
      </div>
    </div>
  );
}

export default function FamilyPage() {
  return <Suspense><FamilyInner /></Suspense>;
}

function FamilyInner() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [search, setSearch] = useState('');
  const [fetching, setFetching] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<FamilyMember>>({});
  const [adding, setAdding] = useState(false);
  const [newMember, setNewMember] = useState<Partial<FamilyMember>>({});
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<'all' | 'birthday' | 'upcoming'>('all');

  // Contact import state (from Share Sheet)
  const [importContact, setImportContact] = useState<ParsedContact | null>(null);
  const [importMatch, setImportMatch] = useState<FamilyMember | null>(null);
  const [importMerge, setImportMerge] = useState<Partial<FamilyMember>>({});
  const [importSaving, setImportSaving] = useState(false);

  // iCloud contact browser
  const [browsing, setBrowsing] = useState(false);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseContacts, setBrowseContacts] = useState<ParsedContact[]>([]);
  const [browseSearch, setBrowseSearch] = useState('');

  useEffect(() => {
    if (!loading && !session) router.push('/login');
  }, [loading, session, router]);

  const load = useCallback(async () => {
    const headers = await authHeaders();
    setFetching(true);
    try {
      const res = await fetch('/api/family?relationship=family', { headers });
      if (res.ok) setMembers(await res.json());
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => { if (session) load(); }, [session, load]);

  // Parse ?import= param once members are loaded
  useEffect(() => {
    const encoded = searchParams.get('import');
    if (!encoded || fetching) return;
    try {
      const contact: ParsedContact = JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')));
      setImportContact(contact);
      const normName = contact.name.toLowerCase().trim();
      const match = members.find((m) => m.name.toLowerCase().trim() === normName) ?? null;
      setImportMatch(match);
      const merged: Partial<FamilyMember> = {
        name: contact.name || match?.name,
        birthday: contact.birthday || match?.birthday,
        birth_year: contact.birth_year ?? match?.birth_year,
        anniversary: contact.anniversary || match?.anniversary,
        email: contact.email || match?.email,
        location_city: contact.location_city || match?.location_city,
        notes: contact.notes || match?.notes,
      };
      setImportMerge(merged);
    } catch {
      // malformed param — ignore
    }
  }, [searchParams, members, fetching]);

  async function openBrowse() {
    setBrowsing(true);
    setBrowseSearch('');
    if (browseContacts.length === 0) {
      setBrowseLoading(true);
      const headers = await authHeaders();
      try {
        const res = await fetch('/api/contacts/browse', { headers });
        if (res.ok) setBrowseContacts(await res.json());
      } finally {
        setBrowseLoading(false);
      }
    }
  }

  async function addFromBrowse(contact: ParsedContact) {
    const normName = contact.name.toLowerCase().trim();
    const match = members.find((m) => m.name.toLowerCase().trim() === normName) ?? null;
    setBrowsing(false);
    setImportContact(contact);
    setImportMatch(match);
    setImportMerge({
      name: contact.name || match?.name,
      birthday: contact.birthday || match?.birthday,
      birth_year: contact.birth_year ?? match?.birth_year,
      anniversary: contact.anniversary || match?.anniversary,
      email: contact.email || match?.email,
      location_city: contact.location_city || match?.location_city,
      notes: contact.notes || match?.notes,
    });
  }

  function dismissImport() {
    setImportContact(null);
    setImportMatch(null);
    setImportMerge({});
    const url = new URL(window.location.href);
    url.searchParams.delete('import');
    window.history.replaceState({}, '', url.toString());
  }

  async function confirmImport() {
    if (!importContact) return;
    setImportSaving(true);
    const headers = { ...(await authHeaders()), 'Content-Type': 'application/json' };
    if (importMatch) {
      await fetch(`/api/family/${importMatch.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(importMerge),
      });
    } else {
      await fetch('/api/family', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...importMerge, relationship: 'family' }),
      });
    }
    setImportSaving(false);
    dismissImport();
    load();
  }

  async function addMember() {
    if (!newMember.name?.trim()) return;
    setSaving(true);
    const headers = { ...(await authHeaders()), 'Content-Type': 'application/json' };
    const res = await fetch('/api/family', {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...newMember, relationship: 'family' }),
    });
    if (res.ok) {
      setNewMember({});
      setAdding(false);
      load();
    }
    setSaving(false);
  }

  async function saveMember() {
    if (!editingId) return;
    setSaving(true);
    const headers = { ...(await authHeaders()), 'Content-Type': 'application/json' };
    const res = await fetch(`/api/family/${editingId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(editDraft),
    });
    if (res.ok) {
      setEditingId(null);
      setEditDraft({});
      load();
    }
    setSaving(false);
  }

  async function removeMember(id: string) {
    const headers = await authHeaders();
    await fetch(`/api/family/${id}`, { method: 'DELETE', headers });
    setMembers((m) => m.filter((mem) => mem.id !== id));
  }

  const upcomingDays = 30;
  const filtered = members.filter((m) => {
    if (search) {
      const q = search.toLowerCase();
      if (!m.name.toLowerCase().includes(q) && !(m.location_city ?? '').toLowerCase().includes(q)) return false;
    }
    if (filter === 'birthday') return !!m.birthday;
    if (filter === 'upcoming') {
      if (!m.birthday) return false;
      return daysUntil(m.birthday) <= upcomingDays;
    }
    return true;
  });

  if (loading || !session) {
    return (
      <div className="min-h-screen bg-[#fafaf8] dark:bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 animate-spin" />
      </div>
    );
  }

  function ImportCard({ contact, match, merge, onMergeChange, onConfirm, onDismiss, saving: isSaving }: {
    contact: ParsedContact;
    match: FamilyMember | null;
    merge: Partial<FamilyMember>;
    onMergeChange: (v: Partial<FamilyMember>) => void;
    onConfirm: () => void;
    onDismiss: () => void;
    saving: boolean;
  }) {
    type Field = { key: keyof FamilyMember; label: string; existing: string | null; incoming: string | null };
    const fields: Field[] = [
      { key: 'birthday',      label: 'Birthday',     existing: match?.birthday ?? null,      incoming: contact.birthday },
      { key: 'birth_year',    label: 'Birth year',   existing: match?.birth_year?.toString() ?? null, incoming: contact.birth_year?.toString() ?? null },
      { key: 'email',         label: 'Email',        existing: match?.email ?? null,          incoming: contact.email },
      { key: 'location_city', label: 'City',         existing: match?.location_city ?? null,  incoming: contact.location_city },
      { key: 'anniversary',   label: 'Anniversary',  existing: match?.anniversary ?? null,    incoming: contact.anniversary },
      { key: 'notes',         label: 'Notes',        existing: match?.notes ?? null,          incoming: contact.notes },
    ].filter((f) => f.existing || f.incoming) as Field[];

    const conflicts = fields.filter((f) => f.existing && f.incoming && f.existing !== f.incoming);
    const additions = fields.filter((f) => !f.existing && f.incoming);

    return (
      <div className="bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded-xl p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {match ? `Merge with existing entry` : `Add to Family`}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              {contact.name}{match && match.name !== contact.name ? ` → matches "${match.name}"` : ''}
            </p>
          </div>
          <button onClick={onDismiss} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors shrink-0">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {additions.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] font-mono text-zinc-400 dark:text-zinc-600 uppercase tracking-wide">Adding</p>
            {additions.map((f) => (
              <p key={f.key} className="text-xs text-zinc-600 dark:text-zinc-400">
                <span className="font-medium text-zinc-500 dark:text-zinc-500">{f.label}:</span>{' '}{f.incoming}
              </p>
            ))}
          </div>
        )}

        {conflicts.length > 0 && (
          <div className="space-y-3">
            <p className="text-[10px] font-mono text-zinc-400 dark:text-zinc-600 uppercase tracking-wide">Conflicts — pick one</p>
            {conflicts.map((f) => {
              const current = (merge[f.key] as string | number | null)?.toString() ?? '';
              return (
                <div key={f.key} className="space-y-1">
                  <p className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">{f.label}</p>
                  <div className="flex gap-2">
                    {([f.existing, f.incoming] as string[]).map((val, i) => (
                      <button
                        key={i}
                        onClick={() => onMergeChange({ ...merge, [f.key]: f.key === 'birth_year' ? parseInt(val) : val })}
                        className={`flex-1 px-3 py-2 rounded-lg text-xs text-left transition-colors border ${
                          current === val
                            ? 'border-violet-400 dark:border-violet-500 bg-violet-100 dark:bg-violet-900/40 text-zinc-900 dark:text-zinc-100 font-medium'
                            : 'border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-700'
                        }`}
                      >
                        <span className="block text-[9px] uppercase tracking-wide text-zinc-400 dark:text-zinc-600 mb-0.5">{i === 0 ? 'Existing' : 'Incoming'}</span>
                        {val}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!match && additions.length === 0 && conflicts.length === 0 && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">No new information to add — already up to date.</p>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={onConfirm} disabled={isSaving} className="flex-1 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium disabled:opacity-40">
            {isSaving ? 'Saving…' : match ? 'Merge' : 'Add to Family'}
          </button>
          <button onClick={onDismiss} className="flex-1 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-sm">
            Skip
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fafaf8] dark:bg-[#0a0a0a]">
      <header className="sticky top-0 z-10 bg-[#fafaf8]/80 dark:bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-zinc-200/60 dark:border-zinc-800/60 px-4 py-3">
        <div className="max-w-xl mx-auto space-y-3">
          <div className="flex items-center gap-3">
            <button onClick={() => router.back()} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex-1">Family</h1>
            <span className="text-[11px] font-mono text-zinc-400 dark:text-zinc-600">{members.length}</span>
            <button onClick={openBrowse} className="text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">
              iCloud
            </button>
            <button onClick={() => { setAdding(true); setNewMember({}); }} className="text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors flex items-center gap-1">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add
            </button>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <input
                type="search"
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-transparent text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none"
              />
            </div>
            {(['all', 'birthday', 'upcoming'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`text-[11px] font-medium px-2.5 py-1.5 rounded-lg transition-colors ${filter === f ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'}`}>
                {f === 'all' ? 'All' : f === 'birthday' ? '🎂' : '30d'}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 pt-4 pb-32 space-y-2">
        {importContact && (
          <ImportCard
            contact={importContact}
            match={importMatch}
            merge={importMerge}
            onMergeChange={setImportMerge}
            onConfirm={confirmImport}
            onDismiss={dismissImport}
            saving={importSaving}
          />
        )}

        {adding && (
          <MemberForm
            draft={newMember}
            onChange={setNewMember}
            onSubmit={addMember}
            onCancel={() => { setAdding(false); setNewMember({}); }}
            submitLabel={saving ? 'Adding…' : 'Add family member'}
            saving={saving}
          />
        )}

        {fetching ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-zinc-400 dark:text-zinc-600 text-sm py-12">
            {search ? 'No matches.' : 'No family members yet — tap Add or iCloud.'}
          </p>
        ) : (
          filtered.map((m) => {
            const isExpanded = expandedId === m.id;
            const isEditing = editingId === m.id;
            const days = m.birthday ? daysUntil(m.birthday) : null;
            const soon = days !== null && days <= 14;

            if (isEditing) {
              return (
                <MemberForm
                  key={m.id}
                  draft={editDraft}
                  onChange={setEditDraft}
                  onSubmit={saveMember}
                  onCancel={() => { setEditingId(null); setEditDraft({}); }}
                  submitLabel={saving ? 'Saving…' : 'Save'}
                  saving={saving}
                />
              );
            }

            const hasDetails = !!(m.email || m.anniversary || m.notes);

            return (
              <div key={m.id} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                <div className="px-4 py-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                    {m.name.charAt(0).toUpperCase()}
                  </div>
                  <button
                    onClick={() => hasDetails && setExpandedId(isExpanded ? null : m.id)}
                    className={`flex-1 min-w-0 text-left ${hasDetails ? 'cursor-pointer' : 'cursor-default'}`}
                  >
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{m.name}</p>
                    {m.birthday && (
                      <p className={`text-[11px] font-mono ${soon ? 'text-rose-500 dark:text-rose-400' : 'text-zinc-400 dark:text-zinc-500'}`}>
                        {formatBirthday(m.birthday, m.birth_year)}
                        {days !== null && days <= 30 && (
                          <span className="ml-1.5">
                            {days === 0 ? '🎂 today!' : days === 1 ? 'tomorrow' : `in ${days}d`}
                          </span>
                        )}
                      </p>
                    )}
                  </button>
                  {m.location_city && (
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-600 shrink-0 hidden sm:block">{m.location_city}</span>
                  )}
                  <button
                    onClick={() => { setEditingId(m.id); setEditDraft({ name: m.name, email: m.email, location_city: m.location_city, birthday: m.birthday, birth_year: m.birth_year, anniversary: m.anniversary, notes: m.notes }); setExpandedId(null); }}
                    className="text-zinc-300 hover:text-zinc-600 dark:text-zinc-700 dark:hover:text-zinc-300 transition-colors shrink-0 p-1"
                    title="Edit"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => removeMember(m.id)}
                    className="text-zinc-200 hover:text-red-400 dark:text-zinc-800 dark:hover:text-red-500 transition-colors shrink-0 p-1"
                    title="Remove"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                    </svg>
                  </button>
                </div>

                {isExpanded && hasDetails && (
                  <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-3 space-y-1.5">
                    {m.email && <p className="text-xs text-zinc-500 dark:text-zinc-400">{m.email}</p>}
                    {m.anniversary && <p className="text-xs text-zinc-500 dark:text-zinc-400">Anniversary: {formatBirthday(m.anniversary, null)}</p>}
                    {m.notes && <p className="text-xs text-zinc-500 dark:text-zinc-400 italic">{m.notes}</p>}
                  </div>
                )}
              </div>
            );
          })
        )}
      </main>

      {/* iCloud contact picker */}
      {browsing && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setBrowsing(false)} />
          <div className="relative bg-white dark:bg-zinc-950 rounded-t-2xl flex flex-col max-h-[80vh]">
            <div className="px-4 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800 space-y-3 shrink-0">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Add from iCloud</p>
                <button onClick={() => setBrowsing(false)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                </svg>
                <input
                  type="search"
                  placeholder="Search contacts…"
                  value={browseSearch}
                  onChange={(e) => setBrowseSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-transparent text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none"
                  autoFocus
                />
              </div>
            </div>
            <div className="overflow-y-auto flex-1">
              {browseLoading ? (
                <div className="flex justify-center py-10">
                  <div className="w-6 h-6 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 animate-spin" />
                </div>
              ) : (() => {
                const existingNames = new Set(members.map((m) => m.name.toLowerCase().trim()));
                const q = browseSearch.toLowerCase();
                const visible = browseContacts.filter((c) =>
                  !q || c.name.toLowerCase().includes(q) || (c.location_city ?? '').toLowerCase().includes(q)
                );
                if (visible.length === 0) {
                  return <p className="text-center text-zinc-400 text-sm py-10">{browseSearch ? 'No matches.' : 'No contacts found.'}</p>;
                }
                return (
                  <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {visible.map((c, i) => {
                      const already = existingNames.has(c.name.toLowerCase().trim());
                      return (
                        <li key={c.external_id ?? i}>
                          <button
                            onClick={() => addFromBrowse(c)}
                            className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
                          >
                            <div className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                              {c.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{c.name}</p>
                              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate">
                                {[c.location_city, c.birthday ? formatBirthday(c.birthday, c.birth_year) : null].filter(Boolean).join(' · ')}
                              </p>
                            </div>
                            {already && (
                              <svg className="w-4 h-4 text-emerald-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
