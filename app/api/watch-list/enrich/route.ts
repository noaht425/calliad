import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { enrichWatchItem } from '@/lib/tmdb';

export const runtime = 'nodejs';
export const maxDuration = 60;

function needsEnrichment(meta: Record<string, unknown>): boolean {
  // Always re-enrich items that were enriched by Gemini (not TMDB) — migration
  if (meta.watch_source !== 'tmdb') return true;
  // For Returning shows enriched by TMDB, re-check every 24h
  if (meta.watch_status !== 'Returning') return false;
  const lastEnriched = meta.watch_last_enriched as string | null;
  if (lastEnriched && Date.now() - new Date(lastEnriched).getTime() < 24 * 60 * 60 * 1000) return false;
  return true;
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { capture_id?: string };
  const forceCaptureId = body?.capture_id;

  const { data: folder } = await adminClient
    .from('folders').select('id').eq('user_id', user.id).ilike('name', '%watch%').limit(1).maybeSingle();
  if (!folder) return NextResponse.json({ enriched: 0 });

  let query = adminClient
    .from('captures')
    .select('id, transcript, summary, metadata')
    .eq('user_id', user.id)
    .eq('folder_id', folder.id)
    .eq('status', 'folder');

  if (forceCaptureId) query = query.eq('id', forceCaptureId);

  const { data: captures } = await query;
  if (!captures?.length) return NextResponse.json({ enriched: 0 });

  const needsEnrich = forceCaptureId
    ? captures
    : captures.filter((c) => {
        const meta = (c.metadata ?? {}) as Record<string, unknown>;
        return !meta.watch_title || !meta.watch_type || needsEnrichment(meta);
      });

  if (!needsEnrich.length) return NextResponse.json({ enriched: 0 });

  const batch = needsEnrich.slice(0, 8);
  let enriched = 0;

  await Promise.allSettled(batch.map(async (c) => {
    const meta = (c.metadata ?? {}) as Record<string, unknown>;
    const title = (c.transcript ?? c.summary ?? '').trim();
    if (!title) return;

    const result = await enrichWatchItem(title);
    const now = new Date().toISOString();

    if (!result) {
      await adminClient.from('captures').update({
        metadata: { ...meta, watch_last_enriched: now, watch_title: meta.watch_title ?? title },
      }).eq('id', c.id);
      return;
    }

    await adminClient.from('captures').update({
      summary: result.synopsis,
      metadata: {
        ...meta,
        watch_title: result.cleanTitle,
        watch_synopsis: result.synopsis,
        watch_actors: result.actors,
        watch_streaming: result.streaming,
        watch_type: result.type,
        watch_seasons: result.seasons,
        watch_status: result.status,
        watch_next_season: result.nextSeason,
        watch_next_episode_season: result.nextEpisodeSeason,
        watch_source: result.source,
        watch_last_enriched: now,
      },
    }).eq('id', c.id);

    enriched++;
  }));

  return NextResponse.json({ enriched });
}
