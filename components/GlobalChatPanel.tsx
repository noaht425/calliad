'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { streamChat } from '@/lib/api';
import { useVoiceInput } from '@/lib/voice/useVoiceInput';
import { SentenceSpeaker, primeSpeech } from '@/lib/voice/speak';
import { fileToResizedDataUrl } from '@/lib/image';
import { useConversationSync } from '@/lib/chat/useConversationSync';

interface Message { role: 'user' | 'assistant'; text: string; images?: string[] }

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
 * SSE stream (streamChat + sticky conversation + mode chip). Voice notes go
 * through /api/chat/transcribe (Groq Whisper); spoken replies use the browser's
 * built-in TTS; photos are resized client-side and sent to the brain as an
 * image block.
 */
export function GlobalChatPanel() {
  const { session } = useAuth();
  const pathname = usePathname();

  const [chatH, setChatH] = useState(CLOSED);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<string | undefined>();
  const [ttsOn, setTtsOn] = useState(false);
  const ttsRef = useRef(false);
  ttsRef.current = ttsOn;
  const speakerRef = useRef<SentenceSpeaker>(null);
  if (!speakerRef.current) speakerRef.current = new SentenceSpeaker();

  useEffect(() => { try { if (localStorage.getItem('calliad:tts') === '1') setTtsOn(true); } catch { /* no storage */ } }, []);
  const toggleTts = useCallback(() => {
    speakerRef.current!.cancel();
    setTtsOn((v) => {
      const next = !v;
      try { localStorage.setItem('calliad:tts', next ? '1' : '0'); } catch { /* no storage */ }
      if (next) primeSpeech(); // unlock speechSynthesis while we still have the tap
      return next;
    });
  }, []);

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

  /* Cross-device: while the panel is open, pull in turns from the other device. */
  const { markTurnDone } = useConversationSync({
    session, sending, active: chatH > CLOSED, setMessages, convRef,
  });

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
  const runTurn = useCallback(async (text: string, images: string[] = []) => {
    if ((!text.trim() && !images.length) || sending || !session) return;
    if (ttsRef.current) primeSpeech(); // keep the gesture-unlock fresh for this reply
    setMessages((m) => [...m, { role: 'user', text, images: images.length ? images : undefined }, { role: 'assistant', text: '' }]);
    setSending(true);
    setChatH((h) => (h < snapsRef.current[2] ? snapsRef.current[2] : h));
    speakerRef.current!.cancel();
    let acc = '';
    try {
      const { conversationId } = await streamChat(
        text,
        {
          onDelta: (d) => {
            acc += d;
            setMessages((m) => {
              const next = [...m];
              next[next.length - 1] = { role: 'assistant', text: next[next.length - 1].text + d };
              return next;
            });
            if (ttsRef.current) speakerRef.current!.feed(acc);
          },
          onDone: (full, meta) => {
            markTurnDone();
            setMode(meta?.mode && MODE_LABEL[meta.mode] ? meta.mode : undefined);
            if (ttsRef.current && full) speakerRef.current!.flush(full);
          },
        },
        convRef.current,
        images,
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
  }, [sending, session, markTurnDone]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text && !pendingImages.length) return;
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    const imgs = pendingImages;
    setPendingImages([]);
    void runTurn(text, imgs);
  }, [input, pendingImages, runTurn]);

  const pickImages = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const resized = (await Promise.all(files.map((f) => fileToResizedDataUrl(f).catch(() => null)))).filter(
      (x): x is string => !!x,
    );
    if (!resized.length) return;
    setPendingImages((cur) => [...cur, ...resized].slice(0, 8));
    setChatH((h) => (h < snapsRef.current[2] ? snapsRef.current[2] : h));
  }, []);

  const { state: voiceState, error: voiceError, start: micStart, stop: micStop, supported: micSupported } = useVoiceInput(
    (t) => { setInput(''); void runTurn(t); },
    { conversationId: convRef.current },
  );

  const { state: songState, start: songStart, stop: songStop } = useVoiceInput(
    (block) => {
      setChatH((h) => (h < snapsRef.current[2] ? snapsRef.current[2] : h));
      setMessages((m) => [...m, { role: 'assistant', text: block }]);
      if (ttsRef.current) speakerRef.current!.flush(block.split('\n').find((l) => !l.startsWith('#') && l.trim()) ?? '');
    },
    { endpoint: '/api/song/identify', pick: (j) => j.block as string | undefined },
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
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
                  {voiceError ? (
                    <span className="text-[11px]" style={{ color: '#EF4444' }}>{voiceError}</span>
                  ) : voiceState === 'recording' ? (
                    <span className="text-[11px] font-medium animate-pulse" style={{ color: '#EF4444' }}>● Recording… release to send</span>
                  ) : voiceState === 'transcribing' ? (
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Transcribing…</span>
                  ) : songState === 'recording' ? (
                    <span className="text-[11px] font-medium animate-pulse" style={{ color: 'var(--accent)' }}>♪ Listening for the song…</span>
                  ) : songState === 'transcribing' ? (
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Identifying…</span>
                  ) : mode ? (
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {MODE_LABEL[mode]} · say &ldquo;english&rdquo; to exit
                    </span>
                  ) : null}
                </div>
                <div className="absolute right-4 flex items-center gap-3">
                  <button
                    onClick={toggleTts}
                    className="transition-colors"
                    style={{ color: ttsOn ? 'var(--accent)' : 'var(--text-quiet)' }}
                    title={ttsOn ? 'Spoken replies on' : 'Spoken replies off'}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      {ttsOn ? (
                        <><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></>
                      ) : (
                        <line x1="23" y1="9" x2="17" y2="15" />
                      )}
                    </svg>
                  </button>
                  <button
                    onClick={() => setChatH(CLOSED)}
                    className="transition-colors"
                    style={{ color: 'var(--text-muted)' }}
                    title="Close"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
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
                  <div className={`max-w-[82%] flex flex-col gap-1 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                    {m.images?.length ? (
                      <div className="flex flex-wrap gap-1 justify-end">
                        {m.images.map((src, k) => (
                          <img key={k} src={src} alt="attached" className="max-h-48 rounded-2xl border" style={{ borderColor: 'var(--border)' }} />
                        ))}
                      </div>
                    ) : null}
                    {(m.text || (m.role === 'assistant' && sending && i === messages.length - 1)) && (
                      <div
                        role={ttsOn && m.role === 'assistant' && m.text ? 'button' : undefined}
                        onClick={ttsOn && m.role === 'assistant' && m.text ? () => { primeSpeech(); speakerRef.current!.speakNow(m.text); } : undefined}
                        title={ttsOn && m.role === 'assistant' && m.text ? 'Tap to read aloud' : undefined}
                        className="whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13.5px] leading-relaxed"
                        style={{
                          ...(m.role === 'user'
                            ? { background: 'var(--accent)', color: 'var(--on-accent)' }
                            : { background: 'var(--surface)', color: 'var(--text-body)', border: '1px solid var(--border)', boxShadow: 'var(--card-glow, none)' }),
                          cursor: ttsOn && m.role === 'assistant' && m.text ? 'pointer' : undefined,
                        }}
                      >
                        {m.text || (sending && i === messages.length - 1 ? <ThinkingDots /> : '')}
                        {ttsOn && m.role === 'assistant' && m.text && (
                          <svg className="inline-block w-3 h-3 ml-1.5 -mt-0.5 align-middle" style={{ color: 'var(--accent)', opacity: 0.65 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                          </svg>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
          )}

          {pendingImages.length > 0 && (
            <div className="shrink-0 px-3 pt-1 flex gap-2 overflow-x-auto">
              {pendingImages.map((src, k) => (
                <div key={k} className="relative shrink-0">
                  <img src={src} alt="attached" className="h-16 rounded-lg border" style={{ borderColor: 'var(--border)' }} />
                  <button
                    onClick={() => setPendingImages((cur) => cur.filter((_, j) => j !== k))}
                    aria-label="Remove photo"
                    className="absolute top-0 right-0 h-5 w-5 rounded-full flex items-center justify-center text-[11px]"
                    style={{ background: 'var(--text)', color: 'var(--paper)' }}
                  >✕</button>
                </div>
              ))}
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
            <input
              ref={imgInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => { void pickImages(Array.from(e.target.files ?? [])); e.target.value = ''; }}
            />
            <button
              onClick={() => imgInputRef.current?.click()}
              disabled={sending}
              className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center disabled:opacity-40"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
              aria-label="Attach a photo"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
              </svg>
            </button>
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
            {micSupported && !input.trim() && !pendingImages.length && (
              <button
                onPointerDown={(e) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture(e.pointerId); songStart(); }}
                onPointerUp={() => songStop()}
                onPointerLeave={() => songState === 'recording' && songStop()}
                onPointerCancel={() => songStop()}
                disabled={songState === 'transcribing' || voiceState !== 'idle' || sending}
                className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all disabled:opacity-40 select-none touch-none ${songState === 'recording' ? 'animate-pulse scale-110' : ''}`}
                style={
                  songState === 'recording'
                    ? { background: 'var(--accent)', color: 'var(--on-accent)' }
                    : { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }
                }
                aria-label={songState === 'recording' ? 'Release to identify' : 'Hold to name a song playing'}
                title="Name that song"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                </svg>
              </button>
            )}
            {micSupported && !input.trim() && !pendingImages.length && (
              <button
                onPointerDown={(e) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture(e.pointerId); micStart(); }}
                onPointerUp={() => micStop()}
                onPointerLeave={() => voiceState === 'recording' && micStop()}
                onPointerCancel={() => micStop()}
                disabled={voiceState === 'transcribing' || songState !== 'idle' || sending}
                className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all disabled:opacity-40 select-none touch-none ${voiceState === 'recording' ? 'animate-pulse scale-110' : ''}`}
                style={
                  voiceState === 'recording'
                    ? { background: '#EF4444', color: '#fff' }
                    : { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }
                }
                aria-label={voiceState === 'recording' ? 'Release to send' : 'Hold to talk'}
              >
                {voiceState === 'recording' ? (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="2" width="6" height="11" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" />
                    <line x1="12" y1="19" x2="12" y2="22" /><line x1="8" y1="22" x2="16" y2="22" />
                  </svg>
                )}
              </button>
            )}
            {(input.trim() || pendingImages.length || !micSupported) && (
              <button
                onClick={() => send()}
                disabled={sending || (!input.trim() && !pendingImages.length)}
                className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-opacity disabled:opacity-40"
                style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
                aria-label="Send"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
