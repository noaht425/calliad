// A venue / place string → its city + coordinates. Free, key-less: OpenStreetMap
// Nominatim (their usage policy wants a real User-Agent and ≤1 req/s — both fine
// at one person's handful of event-creates a day). Used to catch same-day plans
// that sit in different cities.

export interface Place {
  city: string | null;
  region: string | null;   // state / province
  country: string | null;  // ISO-2 where available
  lat: number;
  lon: number;
}

const UA = 'Calliad/1.0 (personal assistant; contact noaht425@gmail.com)';

/** Geocode a free-text place ("Climate Pledge Arena", "Blue Bottle, Oakland"). */
export async function geocodePlace(query: string): Promise<Place | null> {
  const q = query.trim().replace(/\s+/g, ' ');
  if (q.length < 3) return null;
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=1&addressdetails=1`,
      { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(8000) },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { lat?: string; lon?: string; address?: Record<string, string> }[];
    const h = j[0];
    if (!h?.lat || !h?.lon) return null;
    const a = h.address ?? {};
    return {
      city: a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? null,
      region: a.state ?? a.region ?? a.province ?? null,
      country: a.country_code ? a.country_code.toUpperCase() : (a.country ?? null),
      lat: parseFloat(h.lat),
      lon: parseFloat(h.lon),
    };
  } catch {
    return null;
  }
}

/** Great-circle distance in km. */
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
