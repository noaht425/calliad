import { GoogleGenerativeAI } from '@google/generative-ai';
import { adminClient } from './supabase.server';
import { getUserContext, buildSystemPrompt } from './context';
import { createCalendarEvent } from './icloud-calendar-write';

const genai = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY!);

interface TravelEvent {
  type: string;
  title: string;
  start_date: string;
  start_time: string | null;
  end_date: string | null;
  end_time: string | null;
  location: string;
  confirmation_number: string | null;
  notes: string | null;
}

interface CalendarEvent {
  uid: string;
  title: string;
  start_at: string;
  end_at: string | null;
  location: string | null;
  description: string | null;
  all_day: boolean;
}

interface CalendarGap {
  type: string;
  title: string;
  start_at: string;
  end_at: string | null;
  location: string | null;
  confirmation_number: string | null;
}

interface MissingItem {
  element: string;
  question: string;
}

interface ReconciliationResult {
  action_needed: boolean;
  verified: boolean;
  matched_uids: Record<string, string>;
  action_message: string;
  questions: string[];
  trip_type: string;
  missing_elements: string[];
  missing_items: MissingItem[];
  calendar_gaps: CalendarGap[];
  destination: string;
  trip_start: string;
  trip_end: string;
  travelers: string[];
}

interface CalendarInfo {
  name: string;
  calendars: { url: string; displayName: string }[];
  defaultUrl: string | null;
}

async function getCalendarInfo(userId: string): Promise<CalendarInfo> {
  const { data } = await adminClient
    .from('connected_services')
    .select('metadata')
    .eq('user_id', userId)
    .eq('service', 'icloud_calendar')
    .maybeSingle();
  const meta = (data?.metadata ?? {}) as Record<string, unknown>;
  return {
    name: (meta.calendar_name as string | undefined) ?? 'iCloud Calendar',
    calendars: (meta.calendars as { url: string; displayName: string }[] | undefined) ?? [],
    defaultUrl: (meta.calendar_url as string | undefined) ?? null,
  };
}

async function getTravelFolder(userId: string): Promise<string | null> {
  const { data } = await adminClient
    .from('folders')
    .select('id')
    .eq('user_id', userId)
    .eq('entity_type', 'folder')
    .ilike('name', 'Travel')
    .single();
  return data?.id ?? null;
}

function smartMergeTravelers(existing: string[], incoming: string[]): string[] {
  const result = [...existing];
  for (const name of incoming) {
    const parts = name.trim().split(/\s+/);
    const inLast = parts[parts.length - 1].toLowerCase();
    const inFirst = parts[0].toLowerCase();
    const isDuplicate = result.some((r) => {
      const rp = r.trim().split(/\s+/);
      const rLast = rp[rp.length - 1].toLowerCase();
      const rFirst = rp[0].toLowerCase();
      // Same last name AND one first name is a prefix of the other (Doug / Douglas)
      return rLast === inLast && (rFirst.startsWith(inFirst) || inFirst.startsWith(rFirst));
    });
    if (!isDuplicate) result.push(name);
  }
  return result;
}

const AIRPORT_CITIES: Record<string, string> = {
  SEA: 'Seattle', PDX: 'Portland', SFO: 'San Francisco', LAX: 'Los Angeles',
  LAS: 'Las Vegas', PHX: 'Phoenix', DEN: 'Denver', DFW: 'Dallas', IAH: 'Houston',
  ORD: 'Chicago', MDW: 'Chicago', ATL: 'Atlanta', MIA: 'Miami', MCO: 'Orlando',
  JFK: 'New York', LGA: 'New York', EWR: 'Newark', BOS: 'Boston', PHL: 'Philadelphia',
  DCA: 'Washington', IAD: 'Washington', BWI: 'Baltimore', MSP: 'Minneapolis',
  DTW: 'Detroit', CLE: 'Cleveland', PIT: 'Pittsburgh', STL: 'St. Louis',
  SLC: 'Salt Lake City', ANC: 'Anchorage', HNL: 'Honolulu',
  LHR: 'London', LGW: 'London', CDG: 'Paris', AMS: 'Amsterdam',
  FRA: 'Frankfurt', MUC: 'Munich', ZRH: 'Zurich', FCO: 'Rome', MXP: 'Milan',
  BCN: 'Barcelona', MAD: 'Madrid', LIS: 'Lisbon', VIE: 'Vienna',
  YVR: 'Vancouver', YYZ: 'Toronto', YUL: 'Montreal', YYC: 'Calgary', YHZ: 'Halifax',
};

async function getHomeCityInfo(userId: string): Promise<{ homeCity: string | null; airportCity: string | null }> {
  const { data } = await adminClient
    .from('user_profiles')
    .select('home_city, home_airport')
    .eq('user_id', userId)
    .single();
  const homeCity = (data?.home_city as string | null | undefined) ?? null;
  const homeAirport = (data?.home_airport as string | null | undefined) ?? null;
  const airportCity = homeAirport ? (AIRPORT_CITIES[homeAirport] ?? null) : null;
  return { homeCity, airportCity };
}

function isHomeDestination(destination: string, homeCity: string | null, airportCity: string | null): boolean {
  if (!destination) return false;
  const dest = destination.toLowerCase();
  if (homeCity) {
    const city = homeCity.toLowerCase().split(',')[0].trim();
    if (dest.includes(city)) return true;
  }
  if (airportCity && dest.includes(airportCity.toLowerCase())) return true;
  return false;
}

async function findOrCreateTrip(
  userId: string,
  folderId: string | null,
  reconciliation: ReconciliationResult,
  tripIsOver: boolean,
  travelEvents: TravelEvent[]
): Promise<string | null> {
  const hasFlights = travelEvents.some((e) => e.type === 'flight');
  const newStart = reconciliation.trip_start;
  const newEnd = reconciliation.trip_end || reconciliation.trip_start;

  // Return flights home — attach to the trip being returned from rather than
  // creating a phantom "Seattle" or "Kirkland" trip
  if (reconciliation.destination) {
    const { homeCity, airportCity } = await getHomeCityInfo(userId);
    if (isHomeDestination(reconciliation.destination, homeCity, airportCity)) {
      // Find the most recent non-home trip that ended within 5 days before this flight
      const { data: recentTrips } = await adminClient
        .from('trips')
        .select('id, travelers, start_date, end_date, destination')
        .eq('user_id', userId)
        .neq('status', 'archived')
        .lt('end_date', newStart)
        .order('end_date', { ascending: false })
        .limit(5);

      const priorTrip = (recentTrips ?? []).find((t) => {
        if (isHomeDestination(t.destination ?? '', homeCity, airportCity)) return false;
        const daysSince = (new Date(newStart).getTime() - new Date(t.end_date || t.start_date).getTime()) / 86400000;
        return daysSince <= 7;
      });

      if (priorTrip) return attachToExisting(priorTrip);
      return null; // no prior trip found — skip entirely
    }
  }

  // Merge travelers into an existing trip and return its id
  async function attachToExisting(trip: { id: string; travelers: unknown }): Promise<string> {
    const merged = smartMergeTravelers(
      (trip.travelers as string[]) ?? [],
      reconciliation.travelers ?? []
    );
    await adminClient.from('trips')
      .update({ travelers: merged, updated_at: new Date().toISOString() })
      .eq('id', trip.id);
    return trip.id;
  }

  // Create a brand-new trip record
  async function createTrip(): Promise<string> {
    const title = normalizedDest
      ? `${normalizedDest} · ${reconciliation.trip_start}`
      : `Trip · ${reconciliation.trip_start}`;
    const { data } = await adminClient.from('trips').insert({
      user_id: userId,
      folder_id: folderId,
      title,
      destination: normalizedDest ?? reconciliation.destination,
      start_date: reconciliation.trip_start,
      end_date: reconciliation.trip_end,
      travelers: reconciliation.travelers ?? [],
      status: tripIsOver ? 'completed' : 'planned',
    }).select('id').single();
    return data!.id;
  }

  // Step 1: same destination + overlapping date range → attach (handles date drift on same trip,
  // e.g. flight email says Sept 3 but hotel check-in says Sept 4).
  // Match on full normalized destination so "Rome, Italy" only matches "Rome, Italy",
  // not unrelated cities that happen to share a prefix.
  const normalizedDest = reconciliation.destination ? normalizeDestination(reconciliation.destination) : null;
  const { data: sameDestTrips } = normalizedDest
    ? await adminClient
        .from('trips')
        .select('id, travelers, start_date, end_date')
        .eq('user_id', userId)
        .eq('destination', normalizedDest)
        .lte('start_date', newEnd)
        .neq('status', 'archived')
    : { data: [] };

  const sameDestMatch = (sameDestTrips ?? [])
    .find((t) => (t.end_date || t.start_date) >= newStart);
  if (sameDestMatch) return attachToExisting(sameDestMatch);

  // Step 2: different destination — find any trip whose date window overlaps this email
  const { data: allActiveTrips } = await adminClient
    .from('trips')
    .select('id, travelers, start_date, end_date, destination')
    .eq('user_id', userId)
    .lte('start_date', newEnd)
    .neq('status', 'archived');

  const overlapping = (allActiveTrips ?? [])
    .find((t) => (t.end_date || t.start_date) >= newStart);

  if (overlapping && !hasFlights) {
    // Hotel/car within another trip's window and no dedicated flights of its own
    // → it's an element of that trip, not a new destination (e.g. Bloomfield Hills hotel
    //   as part of a Detroit trip). Attach rather than fragment.
    return attachToExisting(overlapping);
  }

  // Step 3: email has its own flights (possibly a side trip like Munich during an Italy trip),
  // or no overlapping trip exists at all → new trip
  return createTrip();
}

async function queryCalendarEventsForTrip(
  userId: string,
  startDate: string,
  endDate: string
): Promise<CalendarEvent[]> {
  const start = new Date(startDate);
  start.setDate(start.getDate() - 1);
  const end = new Date(endDate || startDate);
  end.setDate(end.getDate() + 2);

  const { data } = await adminClient
    .from('calendar_events')
    .select('uid, title, start_at, end_at, location, description, all_day')
    .eq('user_id', userId)
    .gte('start_at', start.toISOString())
    .lte('start_at', end.toISOString())
    .order('start_at');

  return (data ?? []) as CalendarEvent[];
}

async function reconcileWithGemini(
  travelEvents: TravelEvent[],
  calendarEvents: CalendarEvent[],
  userContext: string
): Promise<ReconciliationResult> {
  const model = genai.getGenerativeModel({ model: 'gemini-3.6-flash' });

  const prompt = `You are Calliad, a personal assistant analyzing a travel booking against the user's calendar.

${userContext ? `User profile:\n${userContext}\n` : ''}

Travel booking found in email:
${JSON.stringify(travelEvents, null, 2)}

User's calendar events for the same dates:
${calendarEvents.length > 0 ? JSON.stringify(calendarEvents, null, 2) : '(no calendar events found for these dates)'}

Extract all traveler names from the booking notes (e.g. "Passengers: Douglas Turner, Sonia Savelli").

Analyze and return JSON only (no markdown):
{
  "action_needed": boolean,
  "verified": boolean (true only if EVERY travel element already has an exact calendar match with matching details),
  "matched_uids": { "flight": "uid or null", "hotel": "uid or null", "car_rental": "uid or null" },
  "destination": "City, Country — use the hotel or accommodation city when available (not the airport city). Normalize to just City + Country, no state or province (e.g. 'Calgary, Canada' not 'Calgary, AB, Canada'; 'New York, USA' not 'New York, NY'; 'Rome, Italy' not 'Rome, Lazio, Italy')",
  "trip_start": "YYYY-MM-DD",
  "trip_end": "YYYY-MM-DD",
  "trip_type": "wedding|business|conference|leisure|family|unknown",
  "travelers": ["Full Name 1", "Full Name 2"],
  "missing_items": [
    {"element": "hotel", "question": "Have you booked a hotel for Rome, Sept 3–9?"},
    {"element": "car_rental", "question": "Have you arranged a rental car for the Rome trip?"}
  ],
  "calendar_gaps": [
    {
      "type": "flight|hotel|car_rental|restaurant|activity|cruise|train|other",
      "title": "Alaska Airlines 124 SEA→ORD",
      "start_at": "2026-10-15T13:00:00Z",
      "end_at": "2026-10-15T18:45:00Z",
      "location": "Chicago O'Hare (ORD)",
      "confirmation_number": "XYZABC"
    }
  ],
  "action_message": "A warm, direct 1-2 sentence message. Mention all travelers by name if more than one. Mention the airline/dates/destination and any relevant calendar context."
}

Rules:
- travelers: extract ALL passenger/traveler names from the booking notes
- verified=true only when calendar already has the correct flight/hotel details (flight number, dates match exactly)
- If a calendar event exists with generic title (e.g. "Chicago trip", "Wedding") but no flight details, that is NOT a match for the flight
- missing_items: one entry per travel element (hotel, car_rental, flight) that is NOT confirmed in this email AND has no matching calendar entry. Each entry has a specific yes/no question. If the element IS in this email as a confirmed booking, do NOT include it — it's being confirmed now, not missing. If nothing is missing, return [].
- action_needed=false only when verified=true and missing_items is empty
- calendar_gaps: list every travel element from the email that has NO matching calendar entry. If the element IS matched (matched_uids has a non-null value for it), do NOT include it in calendar_gaps. If there are no gaps, return an empty array [].
- Also return "missing_elements" (array of element strings, derived from missing_items) and "questions" (array of question strings, derived from missing_items) for backwards compatibility.`;

  const result = await model.generateContent(prompt);
  const raw = result.response.text().replace(/```json\n?|\n?```/g, '').trim();
  return JSON.parse(raw) as ReconciliationResult;
}

export async function runTripReconciliation(
  userId: string,
  captureId: string,
  travelEvents: TravelEvent[]
): Promise<void> {
  if (!travelEvents?.length) return;

  const dates = travelEvents.flatMap((e) => [e.start_date, e.end_date].filter(Boolean)) as string[];
  if (!dates.length) return;

  const sorted = [...dates].sort();
  const tripStart = sorted[0];
  const tripEnd = sorted[sorted.length - 1];
  const tripIsOver = new Date(tripEnd) < new Date(new Date().toDateString());

  const [calendarEvents, ctx, folderId, calInfo] = await Promise.all([
    queryCalendarEventsForTrip(userId, tripStart, tripEnd),
    getUserContext(userId),
    getTravelFolder(userId),
    getCalendarInfo(userId),
  ]);

  const userContext = buildSystemPrompt(ctx);
  const reconciliation = await reconcileWithGemini(travelEvents, calendarEvents, userContext);

  // Find or create the Trip record — returns null if destination is home city
  const tripId = await findOrCreateTrip(userId, folderId, reconciliation, tripIsOver, travelEvents);
  if (!tripId) return;

  // Link this capture to the trip and move it out of inbox — its home is the Trip page
  await adminClient.from('captures').update({ trip_id: tripId }).eq('id', captureId);
  await adminClient.from('captures').update({ status: 'archived' }).eq('id', captureId).eq('status', 'inbox');

  if (reconciliation.verified && !reconciliation.action_needed) {
    // Tier 1: mark capture verified silently
    await adminClient.from('captures').update({
      metadata: {
        verified: true,
        verified_at: new Date().toISOString(),
        matched_calendar_uids: reconciliation.matched_uids,
        trip_type: reconciliation.trip_type,
      },
    }).eq('id', captureId);
    return;
  }

  if (tripIsOver) return;

  // Build the set of travel types already covered by OTHER email captures on this trip,
  // PLUS the types confirmed by THIS email. Including the current capture's own types is
  // the key fix: when the car rental email arrives, 'car_rental' goes into this set so
  // the stale "car rental not booked" card gets archived rather than left dangling.
  const { data: otherTripCaptures } = await adminClient
    .from('captures')
    .select('metadata')
    .eq('user_id', userId)
    .eq('trip_id', tripId)
    .eq('source', 'email')
    .neq('id', captureId);

  const alreadyCoveredTypes = new Set<string>();
  for (const cap of otherTripCaptures ?? []) {
    const events = ((cap.metadata as Record<string, unknown> | null)?.calendar_events as Array<{ type: string }> | undefined) ?? [];
    for (const ev of events) {
      if (ev.type) alreadyCoveredTypes.add(ev.type);
    }
  }
  // Include this email's own confirmed bookings — the email IS the confirmation
  for (const ev of travelEvents) {
    if (ev.type) alreadyCoveredTypes.add(ev.type);
  }

  // Use structured per-element items from Gemini; fall back to old parallel arrays
  const missingItems: MissingItem[] = reconciliation.missing_items?.length
    ? reconciliation.missing_items
    : (reconciliation.missing_elements ?? []).map((el, i) => ({
        element: el,
        question: reconciliation.questions?.[i] ?? `Have you booked ${el.replace('_', ' ')} for ${reconciliation.destination}?`,
      }));

  const trulyMissingItems = missingItems.filter((item) => !alreadyCoveredTypes.has(item.element));

  // Fetch all existing trip_proposal action cards for this trip (inbox only)
  const { data: existingCards } = await adminClient
    .from('captures')
    .select('id, metadata')
    .eq('user_id', userId)
    .eq('trip_id', tripId)
    .eq('source', 'action')
    .eq('status', 'inbox')
    .contains('metadata', { action_type: 'trip_proposal' });

  const cardsToArchive: string[] = [];
  for (const card of existingCards ?? []) {
    const cardMeta = card.metadata as Record<string, unknown>;
    const hasAnomalyId = !!cardMeta.anomaly_id;
    if (!hasAnomalyId) {
      // Old multi-question format — migrate: archive it so new per-element cards replace it
      cardsToArchive.push(card.id);
    } else {
      // New format — archive if its element is now covered
      const element = cardMeta.missing_element as string | undefined;
      if (element && alreadyCoveredTypes.has(element)) {
        cardsToArchive.push(card.id);
      }
    }
  }
  if (cardsToArchive.length > 0) {
    await adminClient.from('captures').update({ status: 'archived' }).in('id', cardsToArchive);
  }

  // Nothing truly missing — done
  if (trulyMissingItems.length === 0) {
    await createCalendarGapCards(userId, tripId, reconciliation.calendar_gaps ?? [], reconciliation.destination, calInfo);
    return;
  }

  // One card per missing element — each independently answerable and dismissable
  const tripLabel = `${reconciliation.destination} · ${reconciliation.trip_start}`;
  for (const item of trulyMissingItems) {
    const anomalyId = `trip_proposal:${tripId}:${item.element}`;

    // Skip if a card for this element was already created (inbox or previously handled)
    const { count } = await adminClient
      .from('captures')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('source', 'action')
      .in('status', ['inbox', 'archived'])
      .contains('metadata', { anomaly_id: anomalyId });

    if ((count ?? 0) > 0) continue;

    await adminClient.from('captures').insert({
      user_id: userId,
      source: 'action',
      transcript: item.question,
      summary: item.question.slice(0, 120),
      tags: ['travel', 'action', reconciliation.trip_type].filter(Boolean),
      status: 'inbox',
      transcription_status: 'done',
      trip_id: tripId,
      metadata: {
        action_type: 'trip_proposal',
        anomaly_id: anomalyId,
        trip_id: tripId,
        source_capture_id: captureId,
        destination: reconciliation.destination,
        trip_start: reconciliation.trip_start,
        trip_end: reconciliation.trip_end,
        trip_type: reconciliation.trip_type,
        travelers: reconciliation.travelers,
        missing_element: item.element,
        missing_elements: [item.element],
        matched_calendar_uids: reconciliation.matched_uids,
        questions: [item.question],
        trip_label: tripLabel,
      },
    });
  }

  // Calendar gap action cards — one per unscheduled confirmed booking (inline picker)
  await createCalendarGapCards(userId, tripId, reconciliation.calendar_gaps ?? [], reconciliation.destination, calInfo);
}

async function hasPendingCalendarGapCard(userId: string, anomalyId: string): Promise<boolean> {
  const { data } = await adminClient
    .from('captures')
    .select('id')
    .eq('user_id', userId)
    .eq('source', 'action')
    .in('status', ['inbox', 'archived']) // archived = already handled; don't re-create
    .contains('metadata', { anomaly_id: anomalyId })
    .limit(1);
  return (data?.length ?? 0) > 0;
}

async function createCalendarGapCards(
  userId: string,
  tripId: string,
  gaps: Array<{ type: string; title: string; start_at: string; end_at: string | null; location: string | null; confirmation_number: string | null }>,
  destination: string,
  calInfo: CalendarInfo,
): Promise<void> {
  for (const gap of gaps) {
    const anomalyId = `calendar_gap:${tripId}:${gap.type}:${gap.start_at}`;
    if (await hasPendingCalendarGapCard(userId, anomalyId)) continue;

    const typeLabel = gap.type === 'car_rental' ? 'car rental' : gap.type;
    const description = gap.confirmation_number ? `Confirmation: ${gap.confirmation_number}` : null;

    await adminClient.from('captures').insert({
      user_id: userId,
      source: 'action',
      transcript: `Add ${typeLabel} to calendar — ${gap.title}`,
      summary: `Add ${typeLabel} to calendar — ${destination}`,
      tags: ['travel', 'calendar', gap.type],
      status: 'inbox',
      transcription_status: 'done',
      trip_id: tripId,
      metadata: {
        action_type: 'add_to_calendar',
        anomaly_id: anomalyId,
        trip_id: tripId,
        title: gap.title,
        start_at: gap.start_at,
        end_at: gap.end_at,
        all_day: false,
        location: gap.location,
        description,
        calendars: calInfo.calendars,
        selected_calendar_url: calInfo.defaultUrl,
      },
    });
  }
}

const US_STATE_ABBREVS = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']);
const US_STATE_NAMES = new Set(['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming','District of Columbia']);
const CA_PROVINCE_ABBREVS = new Set(['AB','BC','MB','NB','NL','NS','ON','PE','QC','SK','NT','NU','YT']);
const CA_PROVINCE_NAMES = new Set(['Alberta','British Columbia','Manitoba','New Brunswick','Newfoundland','Newfoundland and Labrador','Nova Scotia','Ontario','Prince Edward Island','Quebec','Saskatchewan','Northwest Territories','Nunavut','Yukon']);

// Normalize a raw location string to "City, Country" for consistent trip matching.
// Handles: airport codes, US state names/abbrevs, Canadian province names/abbrevs,
// and any 3+-part strings (e.g. "Rome, Lazio, Italy" → "Rome, Italy").
function normalizeDestination(raw: string): string {
  // Remove airport codes: "Rome (FCO)" → "Rome"
  let s = raw.replace(/\s*\([A-Z]{3}\)/g, '').trim();
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean);

  if (parts.length <= 1) return s;

  if (parts.length === 2) {
    const [city, second] = parts;
    if (US_STATE_ABBREVS.has(second) || US_STATE_NAMES.has(second)) return `${city}, USA`;
    if (CA_PROVINCE_ABBREVS.has(second) || CA_PROVINCE_NAMES.has(second)) return `${city}, Canada`;
    return `${city}, ${second}`;
  }

  // 3+ parts: "Calgary, AB, Canada" / "Rome, Lazio, Italy" / "New York, NY, USA"
  // Always keep first (city) and last (country) parts only
  const city = parts[0];
  const country = parts[parts.length - 1];
  // If the last part is a state/province abbrev (no country given), map to country
  if (US_STATE_ABBREVS.has(country) || US_STATE_NAMES.has(country)) return `${city}, USA`;
  if (CA_PROVINCE_ABBREVS.has(country) || CA_PROVINCE_NAMES.has(country)) return `${city}, Canada`;
  return `${city}, ${country}`;
}

// Fast, DB-only trip link — no second Gemini call. Used by the Gmail scanner so
// every capture is synchronously linked to a trip within the Vercel function's
// time budget. Full reconciliation (calendar compare, action cards) runs separately.
export async function linkCaptureToTrip(
  userId: string,
  captureId: string,
  travelEvents: TravelEvent[],
  travelers: string[] = []
): Promise<void> {
  if (!travelEvents?.length) return;

  const dates = travelEvents.flatMap((e) => [e.start_date, e.end_date].filter(Boolean)) as string[];
  if (!dates.length) return;

  const sorted = [...dates].sort();
  const tripStart = sorted[0];
  const tripEnd = sorted[sorted.length - 1];
  const tripIsOver = new Date(tripEnd) < new Date(new Date().toDateString());

  const { homeCity, airportCity } = await getHomeCityInfo(userId);

  // Pick the first non-home location as the destination
  const rawDest = travelEvents
    .map((e) => e.location)
    .find((loc) => loc && !isHomeDestination(loc, homeCity, airportCity)) ?? null;

  if (!rawDest) {
    // All events point home — find the most recent prior trip and attach the return leg
    const { data: recentTrips } = await adminClient
      .from('trips')
      .select('id, travelers, start_date, end_date, destination')
      .eq('user_id', userId)
      .neq('status', 'archived')
      .lt('end_date', tripStart)
      .order('end_date', { ascending: false })
      .limit(5);

    const priorTrip = (recentTrips ?? []).find((t) => {
      if (isHomeDestination(t.destination ?? '', homeCity, airportCity)) return false;
      const daysSince = (new Date(tripStart).getTime() - new Date(t.end_date || t.start_date).getTime()) / 86400000;
      return daysSince <= 7;
    });

    if (priorTrip) {
      await adminClient.from('captures').update({ trip_id: priorTrip.id }).eq('id', captureId);
      await adminClient.from('captures').update({ status: 'archived' }).eq('id', captureId).eq('status', 'inbox');
    }
    return;
  }

  const folderId = await getTravelFolder(userId);
  const hasFlights = travelEvents.some((e) => e.type === 'flight');

  const minRec: ReconciliationResult = {
    destination: normalizeDestination(rawDest),
    trip_start: tripStart,
    trip_end: tripEnd,
    travelers,
    missing_elements: [],
    missing_items: [],
    action_needed: false,
    verified: true,
    matched_uids: {},
    action_message: '',
    questions: [],
    trip_type: 'unknown',
    calendar_gaps: [],
  };

  const tripId = await findOrCreateTrip(userId, folderId, minRec, tripIsOver, travelEvents);
  if (!tripId) return;

  await adminClient.from('captures').update({ trip_id: tripId }).eq('id', captureId);
  await adminClient.from('captures').update({ status: 'archived' }).eq('id', captureId).eq('status', 'inbox');
}
