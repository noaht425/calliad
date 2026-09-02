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

interface StartOpts {
  vad?: boolean; // auto-stop the recording after ~1.8s of silence (conversation mode)
}

// VAD tuning (matches what works on iOS): average AnalyserNode energy under
// SILENCE_LEVEL for SILENCE_MS, but never cut off within MIN_SPEECH_MS.
const SILENCE_LEVEL = 18;
const SILENCE_MS = 1800;
const MIN_SPEECH_MS = 1500;

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

  // Fully release the mic. Only on unmount / real app close — NOT between
  // recordings. iOS prompts on getUserMedia, so calling it once per mounted
  // session means it asks at most once (a cold app launch still asks once —
  // unavoidable for a standalone PWA).
  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Between recordings the stream stays alive with its tracks muted
  // (enabled = false) — no "mic in use" indicator, no re-prompt, instant restart.
  const detachRecorder = useCallback(() => {
    recorderRef.current = null;
    chunksRef.current = [];
    streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = false; });
  }, []);

  // true right after a real getUserMedia call (incl. the iOS permission prompt) —
  // the mic needs a beat to spin up or the first ~0.5s records as silence.
  const freshAcquire = useRef(false);
  const getStream = useCallback(async () => {
    const live = streamRef.current?.getAudioTracks().some((t) => t.readyState === 'live');
    if (streamRef.current && live) {
      streamRef.current.getAudioTracks().forEach((t) => { t.enabled = true; });
      freshAcquire.current = false;
      return streamRef.current;
    }
    streamRef.current = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    freshAcquire.current = true;
    return streamRef.current;
  }, []);

  useEffect(() => {
    window.addEventListener('pagehide', releaseStream);
    return () => {
      window.removeEventListener('pagehide', releaseStream);
      releaseStream();
    };
  }, [releaseStream]);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const vadFrameRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopVAD = useCallback(() => {
    if (vadFrameRef.current !== null) { cancelAnimationFrame(vadFrameRef.current); vadFrameRef.current = null; }
    if (silenceTimerRef.current !== null) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
  }, []);

  const stopRequested = useRef(false);
  const vadModeRef = useRef(false); // in a hands-free conversation loop
  const startRef = useRef<(o?: StartOpts) => void>(() => {});
  const stop = useCallback(() => {
    stopRequested.current = true;
    vadModeRef.current = false;
    stopVAD();
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, [stopVAD]);

  const start = useCallback(async (startOpts: StartOpts = {}) => {
    if (!supported || !session) return;
    stopRequested.current = false;
    vadModeRef.current = !!startOpts.vad;
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
        stopVAD();
        const type = recorder.mimeType || 'audio/mp4';
        const blob = new Blob(chunksRef.current, { type });
        detachRecorder();
        if (blob.size < 2048) {
          setState('idle');
          // conversation mode: nothing said — just listen again
          if (vadModeRef.current && !stopRequested.current) {
            setTimeout(() => { if (vadModeRef.current && !stopRequested.current) startRef.current({ vad: true }); }, 500);
          }
          return;
        }

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

      // conversation mode: watch the mic and stop on a silence gap
      if (startOpts.vad) {
        try {
          const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (Ctx) {
            if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
            if (audioCtxRef.current.state === 'suspended') await audioCtxRef.current.resume().catch(() => {});
            const analyser = audioCtxRef.current.createAnalyser();
            analyser.fftSize = 512;
            audioCtxRef.current.createMediaStreamSource(stream).connect(analyser);
            const data = new Uint8Array(analyser.frequencyBinCount);
            const startedAt = Date.now();
            const poll = () => {
              if (recorderRef.current?.state !== 'recording') return;
              analyser.getByteFrequencyData(data);
              const level = data.reduce((s, v) => s + v, 0) / data.length;
              if (level < SILENCE_LEVEL && Date.now() - startedAt > MIN_SPEECH_MS) {
                if (!silenceTimerRef.current) {
                  silenceTimerRef.current = setTimeout(() => {
                    silenceTimerRef.current = null;
                    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
                  }, SILENCE_MS);
                }
              } else if (silenceTimerRef.current) {
                clearTimeout(silenceTimerRef.current);
                silenceTimerRef.current = null;
              }
              vadFrameRef.current = requestAnimationFrame(poll);
            };
            vadFrameRef.current = requestAnimationFrame(poll);
          }
        } catch { /* VAD unavailable — recording still works, just no auto-stop */ }
      }
    } catch {
      releaseStream();
      recorderRef.current = null;
      setState('idle');
    }
  }, [supported, session, endpoint, pick, opts.conversationId, getStream, detachRecorder, releaseStream, stopVAD]);

  startRef.current = start;

  const toggle = useCallback(() => {
    if (state === 'recording') stop();
    else if (state === 'idle') { setError(null); void start(); }
  }, [state, start, stop]);

  return { state, error, toggle, start, stop, stopVAD, supported };
}
