import { adminClient } from './supabase.server';

// Countries where a US IDP is legally required or strongly expected by rental agencies
const IDP_REQUIRED_COUNTRIES = ['italy', 'greece', 'spain', 'austria', 'japan'];
const IDP_RECOMMENDED_COUNTRIES = ['croatia', 'france', 'germany', 'mexico', 'australia', 'portugal', 'thailand', 'china', 'korea', 'poland', 'czech', 'hungary', 'turkey'];

function idpStatus(destination: string): 'required' | 'recommended' | null {
  const d = destination.toLowerCase();
  if (IDP_REQUIRED_COUNTRIES.some((c) => d.includes(c))) return 'required';
  if (IDP_RECOMMENDED_COUNTRIES.some((c) => d.includes(c))) return 'recommended';
  return null;
}

// SEA-TAC parking rates (2026, Port of Seattle official tariff)
const SEATAC_WEEKLY_CAP = 149; // general garage weekly cap

function airportTransportMessage(days: number, dest: string): string {
  const weeks = Math.ceil(days / 7);
  const parkingCost = weeks * SEATAC_WEEKLY_CAP;
  const uberLow = 150;  // ~$75 each way × 2
  const uberHigh = 200; // with early-morning surge

  let recommendation: string;
  if (parkingCost > uberHigh) {
    recommendation = `Uber/Lyft makes more sense — parking would cost ~$${parkingCost} but Uber round trip typically runs $${uberLow}–$${uberHigh}.`;
  } else if (parkingCost <= uberLow) {
    recommendation = `Parking is likely cheaper — SEA-TAC garage runs ~$${parkingCost} vs. Uber round trip at $${uberLow}–$${uberHigh}.`;
  } else {
    recommendation = `It's close: parking ~$${parkingCost}, Uber round trip $${uberLow}–$${uberHigh}. Factor in early-morning surge if you have an early flight.`;
  }

  return `How are you getting to the airport for ${dest}? SEA-TAC general garage is $${SEATAC_WEEKLY_CAP}/week cap — for a ${days}-day trip that's ~$${parkingCost}. Uber/Lyft round trip from Kirkland typically runs $${uberLow}–$${uberHigh}. ${recommendation}`;
}

interface PrepTask {
  key: string;
  reminderDaysBefore: number;
  // Returns message string or null to skip this task
  message: (dest: string, days: number, meta: TripMeta) => string | null;
}

interface TripMeta {
  homeAirport: string;
  hasPet: boolean;
  tripDays: number;
}

const TASKS: PrepTask[] = [
  {
    key: 'pet_housing',
    reminderDaysBefore: 35,
    message: (dest, days, meta) => {
      if (!meta.hasPet) return null;
      return `You're leaving for ${dest} in ${days} days. Have you arranged pet boarding or a house sitter? Popular kennels fill up weeks in advance — now is a good time to book.`;
    },
  },
  {
    key: 'idp_check',
    reminderDaysBefore: 28,
    message: (dest, days) => {
      const status = idpStatus(dest);
      if (!status) return null;
      const urgency = status === 'required' ? `An IDP is legally required in ${dest}` : `Rental car companies in ${dest} typically require an IDP`;
      const onlineViable = days >= 21;
      const walkIn = `• **Same-day walk-in ($20):** AAA Kiosk at 3605 132nd Ave SE, Bellevue — Mon–Fri 10am–5:30pm, Sat 10am–2pm (call 800-562-2582 to confirm)`;
      const options = onlineViable
        ? `• **Online ($30, allow 2–3 weeks):** wa.aaa.com/travel/order-idp-online\n${walkIn}`
        : walkIn;
      const timeNote = onlineViable
        ? `You have ${days} days before departure — online or walk-in both work.`
        : `You have ${days} days before departure — online delivery takes 2–3 weeks so **walk-in only** at this point.`;
      return `${urgency}. Do you have a current one?\n\n${options}\n\n${timeNote}`;
    },
  },
  {
    key: 'amazon_subscriptions',
    reminderDaysBefore: 14,
    message: (dest, days) =>
      `Heads up: you leave for ${dest} in ${days} days. Check your Amazon Subscribe & Save deliveries and skip or reschedule any that would arrive while you're away — go to amazon.com → Account → Subscribe & Save. You need to act at least 5–7 days before each item's processing cutoff.`,
  },
  {
    key: 'airport_transport',
    reminderDaysBefore: 7,
    message: (dest, days, meta) => {
      if (meta.homeAirport !== 'SEA') return null;
      return airportTransportMessage(days, dest);
    },
  },
  {
    key: 'mail_and_deliveries',
    reminderDaysBefore: 7,
    message: (dest, days) =>
      `${days} days until ${dest}. Time to set up delivery holds:\n• **USPS Mail Hold** (free, up to 30 days): usps.com/manage/hold-mail.htm — can be same-day if submitted before 2 AM CT\n• **FedEx Vacation Hold** (24-hr lead, up to 14 days): fedex.com → Delivery Manager\n• **UPS My Choice Hold** (24-hr lead, up to 14 days): ups.com → My Choice\n• **Seattle Times hold:** seattletimes.com → My Account, or 1-800-542-0820 (allow 2–3 days)`,
  },
  {
    key: 'banking_and_prescriptions',
    reminderDaysBefore: 7,
    message: (dest, days) =>
      `${days} days before ${dest}: notify your bank and credit cards of your travel dates and destination to prevent fraud blocks on your cards abroad. Also refill any prescriptions now to ensure enough supply for the trip.`,
  },
  {
    key: 'home_departure',
    reminderDaysBefore: 2,
    message: (dest, days, meta) => {
      const waterLine = meta.tripDays >= 14
        ? '\n• **Shut off the main water supply** (strongly recommended for trips over 2 weeks)'
        : '';
      return `Almost time for ${dest}! Before you leave:${waterLine}\n• Set thermostat to Away/Eco mode (min 55°F in winter to prevent frozen pipes)\n• Unplug non-essential appliances (coffee maker, toasters)\n• Check all locks and entry points\n• Confirm security cameras and motion alerts work remotely`;
    },
  },
];

// Words that establish travel context in a capture — must appear alongside a prep
// keyword for the capture to count as travel-related.
const TRAVEL_CONTEXT_WORDS = [
  'trip', 'travel', 'flight', 'leaving', 'departure', 'vacation', 'abroad',
  'international', 'before we go', 'before we leave', 'going to', 'fly out',
];

// Scan recent captures for trip-prep topics the user has explicitly mentioned
// in a travel context, so we carry them forward to new trips.
// Only considers: (a) captures already linked to a past trip, or (b) captures
// where travel context words appear alongside the prep keyword.
async function detectLearnedTasks(userId: string, currentTripId: string): Promise<string[]> {
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString();

  // Captures already identified as travel-related by the intelligence pipeline
  const { data: tripLinked } = await adminClient
    .from('captures')
    .select('transcript')
    .eq('user_id', userId)
    .not('trip_id', 'is', null)
    .neq('trip_id', currentTripId)
    .gte('created_at', sixtyDaysAgo)
    .in('source', ['voice', 'chat', 'text', 'email']);

  // Captures not linked to a trip but containing explicit travel context words
  const { data: unlinked } = await adminClient
    .from('captures')
    .select('transcript')
    .eq('user_id', userId)
    .is('trip_id', null)
    .gte('created_at', sixtyDaysAgo)
    .in('source', ['voice', 'chat', 'text']);

  const tripLinkedTexts = (tripLinked ?? []).map((c) => (c.transcript ?? '').toLowerCase());

  // Only include unlinked captures that contain travel context words
  const travelContextTexts = (unlinked ?? [])
    .map((c) => (c.transcript ?? '').toLowerCase())
    .filter((t) => TRAVEL_CONTEXT_WORDS.some((kw) => t.includes(kw)));

  const candidateTexts = [...tripLinkedTexts, ...travelContextTexts];
  if (!candidateTexts.length) return [];

  const learned: string[] = [];

  const patterns: Array<{ keys: string[]; taskKey: string }> = [
    { keys: ['idp', 'international driver', 'international license', "driver's permit"], taskKey: 'idp_already_learned' },
    { keys: ['house sitter', 'housesitter', 'house-sitter'], taskKey: 'house_sitter_learned' },
    { keys: ['pet sitter', 'pet boarding', 'kennel', 'dog boarding', 'cat boarding'], taskKey: 'pet_boarding_learned' },
  ];

  for (const { keys, taskKey } of patterns) {
    if (candidateTexts.some((t) => keys.some((k) => t.includes(k)))) {
      learned.push(taskKey);
    }
  }

  return learned;
}

export async function runTripPrepDetector(userId: string): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);
  const windowEnd = new Date(today.getTime() + 40 * 86400000).toISOString().slice(0, 10);

  // Fetch upcoming trips
  const { data: trips } = await adminClient
    .from('trips')
    .select('id, destination, start_date, end_date')
    .eq('user_id', userId)
    .gte('start_date', todayStr)
    .lte('start_date', windowEnd)
    .order('start_date');

  if (!trips?.length) return 0;

  // Fetch user profile for home airport and pet status
  const { data: profile } = await adminClient
    .from('user_profiles')
    .select('home_airport, metadata')
    .eq('user_id', userId)
    .single();

  const homeAirport = (profile?.home_airport as string | null) ?? 'SEA';
  const meta_ = (profile?.metadata ?? {}) as Record<string, unknown>;
  const hasPet = (meta_.has_pet as boolean | undefined) ?? false;

  let created = 0;

  for (const trip of trips) {
    const departure = new Date(trip.start_date + 'T00:00:00');
    const endDate = trip.end_date ? new Date(trip.end_date + 'T00:00:00') : departure;
    const daysUntil = Math.round((departure.getTime() - today.getTime()) / 86400000);
    const tripDays = Math.round((endDate.getTime() - departure.getTime()) / 86400000) || 1;
    const dest = (trip.destination as string | null) ?? 'your trip';

    const meta: TripMeta = { homeAirport, hasPet, tripDays };

    for (const task of TASKS) {
      if (daysUntil > task.reminderDaysBefore) continue;

      const msg = task.message(dest, daysUntil, meta);
      if (!msg) continue; // task skipped for this trip (e.g. no pet, wrong airport)

      const anomalyId = `trip_prep_${trip.id}_${task.key}`;

      const { count } = await adminClient
        .from('captures')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('source', 'action')
        .contains('metadata', { anomaly_id: anomalyId });

      if ((count ?? 0) > 0) continue;

      await adminClient.from('captures').insert({
        user_id: userId,
        source: 'action',
        status: 'inbox',
        transcription_status: 'done',
        transcript: msg,
        summary: null,
        tags: ['trip-prep', 'travel'],
        trip_id: trip.id,
        metadata: {
          action_type: 'trip_prep',
          anomaly_id: anomalyId,
          task_key: task.key,
          trip_destination: dest,
          trip_start: trip.start_date,
          days_until: daysUntil,
        },
      });
      created++;
    }

    // Surface learned tasks from past captures as a reminder
    const learnedKeys = await detectLearnedTasks(userId, trip.id);
    for (const key of learnedKeys) {
      const anomalyId = `trip_prep_${trip.id}_${key}`;
      const { count } = await adminClient
        .from('captures')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('source', 'action')
        .contains('metadata', { anomaly_id: anomalyId });
      if ((count ?? 0) > 0) continue;

      let msg: string | null = null;
      if (key === 'idp_already_learned') {
        msg = `Based on a past reminder you set, you've wanted to check your IDP before international trips. Do you have a current one for ${dest}?`;
      } else if (key === 'house_sitter_learned') {
        msg = `You've arranged a house sitter before trips in the past — have you sorted one out for ${dest}?`;
      } else if (key === 'pet_boarding_learned') {
        msg = `You've arranged pet boarding before trips in the past — is that lined up for ${dest}?`;
      }
      if (!msg) continue;

      await adminClient.from('captures').insert({
        user_id: userId,
        source: 'action',
        status: 'inbox',
        transcription_status: 'done',
        transcript: msg,
        summary: null,
        tags: ['trip-prep', 'travel'],
        trip_id: trip.id,
        metadata: {
          action_type: 'trip_prep',
          anomaly_id: anomalyId,
          task_key: key,
          trip_destination: dest,
          trip_start: trip.start_date,
          days_until: daysUntil,
        },
      });
      created++;
    }
  }

  return created;
}
