// Weather + news headlines for the brief. Both free, no API key. Tolerant of
// failure — a dead feed just drops that part of the brief.

import { getWeatherLocation } from '@/lib/weather/location';

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';

// Reputable, stable, no-key RSS. Order = rough priority.
const FEEDS = [
  'https://feeds.npr.org/1001/rss.xml',
  'https://feeds.bbci.co.uk/news/world/rss.xml',
];

export interface BriefExtras {
  weather: { label: string; summary: string; highF: number; lowF: number; precipPct: number } | null;
  headlines: string[];
}

const WMO: Record<number, string> = {
  0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'fog', 48: 'freezing fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain',
  66: 'freezing rain', 67: 'heavy freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
  80: 'rain showers', 81: 'rain showers', 82: 'violent rain showers',
  85: 'snow showers', 86: 'heavy snow showers',
  95: 'thunderstorms', 96: 'thunderstorms with hail', 99: 'severe thunderstorms',
};

async function getWeather(): Promise<BriefExtras['weather']> {
  try {
    const loc = await getWeatherLocation();
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
      `&temperature_unit=fahrenheit&timezone=${encodeURIComponent(TZ)}&forecast_days=1`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { daily?: { temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[]; weather_code: number[] } };
    const d = j.daily;
    if (!d) return null;
    return {
      label: loc.label,
      summary: WMO[d.weather_code[0]] ?? 'mixed',
      highF: Math.round(d.temperature_2m_max[0]),
      lowF: Math.round(d.temperature_2m_min[0]),
      precipPct: d.precipitation_probability_max[0] ?? 0,
    };
  } catch {
    return null;
  }
}

function parseFeed(xml: string, sinceMs: number): { title: string; ts: number }[] {
  const items: { title: string; ts: number }[] = [];
  for (const block of xml.match(/<item[\s\S]*?<\/item>/g) ?? []) {
    const rawTitle = block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '';
    const title = rawTitle.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const pub = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim();
    const ts = pub ? Date.parse(pub) : Date.now();
    if (title && (!Number.isFinite(ts) || ts >= sinceMs)) items.push({ title, ts: Number.isFinite(ts) ? ts : Date.now() });
  }
  return items;
}

async function getHeadlines(): Promise<string[]> {
  const since = Date.now() - 30 * 3600 * 1000; // ~last day + buffer
  const all: { title: string; ts: number }[] = [];
  await Promise.all(
    FEEDS.map(async (f) => {
      try {
        const r = await fetch(f, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Calliad/1.0' } });
        if (r.ok) all.push(...parseFeed(await r.text(), since));
      } catch { /* skip dead feed */ }
    }),
  );
  const seen = new Set<string>();
  return all
    .sort((a, b) => b.ts - a.ts)
    .filter((h) => {
      const k = h.title.toLowerCase().slice(0, 40);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 6)
    .map((h) => h.title);
}

export async function getBriefExtras(): Promise<BriefExtras> {
  const [weather, headlines] = await Promise.all([getWeather(), getHeadlines()]);
  return { weather, headlines };
}
