import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { listWatchers } from '@/lib/watch/watchers';
import { fetchFlightStatus, flightLine, flightStatusAvailable } from '@/lib/watch/flight';
import { upcomingCharges } from '@/lib/money/subscriptions';
import { getWeatherLocation } from '@/lib/weather/location';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';
const WMO: Record<number, string> = {
  0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'fog',
  51: 'drizzle', 53: 'drizzle', 55: 'drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain',
  66: 'freezing rain', 67: 'freezing rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow',
  80: 'showers', 81: 'showers', 82: 'heavy showers', 85: 'snow showers', 86: 'snow showers',
  95: 'thunderstorms', 96: 'thunderstorms', 99: 'severe storms',
};

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const today = new Date().toISOString().slice(0, 10);
  const in24h = new Date(Date.now() + 24 * 3600_000).toISOString();

  const [locRow, watchers, renewing, loc, evsRes] = await Promise.all([
    adminClient.from('location_events').select('place, event, at').eq('user_id', user.id)
      .order('at', { ascending: false }).limit(1).maybeSingle(),
    listWatchers(user.id).then((w) => w.filter((r) => r.status === 'active')).catch(() => []),
    upcomingCharges(user.id, 5).catch(() => [] as string[]),
    getWeatherLocation().catch(() => null),
    adminClient.from('calendar_events').select('title, start_at, end_at, all_day')
      .eq('user_id', user.id).eq('all_day', false)
      .gte('start_at', new Date().toISOString()).lte('start_at', in24h).order('start_at'),
  ]);

  // location — only if fresh (<14h)
  let location: { place: string; event: string; at: string } | null = null;
  if (locRow.data && Date.now() - Date.parse(locRow.data.at as string) < 14 * 3600_000) {
    location = { place: locRow.data.place as string, event: locRow.data.event as string, at: locRow.data.at as string };
  }

  // live flight status for any flight watcher dated today or later
  const flights: { label: string; line: string }[] = [];
  if (flightStatusAvailable()) {
    const fw = watchers.filter((w) => w.kind === 'flight' && String(w.spec?.date ?? '') >= today).slice(0, 3);
    for (const w of fw) {
      const s = await fetchFlightStatus(String(w.spec?.flightNo ?? ''), String(w.spec?.date ?? '')).catch(() => null);
      if (s) flights.push({ label: w.label, line: flightLine(String(w.spec?.flightNo ?? ''), s) });
    }
  }

  // weather — next 24h + clashes with timed events
  let weather: { now: string; tempNow: number | null; hi: number | null; lo: number | null; rainHours: number; clashes: string[] } | null = null;
  if (loc) {
    try {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
        `&current=temperature_2m,weather_code&hourly=temperature_2m,precipitation_probability,weather_code` +
        `&temperature_unit=fahrenheit&forecast_days=2&timezone=auto`;
      const r = await fetch(u, { signal: AbortSignal.timeout(9000) });
      if (r.ok) {
        const j = (await r.json()) as {
          current?: { temperature_2m?: number; weather_code?: number };
          hourly?: { time: string[]; temperature_2m: number[]; precipitation_probability: number[]; weather_code: number[] };
        };
        const H = j.hourly;
        const idxNext24 = H ? H.time.map((t, i) => ({ t: Date.parse(H.time[i].length === 16 ? `${t}:00` : t), i }))
          .filter((x) => x.t >= Date.now() && x.t <= Date.now() + 24 * 3600_000).map((x) => x.i) : [];
        const temps = idxNext24.map((i) => H!.temperature_2m[i]).filter((n) => typeof n === 'number');
        const rainHours = idxNext24.filter((i) => (H!.precipitation_probability[i] ?? 0) >= 50).length;
        const clashes: string[] = [];
        for (const ev of evsRes.data ?? []) {
          const s = new Date(ev.start_at as string);
          const e = ev.end_at ? new Date(ev.end_at as string) : new Date(s.getTime() + 3600_000);
          let p = 0;
          for (const i of idxNext24) {
            const ht = new Date(H!.time[i].length === 16 ? `${H!.time[i]}:00` : H!.time[i]);
            if (ht >= s && ht <= e) p = Math.max(p, H!.precipitation_probability[i] ?? 0);
          }
          if (p >= 50) clashes.push(`${ev.title} (${s.toLocaleTimeString('en-US', { hour: 'numeric', timeZone: TZ })}) — ${p}% rain`);
        }
        weather = {
          now: WMO[j.current?.weather_code ?? 0] ?? '—',
          tempNow: j.current?.temperature_2m ?? null,
          hi: temps.length ? Math.round(Math.max(...temps)) : null,
          lo: temps.length ? Math.round(Math.min(...temps)) : null,
          rainHours,
          clashes,
        };
      }
    } catch { /* leave weather null */ }
  }

  return NextResponse.json({
    tz: TZ,
    location,
    watchers: watchers.map((w) => ({
      id: w.id, kind: w.kind, label: w.label,
      last_checked_at: w.last_checked_at, last_change_at: w.last_change_at,
    })),
    flights,
    weather,
    renewing,
  });
}
