'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { streamChat } from '@/lib/api';

interface Message { role: 'user' | 'assistant'; text: string }

const CLOSED = 0;
const PEEK = 68; // composer row only
const NAV_H = 86;

const MODE_LABEL: Record<string, string> = {
  'italian-tutor': 'Italian tutor',
  quiz: 'Quiz',
  'study-coach': 'Study coach',
};

function getSnaps(): [number, number, number, number] {
  const usable = window.innerHeight - NAV_H;
  return [CLOSED, PEEK, Math.round(usable * 0.48), Math.round(usable * 0.8)];
}
function snap(h: number, snaps: [number, number, number, number]): number {
  return snaps.reduce((best, pt) => (Math.abs(pt - h) < Math.abs(best - h) ? pt : best));
}

function ThinkingDots() {
  return (
    <div className="flex gap-1 items-center h-5">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="w-1.5 h-1.5 rounded-full animate-bounce"
          style={{ background: 'var(--text-muted)', animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  );
}

/**
 * Draggable split-screen chat — shown on every route except `/` (Today renders
 * <Chat/> inline). Snap points: closed, peek (composer only), half, full.
 * Structure adopted from dougt425/calliad's refresh; wiring is Calliad's own
 * SSE stream (streamChat + sticky conversation + mode chip). Voice/photo are
 * deferred until the STT endpoint lands.
 */
export function GlobalChatPanel() {
  const { session } = useAuth();
  const pathname = usePathname();

  const [chatH, setChatH] = useState(CLOSED);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<string | undefined>();

  const snapsRef = useRef<[number, number, number, number]>([CLOSED, PEEK, 300, 560]);
  const dragRef = useRef({ active: false, startY: 0, startH: 0 });
  const convRef = useRef<string | undefined>(undefined);
  const briefLoaded = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /* Expose height so pages could pad a scroll container if needed. */
  useEffect(() => {
    document.documentElement.style.setProperty('--global-chat-h', `${chatH}px`);
    return () => { document.documentElement.style.setProperty('--global-chat-h', '0px'); };
  }, [chatH]);

  useEffect(() => {
    snapsRef.current = getSnaps();
    const onResize = () => { snapsRef.current = getSnaps(); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => { if (pathname === '/') setChatH(CLOSED); }, [pathname]);

  useEffect(() => {
    if (chatH > PEEK) setTimeout(() => inputRef.current?.focus(), 200);
  }, [chatH]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  /* Seed with today's brief the first time the panel opens. */
  useEffect(() => {
    if (chatH === CLOSED || briefLoaded.current || !session) return;
    briefLoaded.current = true;
    fetch('/api/brief/latest', { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((r) => r.json())
      .then((j) => {
        if (!j.brief?.messages?.length) return;
        setMessages((cur) =>
          cur.length
            ? cur
            : j.brief.messages.map((m: { role: 'user' | 'assistant'; content: string }) => ({ role: m.role, text: m.content })),
        );
        convRef.current = j.brief.conversationId;
      })
      .catch(() => {});
  }, [chatH, session]);

  /* ─── Drag ────────────────────────────────────────────────────────────── */
  const onDragStart = useCallback((e: React.PointerEvent) => {
    dragRef.current = { active: true, startY: e.clientY, startH: chatH };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [chatH]);

  const onDragMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    const delta = dragRef.current.startY - e.clientY;
    setChatH(Math.min(snapsRef.current[3], Math.max(CLOSED, dragRef.current.startH + delta)));
  }, []);

  const onDragEnd = useCallback(() => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    setChatH((h) => snap(h, snapsRef.current));
  }, []);

  /* ─── Send ────────────────────────────────────────────────────────────── */
  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending || !session) return;
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setMessages((m) => [...m, { role: 'user', text }, { role: 'assistant', text: '' }]);
    setSending(true);
    setChatH((h) => (h < snapsRef.current[2] ? snapsRef.current[2] : h));
    try {
      const { conversationId } = await streamChat(
        text,
        {
          onDelta: (d) =>
            setMessages((m) => {
              const next = [...m];
              next[next.length - 1] = { role: 'assistant', text: next[next.length - 1].text + d };
              return next;
            }),
          onDone: (_full, meta) =>
            setMode(meta?.mode && MODE_LABEL[meta.mode] ? meta.mode : undefined),
        },
        convRef.current,
      );
      convRef.current = conversationId;
    } catch {
      setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = { role: 'assistant', text: 'Something broke on my end — try that again in a minute.' };
        return next;
      });
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [input, sending, session]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  };

  if (!session || pathname === '/') return null;

  const panelOpen = chatH > CLOSED;
  const panelExpanded = chatH > PEEK + 10;

  return (
    <>
      {!panelOpen && (
        <button
          onClick={() => setChatH(snapsRef.current[2])}
          className="fixed z-40 w-12 h-12 rounded-full flex items-center justify-center transition-transform active:scale-95"
          style={{
            bottom: NAV_H + 12,
            right: 16,
            background: 'var(--accent)',
            color: 'var(--on-accent)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          }}
          aria-label="Open Calliad chat"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}

      {panelOpen && (
        <div
          className="fixed left-0 right-0 z-40 flex flex-col overflow-hidden"
          style={{
            bottom: NAV_H,
            height: chatH,
            background: 'var(--paper-sheet)',
            borderTop: '1px solid var(--border-sheet)',
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            boxShadow: 'var(--shadow-more)',
            transition: dragRef.current.active ? 'none' : 'height 0.22s cubic-bezier(0.32, 0.72, 0, 1)',
          }}
        >
          {/* Drag handle + header */}
          <div
            className="shrink-0 flex items-center relative"
            style={{
              height: 44,
              paddingInline: 16,
              borderBottom: panelExpanded ? '1px solid var(--border-quiet)' : 'none',
              touchAction: 'none',
            }}
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
          >
            <div className="flex-1 flex justify-center" style={{ pointerEvents: 'none' }}>
              <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border)' }} />
            </div>
            {panelExpanded && (
              <>
                <div className="absolute left-4 flex items-center gap-2" style={{ pointerEvents: 'none' }}>
                  <img src="/icons/icon-192.png" alt="Calliad" className="w-5 h-5 rounded-full shrink-0" style={{ objectFit: 'cover' }} />
                  {mode && (
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {MODE_LABEL[mode]} · say &ldquo;english&rdquo; to exit
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setChatH(CLOSED)}
                  className="absolute right-4 transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                  title="Close"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </>
            )}
          </div>

          {panelExpanded && (
            <div className="flex-1 overflow-y-auto min-h-0 px-4 py-2 space-y-3">
              {messages.length === 0 && (
                <p className="text-center text-[13px] pt-4" style={{ color: 'var(--text-quiet)' }}>
                  Ask Calliad anything.
                </p>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {m.role === 'assistant' && (
                    <img src="/icons/icon-192.png" alt="" className="w-5 h-5 rounded-full shrink-0 mt-1 mr-1.5" style={{ objectFit: 'cover' }} />
                  )}
                  <div
                    className="max-w-[82%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13.5px] leading-relaxed"
                    style={
                      m.role === 'user'
                        ? { background: 'var(--accent)', color: 'var(--on-accent)' }
                        : { background: 'var(--surface)', color: 'var(--text-body)', border: '1px solid var(--border)', boxShadow: 'var(--card-glow, none)' }
                    }
                  >
                    {m.text || (sending && i === messages.length - 1 ? <ThinkingDots /> : '')}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
          )}

          {/* Composer */}
          <div
            className="shrink-0 px-3 pt-1 flex items-end gap-2"
            style={{
              paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))',
              borderTop: panelExpanded ? '1px solid var(--border-quiet)' : 'none',
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 130)}px`;
              }}
              onKeyDown={onKeyDown}
              onFocus={() => setChatH((h) => (h < snapsRef.current[2] ? snapsRef.current[2] : h))}
              placeholder="Ask Calliad anything…"
              rows={1}
              className="flex-1 resize-none rounded-xl px-3 py-2.5 text-[14px] outline-none"
              style={{
                maxHeight: 130,
                minHeight: 40,
                overflowY: 'auto',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
              }}
            />
            <button
              onClick={() => void send()}
              disabled={sending || !input.trim()}
              className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-opacity disabled:opacity-40"
              style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
              aria-label="Send"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
