import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';

export const runtime = 'nodejs';

// GET /api/search?q=bloomfield+hills&limit=20
// Semantic search (pgvector) + full-text fallback (GIN index), merged and deduped
export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q');
  const limit = Math.min(Number(searchParams.get('limit') ?? 20), 50);

  if (!q) return NextResponse.json({ error: 'q required' }, { status: 400 });

  // Run semantic and full-text searches in parallel
  const embedPromise = fetch(
    `https://generativelanguage.googleapis.com/v1/models/gemini-embedding-001:embedContent?key=${process.env.GOOGLE_AI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text: q }] },
        outputDimensionality: 768,
      }),
    }
  );

  // Full-text search via GIN index — catches captures without embeddings (e.g. existing email captures)
  const ftTerms = q.split(/\s+/).filter((w) => w.length > 2).join(' | ');
  const textPromise = adminClient
    .from('captures')
    .select('id,transcript,summary,tags,status,source,folder_id,created_at,metadata,trip_id')
    .eq('user_id', user.id)
    .eq('transcription_status', 'done')
    .textSearch('transcript', ftTerms, { type: 'plain', config: 'english' })
    .limit(limit);

  const [embedRes, textRes] = await Promise.all([embedPromise, textPromise]);

  // Semantic results (may fail if embedding API is down — degrade gracefully)
  let semanticResults: { id: string }[] = [];
  if (embedRes.ok) {
    const embedJson = await embedRes.json() as { embedding: { values: number[] } };
    const { data: semData } = await adminClient.rpc('search_captures', {
      query_embedding: embedJson.embedding.values,
      query_user_id: user.id,
      match_count: limit,
    });
    semanticResults = semData ?? [];
  }

  // Merge: semantic first, then text hits not already in semantic results
  const seen = new Set<string>();
  const merged = [];
  for (const r of semanticResults) {
    if (!seen.has(r.id)) { seen.add(r.id); merged.push(r); }
  }
  for (const r of (textRes.data ?? [])) {
    if (!seen.has(r.id)) { seen.add(r.id); merged.push(r); }
  }

  return NextResponse.json({ results: merged.slice(0, limit) });
}
