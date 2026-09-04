import { audit } from '@/lib/hub/audit';
import { getWeatherLocation, geocodeCity } from '@/lib/weather/location';
import { haversineKm } from '@/lib/geo/place';

// "What's actually nearby" — OpenStreetMap via the Overpass API. Free, no key,
// no signup. Gives name / cuisine / hours / distance for real POIs so a
// restaurant recommendation isn't the model guessing what exists in the area.
// No ratings (OSM has none) — Calliad cross-checks against Noah's own Beli
// scores, which is the signal that matters for him.

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const AMENITIES = 'restaurant|cafe|bar|pub|fast_food|ice_cream|bakery';

export interface Spot {
  name: string;
  cuisine: string | null;
  amenity: string | null;
  hours: string | null;
  website: string | null;
  distanceM: number;
}

interface OverpassEl {
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export async function searchSpots(opts: {
  query?: string;
  lat: number;
  lon: number;
  radiusM?: number;
  limit?: number;
}): Promise<Spot[]> {
  const radius = opts.radiusM ?? 4000;
  const ql =
    `[out:json][timeout:20];(` +
    `node["amenity"~"^(${AMENITIES})$"]["name"](around:${radius},${opts.lat},${opts.lon});` +
    `way["amenity"~"^(${AMENITIES})$"]["name"](around:${radius},${opts.lat},${opts.lon});` +
    `);out center tags 60;`;

  let els: OverpassEl[] | null = null;
  for (const url of ENDPOINTS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Calliad/1.0 (personal assistant)' },
        body: `data=${encodeURIComponent(ql)}`,
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) continue;
      els = ((await r.json()) as { elements?: OverpassEl[] }).elements ?? [];
      break;
    } catch {
      /* try the next mirror */
    }
  }
  if (!els) return [];

  const q = opts.query?.toLowerCase().trim();
  const spots = els
    .map((e): Spot | null => {
      const lat = e.lat ?? e.center?.lat;
      const lon = e.lon ?? e.center?.lon;
      const t = e.tags ?? {};
      if (!lat || !lon || !t.name) return null;
      return {
        name: t.name,
        cuisine: t.cuisine ? t.cuisine.replace(/;/g, ', ').replace(/_/g, ' ') : null,
        amenity: t.amenity ?? null,
        hours: t.opening_hours && t.opening_hours.length <= 60 ? t.opening_hours : null,
        website: t.website ?? t['contact:website'] ?? null,
        distanceM: Math.round(haversineKm({ lat: opts.lat, lon: opts.lon }, { lat, lon }) * 1000),
      };
    })
    .filter((s): s is Spot => !!s)
    .filter((s) => {
      if (!q || q === 'restaurant') return true;
      const hay = `${s.name} ${s.cuisine ?? ''} ${s.amenity ?? ''}`.toLowerCase();
      return q.split(/\s+/).some((w) => w.length > 2 && hay.includes(w));
    })
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, opts.limit ?? 10);

  await audit.log('tool_call', 'calliad', null, { tool: 'places_search', q: opts.query ?? null, hits: spots.length });
  return spots;
}

export function spotsBlock(spots: Spot[], label = 'Nearby (OpenStreetMap)'): string {
  if (!spots.length) return '';
  const mi = (m: number) => (m < 900 ? `${Math.round(m / 50) * 50} m` : `${(m / 1609).toFixed(1)} mi`);
  return (
    `## ${label}\n` +
    spots
      .map(
        (s) =>
          `- ${s.name}` +
          `${s.cuisine ? ` · ${s.cuisine}` : s.amenity && s.amenity !== 'restaurant' ? ` · ${s.amenity}` : ''}` +
          ` · ${mi(s.distanceM)}` +
          `${s.hours ? ` · ${s.hours}` : ''}`,
      )
      .join('\n') +
    `\nWhat's physically nearby (no ratings — OSM has none). Cross-check against Noah's own Beli scores and cuisine averages before naming any; treat presence here as "it exists", not "it's good".`
  );
}

const CUISINE =
  /\b(italian|thai|japanese|sushi|ramen|chinese|dim sum|korean|vietnamese|pho|indian|mexican|tacos?|pizza|french|mediterranean|greek|spanish|tapas|middle eastern|lebanese|ethiopian|bbq|barbecue|seafood|steak(house)?|burgers?|vegan|vegetarian|noodles?|dumplings?)\b/i;
const TYPE =
  /\b(caf[eé]|coffee|espresso|bakery|patisserie|dessert|ice cream|gelato|bar|cocktails?|wine bar|brewery|pub|brunch|breakfast|lunch|dinner)\b/i;
const NEAR_PLACE =
  /\b(?:in|near|around|by)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2})/;

/** "somewhere good for Thai near Cambridge" → a spotsBlock. Area from a place
 *  named in the text, else Noah's set location. '' when nothing resolves. */
export async function nearbySpotsBlock(text: string): Promise<string> {
  const place = text.match(NEAR_PLACE)?.[1];
  const loc = (place ? await geocodeCity(place).catch(() => null) : null) ?? (await getWeatherLocation());

  const query =
    text.match(CUISINE)?.[0]?.toLowerCase() ??
    text.match(TYPE)?.[0]?.toLowerCase() ??
    'restaurant';

  const spots = await searchSpots({ query, lat: loc.lat, lon: loc.lon, limit: 10 }).catch(() => []);
  if (!spots.length) return '';
  return spotsBlock(spots, `Nearby ${loc.label} (OpenStreetMap, closest first)`);
}
