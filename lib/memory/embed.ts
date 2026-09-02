// Text embeddings for the knowledge base. Gemini gemini-embedding-001 truncated
// to 768 dims (free tier). Cosine distance in pgvector normalises internally, so
// no re-normalisation needed here.

const KEY = () => process.env.GOOGLE_AI_KEY ?? '';
export const embedAvailable = () => Boolean(KEY());

export async function embed(text: string): Promise<number[] | null> {
  const key = KEY();
  const t = text.trim();
  if (!key || !t) return null;
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/gemini-embedding-001',
          content: { parts: [{ text: t.slice(0, 8000) }] },
          outputDimensionality: 768,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { embedding?: { values?: number[] } };
    const v = j.embedding?.values;
    return Array.isArray(v) && v.length === 768 ? v : null;
  } catch {
    return null;
  }
}
