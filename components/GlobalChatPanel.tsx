'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { usePathname } from 'next/navigation';
import { sendChatMessage } from '@/lib/api';

interface Message {
  role: 'user' | 'assistant';
  text: string;
}

type VoiceState = 'idle' | 'recording' | 'transcribing';

const PREFERRED_MIME = (() => {
  if (typeof MediaRecorder === 'undefined') return 'audio/mp4';
  const types = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? 'audio/mp4';
})();

export function GlobalChatPanel() {
  const { session } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Load available English voices (async on some browsers)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const load = () => {
      const all = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
      if (all.length > 0) setVoices(all);
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150);
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Release mic stream when panel closes
  useEffect(() => {
    if (!open) {
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setVoiceState('idle');
    }
  }, [open]);

  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    if (voices.length > 0) {
      const savedName = localStorage.getItem('calliad_voice_name');
      utterance.voice = (savedName ? voices.find((v) => v.name === savedName) : null) ?? voices[0];
    }
    window.speechSynthesis.speak(utterance);
  }, [voices]);

  const sendText = useCallback(async (text: string) => {
    if (!text.trim() || !session) return;
    setMessages((prev) => [...prev, { role: 'user', text }]);
    setSending(true);
    try {
      const { assistantCapture } = await sendChatMessage(text);
      const reply = assistantCapture?.transcript ?? '';
      if (reply) {
        setMessages((prev) => [...prev, { role: 'assistant', text: reply }]);
        if (ttsEnabled) speak(reply);
      }
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', text: 'Sorry, something went wrong. Try again.' }]);
    } finally {
      setSending(false);
    }
  }, [session, speak, ttsEnabled]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    await sendText(text);
  }, [input, sending, sendText]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const getStream = useCallback(async (): Promise<MediaStream> => {
    if (streamRef.current?.active) {
      streamRef.current.getAudioTracks().forEach((t) => { t.enabled = true; });
      return streamRef.current;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    streamRef.current = stream;
    return stream;
  }, []);

  const toggleMic = useCallback(async () => {
    if (!session) return;

    if (voiceState === 'recording') {
      recorderRef.current?.stop();
      return;
    }

    // Warm AudioContext inside user gesture (required on iOS)
    if (typeof AudioContext !== 'undefined' || 'webkitAudioContext' in window) {
      if (!audioCtxRef.current) {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtxRef.current = new Ctx();
      }
      if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume().catch(() => {});
    }

    try {
      const stream = await getStream();
      const recorder = new MediaRecorder(stream, { mimeType: PREFERRED_MIME });
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        // Mute (not stop) to keep permission alive without triggering iOS mic-off chime
        streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = false; });
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        if (blob.size < 4096) { setVoiceState('idle'); return; }

        setVoiceState('transcribing');
        try {
          const fd = new FormData();
          fd.append('audio', new File([blob], 'audio.' + (recorder.mimeType.includes('webm') ? 'webm' : 'mp4'), { type: recorder.mimeType }));
          const res = await fetch('/api/chat/transcribe', {
            method: 'POST',
            headers: { Authorization: `Bearer ${session.access_token}` },
            body: fd,
          });
          const { transcript } = await res.json();
          if (transcript) await sendText(transcript);
        } catch {
          setMessages((prev) => [...prev, { role: 'assistant', text: 'Could not transcribe audio. Try again.' }]);
        } finally {
          setVoiceState('idle');
        }
      };

      // No timeslice — iOS drops the MP4 init segment with timeslice
      recorder.start();
      setVoiceState('recording');
      navigator.vibrate?.(15);
    } catch {
      setVoiceState('idle');
    }
  }, [voiceState, session, getStream, sendText]);

  // Today page has chat built in — no floating button needed
  if (!session || pathname === '/') return null;

  const isVoiceBusy = voiceState !== 'idle';

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" onClick={() => setOpen(false)} />
      )}

      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-0 inset-x-0 z-50 flex flex-col bg-[#fafaf8] dark:bg-[#111111] rounded-t-2xl border-t border-zinc-200/60 dark:border-zinc-800/60 shadow-2xl"
          style={{ maxHeight: '72vh' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center">
                <span className="text-[10px] font-bold text-white dark:text-zinc-900">C</span>
              </div>
              <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Calliad</span>
              {voiceState === 'recording' && (
                <span className="text-xs text-red-500 font-medium animate-pulse">● Recording…</span>
              )}
              {voiceState === 'transcribing' && (
                <span className="text-xs text-zinc-400 font-medium">Transcribing…</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* TTS toggle */}
              <button
                onClick={() => { window.speechSynthesis?.cancel(); setTtsEnabled((v) => !v); }}
                className={`p-1 transition-colors ${ttsEnabled ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-300 dark:text-zinc-600'}`}
                title={ttsEnabled ? 'Voice on — tap to mute' : 'Voice off — tap to enable'}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  {ttsEnabled ? (
                    <>
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    </>
                  ) : (
                    <line x1="23" y1="9" x2="17" y2="15" />
                  )}
                </svg>
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
            {messages.length === 0 && (
              <p className="text-center text-sm text-zinc-400 dark:text-zinc-600 pt-6">
                Ask me anything — type or tap the mic to speak.
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                }`}>
                  {m.text}
                </div>
              </div>
            ))}
            {(sending || voiceState === 'transcribing') && (
              <div className="flex justify-start">
                <div className="bg-zinc-100 dark:bg-zinc-800 rounded-2xl px-3 py-2">
                  <div className="flex gap-1 items-center h-4">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500 animate-bounce"
                        style={{ animationDelay: `${i * 150}ms` }} />
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-4 pb-safe-bottom pb-4 pt-2 border-t border-zinc-100 dark:border-zinc-800 shrink-0">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Ask Calliad anything…"
                rows={1}
                disabled={isVoiceBusy}
                className="flex-1 resize-none bg-zinc-100 dark:bg-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-600 disabled:opacity-40"
                style={{ maxHeight: '120px', overflowY: 'auto' }}
              />

              {/* Mic button — tap to start, tap to stop */}
              <button
                onClick={toggleMic}
                disabled={voiceState === 'transcribing' || sending}
                className={[
                  'shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all',
                  voiceState === 'recording'
                    ? 'bg-red-500 text-white animate-pulse'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-40',
                ].join(' ')}
                aria-label={voiceState === 'recording' ? 'Stop recording' : 'Start voice input'}
              >
                {voiceState === 'recording' ? (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="2" width="6" height="11" rx="3" />
                    <path d="M5 10a7 7 0 0 0 14 0" />
                    <line x1="12" y1="19" x2="12" y2="22" />
                    <line x1="8" y1="22" x2="16" y2="22" />
                  </svg>
                )}
              </button>

              {/* Send button — only shown when there's typed text */}
              {input.trim() && (
                <button
                  onClick={send}
                  disabled={sending || isVoiceBusy}
                  className="shrink-0 w-9 h-9 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 flex items-center justify-center disabled:opacity-40 transition-opacity"
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
      )}

      {/* Floating trigger button */}
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
