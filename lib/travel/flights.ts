import { audit } from '@/lib/hub/audit';
import type { FlightParams } from './detect';

// No airline-site scraping, never books. Always produces search links (real prices
// one click away); adds indicative Amadeus fares when AMADEUS_CLIENT_ID is set
// (test-environment inventory — flag as approximate).

interface Offer {
  price: string;
  carriers: string[];
  outbound: string; // "SEA 08:15 → JFK 16:40, 1 stop, 5h25"
  inbound?: string;
}

function gflightsUrl(p: FlightParams): string {
  const parts = [`flights`];
  if (p.origin) parts.push(`from ${p.origin}`);
  parts.push(`to ${p.destination}`);
  if (p.departDate) parts.push(`on ${p.departDate}`);
  if (p.returnDate) parts.push(`returning ${p.returnDate}`);
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(parts.join(' '))}`;
}

function looksAlaska(p: FlightParams): boolean {
  const iata = /^[A-Z]{3}$/;
  const alaskaHubs = ['SEA', 'PDX', 'ANC', 'SFO', 'LAX', 'SJC', 'SAN', 'LAS', 'PHX'];
  const o = (p.origin ?? '').toUpperCase();
  const d = (p.destination ?? '').toUpperCase();
  return alaskaHubs.includes(o) || alaskaHubs.includes(d) || (o === 'SEA') || (iata.test(o) && iata.test(d));
}

async function amadeusOffers(p: FlightParams): Promise<Offer[] | null> {
  const id = process.env.AMADEUS_CLIENT_ID;
  const secret = process.env.AMADEUS_CLIENT_SECRET;
  if (!id || !secret || !p.origin || !p.destination || !p.departDate) return null;
  const iata = /^[A-Z]{3}$/i;
  if (!iata.test(p.origin) || !iata.test(p.destination)) return null; // Amadeus needs IATA

  try {
    const base = 'https://test.api.amadeus.com';
    const tok = await fetch(`${base}/v1/security/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&client_id=${id}&client_secret=${secret}`,
      signal: AbortSignal.timeout(9000),
    }).then((r) => r.json() as Promise<{ access_token?: string }>);
    if (!tok.access_token) return null;

    const q = new URLSearchParams({
      originLocationCode: p.origin.toUpperCase(),
      destinationLocationCode: p.destination.toUpperCase(),
      departureDate: p.departDate,
      adults: String(p.adults),
      currencyCode: 'USD',
      max: '6',
    });
    if (p.returnDate) q.set('returnDate', p.returnDate);

    const res = await fetch(`${base}/v2/shopping/flight-offers?${q}`, {
      headers: { Authorization: `Bearer ${tok.access_token}` },
      signal: AbortSignal.timeout(12000),
    }).then((r) => r.json() as Promise<{ data?: unknown[]; dictionaries?: { carriers?: Record<string, string> } }>);

    const carriers = res.dictionaries?.carriers ?? {};
    const leg = (it: Record<string, unknown>) => {
      const segs = (it.segments as Record<string, unknown>[]) ?? [];
      const first = segs[0] ?? {};
      const last = segs[segs.length - 1] ?? {};
      const dep = (first.departure as { iataCode?: string; at?: string }) ?? {};
      const arr = (last.arrival as { iataCode?: string; at?: string }) ?? {};
      const stops = Math.max(0, segs.length - 1);
      return `${dep.iataCode ?? '?'} ${(dep.at ?? '').slice(11, 16)} → ${arr.iataCode ?? '?'} ${(arr.at ?? '').slice(11, 16)}, ${stops === 0 ? 'nonstop' : `${stops} stop${stops > 1 ? 's' : ''}`}, ${String(it.duration ?? '').replace('PT', '').toLowerCase()}`;
    };

    return (res.data ?? []).slice(0, 6).map((oRaw) => {
      const o = oRaw as Record<string, unknown>;
      const its = (o.itineraries as Record<string, unknown>[]) ?? [];
      const carrierCodes = [...new Set(
        its.flatMap((it) => ((it.segments as Record<string, unknown>[]) ?? []).map((s) => (s as { carrierCode?: string }).carrierCode ?? '')),
      )].filter(Boolean);
      return {
        price: `$${(o.price as { grandTotal?: string })?.grandTotal ?? '?'}`,
        carriers: carrierCodes.map((c) => carriers[c] ?? c),
        outbound: its[0] ? leg(its[0]) : '',
        inbound: its[1] ? leg(its[1]) : undefined,
      };
    });
  } catch {
    return null;
  }
}

export async function flightSearch(p: FlightParams, prefsLine = ''): Promise<string> {
  const offers = await amadeusOffers(p);
  await audit.log('tool_call', 'calliad', null, { tool: 'flight_search', ...p, amadeus: Boolean(offers) });

  const lines: string[] = [
    `## Flight search — ${p.origin ?? '?'} → ${p.destination}${p.departDate ? `, ${p.departDate}` : ''}${p.returnDate ? ` – ${p.returnDate}` : ''}, ${p.adults} adult${p.adults > 1 ? 's' : ''}`,
    ``,
    `Search links (live prices):`,
    `- Google Flights: ${gflightsUrl(p)}`,
    looksAlaska(p) ? `- Alaska: https://www.alaskaair.com/search/results?A=${p.adults}${p.origin ? `&O=${p.origin}` : ''}&D=${p.destination}` : '',
  ].filter(Boolean);

  if (offers?.length) {
    lines.push('', 'Indicative fares (Amadeus test data — treat as ballpark, confirm on the airline/Google):');
    for (const o of offers) {
      lines.push(`- ${o.price} · ${o.carriers.join('/')} · out: ${o.outbound}${o.inbound ? ` · back: ${o.inbound}` : ''}`);
    }
  } else {
    lines.push('', '(No indicative fares — reason from the search links + Noah\'s prefs.)');
  }

  lines.push(
    '',
    '### Instructions',
    `Present this as a shortlist in your voice. APPLY Noah's travel prefs${prefsLine ? ` — ${prefsLine}` : ' from his profile / learned facts'}; he also likes routing through a NYC airport (JFK/LGA/EWR) over Hartford. Recommend but NEVER book — hand him the link to pull the trigger himself.`,
  );
  return lines.join('\n');
}
