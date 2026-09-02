'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { BottomNav } from '@/components/BottomNav';
import { PageShell, PageHeader, PageBody } from '@/components/PageLayout';

export const dynamic = 'force-dynamic';

interface Note { id: string; content: string; kind: string; created_at: string; similarity?: number }

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function NotesPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [docTitle, setDocTitle] = useState('');
  const [docText, setDocText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');

  useEffect(() => { if (!loading && !session) router.push('/login'); }, [loading, session, router]);
  const h = useMemo(
    () => (session ? { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' } : null),
    [session],
  );

  const load = useCallback(async () => {
    if (!h) return;
    const r = await fetch('/api/notes', { headers: h });
    if (r.ok) { setNotes((await r.json()).items ?? []); setSearching(false); }
  }, [h]);
  useEffect(() => { void load(); }, [load]);

  const runSearch = async () => {
    if (!h) return;
    if (!q.trim()) { void load(); return; }
    setSearching(true);
    const r = await fetch(`/api/notes?q=${encodeURIComponent(q.trim())}`, { headers: h });
    if (r.ok) setNotes((await r.json()).items ?? []);
  };

  const add = async () => {
    if (!h || !draft.trim()) return;
    await fetch('/api/notes', { method: 'POST', headers: h, body: JSON.stringify({ content: draft.trim() }) });
    setDraft(''); setQ(''); void load();
  };
  const del = async (id: string) => {
    if (!h) return;
    await fetch(`/api/notes?id=${id}`, { method: 'DELETE', headers: h });
    setNotes((n) => n.filter((x) => x.id !== id));
  };

  const ingestPaste = async () => {
    if (!session || !docText.trim()) return;
    setUploading(true); setUploadMsg('');
    const r = await fetch('/api/notes/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: docTitle.trim() || 'Untitled', text: docText }),
    });
    const j = await r.json().catch(() => ({}));
    setUploading(false);
    if (r.ok) { setUploadMsg(`Added — ${j.chunks} chunk${j.chunks === 1 ? '' : 's'}.`); setDocText(''); setDocTitle(''); void load(); }
    else setUploadMsg(j.error ?? 'Failed.');
  };

  const ingestFile = async (file: File) => {
    if (!session) return;
    setUploading(true); setUploadMsg('');
    const fd = new FormData();
    fd.append('file', file);
    if (docTitle.trim()) fd.append('title', docTitle.trim());
    const r = await fetch('/api/notes/upload', {
      method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` }, body: fd,
    });
    const j = await r.json().catch(() => ({}));
    setUploading(false);
    if (r.ok) { setUploadMsg(`${j.title} — ${j.chunks} chunk${j.chunks === 1 ? '' : 's'}.`); setDocTitle(''); void load(); }
    else setUploadMsg(j.error ?? 'Failed.');
  };

  return (
    <PageShell>
      <PageHeader title="Notes" count={!searching && notes.length ? notes.length : undefined} />
      <PageBody className="px-4 pt-2">
        <div className="max-w-xl mx-auto pb-4">
          <p className="text-[13px] mb-3" style={{ color: 'var(--text-muted)' }}>
            Anything you tell Calliad with &ldquo;note that&hellip;&rdquo; or &ldquo;jot this down&rdquo; lands here and
            is searchable later by meaning &mdash; ask &ldquo;what did I say about X&rdquo;.
          </p>

          <div className="rounded-xl p-3 mb-3 space-y-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void add(); }}
              placeholder="Write a note…"
              rows={2}
              className="w-full resize-none rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--paper)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
            <button
              onClick={() => void add()}
              disabled={!draft.trim()}
              className="w-full rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-40"
              style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
            >
              Save note
            </button>
          </div>

          <details className="rounded-xl mb-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <summary className="px-3 py-2 text-sm cursor-pointer" style={{ color: 'var(--text-muted)' }}>
              Import a document
            </summary>
            <div className="px-3 pb-3 space-y-2">
              <input
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                placeholder="Title (optional)"
                className="w-full rounded-lg px-3 py-1.5 text-sm outline-none"
                style={{ background: 'var(--paper)', border: '1px solid var(--border)', color: 'var(--text)' }}
              />
              <textarea
                value={docText}
                onChange={(e) => setDocText(e.target.value)}
                placeholder="Paste text here…"
                rows={3}
                className="w-full resize-none rounded-lg px-3 py-2 text-sm outline-none"
                style={{ background: 'var(--paper)', border: '1px solid var(--border)', color: 'var(--text)' }}
              />
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => void ingestPaste()}
                  disabled={uploading || !docText.trim()}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-40"
                  style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
                >
                  {uploading ? 'Working…' : 'Import pasted text'}
                </button>
                <label className="text-sm underline cursor-pointer" style={{ color: 'var(--text-muted)' }}>
                  or pick a file (.txt .md .pdf)
                  <input
                    type="file"
                    accept=".txt,.md,.markdown,text/plain,application/pdf"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void ingestFile(f); e.target.value = ''; }}
                  />
                </label>
              </div>
              {uploadMsg && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{uploadMsg}</p>}
            </div>
          </details>

          <div className="flex gap-2 mb-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void runSearch(); }}
              placeholder="Search by meaning…"
              className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
            <button
              onClick={() => void runSearch()}
              className="shrink-0 rounded-lg px-3 text-sm"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
            >
              {searching ? 'clear' : 'search'}
            </button>
          </div>

          {notes.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {searching ? 'No matches.' : 'No notes yet.'}
            </p>
          )}

          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="rounded-xl p-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text)' }}>{n.content}</p>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {fmt(n.created_at)}
                    {n.similarity ? ` · ${Math.round(n.similarity * 100)}% match` : ''}
                  </span>
                  <button className="text-xs underline" style={{ color: '#dc2626' }} onClick={() => del(n.id)}>delete</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </PageBody>
      <BottomNav />
    </PageShell>
  );
}
