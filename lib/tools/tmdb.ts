// Minimal TMDB v3 client (api_key query param). Dark when TMDB_API_KEY is unset.

const KEY = () => process.env.TMDB_API_KEY ?? '';
const BASE = 'https://api.themoviedb.org/3';
const UA = 'Calliad/1.0';

async function tmdb<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  if (!KEY()) return null;
  const qs = new URLSearchParams({ api_key: KEY(), ...params });
  try {
    const r = await fetch(`${BASE}${path}?${qs}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(9000) });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export const tmdbAvailable = () => !!KEY();

function normalizeProviders(names: string[]): string[] {
  const out: string[] = [];
  for (const raw of names) {
    let n = raw
      .replace(/\s+(Amazon Channel|Apple TV Channel|with Ads|Standard with Ads|Premium|Basic|Ad-Supported)$/i, '')
      .trim();
    if (/^Apple TV\+?$/i.test(n)) n = 'Apple TV+';
    else if (/^Disney Plus$/i.test(n)) n = 'Disney+';
    else if (/^Amazon Prime Video$/i.test(n)) n = 'Prime Video';
    else if (/^Paramount Plus$/i.test(n)) n = 'Paramount+';
    else if (/^HBO Max$/i.test(n)) n = 'Max';
    if (n && !out.some((x) => x.toLowerCase() === n.toLowerCase())) out.push(n);
  }
  return out.slice(0, 3);
}
export const posterUrl = (p: string | null, size = 'w154') => (p ? `https://image.tmdb.org/t/p/${size}${p}` : null);

export interface TmdbHit {
  tmdb_id: number;
  media_type: 'tv' | 'movie';
  title: string;
  year: number | null;
  poster_path: string | null;
  overview: string | null;
}

export async function searchScreen(query: string): Promise<TmdbHit | null> {
  const j = await tmdb<{ results?: Record<string, unknown>[] }>('/search/multi', { query, include_adult: 'false' });
  const d = (j?.results ?? []).find((x) => x.media_type === 'tv' || x.media_type === 'movie') as
    | { id: number; media_type: 'tv' | 'movie'; title?: string; name?: string; overview?: string; release_date?: string; first_air_date?: string; poster_path?: string | null }
    | undefined;
  if (!d) return null;
  const year = (d.release_date ?? d.first_air_date ?? '').slice(0, 4);
  return {
    tmdb_id: d.id,
    media_type: d.media_type,
    title: d.title ?? d.name ?? query,
    year: year ? Number(year) : null,
    poster_path: d.poster_path ?? null,
    overview: d.overview ?? null,
  };
}

export interface TmdbDetails {
  air_status: string | null;
  next_air_date: string | null;
  total_seasons: number | null;
  seasons: { season: number; episodes: number }[];
  cast_names: string[];
  streaming: string[];
}

export async function screenDetails(tmdbId: number, mediaType: 'tv' | 'movie'): Promise<TmdbDetails> {
  const j = await tmdb<Record<string, unknown>>(`/${mediaType}/${tmdbId}`, {
    append_to_response: 'credits,watch/providers',
  });
  if (!j) return { air_status: null, next_air_date: null, total_seasons: null, seasons: [], cast_names: [], streaming: [] };

  const cast = ((j.credits as { cast?: { name: string }[] } | undefined)?.cast ?? []).slice(0, 6).map((c) => c.name);
  const usProviders = normalizeProviders(
    ((j['watch/providers'] as { results?: { US?: { flatrate?: { provider_name: string }[] } } } | undefined)?.results?.US
      ?.flatrate ?? []).map((p) => p.provider_name),
  );

  if (mediaType === 'movie') {
    return {
      air_status: (j.status as string) ?? null,
      next_air_date: null,
      total_seasons: null,
      seasons: [],
      cast_names: cast,
      streaming: [...new Set(usProviders)],
    };
  }

  const seasonsRaw = (j.seasons as { season_number: number; episode_count: number }[] | undefined) ?? [];
  const seasons = seasonsRaw
    .filter((s) => s.season_number >= 1)
    .map((s) => ({ season: s.season_number, episodes: s.episode_count }));
  return {
    air_status: (j.status as string) ?? null,
    next_air_date: (j.next_episode_to_air as { air_date?: string } | null | undefined)?.air_date ?? null,
    total_seasons: (j.number_of_seasons as number) ?? seasons.length,
    seasons,
    cast_names: cast,
    streaming: [...new Set(usProviders)],
  };
}
