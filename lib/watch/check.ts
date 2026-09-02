import { createHash } from 'node:crypto';
import { adminClient } from '@/lib/supabase.server';
import { fetchReadable } from '@/lib/tools/webfetch';
import { t1Json } from '@/lib/llm/gemini';
import { enqueueNotification } from '@/lib/hub/notify';
import { getWeatherLocation } from '@/lib/weather/location';

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';

interface DueRow {
  id: string;
  user_id: string;
  kind: string;
  label: string;
  spec: Record<string, unknown> | null;
  last_state: Record<string, unknown> | null;
  interval_min: number | null;
}

interface CheckResult {
  state?: Record<string, unknown>;
  change?: { title: string; body: string; url?: string; key?: string };
}

const RAIN_CODES = new Set([51, 53, 55, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]);
const WMO_SHORT: Record<number, string> = {
  51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle',
  61: 'Rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow',
  80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Snow showers',
  95: 'Thunderstorms', 96: 'Thunderstorms', 99: 'Severe storms',
};

// ── page watcher ──────────────────────────────────────────────────────────
async function checkPage(w: DueRow): Promise<CheckResult> {
  const url = String(w.spec?.url ?? '');
  if (!url) return {};
  const res = await fetchReadable(url);
  if (!res.ok || !res.text) return {}; // transient — keep old state, try next interval

  const norm = res.text.replace(/\s+/g, ' ').trim();
  const hash = createHash('sha1').update(norm).digest('hex');
  const prev = (w.last_state ?? {}) as { hash?: string; sample?: string; len?: number };
  const state = { hash, len: norm.length, sample: norm.slice(0, 4000), title: res.title ?? null };

  if (!prev.hash || prev.hash === hash) return { state };

  const forWhat = String(w.spec?.for ?? '').trim();
  if (forWhat) {
    const j = await t1Json<{ changed: boolean; summary: string }>(
      'watcher_page_diff',
      `A user is watching a web page for: "${forWhat}".\n\n` +
        `OLD PAGE TEXT:\n${prev.sample ?? ''}\n\nNEW PAGE TEXT:\n${norm.slice(0, 4000)}\n\n` +
        `Did the thing they care about actually change? Ignore ads, timestamps, comment/view counts, ` +
        `navigation, and unrelated edits. Reply JSON: ` +
        `{"changed": boolean, "summary": "one sentence, <=160 chars, what changed"}`,
      { maxOutputTokens: 200 },
    );
    if (!j?.changed) return { state };
    return { state, change: { title: w.label, body: (j.summary || 'It changed.').slice(0, 240), url, key: hash.slice(0, 12) } };
  }

  // no "for what" — only nudge on a non-trivial change
  const delta = Math.abs(norm.length - (prev.len ?? norm.length));
  if (delta < 200 && delta / Math.max(norm.length, 1) < 0.02) return { state };
  return {
    state,
    change: { title: w.label, body: `The page changed${res.title ? ` — "${res.title}"` : ''}.`, url, key: hash.slice(0, 12) },
  };
}

// ── weather-over-calendar watcher ─────────────────────────────────────────
async function checkWeatherEvent(w: DueRow): Promise<CheckResult> {
  const days = Math.max(1, Math.min(14, Number(w.spec?.days ?? 3)));
  const loc = await getWeatherLocation();
  const horizon = new Date(Date.now() + days * 86400_000);

  const { data: events } = await adminClient
    .from('calendar_events')
    .select('title, start_at, end_at')
    .eq('user_id', w.user_id)
    .eq('all_day', false)
    .gte('start_at', new Date().toISOString())
    .lte('start_at', horizon.toISOString())
    .order('start_at');

  const prevNotified = ((w.last_state as { notified?: Record<string, string> })?.notified) ?? {};
  // prune anything older than ~16 days so the blob doesn't grow forever
  const cutoff = new Date(Date.now() - 16 * 86400_000).toISOString().slice(0, 10);
  const notified: Record<string, string> = {};
  for (const [k, v] of Object.entries(prevNotified)) if (v >= cutoff) notified[k] = v;

  if (!events?.length) return { state: { notified } };

  const u =
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
    `&hourly=precipitation_probability,weather_code&forecast_days=${Math.min(16, days + 1)}&timezone=auto`;
  let H: { time: string[]; precipitation_probability: number[]; weather_code: number[] } | undefined;
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(10_000) });
    if (r.ok) H = ((await r.json()) as { hourly?: typeof H }).hourly;
  } catch { /* transient */ }
  if (!H?.time?.length) return { state: { notified } };

  const hits: { key: string; title: string; when: string; prob: number; desc: string }[] = [];
  for (const ev of events) {
    const start = new Date(ev.start_at as string);
    const end = ev.end_at ? new Date(ev.end_at as string) : new Date(start.getTime() + 3600_000);
    const key = `${ev.title}|${ev.start_at}`;
    if (notified[key]) continue;

    let maxProb = 0;
    let worst = 0;
    for (let i = 0; i < H.time.length; i++) {
      const ht = new Date(H.time[i].length === 16 ? `${H.time[i]}:00` : H.time[i]);
      if (ht >= start && ht <= end) {
        maxProb = Math.max(maxProb, H.precipitation_probability[i] ?? 0);
        worst = Math.max(worst, H.weather_code[i] ?? 0);
      }
    }
    if (maxProb >= 55 || RAIN_CODES.has(worst)) {
      notified[key] = new Date().toISOString().slice(0, 10);
      hits.push({
        key,
        title: String(ev.title),
        when: start.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: TZ }),
        prob: maxProb,
        desc: WMO_SHORT[worst] ?? 'Wet weather',
      });
    }
  }

  if (!hits.length) return { state: { notified } };
  const first = hits[0];
  const more = hits.length > 1 ? ` (+${hits.length - 1} more on your calendar)` : '';
  return {
    state: { notified },
    change: {
      title: 'Weather over your plans',
      body: `${first.desc} likely during “${first.title}” ${first.when} — ${first.prob}% chance${more}.`,
      key: first.key,
    },
  };
}

// ── runner (called by the tick worker) ───────────────────────────────────
export async function runDueWatchers(limit = 10): Promise<{ checked: number; changed: number }> {
  const { data: due } = await adminClient
    .from('watchers')
    .select('id, user_id, kind, label, spec, last_state, interval_min')
    .eq('status', 'active')
    .lte('next_check_at', new Date().toISOString())
    .order('next_check_at', { ascending: true })
    .limit(limit);

  let checked = 0;
  let changed = 0;
  for (const w of (due ?? []) as DueRow[]) {
    checked++;
    const interval = (w.interval_min ?? 60) * 60_000;
    const base = {
      last_checked_at: new Date().toISOString(),
      next_check_at: new Date(Date.now() + interval).toISOString(),
    };
    try {
      const res: CheckResult =
        w.kind === 'page' ? await checkPage(w) : w.kind === 'weather_event' ? await checkWeatherEvent(w) : {};
      const patch: Record<string, unknown> = { ...base };
      if (res.state !== undefined) patch.last_state = res.state;
      if (res.change) {
        patch.last_change_at = new Date().toISOString();
        await enqueueNotification(w.user_id, {
          kind: 'watcher',
          title: res.change.title,
          body: res.change.body,
          url: res.change.url,
          dedupeKey: `watcher:${w.id}:${res.change.key ?? new Date().toISOString().slice(0, 13)}`,
        });
        changed++;
      }
      await adminClient.from('watchers').update(patch).eq('id', w.id);
    } catch (err) {
      console.error('[watchers] check failed', w.id, err);
      await adminClient.from('watchers').update(base).eq('id', w.id);
    }
  }
  return { checked, changed };
}
