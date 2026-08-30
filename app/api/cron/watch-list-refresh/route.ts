import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase.server';
import { enrichWatchItem } from '@/lib/tmdb';

export const runtime = 'nodejs';
export const maxDuration = 120;

function isSignificantChange(oldDate: string | null, newDate: string | null): boolean {
  if (!newDate) return false;
  if (!oldDate) return true;
  return oldDate !== newDate;
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: folders } = await adminClient
    .from('folders')
    .select('id, user_id')
    .ilike('name', '%watch%');

  if (!folders?.length) return NextResponse.json({ checked: 0, updated: 0, notifications: 0 });

  const folderIds = folders.map((f) => f.id);
  const folderUserMap = Object.fromEntries(folders.map((f) => [f.id, f.user_id as string]));

  const { data: captures } = await adminClient
    .from('captures')
    .select('id, folder_id, user_id, transcript, summary, metadata')
    .in('folder_id', folderIds)
    .eq('status', 'folder');

  if (!captures?.length) return NextResponse.json({ checked: 0, updated: 0, notifications: 0 });

  // Refresh returning shows not checked in the last 7 days
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const toRefresh = captures.filter((c) => {
    const meta = (c.metadata ?? {}) as Record<string, unknown>;
    if (meta.watch_status !== 'Returning') return false;
    const lastEnriched = meta.watch_last_enriched as string | null;
    if (lastEnriched && new Date(lastEnriched).getTime() > sevenDaysAgo) return false;
    return true;
  });

  const batch = toRefresh.slice(0, 30);
  let updated = 0;
  let notifications = 0;

  await Promise.allSettled(batch.map(async (c) => {
    const meta = (c.metadata ?? {}) as Record<string, unknown>;
    const title = (c.transcript ?? c.summary ?? '').trim();
    if (!title) return;

    const result = await enrichWatchItem(title);
    const now = new Date().toISOString();
    const userId = (c.user_id ?? folderUserMap[c.folder_id]) as string;

    if (!result) {
      await adminClient.from('captures').update({
        metadata: { ...meta, watch_last_enriched: now },
      }).eq('id', c.id);
      return;
    }

    const oldNextSeason = meta.watch_next_season as string | null;
    const newNextSeason = result.nextSeason;
    const showTitle = (meta.watch_title as string | undefined) ?? result.cleanTitle;
    const changed = isSignificantChange(oldNextSeason, newNextSeason);

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
        watch_next_season: newNextSeason,
        watch_next_episode_season: result.nextEpisodeSeason,
        watch_source: result.source,
        watch_last_enriched: now,
      },
    }).eq('id', c.id);

    updated++;

    if (changed && userId) {
      const prevNote = oldNextSeason ? ` (previously: ${oldNextSeason})` : '';
      const message = `Good news! The next season of ${showTitle} is scheduled for ${newNextSeason}.${prevNote}`;
      await adminClient.from('captures').insert({
        user_id: userId,
        transcript: message,
        summary: `Watch List update: ${showTitle}`,
        source: 'assistant',
        status: 'inbox',
        tags: ['watch-list', 'update'],
        transcription_status: 'done',
        metadata: { watch_notification: true, show_title: showTitle, watch_next_season: newNextSeason },
      });
      notifications++;
    }
  }));

  return NextResponse.json({ checked: batch.length, updated, notifications });
}
