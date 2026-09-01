import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';
import { t1Json, t1Available } from '@/lib/llm/gemini';
import { scanGmailQuery } from '@/lib/integrations/gmail';

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';

// Gmail search that catches most travel confirmations across categories.
export const TRAVEL_QUERY =
  'newer_than:150d (subject:(itinerary OR "confirmation number" OR "booking reference" OR "e-ticket" OR "your reservation" OR "trip confirmation" OR "flight confirmation" OR "hotel confirmation" OR "car rental" OR "booking confirmed") OR from:(booking.com OR expedia OR airbnb OR hotels.com OR marriott OR hilton OR hyatt OR ihg OR united OR delta OR aa.com OR alaskaair OR southwest OR jetblue OR "british airways" OR lufthansa OR avis OR hertz OR enterprise OR nationalcar OR budget OR sixt OR kayak OR priceline))';

export interface ParsedItem {
  kind: 'flight' | 'hotel' | 'car' | 'train' | 'activity';
  title: string;
  start_at: string | null;
  end_at: string | null;
  location: string | null;
  confirmation_number: string | null;
  travelers: string[];
}
interface Parsed {
  ok: boolean;
  destination: string | null;
  trip_start: string | null;
  trip_end: string | null;
  items: ParsedItem[];
}

async function parseOne(subject: string, from: string, body: string): Promise<Parsed | null> {
  if (!t1Available()) return null;
  const out = await t1Json<Parsed>(
    'parse_travel_email',
    `Extract travel bookings from this email. Today is ${new Date().toLocaleDateString('en-CA', { timeZone: TZ })}.
From: ${from}
Subject: ${subject}
Body (truncated):
${body.slice(0, 4000)}

Return JSON:
{"ok":true|false,
 "destination":"main city, country/state or null",
 "trip_start":"YYYY-MM-DD or null","trip_end":"YYYY-MM-DD or null",
 "items":[{"kind":"flight|hotel|car|train|activity","title":"short label e.g. 'Alaska 180 SEA→FCO' or 'Hilton Rome'","start_at":"ISO 8601 or null","end_at":"ISO 8601 or null","location":"city or airport","confirmation_number":"PNR/booking ref or null","travelers":["names if listed"]}]}

ok=false if this is marketing, a newsletter, a price alert, or has no concrete booking. Only real confirmed bookings. Use full ISO datetimes when a time is given, date-only otherwise.`,
    { maxOutputTokens: 700 },
  );
  return out && out.ok && Array.isArray(out.items) && out.items.length ? out : null;
}

/** Find or create the trip a parsed email belongs to. */
async function resolveTrip(userId: string, p: Parsed): Promise<string | null> {
  const dest = p.destination?.trim();
  const start = p.trip_start ?? p.items.map((i) => i.start_at).filter(Boolean).sort()[0]?.slice(0, 10) ?? null;
  if (!dest || !start) return null;
  const end = p.trip_end ?? null;

  const { data: trips } = await adminClient
    .from('trips')
    .select('id, destination, start_date, end_date')
    .eq('user_id', userId)
    .in('status', ['planned', 'active']);
  const destWords = dest.toLowerCase().split(/[\s,]+/).filter((w) => w.length > 3);
  for (const t of trips ?? []) {
    const td = (t.destination as string).toLowerCase();
    const nameMatch = destWords.some((w) => td.includes(w)) || td.split(/[\s,]+/).some((w) => w.length > 3 && dest.toLowerCase().includes(w));
    const s = t.start_date as string;
    const e = (t.end_date as string | null) ?? s;
    const overlap = start <= e && (end ?? start) >= s;
    if (nameMatch && (overlap || Math.abs(Date.parse(start) - Date.parse(s)) < 6 * 86400000)) return t.id as string;
  }

  const { data: created } = await adminClient
    .from('trips')
    .insert({ user_id: userId, destination: dest, start_date: start, end_date: end, home_airport: process.env.HOME_AIRPORT ?? 'SEA' })
    .select('id')
    .single();
  return (created?.id as string) ?? null;
}

/** Scan travel mail + turn new confirmations into trip_items. Returns counts. */
export async function parseTravelEmails(userId: string, opts: { max?: number } = {}): Promise<{ scanned: number; items: number; trips: number }> {
  await scanGmailQuery(userId, TRAVEL_QUERY, 'travel', { max: 25 }).catch(() => ({}));

  const { data: rows } = await adminClient
    .from('email_items')
    .select('id, from_addr, subject, body_text, snippet, received_at')
    .eq('user_id', userId)
    .eq('travel_checked', false)
    .order('received_at', { ascending: false })
    .limit(opts.max ?? 15);

  let items = 0;
  const tripIds = new Set<string>();
  for (const r of rows ?? []) {
    const p = await parseOne(r.subject ?? '', r.from_addr ?? '', r.body_text || r.snippet || '').catch(() => null);
    await adminClient.from('email_items').update({ travel_checked: true }).eq('id', r.id);
    if (!p) continue;
    const tripId = await resolveTrip(userId, p).catch(() => null);
    if (!tripId) continue;
    tripIds.add(tripId);

    for (const it of p.items) {
      const { error } = await adminClient.from('trip_items').upsert(
        {
          user_id: userId,
          trip_id: tripId,
          kind: it.kind,
          title: (it.title || it.kind).slice(0, 160),
          start_at: it.start_at,
          end_at: it.end_at,
          location: it.location,
          confirmation_number: it.confirmation_number,
          detail: { travelers: it.travelers ?? [] },
          source_email_id: r.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'trip_id,kind,confirmation_number,title', ignoreDuplicates: true },
      );
      if (!error) items++;
    }
    await adminClient.from('trip_sources').upsert(
      { user_id: userId, trip_id: tripId, email_item_id: r.id, subject: r.subject, received_at: r.received_at },
      { onConflict: 'trip_id,email_item_id', ignoreDuplicates: true },
    );
    // widen the trip's dates to cover the booking
    if (p.trip_start || p.trip_end) {
      const { data: t } = await adminClient.from('trips').select('start_date, end_date').eq('id', tripId).single();
      if (t) {
        const ns = p.trip_start && p.trip_start < (t.start_date as string) ? p.trip_start : (t.start_date as string);
        const ne = p.trip_end && p.trip_end > ((t.end_date as string) ?? '') ? p.trip_end : (t.end_date as string | null);
        if (ns !== t.start_date || ne !== t.end_date) {
          await adminClient.from('trips').update({ start_date: ns, end_date: ne, updated_at: new Date().toISOString() }).eq('id', tripId);
        }
      }
    }
  }
  await audit.log('trigger_fired', 'cron', 'travel_parse', { scanned: (rows ?? []).length, items, trips: tripIds.size });
  return { scanned: (rows ?? []).length, items, trips: tripIds.size };
}

// ── gap detection ───────────────────────────────────────────────────────
const TRANSIT_HINT = /\b(new york|nyc|chicago|boston|dc|washington|seattle|hartford|home)\b/i;

export async function refreshTripGapCards(userId: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: trips } = await adminClient
    .from('trips')
    .select('id, destination, start_date, end_date, status')
    .eq('user_id', userId)
    .in('status', ['planned', 'active'])
    .gte('start_date', today);

  let created = 0;
  for (const t of trips ?? []) {
    const { data: its } = await adminClient.from('trip_items').select('kind, start_at').eq('trip_id', t.id);
    const kinds = new Set((its ?? []).map((i) => i.kind));
    const flights = (its ?? []).filter((i) => i.kind === 'flight');
    const nights = t.end_date ? Math.round((Date.parse(t.end_date as string) - Date.parse(t.start_date as string)) / 86400000) : 0;

    const gaps: { key: string; subject: string; want: string }[] = [];
    if (flights.length && !kinds.has('hotel') && nights >= 1 && !TRANSIT_HINT.test(t.destination as string)) {
      gaps.push({ key: `hotel:${t.id}`, subject: `I don't see a hotel booked for ${t.destination}. Check Gmail for a confirmation?`, want: 'hotel' });
    }
    if (flights.length && !kinds.has('car') && nights >= 2 && !TRANSIT_HINT.test(t.destination as string)) {
      gaps.push({ key: `car:${t.id}`, subject: `No car rental for ${t.destination} — want me to look for a confirmation?`, want: 'car' });
    }
    if (flights.length === 1) {
      gaps.push({ key: `return:${t.id}`, subject: `Only one flight on file for ${t.destination}. Is the return booked?`, want: 'return_flight' });
    }

    for (const g of gaps) {
      const { data: existing } = await adminClient
        .from('curation_cards')
        .select('id')
        .eq('user_id', userId)
        .eq('anomaly_key', g.key)
        .in('status', ['open', 'dismissed'])
        .maybeSingle();
      if (existing) continue;
      await adminClient.from('curation_cards').insert({
        user_id: userId, kind: 'trip_gap', subject: g.subject, trip_id: t.id,
        options: ['Check Gmail', 'Not needed'], executor: 'check_gmail',
        executor_params: { trip_id: t.id, want: g.want }, anomaly_key: g.key,
      });
      created++;
    }
  }
  return created;
}

export async function runCurationChoice(userId: string, cardId: string, choice: string): Promise<{ message: string }> {
  const { data: card } = await adminClient
    .from('curation_cards').select('*').eq('user_id', userId).eq('id', cardId).eq('status', 'open').maybeSingle();
  if (!card) return { message: 'That card is already handled.' };

  const params = (card.executor_params ?? {}) as { trip_id?: string; want?: string };
  if (/not needed|no\b/i.test(choice)) {
    await adminClient.from('curation_cards').update({ status: 'dismissed' }).eq('id', cardId);
    return { message: 'Got it — leaving that alone.' };
  }

  // "Check Gmail": targeted re-scan + parse for this trip
  const { data: trip } = await adminClient.from('trips').select('destination, start_date').eq('id', params.trip_id).maybeSingle();
  const dest = (trip?.destination as string | undefined)?.split(',')[0] ?? '';
  const wantWord = params.want === 'hotel' ? 'hotel OR reservation' : params.want === 'car' ? '"car rental" OR "rental car"' : 'flight OR itinerary';
  await scanGmailQuery(userId, `newer_than:200d (${wantWord}) ${dest}`, 'travel', { max: 15 }).catch(() => ({}));
  // reset travel_checked for freshly-pulled matches so parseTravelEmails picks them up
  await adminClient.from('email_items').update({ travel_checked: false })
    .eq('user_id', userId).eq('label', 'travel').eq('travel_checked', true)
    .gte('received_at', new Date(Date.now() - 200 * 86400000).toISOString());
  const res = await parseTravelEmails(userId, { max: 20 }).catch(() => ({ items: 0 }));

  await adminClient.from('curation_cards').update({ status: 'resolved' }).eq('id', cardId);
  return { message: res.items ? `Found and added ${res.items} item${res.items === 1 ? '' : 's'} from Gmail.` : `Couldn't find one in Gmail — you may need to add it by hand.` };
}

// ── read for the trip detail page ───────────────────────────────────────
export async function tripDetailExtras(userId: string, tripId: string) {
  const [{ data: items }, { data: sources }, { data: cards }] = await Promise.all([
    adminClient.from('trip_items').select('id, kind, title, start_at, end_at, location, confirmation_number').eq('trip_id', tripId).order('start_at', { ascending: true, nullsFirst: false }),
    adminClient.from('trip_sources').select('id, subject, received_at').eq('trip_id', tripId).order('received_at', { ascending: false }),
    adminClient.from('curation_cards').select('id, subject, options').eq('user_id', userId).eq('trip_id', tripId).eq('status', 'open'),
  ]);
  return { items: items ?? [], sources: sources ?? [], cards: cards ?? [] };
}

export function tripItineraryBlock(dest: string, items: { kind: string; title: string; start_at: string | null; confirmation_number: string | null }[]): string {
  if (!items.length) return `## ${dest} itinerary\nNothing parsed from email yet.`;
  const L = [`## ${dest} itinerary`];
  for (const i of items) {
    const when = i.start_at ? new Date(i.start_at).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    L.push(`- ${i.kind}: ${i.title}${when ? ` · ${when}` : ''}${i.confirmation_number ? ` · ${i.confirmation_number}` : ''}`);
  }
  return L.join('\n');
}
