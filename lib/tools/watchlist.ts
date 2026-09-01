import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';
import { searchScreen, screenDetails, tmdbAvailable } from '@/lib/tools/tmdb';
import { resolveScreenTitleViaWeb } from '@/lib/tools/resolve-title';

export type WatchStatus = 'watching' | 'want' | 'done';
export type SeasonState = 'pending' | 'watching' | 'watched';

export interface WatchRow {
  id: string;
  tmdb_id: number | null;
  media_type: 'tv' | 'movie';
  title: string;
  year: number | null;
  poster_path: string | null;
  overview: string | null;
  cast_names: string[];
  streaming: string[];
  status: WatchStatus;
  rating: number | null;
  air_status: string | null;
  next_air_date: string | null;
  total_seasons: number | null;
  seasons: { season: number; episodes: number; state: SeasonState }[];
}

const SEL =
  'id, tmdb_id, media_type, title, year, poster_path, overview, cast_names, streaming, status, rating, air_status, next_air_date, total_seasons, seasons';

export async function listWatch(userId: string): Promise<WatchRow[]> {
  const { data } = await adminClient
    .from('watch_list')
    .select(SEL)
    .eq('user_id', userId)
    .order('status')
    .order('updated_at', { ascending: false });
  return (data ?? []) as WatchRow[];
}

/** Add a title. Resolves via TMDB; if TMDB is dark, stores a bare row. */
export async function addToWatchList(
  userId: string,
  title: string,
  status: WatchStatus = 'want',
  opts: { freshOnly?: boolean } = {},
): Promise<{ row: WatchRow | null; added: boolean; note?: string }> {
  const clean = title.trim();
  if (!clean) return { row: null, added: false };

  let hit = tmdbAvailable() ? await searchScreen(clean).catch(() => null) : null;
  // "that new X show" — don't let a years-old namesake stand in for a release
  // TMDB may not have indexed yet. Better to store by name than to mis-resolve.
  if (hit && opts.freshOnly && hit.year && hit.year < new Date().getFullYear() - 2) hit = null;
  if (!hit) {
    // no TMDB match — store minimal so it isn't lost
    const { data } = await adminClient
      .from('watch_list')
      .upsert(
        { user_id: userId, media_type: 'tv', title: clean, status, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,tmdb_id,media_type', ignoreDuplicates: false },
      )
      .select(SEL)
      .maybeSingle();
    return { row: (data as WatchRow) ?? null, added: true, note: 'no TMDB match — added by name only' };
  }

  const existing = await adminClient
    .from('watch_list')
    .select('id, status')
    .eq('user_id', userId)
    .eq('tmdb_id', hit.tmdb_id)
    .eq('media_type', hit.media_type)
    .maybeSingle();
  if (existing.data) {
    if (existing.data.status !== status) {
      await adminClient.from('watch_list').update({ status, updated_at: new Date().toISOString() }).eq('id', existing.data.id);
    }
    const { data } = await adminClient.from('watch_list').select(SEL).eq('id', existing.data.id).maybeSingle();
    return { row: (data as WatchRow) ?? null, added: false, note: 'already on your list' };
  }

  const d = await screenDetails(hit.tmdb_id, hit.media_type).catch(() => null);
  const seasons = (d?.seasons ?? []).map((s) => ({ ...s, state: 'pending' as SeasonState }));
  const { data } = await adminClient
    .from('watch_list')
    .insert({
      user_id: userId,
      tmdb_id: hit.tmdb_id,
      media_type: hit.media_type,
      title: hit.title,
      year: hit.year,
      poster_path: hit.poster_path,
      overview: hit.overview,
      cast_names: d?.cast_names ?? [],
      streaming: d?.streaming ?? [],
      status,
      air_status: d?.air_status ?? null,
      next_air_date: d?.next_air_date ?? null,
      total_seasons: d?.total_seasons ?? null,
      seasons,
    })
    .select(SEL)
    .maybeSingle();
  await audit.log('outbound_message', 'calliad', null, { tool: 'watch_add', title: hit.title, status });
  return { row: (data as WatchRow) ?? null, added: true };
}

export async function setWatchStatus(userId: string, id: string, status: WatchStatus): Promise<void> {
  await adminClient.from('watch_list').update({ status, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('id', id);
}

export async function setWatchRating(userId: string, id: string, rating: number | null): Promise<void> {
  await adminClient
    .from('watch_list')
    .update({ rating, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('id', id);
  // A strong rating also seeds the taste log (the "would I like X" corpus).
  if (rating != null) {
    const { data: row } = await adminClient.from('watch_list').select('title').eq('user_id', userId).eq('id', id).maybeSingle();
    if (row?.title) {
      const verdict = rating >= 5 ? 'loved' : rating >= 4 ? 'liked' : rating >= 3 ? 'fine' : rating >= 2 ? 'disliked' : 'hated';
      await adminClient.from('taste_log').upsert(
        { user_id: userId, title: row.title, kind: 'screen', verdict, dated: new Date().toISOString().slice(0, 10) },
        { onConflict: 'user_id,title,kind' },
      ).then(() => {}, () => {}); // taste_log may not have that unique constraint — best effort
    }
  }
}

export async function setSeasonState(userId: string, id: string, season: number, state: SeasonState): Promise<WatchRow | null> {
  const { data: row } = await adminClient.from('watch_list').select('seasons, total_seasons').eq('user_id', userId).eq('id', id).maybeSingle();
  if (!row) return null;
  const seasons = ((row.seasons as WatchRow['seasons']) ?? []).map((s) => (s.season === season ? { ...s, state } : s));
  // if every season is watched and the show has ended, flip status to done
  const patch: Record<string, unknown> = { seasons, updated_at: new Date().toISOString() };
  const { data } = await adminClient.from('watch_list').update(patch).eq('user_id', userId).eq('id', id).select(SEL).maybeSingle();
  return (data as WatchRow) ?? null;
}

export async function removeWatch(userId: string, id: string): Promise<void> {
  await adminClient.from('watch_list').delete().eq('user_id', userId).eq('id', id);
}

/** Nightly-ish: re-pull next-air-date + status for shows that are still going. */
export async function refreshWatchAirDates(userId: string): Promise<number> {
  if (!tmdbAvailable()) return 0;
  const { data } = await adminClient
    .from('watch_list')
    .select('id, tmdb_id, media_type, air_status')
    .eq('user_id', userId)
    .eq('media_type', 'tv')
    .neq('status', 'done');
  let n = 0;
  for (const r of data ?? []) {
    if (!r.tmdb_id) continue;
    if (r.air_status && /ended|canceled|cancelled/i.test(r.air_status)) continue;
    const d = await screenDetails(r.tmdb_id as number, 'tv').catch(() => null);
    if (!d) continue;
    await adminClient
      .from('watch_list')
      .update({ air_status: d.air_status, next_air_date: d.next_air_date, streaming: d.streaming, updated_at: new Date().toISOString() })
      .eq('id', r.id);
    n++;
  }
  return n;
}

/** Brief block — anything airing in the next ~10 days. */
export async function watchContextLine(userId: string): Promise<string[]> {
  const { data } = await adminClient
    .from('watch_list')
    .select('title, next_air_date')
    .eq('user_id', userId)
    .neq('status', 'done')
    .not('next_air_date', 'is', null);
  const soon = (data ?? [])
    .filter((r) => {
      const t = Date.parse(r.next_air_date as string);
      return t >= Date.now() - 86400000 && t <= Date.now() + 10 * 86400000;
    })
    .sort((a, b) => Date.parse(a.next_air_date as string) - Date.parse(b.next_air_date as string));
  return soon.map((r) => {
    const d = new Date((r.next_air_date as string) + 'T12:00:00');
    return `${r.title} — new episode ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`;
  });
}

// ── chat intent ─────────────────────────────────────────────────────────
export const isWatchAdd = (t: string) =>
  /\b(add\b.{0,40}\b(watch ?list|to watch)|put\b.{0,40}\bon (my )?(watch ?list|want[- ]to[- ]watch|queue|shows)|watch ?list[:]?\s+\S|want to watch\b|start(ed)? watching\b|add\b.{0,30}\bto (my )?(shows|queue))\b/i.test(t);
export const isWatchUpdate = (t: string) =>
  /\b(i'?m (on|watching) season \d|finished season \d|done with season \d|caught up on\b|rate\b.{0,40}\b(stars?|\/5|out of 5)|give\b.{0,40}\bstars?\b|\d\s*stars?\b|finished\b.{0,40}\b(show|series|season)|marked?\b.{0,30}\bwatched)\b/i.test(t);
export const isWatchQuery = (t: string) =>
  /\b(what('?s| is) (on )?my watch ?list|what am i watching|what should i watch next|anything (airing|coming out) (soon|this week)|what'?s (airing|dropping|new) (soon|this week)|my (shows|watch ?list))\b/i.test(t);

/**
 * Strip the filler around a spoken/typed screen title so TMDB search and the
 * stored name are clean. "that new Green Lantern show. Can you add it to my
 * want to watch?" -> "Green Lantern".
 */
export function cleanScreenTitle(raw: string): string {
  // an explicit "... called / titled X" wins outright
  const named = raw.match(/\b(?:called|titled|named)\s+"?([A-Za-z0-9][\w'’&: -]*?)"?[.!?]*\s*$/i);
  if (named && named[1].trim().length >= 2) return named[1].replace(/["'`]/g, '').trim();

  let s = raw.trim();
  // a trailing new sentence — "... show. Can you add it?", "... . It sounds good."
  s = s.replace(/[.!?]\s+(can|could|would|will|i|it|please|thanks|that|this|add|put)\b.*$/i, '');
  // "... to my watch list / want to watch / queue / shows / list"
  s = s.replace(/[,\s]+\b(to|on|for)\s+(my\s+)?(watch\s?list|want(?:[- ]to[- ]watch)(?:\s+list)?|shows|queue|list|me)\b.*$/i, '');
  // leftover polite tails
  s = s.replace(/[,\s]+\b(can|could|would|will)\s+you\b.*$/i, '');
  s = s.replace(/[,\s]+\b(please|for me|thanks?|thank you)\b[\s.!?]*$/i, '');
  // "... that just came out", "... which premiered last week", "... everyone's talking about"
  s = s.replace(/[,\s]+\b(that|which)\s+(just\s+|recently\s+)?(came out|comes out|dropped|premiered|started|is out|released|aired)\b.*$/i, '');
  s = s.replace(/[,\s]+\b(everyone'?s|everybody'?s)\s+(talking about|watching|into)\b.*$/i, '');
  // leading filler — only "that/this ...", or an explicit "the/a new ..."
  let leadStripped = false;
  s = s.replace(/^(that|this)\s+(new\s+|latest\s+)?/i, () => { leadStripped = true; return ''; });
  s = s.replace(/^(the|a|an)\s+(new|latest)\s+/i, () => { leadStripped = true; return ''; });
  s = s.replace(/^(new|latest)\s+/i, () => { leadStripped = true; return ''; });
  // drop a trailing "show/series/movie/film" only when we saw leading filler,
  // so a real title like "The Morning Show" is left alone
  if (leadStripped) s = s.replace(/\s+(tv\s+)?(show|series|movie|film)\b[\s.!?]*$/i, '');
  s = s.replace(/["'`]/g, '').replace(/^[\s,:;-]+|[\s,.:;!?-]+$/g, '').trim();
  // spoken / transcribed titles arrive all-lowercase — title-case them
  if (s && s === s.toLowerCase()) s = s.replace(/\b([a-z])/g, (_m, c: string) => c.toUpperCase());
  return s;
}

export function extractWatchTitle(text: string): { title: string; status: WatchStatus; raw: string } | null {
  const status: WatchStatus =
    /\b(start(?:ed)? watching|i'?m watching|currently watching|now watching)\b/i.test(text) ? 'watching' : 'want';
  const body = text.replace(
    /^.*?\b(add|put|start(?:ed)? watching|i'?m watching|currently watching|want(?:s|ed)? to watch|need(?:s|ed)? to watch|gotta watch|have to watch|watch)\b\s*/i,
    '',
  );
  const raw = body === text ? text : body;
  const title = cleanScreenTitle(raw);
  return title.length >= 2 ? { title, status, raw } : null;
}

const FRESH_RE = /\b(new|latest|just (?:came out|dropped|released|premiered)|recently)\b/i;
// a raw phrase that reads like a *description* rather than a title — worth a
// web lookup if TMDB can't place it ("the new Green Lantern show" -> "Lanterns")
export const looksVague = (raw: string) =>
  /\b(new|latest|just|recently|show|series|movie|film|thing|one)\b/i.test(raw) || raw.trim().split(/\s+/).length >= 3;

/** Chat-facing add: clean the user's words to a title, store fast (by name if
 *  TMDB can't place it). The route schedules {@link upgradeWatchRowViaWeb} for
 *  a bare row so a vague "new X show" gets its real title filled in after. */
export async function addWatchFromText(
  userId: string,
  rawPhrase: string,
  status: WatchStatus,
  fullText: string,
): Promise<{ row: WatchRow | null; added: boolean; note?: string }> {
  const cleaned = cleanScreenTitle(rawPhrase);
  if (cleaned.length < 2) return { row: null, added: false };
  return addToWatchList(userId, cleaned, status, { freshOnly: FRESH_RE.test(fullText) });
}

/** Background (waitUntil): a bare by-name row may be a loose reference to
 *  something new. Spend one web search to pin the real title, then re-resolve
 *  through TMDB and swap the row. No-op if the row already resolved or is gone. */
export async function upgradeWatchRowViaWeb(userId: string, rowId: string, rawPhrase: string): Promise<void> {
  const { data: row } = await adminClient
    .from('watch_list')
    .select('id, tmdb_id, status, title')
    .eq('user_id', userId)
    .eq('id', rowId)
    .maybeSingle();
  if (!row || row.tmdb_id) return;

  const resolved = await resolveScreenTitleViaWeb(rawPhrase).catch(() => null);
  if (!resolved || resolved.toLowerCase() === String(row.title).toLowerCase()) return;

  const r = await addToWatchList(userId, resolved, (row.status as WatchStatus) ?? 'want').catch(() => null);
  if (r?.row && r.row.id !== rowId) {
    await adminClient.from('watch_list').delete().eq('user_id', userId).eq('id', rowId);
    await audit.log('tool_call', 'calliad', null, { tool: 'watch_upgrade', from: row.title, to: r.row.title });
  }
}

export async function matchWatchRow(userId: string, title: string): Promise<WatchRow | null> {
  const q = title.toLowerCase().replace(/^(the|a)\s+/, '').trim();
  if (q.length < 2) return null;
  const rows = await listWatch(userId);
  return (
    rows.find((r) => {
      const n = r.title.toLowerCase().replace(/^(the|a)\s+/, '');
      return n === q || n.includes(q) || q.includes(n);
    }) ?? null
  );
}

/** Apply "I'm on season 2 of X" / "rate X 4 stars" / "finished X". */
export async function applyWatchUpdate(userId: string, text: string): Promise<string | null> {
  let m =
    text.match(/\brate\s+(.+?)\s+(\d)\s*(?:stars?|\/\s*5|out of 5)?\s*$/i) ||
    text.match(/\bgave?\s+(.+?)\s+(\d)\s*stars?\b/i) ||
    text.match(/\b(.+?)\s+(\d)\s*(?:stars?|\/\s*5|out of 5)\b/i);
  if (m && +m[2] >= 1 && +m[2] <= 5) {
    const row = await matchWatchRow(userId, m[1]);
    if (!row) return null;
    await setWatchRating(userId, row.id, +m[2]);
    return `Rated ${row.title} ${'★'.repeat(+m[2])}.`;
  }

  m = text.match(/\b(?:i'?m on|watching|up to|on|starting)\s+season\s+(\d+)\s+of\s+(.+?)[.!?]?\s*$/i);
  if (m) {
    const row = await matchWatchRow(userId, m[2]);
    if (!row) return null;
    const sn = +m[1];
    for (const s of row.seasons) {
      await setSeasonState(userId, row.id, s.season, (s.season < sn ? 'watched' : s.season === sn ? 'watching' : 'pending') as SeasonState);
    }
    if (row.status !== 'watching') await setWatchStatus(userId, row.id, 'watching');
    return `Marked ${row.title} — on season ${sn}.`;
  }

  m = text.match(/\bfinished\s+season\s+(\d+)\s+of\s+(.+?)[.!?]?\s*$/i);
  if (m) {
    const row = await matchWatchRow(userId, m[2]);
    if (!row) return null;
    await setSeasonState(userId, row.id, +m[1], 'watched');
    return `Marked ${row.title} S${m[1]} watched.`;
  }

  m = text.match(/\b(?:finished|done with|caught up on|completed)\s+(.+?)[.!?]?\s*$/i);
  if (m) {
    const row = await matchWatchRow(userId, m[1]);
    if (!row) return null;
    for (const s of row.seasons) await setSeasonState(userId, row.id, s.season, 'watched');
    return `Marked ${row.title} — all caught up.`;
  }
  return null;
}

export function watchListBlock(rows: WatchRow[]): string {
  if (!rows.length) return `## Watch list\nEmpty.`;
  const fmt = (r: WatchRow) => {
    const done = r.seasons.filter((s) => s.state === 'watched').length;
    const prog = r.media_type === 'tv' && r.total_seasons ? ` — ${done}/${r.total_seasons} seasons` : '';
    const rate = r.rating ? ` — ${'★'.repeat(r.rating)}` : '';
    const svc = r.streaming.length ? ` [${r.streaming.slice(0, 2).join('/')}]` : '';
    const next = r.next_air_date ? ` · next ${r.next_air_date}` : '';
    return `- ${r.title}${r.year ? ` (${r.year})` : ''}${svc}${prog}${rate}${next}`;
  };
  const L = ['## Watch list'];
  const w = rows.filter((r) => r.status === 'watching');
  const want = rows.filter((r) => r.status === 'want');
  if (w.length) { L.push('', 'Watching:'); w.forEach((r) => L.push(fmt(r))); }
  if (want.length) { L.push('', 'Want to watch:'); want.forEach((r) => L.push(fmt(r))); }
  L.push('', 'Answer from this. Full CRUD is on the /watch screen — don\'t offer to edit it via chat unless asked.');
  return L.join('\n');
}
