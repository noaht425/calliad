import { audit } from '@/lib/hub/audit';

// Name-that-song — AudD fingerprint API (audd.io). Audio snippet → title/artist
// + streaming links; a lyric fragment → best match. Optional: no AUDD_API_TOKEN
// set means the feature is dark, same as TMDB/Amadeus.

export const songIdAvailable = () => Boolean(process.env.AUDD_API_TOKEN);

interface AudDSong {
  artist?: string;
  title?: string;
  album?: string;
  release_date?: string;
  label?: string;
  song_link?: string;
  spotify?: { external_urls?: { spotify?: string } };
  apple_music?: { url?: string };
}

function formatSong(s: AudDSong, heard: 'audio' | 'lyrics'): string {
  const bits = [
    `## Song ID — ${s.title ?? 'unknown'}${s.artist ? ` · ${s.artist}` : ''}`,
    heard === 'audio' ? '(matched from the audio)' : '(matched from the lyric fragment)',
  ];
  if (s.album) bits.push(`Album: ${s.album}${s.release_date ? ` (${s.release_date.slice(0, 4)})` : ''}`);
  if (s.label) bits.push(`Label: ${s.label}`);
  const links: string[] = [];
  if (s.spotify?.external_urls?.spotify) links.push(`[Spotify](${s.spotify.external_urls.spotify})`);
  if (s.apple_music?.url) links.push(`[Apple Music](${s.apple_music.url})`);
  if (s.song_link) links.push(`[AudD](${s.song_link})`);
  if (links.length) bits.push(links.join(' · '));
  bits.push(`\nTell Noah what it is in your voice — name, artist, a word on the album/era if it's notable. Keep the links.`);
  return bits.join('\n');
}

/** Audio blob → a ground-truth block, or a plain "no match" line. */
export async function identifySong(audio: Blob, filename: string): Promise<string> {
  const token = process.env.AUDD_API_TOKEN;
  if (!token) return `## Song ID\nNot configured (AUDD_API_TOKEN unset).`;

  const started = Date.now();
  try {
    const fd = new FormData();
    fd.append('api_token', token);
    fd.append('return', 'spotify,apple_music');
    fd.append('file', audio, filename);
    const r = await fetch('https://api.audd.io/', { method: 'POST', body: fd, signal: AbortSignal.timeout(20_000) });
    const j = (await r.json()) as { status: string; result: AudDSong | null; error?: { error_message?: string } };
    await audit.log('tool_call', 'calliad', null, {
      tool: 'song_identify', ok: j.status === 'success' && !!j.result, latency_ms: Date.now() - started,
    });
    if (j.status !== 'success') return `## Song ID\nLookup failed${j.error?.error_message ? ` — ${j.error.error_message}` : ''}.`;
    if (!j.result) return `## Song ID\nNo match — the snippet was too short, too noisy, or it's not in the database. Tell Noah plainly; don't guess.`;
    return formatSong(j.result, 'audio');
  } catch (err) {
    await audit.log('error', 'system', null, { where: 'identifySong', message: String(err) });
    return `## Song ID\nLookup errored — try again with a longer, clearer snippet.`;
  }
}

/** "what song goes '…'" — a lyric fragment → best match. */
export async function findByLyrics(query: string): Promise<string> {
  const token = process.env.AUDD_API_TOKEN;
  if (!token) return `## Song ID\nLyric search isn't configured (AUDD_API_TOKEN unset).`;
  try {
    const r = await fetch(
      `https://api.audd.io/findLyrics/?api_token=${token}&q=${encodeURIComponent(query.slice(0, 200))}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    const j = (await r.json()) as { status: string; result: AudDSong[] | null };
    await audit.log('tool_call', 'calliad', null, { tool: 'song_lyrics', ok: j.status === 'success' && !!j.result?.length });
    if (j.status !== 'success' || !j.result?.length) {
      return `## Song ID\nNo lyric match. Say so; don't guess at the song.`;
    }
    return formatSong(j.result[0], 'lyrics');
  } catch {
    return `## Song ID\nLyric search errored.`;
  }
}

export const isLyricQuery = (t: string) =>
  /\b(what('?s the| is the)? song\b.{0,40}\b(goes|lyric)|song that goes|who sings\b.{0,60}("|'|\bgoes\b)|what are the lyrics|name of the song\b.{0,40}\blyric)/i.test(t) ||
  /\bsong\b[^?]{0,60}["'].{4,}["']/i.test(t);