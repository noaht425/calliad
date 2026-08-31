'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';

export type VoiceState = 'idle' | 'recording' | 'transcribing';

// iOS Safari only reliably records audio/mp4; recording with a timeslice drops
// the MP4 init segment there, so we never pass one to start().
const PREFERRED_MIME = (() => {
  if (typeof MediaRecorder === 'undefined') return '';
  return ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
})();

/**
 * Hold/tap-to-talk recorder. On stop, sends the clip to /api/chat/transcribe
 * and hands the transcript back via `onTranscript`. Shared by the Today chat
 * and the global panel.
 */
export function useVoiceInput(onTranscript: (text: string) => void, conversationId?: string) {
  const { session } = useAuth();
  const [state, setState] = useState<VoiceState>('idle');
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cbRef = useRef(onTranscript);
  cbRef.current = onTranscript;

  const supported =
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia;

  const cleanup = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const stop = useCallback(() => {
    recorderRef.current?.state === 'recording' && recorderRef.current.stop();
  }, []);

  const start = useCallback(async () => {
    if (!supported || !session) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, PREFERRED_MIME ? { mimeType: PREFERRED_MIME } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const type = recorder.mimeType || 'audio/mp4';
        const blob = new Blob(chunksRef.current, { type });
        cleanup();
        if (blob.size < 2048) { setState('idle'); return; } // too short / silent

        setState('transcribing');
        setError(null);
        try {
          const fd = new FormData();
          fd.append('audio', new File([blob], `note.${type.includes('webm') ? 'webm' : 'm4a'}`, { type }));
          if (conversationId) fd.append('conversationId', conversationId);
          const res = await fetch('/api/chat/transcribe', {
            method: 'POST',
            headers: { Authorization: `Bearer ${session.access_token}` },
            body: fd,
          });
          const j = await res.json().catch(() => ({}));
          if (res.ok && j.transcript) cbRef.current(j.transcript);
          else if (res.ok) setError('Didn’t catch that — try again.');
          else setError(j.error || 'Transcription failed.');
        } catch {
          setError('Transcription failed — check your connection.');
        } finally {
          setState('idle');
        }
      };

      recorder.start(); // no timeslice
      navigator.vibrate?.(15);
      setState('recording');
    } catch {
      cleanup();
      setState('idle');
    }
  }, [supported, session, conversationId, cleanup]);

  const toggle = useCallback(() => {
    if (state === 'recording') stop();
    else if (state === 'idle') { setError(null); void start(); }
  }, [state, start, stop]);

  return { state, error, toggle, start, stop, supported };
}
