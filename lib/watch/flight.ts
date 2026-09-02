// Flight-status lookups via AeroDataBox (RapidAPI). Free tier is enough for one
// traveller. Dark until RAPIDAPI_KEY is set.

const KEY = () => process.env.RAPIDAPI_KEY ?? '';
const HOST = 'aerodatabox.p.rapidapi.com';

export const flightStatusAvailable = () => Boolean(KEY());

export interface FlightStatus {
  status: string;                 // "Scheduled" | "EnRoute" | "Landed" | "Delayed" | "Canceled" | …
  depAirport: string | null;
  arrAirport: string | null;
  depTime: string | null;         // ISO, best available (estimated → scheduled)
  arrTime: string | null;
  depTerminal: string | null;
  depGate: string | null;
  arrTerminal: string | null;
  delayMin: number | null;
}

function pickTime(mv?: { local?: string; utc?: string }): string | null {
  return mv?.utc ?? mv?.local ?? null;
}

/** flightNo like "AA123", date "YYYY-MM-DD" (departure date, local). */
export async function fetchFlightStatus(flightNo: string, date: string): Promise<FlightStatus | null> {
  if (!KEY()) return null;
  const url = `https://${HOST}/flights/number/${encodeURIComponent(flightNo)}/${date}?withAircraftImage=false&withLocation=false`;
  let j: unknown;
  try {
    const r = await fetch(url, {
      headers: { 'X-RapidAPI-Key': KEY(), 'X-RapidAPI-Host': HOST },
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) return null;
    j = await r.json();
  } catch {
    return null;
  }
  const arr = Array.isArray(j) ? j : [];
  const f = arr[0] as
    | {
        status?: string;
        departure?: { airport?: { iata?: string; name?: string }; scheduledTime?: { local?: string; utc?: string }; revisedTime?: { local?: string; utc?: string }; terminal?: string; gate?: string };
        arrival?: { airport?: { iata?: string; name?: string }; scheduledTime?: { local?: string; utc?: string }; revisedTime?: { local?: string; utc?: string }; terminal?: string };
      }
    | undefined;
  if (!f) return null;

  const depSched = pickTime(f.departure?.scheduledTime);
  const depRev = pickTime(f.departure?.revisedTime);
  const delayMin =
    depSched && depRev ? Math.round((Date.parse(depRev) - Date.parse(depSched)) / 60000) : null;

  return {
    status: f.status ?? 'Unknown',
    depAirport: f.departure?.airport?.iata ?? f.departure?.airport?.name ?? null,
    arrAirport: f.arrival?.airport?.iata ?? f.arrival?.airport?.name ?? null,
    depTime: depRev ?? depSched,
    arrTime: pickTime(f.arrival?.revisedTime) ?? pickTime(f.arrival?.scheduledTime),
    depTerminal: f.departure?.terminal ?? null,
    depGate: f.departure?.gate ?? null,
    arrTerminal: f.arrival?.terminal ?? null,
    delayMin,
  };
}

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';
const clock = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: TZ }) : '—';

/** Human summary for a nudge / a chat answer. */
export function flightLine(no: string, s: FlightStatus): string {
  const route = s.depAirport && s.arrAirport ? ` ${s.depAirport}→${s.arrAirport}` : '';
  const gate = s.depGate ? `, gate ${s.depGate}` : s.depTerminal ? `, terminal ${s.depTerminal}` : '';
  const delay = s.delayMin && s.delayMin >= 15 ? ` (${s.delayMin} min late)` : '';
  return `${no}${route}: ${s.status}${delay} — dep ${clock(s.depTime)}${gate}, arr ${clock(s.arrTime)}`;
}

/** Did anything a traveller cares about change between two observations? */
export function flightChanged(prev: Partial<FlightStatus> | null, now: FlightStatus): string | null {
  if (!prev || !prev.status) return null; // first observation — baseline only
  if (/cancel/i.test(now.status) && !/cancel/i.test(prev.status ?? '')) return `${now.status} — flight cancelled.`;
  if (now.status !== prev.status && !/scheduled/i.test(now.status)) {
    return `Status: ${prev.status} → ${now.status}.`;
  }
  if (now.depGate && now.depGate !== (prev.depGate ?? null)) return `Gate ${prev.depGate ? `changed ${prev.depGate} → ` : 'set to '}${now.depGate}.`;
  const a = prev.depTime ? Date.parse(prev.depTime) : NaN;
  const b = now.depTime ? Date.parse(now.depTime) : NaN;
  if (!Number.isNaN(a) && !Number.isNaN(b) && Math.abs(b - a) >= 15 * 60000) {
    return `Departure moved to ${clock(now.depTime)}${now.delayMin && now.delayMin >= 15 ? ` (${now.delayMin} min late)` : ''}.`;
  }
  return null;
}
