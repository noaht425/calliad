import { audit } from '@/lib/hub/audit';
import type { FlightParams } from './detect';

// Never books, never scrapes an airline. Produces pre-filled search links (real
// prices one click away) and lets the brain reason over them + Noah's prefs.
// (Amadeus Self-Service — the old "indicative fares" source — was decommissioned
//  in July 2026 and there's no equivalent free first-party fare API; the links
//  were always the real value anyway.)

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

export async function flightSearch(p: FlightParams, prefsLine = ''): Promise<string> {
  await audit.log('tool_call', 'calliad', null, { tool: 'flight_search', ...p });

  const lines: string[] = [
    `## Flight search — ${p.origin ?? '?'} → ${p.destination}${p.departDate ? `, ${p.departDate}` : ''}${p.returnDate ? ` – ${p.returnDate}` : ''}, ${p.adults} adult${p.adults > 1 ? 's' : ''}`,
    ``,
    `Search links (live prices):`,
    `- Google Flights: ${gflightsUrl(p)}`,
    looksAlaska(p) ? `- Alaska: https://www.alaskaair.com/search/results?A=${p.adults}${p.origin ? `&O=${p.origin}` : ''}&D=${p.destination}` : '',
    ``,
    `(No inline fares — reason from the search links + Noah's prefs.)`,
  ].filter(Boolean);

  lines.push(
    '',
    '### Instructions',
    `Present this as a shortlist in your voice. APPLY Noah's travel prefs${prefsLine ? ` — ${prefsLine}` : ' from his profile / learned facts'}; he also likes routing through a NYC airport (JFK/LGA/EWR) over Hartford. Recommend but NEVER book — hand him the link to pull the trigger himself.`,
  );
  return lines.join('\n');
}
