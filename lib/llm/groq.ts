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
  opts: { conversationId?: string | null } = {},
): Promise<Transcription> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY not set');

  const started = Date.now();
  const fd = new FormData();
  fd.append('file', file, filename);
  fd.append('model', MODEL);
  fd.append('language', 'en');
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

  const j = (await r.json()) as { text?: string; duration?: number };
  const text = (j.text ?? '').trim();
  const durationSec = j.duration ?? 0;
  const costUsd = (durationSec / 3600) * PRICE_PER_HOUR;

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
