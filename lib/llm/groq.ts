import { audit } from '@/lib/hub/audit';

// Groq — speech-to-text only (whisper-large-v3-turbo). Not persona-facing.
// Phase 3 Stage 1: async voice notes. Cloud STT is the early-testing fallback;
// a local Whisper is the no-recurring-cost endgame (PLAN §9 Phase 3).

const MODEL = 'whisper-large-v3-turbo';
const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const PRICE_PER_HOUR = 0.04; // USD, public rate for the turbo model

export const sttAvailable = () => Boolean(process.env.GROQ_API_KEY);

export interface Transcription {
  text: string;
  durationSec: number;
  costUsd: number;
}

/** One audio blob → transcript. Throws on transport / auth / quota failure. */
export async function transcribe(
  file: Blob,
  filename: string,
  opts: { conversationId?: string | null; language?: string } = {},
): Promise<Transcription> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY not set');

  const started = Date.now();
  const fd = new FormData();
  fd.append('file', file, filename);
  fd.append('model', MODEL);
  // Only pin a language when the caller is sure (e.g. Italian-tutor mode).
  // Otherwise let whisper-large-v3-turbo auto-detect — it's fully multilingual,
  // and Noah switches between English and Italian.
  if (opts.language) fd.append('language', opts.language);
  fd.append('prompt', 'Calliad'); // biases Whisper toward the app name
  fd.append('response_format', 'verbose_json'); // carries .duration for cost

  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: fd,
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`groq stt ${r.status}: ${body.slice(0, 200)}`);
  }

  const j = (await r.json()) as {
    text?: string;
    duration?: number;
    segments?: { no_speech_prob?: number; avg_logprob?: number }[];
  };
  let text = (j.text ?? '').trim().replace(/\b[CK]a+l+[iy]+a[dt]\b/gi, 'Calliad'); // fix common mishearings
  const durationSec = j.duration ?? 0;
  const costUsd = (durationSec / 3600) * PRICE_PER_HOUR;

  // Whisper fills silence / a broken clip with a stock phrase ("Thank you.",
  // "Grazie a tutti.", subtitle credits) or bare punctuation. Drop those before
  // they become a chat message — the mic often catches nothing on the very first
  // tap after iOS re-prompts for permission.
  const segs = j.segments ?? [];
  const meanNoSpeech = segs.length ? segs.reduce((a, s) => a + (s.no_speech_prob ?? 0), 0) / segs.length : 0;
  const meanLogprob = segs.length ? segs.reduce((a, s) => a + (s.avg_logprob ?? 0), 0) / segs.length : 0;
  const stripped = text.replace(/[\s.,!?¿¡…"'’()\-–—]/g, '').toLowerCase();
  // Note: some containers (Telegram's streamed OGG/Opus) come back with
  // duration 0 — that means "not reported", not "empty clip", so only treat a
  // *positive* sub-0.5s duration as silence.
  const noSpeech =
    stripped.length === 0 ||
    (durationSec > 0 && durationSec < 0.5) ||
    meanNoSpeech >= 0.65 ||
    (segs.length > 0 && meanNoSpeech >= 0.45 && meanLogprob < -0.85 && stripped.length <= 20);
  if (noSpeech) text = '';

  await audit.modelCall({
    conversation_id: opts.conversationId ?? null,
    purpose: 'transcribe',
    tier: 'T1',
    model: MODEL,
    input_tokens: 0,
    cached_read_tokens: 0,
    cache_write_tokens: 0,
    output_tokens: 0,
    cost_usd: costUsd,
    latency_ms: Date.now() - started,
  });

  return { text, durationSec, costUsd };
}
