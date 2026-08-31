import { getWeatherLocation, geocodeCity } from '@/lib/weather/location';

// Multi-day forecast. Open-Meteo, free, no key. 16 days is the real limit of
// numerical forecasting — "next month" gets 16 days plus a note that that's
// as far as any forecast goes.

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';
const MAX_DAYS = 16;

const WMO: Record<number, string> = {
  0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'fog', 48: 'freezing fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain',
  66: 'freezing rain', 67: 'heavy freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
  80: 'showers', 81: 'showers', 82: 'heavy showers',
  85: 'snow showers', 86: 'heavy snow showers',
  95: 'thunderstorms', 96: 'thunderstorms w/ hail', 99: 'severe thunderstorms',
};

const WEATHER_WORD = /\b(weather|forecast|rain|snow|temperatures?)\b/i;
const WINDOW_WORD = /\b(this week|next week|next weekend|the weekend|this weekend|next month|this month|next \d+ days?|\d+[- ]day|forecast|tomorrow|coming days?|rest of the week|over the week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

export const isWeatherQuery = (t: string) =>
  (WEATHER_WORD.test(t) && WINDOW_WORD.test(t)) || /\bweather (in|for|at) [A-Z][a-z]/.test(t);

/** Pull a day count + optional place out of the request. */
function parseWindow(text: string): { days: number; placeName: string | null } {
  const t = text.toLowerCase();
  let days = 7;
  if (/\bnext month|this month|month(ly)?\b/.test(t)) days = MAX_DAYS;
  else if (/\bnext (two|2) weeks|fortnight|14[- ]day\b/.test(t)) days = 14;
  else if (/\b(this|next|the) week|7[- ]day\b/.test(t)) days = 7;
  else if (/\b(this |the )?weekend\b/.test(t)) days = 4;
  else if (/\btomorrow\b/.test(t)) days = 2;
  const n = t.match(/\bnext (\d+) ?days?|\b(\d+)[- ]day\b/);
  if (n) days = Math.max(2, Math.min(MAX_DAYS, parseInt(n[1] || n[2], 10)));
  const p = text.match(/\bweather (?:in|for|at) ([A-Z][A-Za-z .'-]+?)(?:[,?.]|\s+(?:this|next|for|tomorrow|over)|$)/);
  return { days, placeName: p?.[1]?.trim() || null };
}

export async function runForecast(text: string): Promise<string> {
  const { days, placeName } = parseWindow(text);
  const loc = placeName ? (await geocodeCity(placeName)) ?? (await getWeatherLocation()) : await getWeatherLocation();

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
      `&temperature_unit=fahrenheit&timezone=${encodeURIComponent(TZ)}&forecast_days=${Math.min(MAX_DAYS, days)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return `## Weather\nForecast lookup failed (${r.status}).`;
    const j = (await r.json()) as {
      daily?: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[]; weather_code: number[] };
    };
    const d = j.daily;
    if (!d?.time?.length) return `## Weather\nNo forecast data came back.`;

    const rows = d.time.map((iso, i) => {
      const day = new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ });
      const pp = d.precipitation_probability_max[i] ?? 0;
      return `- ${day}: ${WMO[d.weather_code[i]] ?? 'mixed'}, ${Math.round(d.temperature_2m_max[i])}/${Math.round(d.temperature_2m_min[i])}°F${pp >= 20 ? `, ${pp}% precip` : ''}`;
    });

    const capped = days > MAX_DAYS;
    return [
      `## Weather — ${loc.label} (next ${d.time.length} days)`,
      ...rows,
      capped ? `\n(${MAX_DAYS} days is as far as forecasts go — anything beyond that is climate averages, not a forecast.)` : '',
      `\nGive Noah the gist in your voice — the shape of the week, any day that stands out (rain, cold snap, nice weekend), not a full read-out of every row unless he wants it.`,
    ].filter(Boolean).join('\n');
  } catch {
    return `## Weather\nForecast lookup errored.`;
  }
}
