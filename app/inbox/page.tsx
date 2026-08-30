'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { InboxCard } from '@/components/InboxCard';
import { BottomNav } from '@/components/BottomNav';
import { uploadCapture, triggerTranscription, listCaptures, updateCapture, deleteCapture, listFolders, fileCapture, fileCaptureToTrip, sendChatMessage, confirmProjectSuggestion, listTrips } from '@/lib/api';
import { enqueue, getPendingQueue, markSynced } from '@/lib/db';
import type { Capture, Folder, Trip } from '@/lib/types';
import { v4 as uuid } from 'uuid';
import type { CaptureStartEvent, CaptureDoneEvent, PhotoDoneEvent } from '@/components/GlobalCaptureBar';

export default function Home() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [chatText, setChatText] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<{ id: string; label: string; type?: 'action' | 'curation' } | null>(null);
  const [resolvedActionCards, setResolvedActionCards] = useState<Map<string, { replyText: string; ackText: string }>>(new Map());
  const [overdueTodos, setOverdueTodos] = useState<{ id: string; summary: string }[]>([]);
  const [overdueDismissed, setOverdueDismissed] = useState(false);

  useEffect(() => {
    if (!loading && !session) router.push('/login');
  }, [loading, session, router]);

  const refreshInbox = useCallback(async () => {
    try {
      const [data, projs, tripData] = await Promise.all([listCaptures('inbox'), listFolders(), listTrips()]);
      setCaptures(data);
      setFolders(projs);
      setTrips(tripData);
    } catch {}
  }, []);

  const checkOverdueTodos = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch('/api/todos', { headers: { Authorization: `Bearer ${session.access_token}` } });
      if (!res.ok) return;
      const todos = await res.json() as { id: string; summary: string; metadata: Record<string, unknown> | null }[];
      const today = new Date().toISOString().slice(0, 10);
      const overdue = todos.filter((t) => {
        const ra = t.metadata?.remind_at as string | undefined;
        return ra && ra.slice(0, 10) <= today;
      });
      setOverdueTodos(overdue.map((t) => ({ id: t.id, summary: t.summary })));
    } catch {}
  }, [session]);

  useEffect(() => {
    if (session) { refreshInbox(); checkOverdueTodos(); }
  }, [session, refreshInbox, checkOverdueTodos]);



  // Sync offline queue when back online
  useEffect(() => {
    if (!session) return;
    async function syncQueue() {
      const pending = await getPendingQueue();
      for (const item of pending) {
        try {
          const capture = await uploadCapture(item.audio_blob, item.source, undefined);
          await markSynced(item.local_id);
          triggerTranscription(capture.id).then(() => refreshInbox());
          refreshInbox();
        } catch {}
      }
    }
    window.addEventListener('online', syncQueue);
    syncQueue();
    return () => window.removeEventListener('online', syncQueue);
  }, [session, refreshInbox]);

  // Listen for captures from GlobalCaptureBar (works from any tab)
  useEffect(() => {
    const onStart = (e: Event) => {
      const { placeholder } = (e as CaptureStartEvent).detail;
      setCaptures((prev) => [placeholder, ...prev.filter((c) => c.id !== placeholder.id)]);
    };
    const onDone = (e: Event) => {
      const { capture } = (e as CaptureDoneEvent).detail;
      setCaptures((prev) => prev.map((c) => c.id === capture.id ? capture : c).filter((c) => {
        // Keep only if it belongs in inbox (todo flow may have archived it)
        return c.id !== capture.id || capture.status === 'inbox';
      }));
    };
    const onDeleted = (e: Event) => {
      const { captureId } = (e as CustomEvent<{ captureId: string }>).detail;
      setCaptures((prev) => prev.filter((c) => c.id !== captureId));
    };
    const onPhoto = (e: Event) => {
      const { photoCap, actionCard } = (e as PhotoDoneEvent).detail;
      setCaptures((prev) => [actionCard, photoCap, ...prev]);
    };
    window.addEventListener('calliad:capture-start', onStart);
    window.addEventListener('calliad:capture-done', onDone);
    window.addEventListener('calliad:capture-deleted', onDeleted);
    window.addEventListener('calliad:photo-done', onPhoto);
    return () => {
      window.removeEventListener('calliad:capture-start', onStart);
      window.removeEventListener('calliad:capture-done', onDone);
      window.removeEventListener('calliad:capture-deleted', onDeleted);
      window.removeEventListener('calliad:photo-done', onPhoto);
    };
  }, []);

  const handleCalendarConfirm = useCallback(async (id: string, data: {
    title: string; start_at: string; end_at?: string | null; all_day?: boolean;
    location?: string | null; description?: string | null; calendar_url?: string;
  }) => {
    if (!session) return;
    setCaptures((prev) => prev.filter((c) => c.id !== id));
    try {
      await fetch('/api/calendar/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ capture_id: id, ...data }),
      });
    } catch {
      refreshInbox();
    }
  }, [session, refreshInbox]);

  const handleRetry = useCallback(async (id: string) => {
    setCaptures((prev) => prev.map((c) => c.id === id ? { ...c, transcription_status: 'processing' } : c));
    try {
      const result = await triggerTranscription(id);
      if ('deleted' in result) {
        setCaptures((prev) => prev.filter((c) => c.id !== id));
      } else {
        setCaptures((prev) => prev.map((c) => c.id === result.id ? result : c));
      }
    } catch {
      setCaptures((prev) => prev.map((c) => c.id === id ? { ...c, transcription_status: 'error' } : c));
    }
  }, []);

  const handleArchive = useCallback(async (id: string) => {
    setCaptures((prev) => prev.filter((c) => c.id !== id));
    try {
      await updateCapture(id, { status: 'archived' });
    } catch {
      refreshInbox();
    }
  }, [refreshInbox]);

  const handleDelete = useCallback(async (id: string) => {
    setCaptures((prev) => prev.filter((c) => c.id !== id));
    try {
      await deleteCapture(id);
    } catch {
      refreshInbox();
    }
  }, [refreshInbox]);

  const applyChatResult = useCallback((
    actionCardId: string | undefined,
    userCapture: import('@/lib/types').Capture,
    assistantCapture: import('@/lib/types').Capture,
    curationResolved?: boolean,
    updatedCurationCard?: import('@/lib/types').Capture
  ) => {
    setCaptures((prev) => {
      let base = prev;
      if (actionCardId) {
        const isCuration = curationResolved !== undefined;
        if (!isCuration || curationResolved) {
          // Standard action card or resolved curation card — remove it
          base = prev.filter((c) => c.id !== actionCardId);
        } else if (updatedCurationCard) {
          // Mid-conversation curation — replace card in place with updated metadata
          base = prev.map((c) => (c.id === actionCardId ? updatedCurationCard : c));
        }
      }
      // Only show captures that belong in inbox — archived ones (completed actions) are excluded
      const toShow = [assistantCapture, userCapture].filter((c) => c.status !== 'archived');
      return [...toShow, ...base.filter((c) => c.id !== userCapture.id && c.id !== assistantCapture.id)];
    });
  }, []);

  const handleResolvedArchive = useCallback((id: string) => {
    setCaptures((prev) => prev.filter((c) => c.id !== id));
    setResolvedActionCards((prev) => { const next = new Map(prev); next.delete(id); return next; });
  }, []);

  const handleChat = useCallback(async () => {
    const text = chatText.trim();
    if (!text || chatSending) return;
    const actionCardId = replyingTo?.id;
    const isStandardActionCard = replyingTo?.type === 'action';
    setChatText('');
    setReplyingTo(null);
    setChatSending(true);
    setChatError(null);
    try {
      const { userCapture, assistantCapture, curationResolved, updatedCurationCard } = await sendChatMessage(text, actionCardId);
      if (isStandardActionCard && actionCardId) {
        // Keep the action card visible as a resolved thread; remove its paired captures
        setCaptures((prev) => prev.filter((c) => c.id !== assistantCapture?.id && c.id !== userCapture?.id));
        setResolvedActionCards((prev) => {
          const next = new Map(prev);
          next.set(actionCardId, { replyText: text, ackText: assistantCapture?.transcript ?? '' });
          return next;
        });
      } else {
        applyChatResult(actionCardId, userCapture, assistantCapture, curationResolved, updatedCurationCard);
      }
    } catch (err) {
      console.error('Chat failed:', err);
      setChatError('Something went wrong — please try again.');
    } finally {
      setChatSending(false);
    }
  }, [chatText, chatSending, replyingTo, applyChatResult]);

  const handleReply = useCallback((id: string, label: string) => {
    const card = captures.find((c) => c.id === id);
    const isCuration = (card?.metadata as Record<string, unknown> | null)?.action_type === 'curation';
    setReplyingTo({ id, label, type: isCuration ? 'curation' : 'action' });
    document.getElementById('chat-input')?.focus();
  }, [captures]);

  const handleCurationAnswer = useCallback(async (cardId: string, answer: string) => {
    if (chatSending) return;
    setChatSending(true);
    try {
      const { userCapture, assistantCapture, curationResolved, updatedCurationCard } = await sendChatMessage(answer, cardId);
      applyChatResult(cardId, userCapture, assistantCapture, curationResolved, updatedCurationCard);
    } catch (err) {
      console.error('Curation answer failed:', err);
    } finally {
      setChatSending(false);
    }
  }, [chatSending, applyChatResult]);

  const handleCurationDismiss = useCallback((cardId: string, _mode: 'skip' | 'remind') => {
    // Both modes archive the card; the detector re-surfaces it next sync if anomaly persists
    setCaptures((prev) => prev.filter((c) => c.id !== cardId));
    updateCapture(cardId, { status: 'archived' }).catch(() => {});
  }, []);

  const handleFile = useCallback(async (captureId: string, projectId: string) => {
    setCaptures((prev) => prev.filter((c) => c.id !== captureId));
    try {
      await fileCapture(captureId, projectId);
    } catch {
      refreshInbox();
    }
  }, [refreshInbox]);

  const handleFileToTrip = useCallback(async (captureId: string, tripId: string) => {
    setCaptures((prev) => prev.filter((c) => c.id !== captureId));
    try {
      await fileCaptureToTrip(captureId, tripId);
    } catch {
      refreshInbox();
    }
  }, [refreshInbox]);

  const handleProjectSuggestionConfirm = useCallback(async (captureId: string) => {
    setCaptures((prev) => prev.filter((c) => c.id !== captureId));
    try {
      await confirmProjectSuggestion(captureId);
    } catch {
      refreshInbox();
    }
  }, [refreshInbox]);

  const handleSendToAbentfork = useCallback(async (captureId: string) => {
    if (!session?.access_token) return;
    try {
      await fetch('/api/abentfork/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ capture_id: captureId }),
      });
    } catch {
      // fire-and-forget; errors are silent since the endpoint is optional
    }
  }, [session?.access_token]);

  const filtered = captures;

  // Pair assistant responses with their source chat capture for merged card rendering
  const pairedResponseMap = new Map<string, Capture>();
  const pairedAssistantIds = new Set<string>();
  const filteredIds = new Set(filtered.map((c) => c.id));
  for (const c of filtered) {
    if (c.source === 'assistant') {
      const meta = (c.metadata ?? {}) as Record<string, unknown>;
      const userCaptureId = meta.user_capture_id as string | undefined;
      // Only pair if the user capture is also visible — if it's archived (e.g. action
      // card reply), show the assistant capture as a standalone card instead.
      if (userCaptureId && filteredIds.has(userCaptureId)) {
        pairedResponseMap.set(userCaptureId, c);
        pairedAssistantIds.add(c.id);
      }
    }
  }
  const displayCaptures = filtered.filter((c) => !pairedAssistantIds.has(c.id));

  if (loading || !session) {
    return (
      <div className="min-h-screen bg-[#fafaf8] dark:bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fafaf8] dark:bg-[#0a0a0a]">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-[#fafaf8]/80 dark:bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-zinc-200/60 dark:border-zinc-800/60 px-4 py-3">
        <div className="max-w-xl mx-auto flex items-center gap-3">
          <div className="flex-1 relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="search"
              placeholder="Search everything…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && searchQuery.trim()) router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`); }}
              onFocus={() => { if (searchQuery.trim()) router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`); }}
              className="w-full pl-9 pr-8 py-2 text-sm rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-transparent focus:border-zinc-300 dark:focus:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none transition-colors"
            />
          </div>
          <span className="text-xs font-mono text-zinc-400 dark:text-zinc-600 shrink-0">
            {captures.length > 0 ? `${captures.length} in inbox` : ''}
          </span>
        </div>
      </header>

      {/* Inbox */}
      <main className="max-w-xl mx-auto px-4 pt-4 pb-56 space-y-3">
        {!overdueDismissed && overdueTodos.length > 0 && (
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl px-4 py-3 flex items-start gap-3">
            <svg className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                {overdueTodos.length === 1 ? '1 overdue task' : `${overdueTodos.length} overdue tasks`}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5 line-clamp-2">
                {overdueTodos.map((t) => t.summary).join(' · ')}
              </p>
            </div>
            <button
              onClick={() => setOverdueDismissed(true)}
              className="text-amber-400 hover:text-amber-600 dark:hover:text-amber-300 transition-colors shrink-0"
              aria-label="Dismiss"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        {filtered.length === 0 && (
          <div className="text-center pt-16 pb-8 space-y-2">
            <p className="text-zinc-400 dark:text-zinc-600 text-sm">Inbox is empty.</p>
            <p className="text-zinc-300 dark:text-zinc-700 text-xs">Hold the button below to capture an idea.</p>
          </div>
        )}

        {displayCaptures.map((capture) => (
          <InboxCard
            key={capture.id}
            capture={capture}
            pairedResponse={pairedResponseMap.get(capture.id)}
            resolvedState={resolvedActionCards.get(capture.id)}
            onArchive={handleArchive}
            onDelete={handleDelete}
            onRetry={handleRetry}
            onFile={handleFile}
            onReply={handleReply}
            onResolvedArchive={handleResolvedArchive}
            onCurationAnswer={handleCurationAnswer}
            onCurationDismiss={handleCurationDismiss}
            onCalendarConfirm={handleCalendarConfirm}
            onSendToAbentfork={handleSendToAbentfork}
            onProjectSuggestionConfirm={handleProjectSuggestionConfirm}
            onFileToTrip={handleFileToTrip}
            folders={folders}
            trips={trips}
          />
        ))}
      </main>

      {/* Text input bar */}
      <div className="fixed bottom-[166px] left-0 right-0 z-20 px-4">
        <div className="max-w-xl mx-auto space-y-1.5">
          {replyingTo && (
            <div className={`flex items-center gap-2 border rounded-xl px-3 py-2 ${replyingTo.type === 'curation' ? 'bg-violet-50 dark:bg-violet-950/60 border-violet-200 dark:border-violet-800/60' : 'bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800/60'}`}>
              <svg className={`w-3.5 h-3.5 shrink-0 ${replyingTo.type === 'curation' ? 'text-violet-500' : 'text-amber-500'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" />
              </svg>
              <span className={`flex-1 text-xs font-medium truncate ${replyingTo.type === 'curation' ? 'text-violet-700 dark:text-violet-400' : 'text-amber-700 dark:text-amber-400'}`}>Replying to: {replyingTo.label}</span>
              <button
                onClick={() => setReplyingTo(null)}
                className={`shrink-0 w-5 h-5 flex items-center justify-center rounded-full transition-colors ${replyingTo.type === 'curation' ? 'hover:bg-violet-200 dark:hover:bg-violet-800/60 text-violet-500' : 'hover:bg-amber-200 dark:hover:bg-amber-800/60 text-amber-500'}`}
                aria-label="Cancel reply"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}
          <div className={`flex items-center gap-2 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl border rounded-2xl px-3 py-2.5 shadow-sm transition-colors ${replyingTo?.type === 'curation' ? 'border-violet-300 dark:border-violet-700' : replyingTo ? 'border-amber-300 dark:border-amber-700' : 'border-zinc-200 dark:border-zinc-800'}`}>
          <input
            id="chat-input"
            type="text"
            value={chatText}
            onChange={(e) => { setChatText(e.target.value); if (chatError) setChatError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChat(); } }}
            placeholder={replyingTo ? 'Yes / No / ask a question…' : 'Ask Calliad…'}
            className="flex-1 bg-transparent text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none"
          />
          {chatText.trim() && (
            <button
              onClick={handleChat}
              disabled={chatSending}
              className="w-7 h-7 rounded-full bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center shrink-0 disabled:opacity-50 transition-opacity"
              aria-label="Send"
            >
              <svg className="w-3.5 h-3.5 text-white dark:text-zinc-900" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          )}
          {chatSending && !chatText.trim() && (
            <div className="w-4 h-4 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-zinc-600 dark:border-t-zinc-400 animate-spin shrink-0" />
          )}
          </div>
          {chatError && (
            <div className="flex items-center gap-2 mt-1.5 px-1">
              <span className="text-xs text-red-500 dark:text-red-400">{chatError}</span>
              <button onClick={() => setChatError(null)} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 ml-auto">Dismiss</button>
            </div>
          )}
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
