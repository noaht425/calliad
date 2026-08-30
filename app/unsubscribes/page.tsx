'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { BottomNav } from '@/components/BottomNav';
import { listUnsubscribes, createUnsubscribe, deleteUnsubscribe } from '@/lib/api';
import type { Unsubscribe } from '@/lib/types';

function deriveStatus(u: Unsubscribe): 'failed' | 'confirmed' | 'pending' {
  if (u.last_marketing_email_at) return 'failed';
  const days = Math.floor((Date.now() - new Date(u.unsubscribed_at).getTime()) / 86400000);
  return days >= 10 ? 'confirmed' : 'pending';
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso + (iso.length === 10 ? 'T12:00:00' : ''));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')).getTime()) / 86400000);
}

function StatusBadge({ u }: { u: Unsubscribe }) {
  const status = deriveStatus(u);
  const days = daysSince(u.unsubscribed_at);

  if (status === 'failed') {
    return (
      <div className="text-right shrink-0">
        <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/40">Failed</span>
        <p className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 mt-1">Received: {formatDate(u.last_marketing_email_at)}</p>
      </div>
    );
  }
  if (status === 'confirmed') {
    return (
      <div className="text-right shrink-0">
        <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40">Confirmed</span>
        <p className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 mt-1">{days} days clean</p>
      </div>
    );
  }
  return (
    <div className="text-right shrink-0">
      <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40">Pending</span>
      <p className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 mt-1">{days} of 10 days</p>
    </div>
  );
}

export default function UnsubscribesPage() {
  const { session, loading } = useAuth();
  const router = useRouter();

  const [items, setItems] = useState<Unsubscribe[]>([]);
  const [fetching, setFetching] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addDomain, setAddDomain] = useState('');
  const [addDate, setAddDate] = useState(new Date().toISOString().slice(0, 10));
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !session) router.push('/login');
  }, [loading, session, router]);

  useEffect(() => {
    if (!session) return;
    listUnsubscribes().then(setItems).finally(() => setFetching(false));
  }, [session]);

  const handleAdd = useCallback(async () => {
    if (!addName.trim() || !addDomain.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      const created = await createUnsubscribe({
        sender_name: addName.trim(),
        sender_domain: addDomain.trim(),
        unsubscribed_at: addDate,
      });
      setItems((prev) => [created, ...prev]);
      setShowAdd(false);
      setAddName('');
      setAddDomain('');
      setAddDate(new Date().toISOString().slice(0, 10));
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Failed to add');
    }
    setAdding(false);
  }, [addName, addDomain, addDate]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteUnsubscribe(id);
    setItems((prev) => prev.filter((u) => u.id !== id));
    setConfirmDeleteId(null);
  }, []);

  if (loading || !session) {
    return (
      <div className="min-h-screen bg-[#fafaf8] dark:bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 animate-spin" />
      </div>
    );
  }

  const failed = items.filter((u) => deriveStatus(u) === 'failed');
  const confirmed = items.filter((u) => deriveStatus(u) === 'confirmed');
  const pending = items.filter((u) => deriveStatus(u) === 'pending');

  return (
    <div className="min-h-screen bg-[#fafaf8] dark:bg-[#0a0a0a]">
      <header className="sticky top-0 z-10 bg-[#fafaf8]/80 dark:bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-zinc-200/60 dark:border-zinc-800/60 px-4 py-3">
        <div className="max-w-xl mx-auto flex items-center gap-3">
          <button onClick={() => router.push('/folders')} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors shrink-0">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 className="flex-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">Unsubscribes</h1>
          <button
            onClick={() => { setShowAdd(true); setAddError(null); }}
            className="text-[11px] font-mono text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 rounded-lg px-2.5 py-1 transition-colors"
          >
            + Add
          </button>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 pt-4 pb-32 space-y-6">

        {showAdd && (
          <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 space-y-3">
            <p className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest">Add unsubscribe</p>
            <input
              autoFocus
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="Publication name (e.g. The Kitchn)"
              className="w-full text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 outline-none focus:ring-1 focus:ring-emerald-400"
            />
            <input
              value={addDomain}
              onChange={(e) => setAddDomain(e.target.value)}
              placeholder="Sender domain (e.g. thekitchn.com)"
              className="w-full text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 outline-none focus:ring-1 focus:ring-emerald-400"
            />
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-mono text-zinc-400 shrink-0">Unsubscribed</label>
              <input
                type="date"
                value={addDate}
                onChange={(e) => setAddDate(e.target.value)}
                className="text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-2 py-1 text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-400"
              />
            </div>
            {addError && <p className="text-xs text-red-500">{addError}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleAdd}
                disabled={adding || !addName.trim() || !addDomain.trim()}
                className="text-xs font-mono text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 disabled:opacity-40 px-3 py-1.5 border border-emerald-200 dark:border-emerald-800/60 rounded-lg transition-colors"
              >
                {adding ? 'Adding…' : 'Add'}
              </button>
              <button
                onClick={() => setShowAdd(false)}
                className="text-xs font-mono text-zinc-400 hover:text-zinc-600 px-3 py-1.5 transition-colors"
              >
                Cancel
              </button>
            </div>
          </section>
        )}

        {fetching ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-sm text-zinc-400 dark:text-zinc-600">No unsubscribes tracked yet.</p>
            <p className="text-xs text-zinc-300 dark:text-zinc-700 mt-1">Calliad will detect them automatically, or tap + Add above.</p>
          </div>
        ) : (
          <>
            {failed.length > 0 && (
              <section>
                <h2 className="text-[10px] font-mono text-zinc-400 dark:text-zinc-600 uppercase tracking-widest mb-3">Failed · {failed.length}</h2>
                <UnsubscribeList items={failed} onDelete={(id) => setConfirmDeleteId(id)} confirmDeleteId={confirmDeleteId} onConfirmDelete={handleDelete} onCancelDelete={() => setConfirmDeleteId(null)} />
              </section>
            )}
            {pending.length > 0 && (
              <section>
                <h2 className="text-[10px] font-mono text-zinc-400 dark:text-zinc-600 uppercase tracking-widest mb-3">Pending · {pending.length}</h2>
                <UnsubscribeList items={pending} onDelete={(id) => setConfirmDeleteId(id)} confirmDeleteId={confirmDeleteId} onConfirmDelete={handleDelete} onCancelDelete={() => setConfirmDeleteId(null)} />
              </section>
            )}
            {confirmed.length > 0 && (
              <section>
                <h2 className="text-[10px] font-mono text-zinc-400 dark:text-zinc-600 uppercase tracking-widest mb-3">Confirmed · {confirmed.length}</h2>
                <UnsubscribeList items={confirmed} onDelete={(id) => setConfirmDeleteId(id)} confirmDeleteId={confirmDeleteId} onConfirmDelete={handleDelete} onCancelDelete={() => setConfirmDeleteId(null)} />
              </section>
            )}
          </>
        )}
      </main>
      <BottomNav />
    </div>
  );
}

function UnsubscribeList({
  items, onDelete, confirmDeleteId, onConfirmDelete, onCancelDelete,
}: {
  items: Unsubscribe[];
  onDelete: (id: string) => void;
  confirmDeleteId: string | null;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;
}) {
  return (
    <div className="space-y-2">
      {items.map((u) => (
        <div key={u.id} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3">
          {confirmDeleteId === u.id ? (
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-600 dark:text-zinc-400">Remove {u.sender_name}?</span>
              <div className="flex gap-2">
                <button onClick={onCancelDelete} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 px-2 py-1 transition-colors">Cancel</button>
                <button onClick={() => onConfirmDelete(u.id)} className="text-xs text-red-500 hover:text-red-600 dark:hover:text-red-400 font-medium px-2 py-1 transition-colors">Remove</button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{u.sender_name}</p>
                <p className="text-[11px] font-mono text-zinc-400 dark:text-zinc-500 truncate">{u.sender_domain}</p>
                <div className="flex gap-4 mt-1.5">
                  <div>
                    <p className="text-[9px] font-mono text-zinc-300 dark:text-zinc-700 uppercase tracking-wide">Unsubscribed</p>
                    <p className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400">{formatDate(u.unsubscribed_at)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-mono text-zinc-300 dark:text-zinc-700 uppercase tracking-wide">Last marketing email</p>
                    <p className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400">{formatDate(u.last_marketing_email_at)}</p>
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <StatusBadge u={u} />
                <button
                  onClick={() => onDelete(u.id)}
                  className="text-[10px] font-mono text-zinc-300 dark:text-zinc-700 hover:text-red-400 dark:hover:text-red-500 transition-colors"
                >
                  remove
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
