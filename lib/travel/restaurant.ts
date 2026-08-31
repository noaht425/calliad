import { audit } from '@/lib/hub/audit';
import type { RestaurantParams } from './detect';

// Programmatic booking is closed (Resy: no public API; OpenTable: partner-only).
// So: hand Noah pre-filled search/booking links + the details. He books.

export async function restaurantHandoff(p: RestaurantParams): Promise<string> {
  await audit.log('tool_call', 'calliad', null, { tool: 'restaurant_handoff', ...p });

  const enc = encodeURIComponent;
  const term = p.name ?? '';
  const cityQ = p.city ? ` ${p.city}` : '';
  // p.dateTime is a LOCAL ISO string from T1 — use it as-is, don't round-trip UTC.
  const localIso = p.dateTime && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(p.dateTime) ? p.dateTime : null;
  const dateStr = localIso ? localIso.slice(0, 10) : '';
  const otDateTime = localIso ? localIso.slice(0, 16) : '';
  const dt = localIso ? new Date(localIso) : null;

  const links: string[] = [];
  if (term) {
    links.push(`- OpenTable: https://www.opentable.com/s?term=${enc(term)}${otDateTime ? `&dateTime=${enc(otDateTime)}` : ''}&covers=${p.party}`);
    links.push(`- Resy: https://resy.com/cities?query=${enc(term + cityQ)}${dateStr ? `&date=${dateStr}` : ''}&seats=${p.party}`);
    links.push(`- Google: https://www.google.com/search?q=${enc(term + cityQ + ' reservation')}`);
    links.push(`- Map: https://www.google.com/maps/search/${enc(term + cityQ)}`);
  } else {
    links.push(`- OpenTable near${cityQ || ' you'}: https://www.opentable.com/s?${otDateTime ? `dateTime=${enc(otDateTime)}&` : ''}covers=${p.party}${p.city ? `&metroId=&term=${enc(p.city)}` : ''}`);
    links.push(`- Google: https://www.google.com/search?q=${enc('dinner reservation' + cityQ + (dateStr ? ` ${dateStr}` : ''))}`);
  }

  const when = dt
    ? dt.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'a time you pick';

  return [
    `## Restaurant hand-off`,
    `${term ? `**${term}**` : 'A spot'}${p.city ? ` in ${p.city}` : ''} · party of ${p.party} · ${when}`,
    ``,
    ...links,
    ``,
    `### Instructions`,
    `Hand Noah these links with a one-line steer (e.g. "Resy's more likely for a place like that; OpenTable for the bigger rooms"). You can't book — he taps the link. If there'd be a cancellation fee on the booking, say so plainly. No spoilers about menus he hasn't seen.`,
  ].join('\n');
}
