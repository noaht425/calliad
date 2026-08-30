'use client';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Chat } from '@/components/Chat';

/** Floating chat panel — shown on every route except `/` (which renders Chat inline). */
export function GlobalChatPanel() {
  const { session } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  if (!session || pathname === '/') return null;

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" onClick={() => setOpen(false)} />
      )}
      {open && (
        <div
          className="fixed bottom-0 inset-x-0 z-50 flex flex-col bg-[#fafaf8] dark:bg-[#111111] rounded-t-2xl border-t border-zinc-200/60 dark:border-zinc-800/60 shadow-2xl overflow-hidden"
          style={{ height: '72vh' }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center">
                <span className="text-[10px] font-bold text-white dark:text-zinc-900">C</span>
              </div>
              <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Calliad</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
              aria-label="Close"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <Chat />
          </div>
        </div>
      )}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-20 right-4 z-40 w-12 h-12 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
          aria-label="Open Calliad chat"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}
    </>
  );
}
