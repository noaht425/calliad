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

interface Opts {
  conversationId?: string;
  endpoint?: string;                          // default /api/chat/transcribe
  pick?: (j: Record<string, unknown>) => string | undefined; // extract the result string
  busyLabel?: string;                         // status shown while the POST is in flight
}

/**
 * Hold/tap-to-record. On stop, POSTs the clip to `endpoint` and hands the picked
 * result back via `onResult`. Used for voice notes (/api/chat/transcribe) and
 * song ID (/api/song/identify). `state` is 'transcribing' during any upload.
 */
export function useVoiceInput(onResult: (text: string) => void, opts: Opts = {}) {
  const { session } = useAuth();
  const endpoint = opts.endpoint ?? '/api/chat/transcribe';
  const pick = opts.pick ?? ((j) => j.transcript as string | undefined);

  const [state, setState] = useState<VoiceState>('idle');
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cbRef = useRef(onResult);
  cbRef.current = onResult;

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
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
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
          fd.append('audio', new File([blob], `clip.${type.includes('webm') ? 'webm' : 'm4a'}`, { type }));
          if (opts.conversationId) fd.append('conversationId', opts.conversationId);
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { Authorization: `Bearer ${session.access_token}` },
            body: fd,
          });
          const j = await res.json().catch(() => ({}));
          const out = res.ok ? pick(j) : undefined;
          if (out) cbRef.current(out);
          else if (res.ok) setError('Nothing came back — try again.');
          else setError((j.error as string) || 'That failed.');
        } catch {
          setError('That failed — check your connection.');
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
  }, [supported, session, endpoint, pick, opts.conversationId, cleanup]);

  const toggle = useCallback(() => {
    if (state === 'recording') stop();
    else if (state === 'idle') { setError(null); void start(); }
  }, [state, start, stop]);

  return { state, error, toggle, start, stop, supported };
}
