'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { streamChat } from '@/lib/api';
import { useVoiceInput } from '@/lib/voice/useVoiceInput';
import { SentenceSpeaker } from '@/lib/voice/speak';
import { fileToResizedDataUrl } from '@/lib/image';
import { useConversationSync } from '@/lib/chat/useConversationSync';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  image?: string;
}

/**
 * The chat surface — text or voice in, streamed reply out. Voice notes go
 * through /api/chat/transcribe (Groq Whisper). Fills its parent (which must
 * give it a bounded height). Used inline on `/` and inside GlobalChatPanel.
 */
export function Chat() {
  const { session } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<string | undefined>();
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const [ttsOn, setTtsOn] = useState(false);
  const ttsRef = useRef(false);
  ttsRef.current = ttsOn;
  const speakerRef = useRef<SentenceSpeaker>(null);
  if (!speakerRef.current) speakerRef.current = new SentenceSpeaker();
  const convRef = useRef<string | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // On load, show today's brief (if there is one) and let replies continue it.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetch('/api/brief/latest', { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !j.brief?.messages?.length) return;
        setMessages((cur) =>
          cur.length ? cur : j.brief.messages.map((m: { role: 'user' | 'assistant'; content: string }) => ({ role: m.role, text: m.content })),
        );
        convRef.current = j.brief.conversationId;
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [session]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Cross-device: pull in turns continued on another device (the home chat is
  // always on screen when mounted, so it's always active).
  const { markTurnDone } = useConversationSync({ session, sending, active: true, setMessages, convRef });

  const runTurn = useCallback(async (text: string, image?: string) => {
    if ((!text.trim() && !image) || sending || !session) return;
    setMessages((m) => [...m, { role: 'user', text, image }, { role: 'assistant', text: '' }]);
    setSending(true);
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
            setMode(meta?.mode && ['italian-tutor', 'quiz', 'study-coach'].includes(meta.mode) ? meta.mode : undefined);
            if (ttsRef.current && full) speakerRef.current!.flush(full);
          },
        },
        convRef.current,
        image,
      );
      convRef.current = conversationId;
    } catch {
      setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = {
          role: 'assistant',
          text: 'Something broke on my end — try that again in a minute.',
        };
        return next;
      });
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [sending, session, markTurnDone]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text && !pendingImage) return;
    setInput('');
    const img = pendingImage ?? undefined;
    setPendingImage(null);
    void runTurn(text, img);
  }, [input, pendingImage, runTurn]);

  const pickImage = useCallback(async (file: File) => {
    try {
      setPendingImage(await fileToResizedDataUrl(file));
      inputRef.current?.focus();
    } catch { /* ignore a bad file */ }
  }, []);

  const { state: voiceState, error: voiceError, start: micStart, stop: micStop, supported: micSupported } = useVoiceInput(
    (t) => { setInput(''); void runTurn(t); },
    { conversationId: convRef.current },
  );

  const { state: songState, start: songStart, stop: songStop } = useVoiceInput(
    (block) => {
      speakerRef.current!.cancel();
      setMessages((m) => [...m, { role: 'assistant', text: block }]);
    },
    { endpoint: '/api/song/identify', pick: (j) => j.block as string | undefined },
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--paper)' }}>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {messages.length === 0 && (
          <p className="text-center text-sm pt-8" style={{ color: 'var(--text-quiet)' }}>
            Ask Calliad anything.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] ${m.role === 'user' ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
              {m.image && (
                <img src={m.image} alt="attached" className="max-h-56 rounded-2xl border" style={{ borderColor: 'var(--border)' }} />
              )}
              {(m.text || (m.role === 'assistant' && sending)) && (
                <div
                  className="whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed"
                  style={
                    m.role === 'user'
                      ? { background: 'var(--accent)', color: 'var(--on-accent)' }
                      : { background: 'var(--surface)', color: 'var(--text-body)', border: '1px solid var(--border)', boxShadow: 'var(--card-glow, none)' }
                  }
                >
                  {m.text || (sending ? '…' : '')}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 px-4 pt-2 pb-3" style={{ borderTop: '1px solid var(--border-quiet)' }}>
        {(mode || voiceState !== 'idle' || songState !== 'idle' || voiceError) && (
          <div className="mb-1.5 flex items-center justify-between text-[11px]" style={{ color: voiceState === 'recording' || voiceError ? '#EF4444' : songState === 'recording' ? 'var(--accent)' : 'var(--text-muted)' }}>
            <span>
              {voiceError
                ? voiceError
                : voiceState === 'recording'
                  ? '● Recording… release to send'
                  : voiceState === 'transcribing'
                    ? 'Transcribing…'
                    : songState === 'recording'
                      ? '♪ Listening for the song…'
                      : songState === 'transcribing'
                        ? 'Identifying…'
                        : `${mode === 'italian-tutor' ? 'Italian tutor' : mode === 'quiz' ? 'Quiz' : mode === 'study-coach' ? 'Study coach' : mode} · say “english” to exit`}
            </span>
          </div>
        )}
        {pendingImage && (
          <div className="mb-2 relative inline-block">
            <img src={pendingImage} alt="attached" className="h-16 rounded-lg border" style={{ borderColor: 'var(--border)' }} />
            <button
              onClick={() => setPendingImage(null)}
              aria-label="Remove photo"
              className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full flex items-center justify-center text-[11px]"
              style={{ background: 'var(--text)', color: 'var(--paper)' }}
            >✕</button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={imgInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickImage(f); e.target.value = ''; }}
          />
          <button
            onClick={() => imgInputRef.current?.click()}
            disabled={sending}
            className="shrink-0 h-9 w-9 rounded-xl flex items-center justify-center disabled:opacity-40"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
            aria-label="Attach a photo"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
            </svg>
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask Calliad anything…"
            rows={1}
            className="flex-1 resize-none rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ maxHeight: '120px', overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
          />
          {micSupported && !input.trim() && !pendingImage && (
            <button
              onClick={() => { speakerRef.current!.cancel(); setTtsOn((v) => !v); }}
              className="shrink-0 h-9 w-9 rounded-xl flex items-center justify-center transition-colors"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: ttsOn ? 'var(--accent)' : 'var(--text-quiet)' }}
              aria-label={ttsOn ? 'Spoken replies on' : 'Spoken replies off'}
              title={ttsOn ? 'Spoken replies on' : 'Spoken replies off'}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                {ttsOn ? (<><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></>) : (<line x1="23" y1="9" x2="17" y2="15" />)}
              </svg>
            </button>
          )}
          {micSupported && !input.trim() && !pendingImage && (
            <button
              onPointerDown={(e) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture(e.pointerId); songStart(); }}
              onPointerUp={() => songStop()}
              onPointerLeave={() => songState === 'recording' && songStop()}
              onPointerCancel={() => songStop()}
              disabled={songState === 'transcribing' || voiceState !== 'idle' || sending}
              className={`shrink-0 h-9 w-9 rounded-xl flex items-center justify-center disabled:opacity-40 transition-all select-none touch-none ${songState === 'recording' ? 'animate-pulse scale-110' : ''}`}
              style={
                songState === 'recording'
                  ? { background: 'var(--accent)', color: 'var(--on-accent)' }
                  : { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }
              }
              aria-label={songState === 'recording' ? 'Release to identify' : 'Hold to name a song playing'}
              title="Name that song"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
              </svg>
            </button>
          )}
          {micSupported && !input.trim() && !pendingImage && (
            <button
              onPointerDown={(e) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture(e.pointerId); micStart(); }}
              onPointerUp={() => micStop()}
              onPointerLeave={() => voiceState === 'recording' && micStop()}
              onPointerCancel={() => micStop()}
              disabled={voiceState === 'transcribing' || songState !== 'idle' || sending}
              className={`shrink-0 h-9 w-9 rounded-xl flex items-center justify-center disabled:opacity-40 transition-all select-none touch-none ${voiceState === 'recording' ? 'animate-pulse scale-110' : ''}`}
              style={
                voiceState === 'recording'
                  ? { background: '#EF4444', color: '#fff' }
                  : { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }
              }
              aria-label={voiceState === 'recording' ? 'Release to send' : 'Hold to talk'}
            >
              {voiceState === 'recording' ? (
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
              ) : (
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="2" width="6" height="11" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" />
                  <line x1="12" y1="19" x2="12" y2="22" /><line x1="8" y1="22" x2="16" y2="22" />
                </svg>
              )}
            </button>
          )}
          {(input.trim() || pendingImage || !micSupported) && (
            <button
              onClick={() => send()}
              disabled={sending || (!input.trim() && !pendingImage)}
              className="shrink-0 h-9 w-9 rounded-xl flex items-center justify-center disabled:opacity-40 transition-opacity"
              style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
              aria-label="Send"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
