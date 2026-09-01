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
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cbRef = useRef(onResult);
  cbRef.current = onResult;

  const supported =
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia;

  // Fully release the mic (stops the "in use" indicator). Next start() re-acquires.
  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Between recordings we keep the granted stream alive briefly so a burst of
  // voice notes doesn't re-prompt / re-spin the mic each time. iOS still asks
  // once per app launch — that's a standalone-PWA limitation, not something the
  // page can persist.
  const detachRecorder = useCallback(() => {
    recorderRef.current = null;
    chunksRef.current = [];
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(releaseStream, 90_000);
  }, [releaseStream]);

  // true right after a real getUserMedia call (incl. the iOS permission prompt) —
  // the mic needs a beat to spin up or the first ~0.5s records as silence.
  const freshAcquire = useRef(false);
  const getStream = useCallback(async () => {
    const live = streamRef.current?.getAudioTracks().some((t) => t.readyState === 'live');
    if (streamRef.current && live) { freshAcquire.current = false; return streamRef.current; }
    streamRef.current = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    freshAcquire.current = true;
    return streamRef.current;
  }, []);

  useEffect(() => {
    // Drop the mic when the app is backgrounded / closed so it doesn't sit hot.
    const onHidden = () => { if (document.visibilityState === 'hidden') releaseStream(); };
    window.addEventListener('pagehide', releaseStream);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', releaseStream);
      document.removeEventListener('visibilitychange', onHidden);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      releaseStream();
    };
  }, [releaseStream]);

  const stopRequested = useRef(false);
  const stop = useCallback(() => {
    stopRequested.current = true;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  const start = useCallback(async () => {
    if (!supported || !session) return;
    if (idleTimer.current) { clearTimeout(idleTimer.current); idleTimer.current = null; }
    stopRequested.current = false;
    try {
      const stream = await getStream();
      // Fresh mic (first tap / after the iOS prompt) needs a moment to spin up,
      // or the clip is silence and Whisper hallucinates a stock phrase.
      const warmup = freshAcquire.current ? 300 : 0;
      freshAcquire.current = false;
      if (warmup) {
        setState('recording');
        await new Promise((r) => setTimeout(r, warmup));
        if (stopRequested.current) { setState('idle'); return; } // let go during warmup
      }
      const recorder = new MediaRecorder(stream, PREFERRED_MIME ? { mimeType: PREFERRED_MIME } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const type = recorder.mimeType || 'audio/mp4';
        const blob = new Blob(chunksRef.current, { type });
        detachRecorder();
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
      releaseStream();
      recorderRef.current = null;
      setState('idle');
    }
  }, [supported, session, endpoint, pick, opts.conversationId, getStream, detachRecorder, releaseStream]);

  const toggle = useCallback(() => {
    if (state === 'recording') stop();
    else if (state === 'idle') { setError(null); void start(); }
  }, [state, start, stop]);

  return { state, error, toggle, start, stop, supported };
}
