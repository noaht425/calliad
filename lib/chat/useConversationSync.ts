'use client';
import { useCallback, useEffect, useRef } from 'react';
import type { Session } from '@supabase/supabase-js';

export interface SyncMessage {
  role: 'user' | 'assistant';
  text: string;
  images?: string[];
}

interface Opts {
  session: Session | null;
  sending: boolean;
  /** Only poll while the surface is actually on screen (panel open / route active). */
  active: boolean;
  setMessages: (fn: (cur: SyncMessage[]) => SyncMessage[]) => void;
  convRef: React.MutableRefObject<string | undefined>;
  intervalMs?: number;
}

const PHOTO = /^📷/;

function sameThread(a: SyncMessage[], b: SyncMessage[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].role !== b[i].role || a[i].text !== b[i].text) return false;
  }
  return true;
}

/**
 * Keeps a chat surface in step with the server copy of the current conversation.
 * Pulls /api/conversation/current on mount, on tab focus / visibility, and on a
 * light interval while `active`. A turn continued on another device then lands
 * here on its own — no refresh, no app restart.
 *
 * Never disturbs an in-flight stream: skips while `sending`, for a few seconds
 * after a turn finishes (the assistant row may not be written yet), and won't
 * shrink a local list that ends on a freshly streamed reply.
 */
export function useConversationSync({
  session,
  sending,
  active,
  setMessages,
  convRef,
  intervalMs = 10_000,
}: Opts): { syncNow: () => Promise<void>; markTurnDone: () => void } {
  const doneAt = useRef(0);
  const busy = useRef(false);
  const sendingRef = useRef(sending);
  sendingRef.current = sending;

  const markTurnDone = useCallback(() => {
    doneAt.current = Date.now();
  }, []);

  const syncNow = useCallback(async () => {
    if (!session || sendingRef.current || busy.current) return;
    if (Date.now() - doneAt.current < 4000) return;
    busy.current = true;
    try {
      const r = await fetch('/api/conversation/current', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!r.ok) return;
      const j = (await r.json()) as {
        conversation?: { id: string; messages: { role: 'user' | 'assistant'; content: string }[] };
      };
      const conv = j.conversation;
      if (!conv?.messages?.length || sendingRef.current) return;
      convRef.current = conv.id;
      const server: SyncMessage[] = conv.messages.map((m) => ({ role: m.role, text: m.content }));
      setMessages((cur) => {
        if (sameThread(cur, server)) return cur;
        // a longer local list ending on a streamed reply — server write may lag
        if (cur.length > server.length && cur[cur.length - 1]?.role === 'assistant' && cur[cur.length - 1]?.text) {
          return cur;
        }
        // carry local photo thumbnails across when the lists line up 1:1
        if (cur.length === server.length) {
          return server.map((s, i) =>
            s.role === 'user' && PHOTO.test(s.text) && cur[i]?.images?.length ? { ...s, images: cur[i].images } : s,
          );
        }
        return server;
      });
    } catch {
      /* offline / transient — try again next tick */
    } finally {
      busy.current = false;
    }
  }, [session, setMessages, convRef]);

  useEffect(() => {
    if (!session || !active) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncNow();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', syncNow);
    void syncNow();
    const iv = window.setInterval(() => {
      if (document.visibilityState === 'visible') void syncNow();
    }, intervalMs);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', syncNow);
      window.clearInterval(iv);
    };
  }, [session, active, syncNow, intervalMs]);

  return { syncNow, markTurnDone };
}
