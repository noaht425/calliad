import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';
import { t1Json, t1Available } from '@/lib/llm/gemini';

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';
const DEFAULT_HOME_AIRPORT = process.env.HOME_AIRPORT ?? 'SEA';

export interface Trip {
  id: string;
  destination: string;
  start_date: string;
  end_date: string | null;
  home_airport: string | null;
  has_pet: boolean;
  status: 'planned' | 'active' | 'done' | 'cancelled';
  prep_state: Record<string, string>;
}

// ── detection + extraction ────────────────────────────────────────────────
const TRIP_STRUCT =
  /\b(?:(?:i'?m )?going to be in|(?:planning|booked|taking) a trip to|i'?m (?:going|headed|flying|travel(?:l)?ing) to|heading (?:to|out to)|flying (?:to|out to)|trip to|visiting|leaving for)\s+([A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+){0,2})/i;
const TRIP_WHEN =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next (?:week|month|weekend|year)|this (?:weekend|week)|tomorrow|\d{1,2}(?:st|nd|rd|th)|\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2})\b/i;

export function isTripPlan(t: string): boolean {
  const m = t.match(TRIP_STRUCT);
  if (!m || !/^[A-Z]/.test(m[1])) return false; // destination must be a proper noun
  return TRIP_WHEN.test(t);
}

export async function extractTrip(
  text: string,
  now = new Date(),
): Promise<{ destination: string; start_date: string; end_date: string | null; has_pet: boolean } | null> {
  if (!t1Available()) return null;
  const localNow = now.toLocaleString('en-US', { timeZone: TZ });
  const out = await t1Json<{
    ok: boolean;
    destination: string | null;
    start_date: string | null;
    end_date: string | null;
    has_pet: boolean;
  }>(
    'extract_trip',
    `Pull trip details from Noah's message. "Now" is ${localNow} (${TZ}).
Message: "${text}"
Return JSON: {"ok":true|false,"destination":"City, Country or City, ST or null","start_date":"YYYY-MM-DD or null","end_date":"YYYY-MM-DD or null","has_pet":false}
ok=false unless there's a real destination AND at least a start date. Resolve relative dates ("next friday", "the 12th", "March 3-10"). If only one date is given, end_date=null. Only set has_pet=true if the message explicitly mentions a pet/dog/cat.`,
    { maxOutputTokens: 160 },
  );
  if (!out?.ok || !out.destination || !out.start_date) return null;
  return {
    destination: out.destination.trim(),
    start_date: out.start_date,
    end_date: out.end_date ?? null,
    has_pet: !!out.has_pet,
  };
}

export async function createTrip(
  userId: string,
  t: { destination: string; start_date: string; end_date: string | null; has_pet?: boolean },
): Promise<Trip | null> {
  // Fold into an existing planned trip for the same destination + start date.
  const { data: existing } = await adminClient
    .from('trips')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'planned')
    .ilike('destination', t.destination)
    .eq('start_date', t.start_date)
    .maybeSingle();
  if (existing) return null;

  const { data } = await adminClient
    .from('trips')
    .insert({
      user_id: userId,
      destination: t.destination,
      start_date: t.start_date,
      end_date: t.end_date,
      home_airport: DEFAULT_HOME_AIRPORT,
      has_pet: t.has_pet ?? false,
    })
    .select('id, destination, start_date, end_date, home_airport, has_pet, status, prep_state')
    .single();
  await audit.log('outbound_message', 'calliad', null, { action: 'trip_create', destination: t.destination, start: t.start_date });
  return (data as Trip) ?? null;
}

export async function upcomingTrips(userId: string): Promise<Trip[]> {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const { data } = await adminClient
    .from('trips')
    .select('id, destination, start_date, end_date, home_airport, has_pet, status, prep_state')
    .eq('user_id', userId)
    .in('status', ['planned', 'active'])
    .gte('start_date', today)
    .order('start_date', { ascending: true })
    .limit(10);
  return (data ?? []) as Trip[];
}

// ── prep tasks ───────────────────────────────────────────────────────────
const IDP_REQUIRED = ['italy', 'greece', 'spain', 'austria', 'japan'];
const IDP_RECOMMENDED = ['croatia', 'france', 'germany', 'mexico', 'australia', 'portugal', 'thailand', 'china', 'korea', 'poland', 'czech', 'hungary', 'turkey', 'brazil'];
const SEATAC_WEEKLY_CAP = 149; // Port of Seattle 2026 general-garage weekly cap

function idpStatus(dest: string): 'required' | 'recommended' | null {
  const d = dest.toLowerCase();
  if (IDP_REQUIRED.some((c) => d.includes(c))) return 'required';
  if (IDP_RECOMMENDED.some((c) => d.includes(c))) return 'recommended';
  return null;
}
interface PrepTask {
  key: string;
  leadDays: number;
  message: (t: Trip, days: number, tripDays: number) => string | null;
}

const PREP_TASKS: PrepTask[] = [
  {
    key: 'pet_boarding',
    leadDays: 35,
    message: (t, days) =>
      t.has_pet ? `${t.destination} in ${days} days — have you sorted pet boarding or a sitter? Good kennels book up weeks out.` : null,
  },
  {
    key: 'idp',
    leadDays: 28,
    message: (t, days) => {
      const s = idpStatus(t.destination);
      if (!s) return null;
      const lead = s === 'required' ? `An International Driving Permit is required to drive in ${t.destination}` : `Rental agencies in ${t.destination} usually want an International Driving Permit`;
      const online = days >= 21;
      const walkIn = 'Same-day walk-in ($20): AAA branch, bring passport photo + license';
      const opts = online ? `Online ($30, 2–3 wks): wa.aaa.com/travel/order-idp-online — or ${walkIn.toLowerCase()}` : `${walkIn} (online delivery won't arrive in time now)`;
      return `${lead}. Do you have a current one? ${opts}.`;
    },
  },
  {
    key: 'amazon_subscribe_save',
    leadDays: 14,
    message: (t, days, tripDays) =>
      tripDays >= 4
        ? `You leave for ${t.destination} in ${days} days. Check Amazon Subscribe & Save and skip anything that'd deliver while you're away (Account → Subscribe & Save; act 5–7 days before each item's cutoff).`
        : null,
  },
  {
    key: 'mail_hold',
    leadDays: 7,
    message: (t, days, tripDays) =>
      tripDays >= 4
        ? `${days} days to ${t.destination}. Set delivery holds: USPS Mail Hold (free, usps.com/manage/hold-mail), and pause FedEx Delivery Manager / UPS My Choice if you're expecting packages.`
        : null,
  },
  {
    key: 'bank_and_rx',
    leadDays: 7,
    message: (t, days) =>
      `${days} days before ${t.destination}: tell your bank/cards your travel dates so a foreign charge doesn't get blocked, and refill any prescriptions with enough supply for the trip.`,
  },
  {
    key: 'airport_transport',
    leadDays: 6,
    message: (t, days, tripDays) => {
      if ((t.home_airport ?? '').toUpperCase() !== 'SEA') return null;
      const weeks = Math.max(1, Math.ceil(tripDays / 7));
      const parking = weeks * SEATAC_WEEKLY_CAP;
      const call = parking > 200 ? 'Uber/Lyft likely wins' : parking <= 150 ? 'parking likely wins' : "it's close — watch early-morning surge";
      return `Airport plan for ${t.destination} (${days} days out)? SEA-TAC garage caps at $${SEATAC_WEEKLY_CAP}/wk → ~$${parking} for this trip; Uber/Lyft round trip from Kirkland runs ~$150–$200. ${call}.`;
    },
  },
];

export interface TripPrepNudge {
  tripId: string;
  key: string;
  message: string;
}

export async function tripPrepNudges(userId: string, max = 2): Promise<TripPrepNudge[]> {
  const trips = await upcomingTrips(userId);
  const todayMs = Date.now();
  const out: TripPrepNudge[] = [];
  for (const trip of trips) {
    const start = new Date(trip.start_date + 'T12:00:00');
    const days = Math.ceil((start.getTime() - todayMs) / 86400000);
    if (days < 0) continue;
    const end = trip.end_date ? new Date(trip.end_date + 'T12:00:00') : start;
    const tripDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) || 1);
    for (const task of PREP_TASKS) {
      if (days > task.leadDays) continue;
      if (trip.prep_state?.[task.key]) continue;
      const msg = task.message(trip, days, tripDays);
      if (!msg) continue;
      out.push({ tripId: trip.id, key: task.key, message: msg });
      if (out.length >= max) return out;
    }
  }
  return out;
}

export async function markPrepSent(tripId: string, key: string): Promise<void> {
  const { data } = await adminClient.from('trips').select('prep_state').eq('id', tripId).single();
  const state = ((data?.prep_state as Record<string, string>) ?? {});
  state[key] = 'sent';
  await adminClient.from('trips').update({ prep_state: state, updated_at: new Date().toISOString() }).eq('id', tripId);
}

/** One short block for the brain so chat answers know about upcoming trips. */
export async function tripsContextLine(userId: string): Promise<string> {
  const trips = await upcomingTrips(userId);
  if (!trips.length) return '';
  const lines = trips.slice(0, 5).map((t) => {
    const range = t.end_date ? `${t.start_date} → ${t.end_date}` : t.start_date;
    return `- ${t.destination}: ${range}`;
  });
  return `## Upcoming trips\n${lines.join('\n')}\nCalliad tracks these for prep nudges; mention prep only if Noah asks or a departure is close.`;
}
