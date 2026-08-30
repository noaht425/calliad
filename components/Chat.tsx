'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { streamChat } from '@/lib/api';

interface Message {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * The chat surface — text in, streamed reply out. Phase 0 has no voice/TTS
 * (deferred to Phase 3). Used inline on `/` and inside GlobalChatPanel elsewhere.
 */
export function Chat({ compact = false }: { compact?: boolean }) {
  const { session } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const convRef = useRef<string | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
              next[next.length - 1] = { role: 'assistant', text: next[next.length - 1].text + d };
              return next;
            }),
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

  return (
    <div className={`flex flex-col ${compact ? 'h-full' : 'h-dvh'} bg-[#fafaf8] dark:bg-[#0a0a0a]`}>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {messages.length === 0 && (
          <p className="text-center text-sm text-zinc-400 dark:text-zinc-600 pt-8">
            Ask Calliad anything.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed ${
              m.role === 'user'
                ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
            }`}>
              {m.text || (sending ? '…' : '')}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="px-4 pt-2 pb-4 border-t border-zinc-100 dark:border-zinc-800 shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask Calliad anything…"
            rows={1}
            className="flex-1 resize-none bg-zinc-100 dark:bg-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-600"
            style={{ maxHeight: '120px', overflowY: 'auto' }}
          />
          {input.trim() && (
            <button
              onClick={() => void send()}
              disabled={sending}
              className="shrink-0 w-9 h-9 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 flex items-center justify-center disabled:opacity-40 transition-opacity"
              aria-label="Send"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
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
