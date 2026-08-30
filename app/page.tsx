'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { BottomNav } from '@/components/BottomNav';
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

export default function TodayPage() {
  const { session, loading } = useAuth();
  const router = useRouter();

  const [messages, setMessages] = useState<Message[]>([]);
  const [briefingLoaded, setBriefingLoaded] = useState(false);
  const [statusData, setStatusData] = useState<{ openTodos: number; nextTrip: { destination: string; daysUntil: number } | null; newCapturesCount: number } | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!loading && !session) router.push('/login');
  }, [loading, session, router]);

  // Load TTS voices
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const load = () => {
      const all = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
      if (all.length > 0) setVoices(all);
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
  }, []);

  // Load briefing once on mount — cache by date so it only regenerates once per day
  useEffect(() => {
    if (!session || briefingLoaded) return;
    const today = new Date().toDateString();
    const cacheKey = `calliad_briefing_${session.user.id}_${today}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      setMessages([{ role: 'assistant', text: cached }]);
      setBriefingLoaded(true);
      return;
    }
    fetch('/api/today/briefing', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then(({ briefing }) => {
        if (briefing) {
          localStorage.setItem(cacheKey, briefing);
          setMessages([{ role: 'assistant', text: briefing }]);
        }
      })
      .catch(() => {
        setMessages([{ role: 'assistant', text: "Hey Doug — what's on your mind?" }]);
      })
      .finally(() => setBriefingLoaded(true));
  }, [session, briefingLoaded]);

  // Refresh status on every mount — pure DB reads, no AI
  useEffect(() => {
    if (!session) return;
    fetch('/api/today/status', { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((r) => r.json())
      .then(setStatusData)
      .catch(() => {});
  }, [session]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
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
      setMessages((prev) => [...prev, { role: 'assistant', text: 'Something went wrong. Try again.' }]);
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
    if (voiceState === 'recording') { recorderRef.current?.stop(); return; }

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

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
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
      recorder.start(); // No timeslice — iOS drops the MP4 init segment with timeslice
      setVoiceState('recording');
      navigator.vibrate?.(15);
    } catch {
      setVoiceState('idle');
    }
  }, [voiceState, session, getStream, sendText]);

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    timeZone: 'America/Los_Angeles',
  });
  const isVoiceBusy = voiceState !== 'idle';

  function buildStatusLine(d: NonNullable<typeof statusData>): string {
    const parts: string[] = [];
    if (d.nextTrip) {
      const { destination, daysUntil } = d.nextTrip;
      const when = daysUntil === 0 ? 'today' : daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;
      parts.push(`${destination} ${when}`);
    }
    if (d.openTodos > 0) parts.push(`${d.openTodos} todo${d.openTodos !== 1 ? 's' : ''} open`);
    if (d.newCapturesCount > 0) parts.push(`${d.newCapturesCount} new capture${d.newCapturesCount !== 1 ? 's' : ''} today`);
    return parts.length > 0 ? parts.join('  ·  ') : 'Nothing new since this morning';
  }

  const updatedTime = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' });

  if (loading || !session) return null;

  return (
    <div className="flex flex-col h-dvh bg-[#fafaf8] dark:bg-[#0a0a0a]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-12 pb-3 shrink-0">
        <div>
          <p className="text-xs font-medium text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">Today</p>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 leading-tight">{dateStr}</h1>
        </div>
        <div className="flex items-center gap-3">
          {/* TTS toggle */}
          <button
            onClick={() => { window.speechSynthesis?.cancel(); setTtsEnabled((v) => !v); }}
            className={`transition-colors ${ttsEnabled ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-300 dark:text-zinc-700'}`}
            title={ttsEnabled ? 'Voice on' : 'Voice off'}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
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
          {/* Inbox shortcut */}
          <button
            onClick={() => router.push('/inbox')}
            className="text-zinc-400 dark:text-zinc-600 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
            title="Inbox"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12H16L14 15H10L8 12H2" />
              <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Live status strip — pinned below header, refreshes on every return */}
      {statusData && (
        <div className="shrink-0 px-4 pb-2 border-b border-zinc-200/60 dark:border-zinc-800/60">
          <p className="text-[9px] font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-600 mb-0.5">
            Right now · {updatedTime}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-500 leading-snug">
            {buildStatusLine(statusData)}
          </p>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3 min-h-0">
        {!briefingLoaded && (
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
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'assistant' && (
              <div className="w-6 h-6 rounded-full bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center shrink-0 mt-1 mr-2">
                <span className="text-[9px] font-bold text-white dark:text-zinc-900">C</span>
              </div>
            )}
            <div className={`max-w-[82%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
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
            <div className="w-6 h-6 rounded-full bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center shrink-0 mt-1 mr-2">
              <span className="text-[9px] font-bold text-white dark:text-zinc-900">C</span>
            </div>
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

      {/* Voice recording indicator */}
      {voiceState === 'recording' && (
        <div className="flex items-center justify-center gap-2 py-2 shrink-0">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-xs text-red-500 font-medium">Listening…</span>
        </div>
      )}

      {/* Input row */}
      <div className="px-4 pt-2 pb-2 border-t border-zinc-100 dark:border-zinc-800 shrink-0">
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
          <button
            onClick={toggleMic}
            disabled={voiceState === 'transcribing' || sending}
            className={[
              'shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all',
              voiceState === 'recording'
                ? 'bg-red-500 text-white animate-pulse'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 disabled:opacity-40',
            ].join(' ')}
            aria-label={voiceState === 'recording' ? 'Stop recording' : 'Speak to Calliad'}
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

      {/* Spacer so input row clears the fixed BottomNav */}
      <div className="h-16 shrink-0" />
      <BottomNav />
    </div>
  );
}
