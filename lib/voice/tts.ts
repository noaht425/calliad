import { audit } from '@/lib/hub/audit';

// Gemini TTS — natural voices via the same key Calliad already uses for
// embeddings, on the free preview tier. Returns a ready-to-play WAV. The legacy
// @google/generative-ai SDK can't do audio output, so this is a direct REST
// call (same as lib/memory/embed.ts).

const MODEL = 'gemini-3.1-flash-tts-preview';
const ENDPOINT = (key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;

// A safe default + the handful worth offering. Full list is ~30; these read well
// for a dry, conversational assistant.
export const GEMINI_VOICES = ['Kore', 'Charon', 'Aoede', 'Puck', 'Fenrir', 'Leda', 'Orus', 'Zephyr'] as const;
export type GeminiVoice = (typeof GEMINI_VOICES)[number];
const DEFAULT_VOICE: GeminiVoice = 'Kore';

export const geminiTtsAvailable = () => Boolean(process.env.GOOGLE_AI_KEY);

/** Wrap raw little-endian PCM16 mono in a minimal WAV container. */
function pcmToWav(pcm: Uint8Array, sampleRate = 24000): Uint8Array {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample; // mono
  const byteRate = sampleRate * blockAlign;
  const buf = new ArrayBuffer(44 + pcm.length);
  const dv = new DataView(buf);
  const str = (off: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  dv.setUint32(4, 36 + pcm.length, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true);       // PCM chunk size
  dv.setUint16(20, 1, true);        // audio format = PCM
  dv.setUint16(22, 1, true);        // channels = 1
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, byteRate, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, 16, true);       // bits per sample
  str(36, 'data');
  dv.setUint32(40, pcm.length, true);
  new Uint8Array(buf, 44).set(pcm);
  return new Uint8Array(buf);
}

function rateFromMime(mime: string): number {
  return Number(mime.match(/rate=(\d+)/)?.[1]) || 24000;
}

/** text → WAV bytes, or null on any failure (missing key, quota, parse). */
export async function synthesize(text: string, voice?: string): Promise<Uint8Array | null> {
  const key = process.env.GOOGLE_AI_KEY;
  if (!key) return null;
  const clean = text.trim().slice(0, 1200);
  if (!clean) return null;
  const v = (GEMINI_VOICES as readonly string[]).includes(voice ?? '') ? voice! : DEFAULT_VOICE;

  const started = Date.now();
  try {
    const r = await fetch(ENDPOINT(key), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: clean }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: v } } },
        },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) {
      await audit.log('error', 'system', null, { where: 'tts.synthesize', status: r.status, body: (await r.text().catch(() => '')).slice(0, 300) });
      return null;
    }
    const j = (await r.json()) as {
      candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
    };
    const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    const b64 = part?.inlineData?.data;
    if (!b64) return null;
    const pcm = Buffer.from(b64, 'base64');
    const wav = pcmToWav(new Uint8Array(pcm), rateFromMime(part!.inlineData!.mimeType ?? ''));
    await audit.modelCall({
      conversation_id: null, purpose: 'tts', tier: 'T1', model: MODEL,
      input_tokens: clean.length, cached_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0,
      cost_usd: 0, latency_ms: Date.now() - started,
    });
    return wav;
  } catch (err) {
    await audit.log('error', 'system', null, { where: 'tts.synthesize', message: String(err) });
    return null;
  }
}
