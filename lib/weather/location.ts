import { config } from '@/lib/hub/config';

// Where the brief's weather is for. Stored in config as JSON {lat,lon,label};
// changed by Noah in Settings when he's away from Hartford. Open-Meteo's
// geocoding API is free and key-less.

export interface WeatherLocation { lat: number; lon: number; label: string }

const FALLBACK: WeatherLocation = { lat: 41.7637, lon: -72.6851, label: 'Hartford' };

export async function getWeatherLocation(): Promise<WeatherLocation> {
  try {
    const raw = await config.get('weather_location');
    const p = JSON.parse(raw) as Partial<WeatherLocation>;
    if (typeof p.lat === 'number' && typeof p.lon === 'number' && p.label) {
      return { lat: p.lat, lon: p.lon, label: p.label };
    }
  } catch { /* fall through */ }
  return FALLBACK;
}

export async function setWeatherLocation(loc: WeatherLocation): Promise<void> {
  await config.set('weather_location', JSON.stringify(loc));
}

/** City name → coordinates + a clean label ("Seattle, Washington"). */
export async function geocodeCity(name: string): Promise<WeatherLocation | null> {
  const q = name.trim();
  if (!q) return null;
  try {
    const r = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as {
      results?: { latitude: number; longitude: number; name: string; admin1?: string; country_code?: string }[];
    };
    const h = j.results?.[0];
    if (!h) return null;
    const label = [h.name, h.admin1].filter(Boolean).join(', ');
    return { lat: h.latitude, lon: h.longitude, label };
  } catch {
    return null;
  }
}
