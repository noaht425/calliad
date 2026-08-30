import { GoogleGenerativeAI } from '@google/generative-ai';
import { audit } from '@/lib/hub/audit';

// T1 tier — cheap classification / extraction / tagging. Gemini Flash-Lite.
// Not persona-facing. Reuse the model string Doug's deployed code uses.

// gemini-2.5-flash-lite was retired for new API keys (Aug 2026). 3.5-flash-lite
// is the current cheap tier.
const MODEL = 'gemini-3.5-flash-lite';
// Rough public rate for the Flash-Lite tier, USD per MTok. Re-check when confirmed.
const PRICE = { input: 0.1, output: 0.4 };

let client: GoogleGenerativeAI | null = null;
function genai(): GoogleGenerativeAI | null {
  if (client) return client;
  const key = process.env.GOOGLE_AI_KEY;
  if (!key) return null;
  client = new GoogleGenerativeAI(key);
  return client;
}

export function t1Available(): boolean {
  return Boolean(process.env.GOOGLE_AI_KEY);
}

/**
 * One cheap classification/extraction call. Returns parsed JSON of shape T, or
 * null on any failure (missing key, model error, unparseable). Records a
 * model_calls row.
 */
export async function t1Json<T>(
  purpose: string,
  prompt: string,
  opts: { conversationId?: string | null; maxOutputTokens?: number } = {},
): Promise<T | null> {
  const g = genai();
  if (!g) return null;

  const started = Date.now();
  try {
    const model = g.getGenerativeModel({
      model: MODEL,
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: opts.maxOutputTokens ?? 400 },
    });
    const res = await model.generateContent(prompt);
    const raw = res.response.text().replace(/```json\n?|\n?```/g, '').trim();

    const um = res.response.usageMetadata;
    const inTok = um?.promptTokenCount ?? 0;
    const outTok = um?.candidatesTokenCount ?? 0;
    const cost = (inTok * PRICE.input + outTok * PRICE.output) / 1_000_000;
    await audit.modelCall({
      conversation_id: opts.conversationId ?? null,
      purpose,
      tier: 'T1',
      model: MODEL,
      input_tokens: inTok,
      cached_read_tokens: 0,
      cache_write_tokens: 0,
      output_tokens: outTok,
      cost_usd: cost,
      latency_ms: Date.now() - started,
    });

    try {
      return JSON.parse(raw) as T;
    } catch {
      console.warn('[t1] unparseable JSON for', purpose, raw.slice(0, 200));
      return null;
    }
  } catch (err) {
    console.error('[t1]', purpose, err);
    await audit.log('error', 'system', opts.conversationId ?? null, { where: 't1Json', purpose, message: String(err) });
    return null;
  }
}
