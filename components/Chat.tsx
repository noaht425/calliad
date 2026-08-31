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
    <div className="flex h-full flex-col bg-[#fafaf8] dark:bg-[#0a0a0a]">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {messages.length === 0 && (
          <p className="text-center text-sm text-zinc-400 dark:text-zinc-600 pt-8">
            Ask Calliad anything.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
              }`}
            >
              {m.text || (sending ? '…' : '')}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 border-t border-zinc-100 dark:border-zinc-800 px-4 pt-2 pb-3">
        {mode && (
          <div className="mb-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
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
            className="flex-1 resize-none rounded-xl bg-zinc-100 dark:bg-zinc-800 px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-600"
            style={{ maxHeight: '120px', overflowY: 'auto' }}
          />
          <button
            onClick={() => void send()}
            disabled={sending || !input.trim()}
            className="shrink-0 h-9 w-9 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 flex items-center justify-center disabled:opacity-40 transition-opacity"
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
