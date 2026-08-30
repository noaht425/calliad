'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import { useT } from '@/lib/i18n';

interface Props {
  onCapture: (blob: Blob) => void;
  onPhoto?: (file: File, location: { lat: number; lng: number } | null) => void;
  disabled?: boolean;
}

// Preferred MIME type — determined once at module load
const PREFERRED_MIME = (() => {
  if (typeof MediaRecorder === 'undefined') return 'audio/mp4';
  const types = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? 'audio/mp4';
})();

export function CaptureButton({ onCapture, onPhoto, disabled }: Props) {
  const t = useT();
  const [state, setState] = useState<'idle' | 'recording' | 'cancelled'>('idle');
  const [seconds, setSeconds] = useState(0);

  // Persistent stream — kept alive between recordings so iOS never re-prompts
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startYRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Shared AudioContext — kept warm so iOS hardware session stays primed
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Warm up (or resume) the AudioContext — must be called inside a user gesture
  const warmAudio = useCallback(() => {
    if (typeof AudioContext === 'undefined' && !('webkitAudioContext' in window)) return;
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new Ctx();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
  }, []);

  // Acquire (or reuse) the persistent stream
  const getStream = useCallback(async (): Promise<MediaStream> => {
    if (streamRef.current?.active) {
      // Unmute tracks — stream already granted, no re-prompt
      streamRef.current.getAudioTracks().forEach((t) => { t.enabled = true; });
      return streamRef.current;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    streamRef.current = stream;
    return stream;
  }, []);

  // Mute (not stop) tracks so the stream stays alive and permission is retained
  const muteStream = useCallback(() => {
    streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = false; });
  }, []);

  // Mute (not stop) when the screen turns off — stopping triggers iOS's audible
  // mic-off chime. Muting keeps the hardware session silent and avoids the bleep.
  // iOS may still kill the stream after a longer background period; getStream()
  // handles re-acquisition gracefully when the user returns.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = false; });
      } else {
        // Re-mute intentionally stays muted — user must tap mic to re-enable
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (timerRef.current) clearInterval(timerRef.current);
      // Actually release on unmount (component teardown, not sleep)
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const startRecording = useCallback(async (clientY: number) => {
    if (disabled) return;
    startYRef.current = clientY;
    cancelledRef.current = false;

    // Warm AudioContext inside the user gesture
    warmAudio();

    try {
      const stream = await getStream();
      const recorder = new MediaRecorder(stream, { mimeType: PREFERRED_MIME });
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        // Mute instead of stop — keeps the stream (and permission) alive
        muteStream();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        // Require at least 4KB — iOS emits an MP4 init segment (~200B) even for
        // near-instant taps; real speech produces far more data than this threshold.
        if (!cancelledRef.current && blob.size >= 4096) {
          onCapture(blob);
          navigator.vibrate?.([40, 20, 40]);
        }
        if (timerRef.current) clearInterval(timerRef.current);
        setSeconds(0);
        setState('idle');
      };

      // No timeslice — iOS produces a single complete MP4 on stop() rather than
      // fragmented segments whose init chunk (ftyp+moov) was being silently dropped.
      recorder.start();
      setState('recording');
      setSeconds(0);
      navigator.vibrate?.(15);

      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setState('idle');
    }
  }, [disabled, onCapture, warmAudio, getStream, muteStream]);

  const stopRecording = useCallback((currentY: number) => {
    const dy = startYRef.current - currentY;
    cancelledRef.current = dy > 80;
    if (cancelledRef.current) setState('cancelled');
    recorderRef.current?.stop();
  }, []);

  const handlePhotoClick = useCallback(() => {
    if (!onPhoto || disabled) return;
    fileInputRef.current?.click();
  }, [onPhoto, disabled]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onPhoto) return;
    e.target.value = '';

    let location: { lat: number; lng: number } | null = null;
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 3000 })
      );
      location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch {
      // geolocation unavailable or denied — proceed without it
    }

    onPhoto(file, location);
  }, [onPhoto]);

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="fixed bottom-0 left-0 right-0 flex flex-col items-center pb-20 pt-4 pointer-events-none">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
      {state === 'recording' && (
        <div className="mb-5 pointer-events-none flex flex-col items-center gap-2">
          <div className="flex gap-1 items-end h-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="w-1 rounded-full bg-red-500 dark:bg-red-400"
                style={{
                  height: `${30 + Math.sin(Date.now() / 200 + i) * 20}%`,
                  animation: `wave 0.8s ease-in-out ${i * 0.06}s infinite alternate`,
                }}
              />
            ))}
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
            {fmt(seconds)} · {t('capture.releaseToSave')} · {t('capture.swipeToCancel')}
          </p>
        </div>
      )}

      <div className="flex items-center gap-5">
        {onPhoto && state !== 'recording' && (
          <button
            onClick={handlePhotoClick}
            disabled={disabled}
            className={[
              'pointer-events-auto w-12 h-12 rounded-full flex items-center justify-center',
              'transition-transform duration-150 select-none',
              'shadow-[0_2px_12px_rgba(0,0,0,0.15)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.4)]',
              disabled
                ? 'bg-zinc-200 dark:bg-zinc-800'
                : 'bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 active:scale-95',
            ].join(' ')}
            aria-label="Take or choose a photo"
          >
            <CameraIcon className={disabled ? 'text-zinc-400' : 'text-zinc-600 dark:text-zinc-300'} />
          </button>
        )}
        <button
          disabled={disabled}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); startRecording(e.clientY); }}
          onPointerUp={(e) => stopRecording(e.clientY)}
          onPointerCancel={() => { cancelledRef.current = true; recorderRef.current?.stop(); }}
          className={[
            'pointer-events-auto w-20 h-20 rounded-full flex items-center justify-center',
            'transition-transform duration-150 select-none touch-none',
            'shadow-[0_4px_24px_rgba(0,0,0,0.18)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.5)]',
            state === 'recording'
              ? 'bg-red-500 scale-110'
              : disabled
              ? 'bg-zinc-300 dark:bg-zinc-700'
              : 'bg-zinc-900 dark:bg-white active:scale-95',
          ].join(' ')}
          style={{ touchAction: 'none' }}
          aria-label={state === 'recording' ? t('capture.releaseToSave') : t('capture.holdToCapture')}
        >
          {state === 'recording' ? (
            <span className="w-5 h-5 rounded-sm bg-white" />
          ) : (
            <MicIcon className={disabled ? 'text-zinc-400' : 'text-white dark:text-zinc-900'} />
          )}
        </button>
      </div>

      <style>{`
        @keyframes wave {
          from { transform: scaleY(0.4); }
          to { transform: scaleY(1); }
        }
      `}</style>
    </div>
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg className={`w-7 h-7 ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  );
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg className={`w-5 h-5 ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}
