import { adminClient } from '@/lib/supabase.server';
import { geocodePlace, haversineKm } from '@/lib/geo/place';

// "You're in Seattle that day" — when a new event lands in a different city from
// something already on the calendar the same day, say so. Coordinates are
// resolved lazily and cached back onto the row, so each venue is geocoded once.

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';
const FAR_KM = 250; // far enough apart that you can't reasonably be at both

export interface GeoEvent {
  start_at: string;
  location?: string | null;
  city?: string | null;
  lat?: number | null;
  lon?: number | null;
}

const localDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });

async function coordsFor(ev: GeoEvent): Promise<{ lat: number; lon: number } | null> {
  if (typeof ev.lat === 'number' && typeof ev.lon === 'number') return { lat: ev.lat, lon: ev.lon };
  const q = ev.location || ev.city;
  if (!q) return null;
  const p = await geocodePlace(q).catch(() => null);
  return p ? { lat: p.lat, lon: p.lon } : null;
}

/**
 * A one-line warning if `ev` sits >~250 km from another event the same local
 * day, else null. Safe to call on every calendar create — no-ops when the new
 * event or every same-day event lacks a resolvable place.
 */
export async function sameDayConflict(userId: string, ev: GeoEvent): Promise<string | null> {
  const here = await coordsFor(ev);
  if (!here) return null;

  const day = localDate(ev.start_at);
  const anchor = new Date(`${day}T12:00:00`);
  const { data } = await adminClient
    .from('calendar_events')
    .select('id, title, location, city, lat, lon, geo_resolved_at, start_at, all_day')
    .eq('user_id', userId)
    .gte('start_at', new Date(anchor.getTime() - 24 * 3600_000).toISOString())
    .lte('start_at', new Date(anchor.getTime() + 24 * 3600_000).toISOString());

  for (const row of data ?? []) {
    if (localDate(row.start_at as string) !== day) continue;

    let coords: { lat: number; lon: number } | null =
      typeof row.lat === 'number' && typeof row.lon === 'number'
        ? { lat: row.lat as number, lon: row.lon as number }
        : null;

    // geocode this row once, then remember the answer (or the give-up)
    if (!coords && row.location && !row.geo_resolved_at) {
      const p = await geocodePlace(row.location as string).catch(() => null);
      await adminClient
        .from('calendar_events')
        .update({
          city: p?.city ?? null,
          region: p?.region ?? null,
          country: p?.country ?? null,
          lat: p?.lat ?? null,
          lon: p?.lon ?? null,
          geo_resolved_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      if (p) coords = { lat: p.lat, lon: p.lon };
    }
    if (!coords) continue;

    if (haversineKm(here, coords) >= FAR_KM) {
      const where = (row.city as string | null) || (row.location as string | null) || 'a different city';
      return `you've also got "${row.title}" in ${where} that day`;
    }
  }
  return null;
}
