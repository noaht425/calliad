'use client';
import { useCallback, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { usePathname } from 'next/navigation';
import { CaptureButton } from './CaptureButton';
import { uploadCapture, sendPhotoCapture } from '@/lib/api';
import { useT } from '@/lib/i18n';

// Custom events dispatched so the Inbox page can update its list in real-time.
// Other pages can ignore them — captures always land in the inbox.
export type CaptureStartEvent = CustomEvent<{ captureId: string; placeholder: import('@/lib/types').Capture }>;
export type CaptureDoneEvent = CustomEvent<{ capture: import('@/lib/types').Capture }>;
export type PhotoDoneEvent = CustomEvent<{ photoCap: import('@/lib/types').Capture; actionCard: import('@/lib/types').Capture }>;

function dispatch<T>(name: string, detail: T) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function GlobalCaptureBar() {
  const { session } = useAuth();
  const pathname = usePathname();
  const t = useT();
  const [uploading, setUploading] = useState(false);
  const [photoProcessing, setPhotoProcessing] = useState(false);

  const handleCapture = useCallback(async (blob: Blob) => {
    if (!session) return;
    setUploading(true);
    try {
      const capture = await uploadCapture(blob, 'pwa_button');
      dispatch<CaptureStartEvent['detail']>('calliad:capture-start', { captureId: capture.id, placeholder: capture });

      // Transcription runs async — dispatch the result when done
      import('@/lib/api').then(({ triggerTranscription }) =>
        triggerTranscription(capture.id)
          .then((result) => {
            if ('deleted' in result) {
              dispatch('calliad:capture-deleted', { captureId: capture.id });
            } else {
              dispatch<CaptureDoneEvent['detail']>('calliad:capture-done', { capture: result });
            }
          })
          .catch(() => dispatch('calliad:capture-deleted', { captureId: capture.id }))
      );
    } catch (err) {
      console.error('Capture failed:', err);
    } finally {
      setUploading(false);
    }
  }, [session]);

  const handlePhoto = useCallback(async (file: File, location: { lat: number; lng: number } | null) => {
    if (!session || photoProcessing) return;
    setPhotoProcessing(true);
    try {
      const { photoCap, actionCard } = await sendPhotoCapture(file, location);
      dispatch<PhotoDoneEvent['detail']>('calliad:photo-done', { photoCap, actionCard });
    } catch (err) {
      console.error('Photo capture failed:', err);
    } finally {
      setPhotoProcessing(false);
    }
  }, [session, photoProcessing]);

  // Today page has its own input — capture bar not needed there
  if (!session || pathname === '/') return null;

  return (
    <>
      {(uploading || photoProcessing) && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-full bg-zinc-900/90 dark:bg-zinc-100/90 text-white dark:text-zinc-900 text-xs font-medium flex items-center gap-2 shadow-lg">
          <div className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
          {photoProcessing ? t('capture.analyzingPhoto') : t('capture.savingCapture')}
        </div>
      )}
      <CaptureButton
        onCapture={handleCapture}
        onPhoto={handlePhoto}
        disabled={uploading || photoProcessing}
      />
    </>
  );
}
