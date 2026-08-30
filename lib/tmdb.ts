import { GoogleGenerativeAI } from '@google/generative-ai';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY!);

export interface SeasonInfo { season: number; episodes: number | null }

export interface WatchEnrichResult {
  cleanTitle: string;
  synopsis: string;
  actors: string[];
  streaming: string[];
  type: 'TV Series' | 'Movie';
  seasons: SeasonInfo[];
  status: 'Returning' | 'Ended' | 'Cancelled' | 'Unknown';
  nextSeason: string | null;
  nextEpisodeSeason: number | null; // which season the next episode belongs to
  source: 'tmdb' | 'gemini';
}

async function tmdbFetch<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${TMDB_BASE}${path}`, {
      headers: { Authorization: `Bearer ${process.env.TMDB_API_TOKEN}` },
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

function mapTmdbStatus(status: string): WatchEnrichResult['status'] {
  if (status === 'Returning Series' || status === 'In Production') return 'Returning';
  if (status === 'Ended') return 'Ended';
  if (status === 'Canceled' || status === 'Cancelled') return 'Cancelled';
  return 'Unknown';
}

function mapStreamingProviders(watchData: Record<string, unknown> | null): string[] {
  type WatchResult = { flatrate?: { provider_name: string }[]; rent?: { provider_name: string }[] };
  const us = (watchData as { results?: { US?: WatchResult } } | null)?.results?.US;
  if (!us) return [];
  const flatrate = [...new Set((us.flatrate ?? []).map((p) => p.provider_name))];
  if (flatrate.length) return flatrate.slice(0, 5);
  if (us.rent?.length) return ['Rent/Buy'];
  return [];
}

function nextSeasonDate(
  nextEp: { air_date: string; season_number: number } | null,
  seasons: { season_number: number; air_date: string | null }[],
): string | null {
  const now = new Date();
  if (nextEp?.air_date && new Date(nextEp.air_date) > now) return nextEp.air_date;
  for (const s of seasons) {
    if (s.season_number === 0 || !s.air_date) continue;
    if (new Date(s.air_date) > now) return s.air_date;
  }
  return null;
}

async function fromTmdb(rawTitle: string): Promise<WatchEnrichResult | null> {
  const searchTitle = rawTitle.replace(/\b(TV show|TV series|series|film|movie)\b/gi, '').trim();

  // Try TV first
  const tvSearch = await tmdbFetch<{ results: { id: number; name: string }[] }>(
    `/search/tv?query=${encodeURIComponent(searchTitle)}&language=en-US&page=1`,
  );
  const tvHit = tvSearch?.results?.[0];

  if (tvHit) {
    type TvDetails = {
      name: string; overview: string; status: string;
      seasons: { season_number: number; episode_count: number; air_date: string | null }[];
      next_episode_to_air: { air_date: string; season_number: number } | null;
      credits: { cast: { name: string }[] };
    };
    const [details, watchData] = await Promise.all([
      tmdbFetch<TvDetails>(`/tv/${tvHit.id}?append_to_response=credits&language=en-US`),
      tmdbFetch<Record<string, unknown>>(`/tv/${tvHit.id}/watch/providers`),
    ]);
    if (details?.overview) {
      const realSeasons = (details.seasons ?? []).filter((s) => s.season_number > 0);
      return {
        cleanTitle: details.name,
        synopsis: details.overview,
        actors: (details.credits?.cast ?? []).slice(0, 5).map((c) => c.name),
        streaming: mapStreamingProviders(watchData),
        type: 'TV Series',
        seasons: realSeasons.map((s) => ({ season: s.season_number, episodes: s.episode_count ?? null })),
        status: mapTmdbStatus(details.status),
        nextSeason: nextSeasonDate(details.next_episode_to_air, details.seasons ?? []),
        nextEpisodeSeason: details.next_episode_to_air?.season_number ?? null,
        source: 'tmdb',
      };
    }
  }

  // Try Movie
  const movieSearch = await tmdbFetch<{ results: { id: number; title: string }[] }>(
    `/search/movie?query=${encodeURIComponent(searchTitle)}&language=en-US&page=1`,
  );
  const movieHit = movieSearch?.results?.[0];

  if (movieHit) {
    type MovieDetails = {
      title: string; overview: string; status: string;
      credits: { cast: { name: string }[] };
    };
    const [details, watchData] = await Promise.all([
      tmdbFetch<MovieDetails>(`/movie/${movieHit.id}?append_to_response=credits&language=en-US`),
      tmdbFetch<Record<string, unknown>>(`/movie/${movieHit.id}/watch/providers`),
    ]);
    if (details?.overview) {
      return {
        cleanTitle: details.title,
        synopsis: details.overview,
        actors: (details.credits?.cast ?? []).slice(0, 5).map((c) => c.name),
        streaming: mapStreamingProviders(watchData),
        type: 'Movie',
        seasons: [],
        status: details.status === 'Released' ? 'Ended' : 'Unknown',
        nextSeason: null,
        nextEpisodeSeason: null,
        source: 'tmdb',
      };
    }
  }

  return null;
}

async function fromGemini(rawTitle: string): Promise<WatchEnrichResult | null> {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
    const prompt = `You are enriching a saved show or movie for a personal watch list.

Raw title: "${rawTitle}"

Return JSON only, no markdown fences:
{
  "clean_title": "Properly formatted title",
  "synopsis": "2-3 sentence synopsis — genre, premise, main characters, tone.",
  "actors": ["Actor Name"],
  "streaming": ["Service Name"],
  "type": "TV Series" or "Movie",
  "seasons": [{"season": 1, "episodes": 8}],
  "status": "Returning" or "Ended" or "Cancelled" or "Unknown",
  "next_season": null
}`;
    const result = await model.generateContent(prompt);
    const raw = result.response.text().replace(/```json\n?|\n?```/g, '').trim();
    const p = JSON.parse(raw) as {
      clean_title: string; synopsis: string; actors: string[]; streaming: string[];
      type: string; seasons: { season: number; episodes: number | null }[];
      status: string; next_season: string | null;
    };
    if (!p.synopsis) return null;
    return {
      cleanTitle: (p.clean_title ?? rawTitle).trim(),
      synopsis: p.synopsis.trim(),
      actors: Array.isArray(p.actors) ? p.actors.slice(0, 5) : [],
      streaming: Array.isArray(p.streaming) ? p.streaming : [],
      type: p.type === 'Movie' ? 'Movie' : 'TV Series',
      seasons: Array.isArray(p.seasons) ? p.seasons.map((s) => ({ season: s.season, episodes: s.episodes ?? null })) : [],
      status: (['Returning', 'Ended', 'Cancelled'].includes(p.status) ? p.status : 'Unknown') as WatchEnrichResult['status'],
      nextSeason: null,
      nextEpisodeSeason: null,
      source: 'gemini',
    };
  } catch {
    return null;
  }
}

/** Try TMDB first (live data), fall back to Gemini for obscure titles. */
export async function enrichWatchItem(rawTitle: string): Promise<WatchEnrichResult | null> {
  return (await fromTmdb(rawTitle)) ?? fromGemini(rawTitle);
}
