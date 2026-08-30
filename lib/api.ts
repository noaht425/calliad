import { supabase } from './supabase';

/** Bearer header for the current Supabase session (single user = Noah). */
export async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface StreamChatHandlers {
  onDelta: (text: string) => void;
  onDone?: (full: string) => void;
  onError?: (err: unknown) => void;
}

/**
 * POST /api/chat and consume the SSE stream.
 * Server sends `data: {"delta":"..."}` lines and a final `data: {"done":true}`.
 */
export async function streamChat(
  text: string,
  handlers: StreamChatHandlers,
  conversationId?: string,
): Promise<{ conversationId?: string }> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, conversationId }),
  });
  if (!res.ok || !res.body) {
    const err = new Error(`chat failed: ${res.status}`);
    handlers.onError?.(err);
    throw err;
  }

  const returnedConvId = res.headers.get('x-conversation-id') ?? conversationId;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';
    for (const evt of events) {
      const line = evt.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      try {
        const payload = JSON.parse(line.slice(5).trim());
        if (payload.delta) { full += payload.delta; handlers.onDelta(payload.delta); }
        if (payload.error) handlers.onError?.(new Error(payload.error));
      } catch { /* ignore keep-alives / malformed */ }
    }
  }
  handlers.onDone?.(full);
  return { conversationId: returnedConvId ?? undefined };
}
