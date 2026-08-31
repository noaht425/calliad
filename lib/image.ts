'use client';

// Downscale a picked photo before it goes to the API. Claude's vision caps the
// long edge at 1568px and tokens scale with pixels, so a 12MP phone photo is
// pure waste — resize to ~1400px, JPEG ~0.82, usually 80–300 KB.

const MAX_EDGE = 1400;
const QUALITY = 0.82;

export async function fileToResizedDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('not an image');

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    // Fallback: hand the raw file over as a data URL (small images, or no
    // createImageBitmap). The API still caps size.
    return await new Promise<string>((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = () => rej(new Error('read failed'));
      fr.readAsDataURL(file);
    });
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', QUALITY);
}
