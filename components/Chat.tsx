'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { streamChat } from '@/lib/api';

interface Message {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * The chat surface — text in, streamed reply out. Phase 0 has no voice/TTS.
 * Fills its parent (which must give it a bounded height). Used inline on `/`
 * and inside GlobalChatPanel elsewhere.
 */
export function Chat() {
  const { session } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<string | undefined>();
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

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending || !session) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text }, { role: 'assistant', text: '' }]);
    setSending(true);
    try {
      const { conversationId } = await streamChat(
        text,
        {
          onDelta: (d) =>
            setMessages((m) => {
              const next = [...m];
              next[next.length - 1] = {
                role: 'assistant',
                text: next[next.length - 1].text + d,
              };
              return next;
            }),
          onDone: (_full, meta) =>
            setMode(meta?.mode && ['italian-tutor', 'quiz', 'study-coach'].includes(meta.mode) ? meta.mode : undefined),
        },
        convRef.current,
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
  }, [input, sending, session]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
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
            <div
              className="max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed"
              style={
                m.role === 'user'
                  ? { background: 'var(--accent)', color: 'var(--on-accent)' }
                  : { background: 'var(--surface)', color: 'var(--text-body)', border: '1px solid var(--border)', boxShadow: 'var(--card-glow, none)' }
              }
            >
              {m.text || (sending ? '…' : '')}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 px-4 pt-2 pb-3" style={{ borderTop: '1px solid var(--border-quiet)' }}>
        {mode && (
          <div className="mb-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {mode === 'italian-tutor' ? 'Italian tutor' : mode === 'quiz' ? 'Quiz' : mode === 'study-coach' ? 'Study coach' : mode} · say &ldquo;english&rdquo; to exit
          </div>
        )}
        <div className="flex items-end gap-2">
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
          <button
            onClick={() => void send()}
            disabled={sending || !input.trim()}
            className="shrink-0 h-9 w-9 rounded-xl flex items-center justify-center disabled:opacity-40 transition-opacity"
            style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
            aria-label="Send"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
