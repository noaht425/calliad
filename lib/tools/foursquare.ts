import { audit } from '@/lib/hub/audit';
import { getWeatherLocation, geocodeCity } from '@/lib/weather/location';

// Foursquare Places — structured "good spots near here" (name, category, rating,
// price, distance, hours) so restaurant recommendations lean on real POI data
// instead of guessing. Dark until FOURSQUARE_API_KEY is set. Free: $200/mo of
// usage credits covers one person's lookups many times over.

const BASE = 'https://places-api.foursquare.com';
const API_VERSION = '2025-06-17'; // X-Places-Api-Version (v3 was retired May 2026)

export const foursquareAvailable = () => Boolean(process.env.FOURSQUARE_API_KEY);

export interface Spot {
  name: string;
  category: string | null;
  rating: number | null;   // 0–10
  price: number | null;    // 1–4 ($ tier)
  address: string | null;
  distanceM: number | null;
  website: string | null;
  openNow: boolean | null;
}

export async function searchSpots(opts: {
  query?: string;
  lat: number;
  lon: number;
  radiusM?: number;
  limit?: number;
}): Promise<Spot[]> {
  const key = process.env.FOURSQUARE_API_KEY;
  if (!key) return [];
  const q = new URLSearchParams({
    ll: `${opts.lat},${opts.lon}`,
    radius: String(opts.radiusM ?? 8000),
    limit: String(opts.limit ?? 8),
    sort: 'RATING',
    fields: 'name,location,categories,rating,price,distance,website,hours',
  });
  if (opts.query) q.set('query', opts.query);
  try {
    const r = await fetch(`${BASE}/places/search?${q}`, {
      headers: { Authorization: `Bearer ${key}`, 'X-Places-Api-Version': API_VERSION, accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      await audit.log('error', 'system', null, { where: 'foursquare.search', status: r.status });
      return [];
    }
    const j = (await r.json()) as { results?: Record<string, unknown>[] };
    await audit.log('tool_call', 'calliad', null, { tool: 'foursquare_search', q: opts.query ?? null, hits: j.results?.length ?? 0 });
    return (j.results ?? [])
      .map((p): Spot => {
        const loc = (p.location ?? {}) as Record<string, unknown>;
        const cats = (p.categories ?? []) as { name?: string }[];
        const hours = (p.hours ?? {}) as { open_now?: boolean };
        return {
          name: String(p.name ?? ''),
          category: cats[0]?.name ?? null,
          rating: typeof p.rating === 'number' ? p.rating : null,
          price: typeof p.price === 'number' ? p.price : null,
          address: (loc.formatted_address as string) ?? (loc.address as string) ?? null,
          distanceM: typeof p.distance === 'number' ? p.distance : null,
          website: (p.website as string) ?? null,
          openNow: typeof hours.open_now === 'boolean' ? hours.open_now : null,
        };
      })
      .filter((s) => s.name);
  } catch {
    return [];
  }
}

export function spotsBlock(spots: Spot[], label = 'Nearby options (Foursquare)'): string {
  if (!spots.length) return '';
  const dollars = (n: number | null) => (n ? '$'.repeat(Math.min(4, n)) : '');
  const miles = (m: number | null) => (m ? `${(m / 1609).toFixed(1)} mi` : '');
  return (
    `## ${label}\n` +
    spots
      .map(
        (s) =>
          `- ${s.name}` +
          `${s.category ? ` · ${s.category}` : ''}` +
          `${s.rating ? ` · ${s.rating}/10` : ''}` +
          `${s.price ? ` · ${dollars(s.price)}` : ''}` +
          `${s.distanceM ? ` · ${miles(s.distanceM)}` : ''}` +
          `${s.openNow === false ? ' · closed now' : ''}` +
          `${s.address ? ` — ${s.address}` : ''}`,
      )
      .join('\n') +
    `\nStructured nearby data — cross-check against Noah's own ratings/cuisines before recommending. Not endorsements.`
  );
}

const CUISINE =
  /\b(italian|thai|japanese|sushi|ramen|chinese|dim sum|korean|vietnamese|pho|indian|mexican|tacos?|pizza|french|mediterranean|greek|spanish|tapas|middle eastern|lebanese|ethiopian|bbq|barbecue|seafood|steak(house)?|burgers?|vegan|vegetarian|noodles?|dumplings?)\b/i;
const TYPE =
  /\b(caf[eé]|coffee|espresso|bakery|patisserie|dessert|ice cream|gelato|bar|cocktails?|wine bar|brewery|pub|brunch|breakfast|lunch|dinner)\b/i;
const NEAR_PLACE =
  /\b(?:in|near|around|by)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2})/;

/**
 * "somewhere good for Thai near Cambridge" → a spotsBlock. Resolves the area
 * from a place named in the text, else Noah's set location. '' when Foursquare
 * is dark or nothing matches.
 */
export async function nearbySpotsBlock(text: string): Promise<string> {
  if (!foursquareAvailable()) return '';

  const place = text.match(NEAR_PLACE)?.[1];
  const loc = (place ? await geocodeCity(place).catch(() => null) : null) ?? (await getWeatherLocation());

  const query =
    text.match(CUISINE)?.[0]?.toLowerCase() ??
    text.match(TYPE)?.[0]?.toLowerCase() ??
    'restaurant';

  const spots = await searchSpots({ query, lat: loc.lat, lon: loc.lon, limit: 8 }).catch(() => []);
  if (!spots.length) return '';
  return spotsBlock(spots, `Nearby options near ${loc.label} (Foursquare, sorted by rating)`);
}
