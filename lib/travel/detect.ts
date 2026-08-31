import { t1Json, t1Available } from '@/lib/llm/gemini';

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';

export const isFlightQuery = (t: string) =>
  /\b(flights?\s+(from|to)|fly(ing)?\s+(from|to|home)|find (me )?a flight|book (me )?a flight|plane ticket|airfare|get me to \w+ (by|on|next)|flight search)\b/i.test(t);

export const isRestaurantQuery = (t: string) =>
  /\b(reservation|book (a )?table|dinner (reservation|somewhere|spot)|table for \d|get us into|make a booking at|somewhere for (dinner|lunch|drinks)|opentable|resy)\b/i.test(t);

export interface FlightParams {
  origin: string | null;        // IATA or city
  destination: string | null;
  departDate: string | null;    // YYYY-MM-DD
  returnDate: string | null;
  adults: number;
}

export async function extractFlight(text: string, now = new Date()): Promise<FlightParams | null> {
  if (!t1Available()) return null;
  const localNow = now.toLocaleString('en-US', { timeZone: TZ });
  const out = await t1Json<FlightParams & { ok: boolean }>(
    'extract_flight',
    `Pull flight-search parameters from Noah's request. "Now" is ${localNow} (${TZ}).
Noah context: home = Kirkland/Seattle (SEA); girlfriend in NYC (uses JFK/LGA/EWR); school = Hartford. "home" ⇒ SEA. "to Annalee" / "to NYC" ⇒ NYC (leave as "NYC", the search handles it).
Request: "${text}"

Return JSON only:
{"ok":true|false,"origin":"IATA or city or null","destination":"IATA or city or null","departDate":"YYYY-MM-DD or null","returnDate":"YYYY-MM-DD or null","adults":1}

ok=false only if there's no usable destination. Resolve relative dates ("next friday", "the 12th"). One-way ⇒ returnDate null.`,
    { maxOutputTokens: 150 },
  );
  if (!out?.ok || !out.destination) return null;
  return {
    origin: out.origin ?? null,
    destination: out.destination,
    departDate: out.departDate ?? null,
    returnDate: out.returnDate ?? null,
    adults: out.adults && out.adults > 0 ? out.adults : 1,
  };
}

export interface RestaurantParams {
  name: string | null;
  city: string | null;
  dateTime: string | null; // local ISO
  party: number;
}

export async function extractRestaurant(text: string, now = new Date()): Promise<RestaurantParams | null> {
  if (!t1Available()) return null;
  const localNow = now.toLocaleString('en-US', { timeZone: TZ });
  const out = await t1Json<RestaurantParams & { ok: boolean }>(
    'extract_restaurant',
    `Pull restaurant-booking details from Noah's request. "Now" is ${localNow} (${TZ}).
Request: "${text}"
Return JSON: {"ok":true|false,"name":"restaurant name or null","city":"city or null","dateTime":"local ISO 8601 or null","party":2}
ok=false if there's nothing to act on. If Noah gave no party size, default 2.`,
    { maxOutputTokens: 120 },
  );
  if (!out?.ok) return null;
  return { name: out.name ?? null, city: out.city ?? null, dateTime: out.dateTime ?? null, party: out.party && out.party > 0 ? out.party : 2 };
}
