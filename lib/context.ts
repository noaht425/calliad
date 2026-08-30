import { adminClient } from './supabase.server';

interface UpcomingBirthday {
  full_name: string;
  type: 'Birthday' | 'Anniversary';
  mmdd: string;
  daysUntil: number;
}

export interface UserContext {
  profile: Record<string, unknown> | null;
  familyMembers: Record<string, unknown>[];
  upcomingEvents: { title: string; start_at: string; end_at: string | null; location: string | null; all_day: boolean }[];
  upcomingBirthdays: UpcomingBirthday[];
  openTodos: { summary: string; remind_at: string | null }[];
  upcomingTrips: { id: string; destination: string | null; start_date: string | null; end_date: string | null; status: string; travelers: string[]; summary: string | null; itinerary: { summary: string | null; metadata: Record<string, unknown> }[] }[];
  watchList: { title: string; type: string; watchStatus: string; nextSeason: string | null; streaming: string[]; activityState: string }[];
  readingList: { title: string; url: string | null }[];
  activeProjects: { title: string; status: string; company: string | null }[];
  recentConversation: { role: 'user' | 'assistant'; content: string; created_at: string }[];
  memories: { category: string; key: string; value: string }[];
}

function birthdaysInWindow(people: { name: string; birthday: string | null; anniversary: string | null }[], days: number): UpcomingBirthday[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const results: UpcomingBirthday[] = [];

  for (const c of people) {
    for (const [field, type] of [['birthday', 'Birthday'], ['anniversary', 'Anniversary']] as const) {
      const mmdd = field === 'birthday' ? c.birthday : c.anniversary;
      if (!mmdd) continue;
      const [mm, dd] = mmdd.split('-').map(Number);
      let next = new Date(now.getFullYear(), mm - 1, dd);
      if (next < now) next = new Date(now.getFullYear() + 1, mm - 1, dd);
      const daysUntil = Math.round((next.getTime() - now.getTime()) / 86400000);
      if (daysUntil <= days) results.push({ full_name: c.name, type, mmdd, daysUntil });
    }
  }
  return results.sort((a, b) => a.daysUntil - b.daysUntil);
}

export async function getUserContext(userId: string): Promise<UserContext> {
  const now = new Date().toISOString();
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 90);

  const [{ data: profile }, { data: familyMembers }, { data: events }, { data: people }, { data: todoProject },
    { data: trips }, { data: watchFolder }, { data: readingFolder }, { data: projects }, { data: recentConv }, { data: memoriesData }] = await Promise.all([
    adminClient.from('user_profiles').select('*').eq('user_id', userId).single(),
    adminClient.from('family_members').select('*').eq('user_id', userId).neq('relationship', 'friend').order('created_at'),
    adminClient.from('calendar_events')
      .select('title, start_at, end_at, location, all_day')
      .eq('user_id', userId).gte('start_at', now).lte('start_at', horizon.toISOString()).order('start_at').limit(30),
    adminClient.from('family_members').select('name, birthday, anniversary').eq('user_id', userId).or('birthday.not.is.null,anniversary.not.is.null'),
    adminClient.from('folders').select('id').eq('user_id', userId).ilike('name', '%to-do%').limit(1).maybeSingle(),
    adminClient.from('trips').select('id, destination, start_date, end_date, status, travelers, summary').eq('user_id', userId).in('status', ['planned', 'active']).order('start_date').limit(8),
    adminClient.from('folders').select('id').eq('user_id', userId).ilike('name', '%watch%').limit(1).maybeSingle(),
    adminClient.from('folders').select('id').eq('user_id', userId).ilike('name', '%reading%').limit(1).maybeSingle(),
    adminClient.from('projects').select('title, status, company').eq('user_id', userId).in('status', ['active', 'pending']).order('created_at').limit(10),
    adminClient.from('conversations').select('role, content, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
    adminClient.from('memories').select('category, key, value').eq('user_id', userId).order('category').order('key'),
  ]);

  // Fetch itinerary captures for each upcoming trip
  const tripIds = (trips ?? []).map((t) => t.id);
  let tripCaptureMap: Record<string, { summary: string | null; metadata: Record<string, unknown> }[]> = {};
  if (tripIds.length > 0) {
    const { data: tCaptures } = await adminClient
      .from('captures')
      .select('trip_id, summary, metadata')
      .eq('user_id', userId)
      .in('trip_id', tripIds)
      .order('created_at');
    for (const c of tCaptures ?? []) {
      if (!c.trip_id) continue;
      if (!tripCaptureMap[c.trip_id]) tripCaptureMap[c.trip_id] = [];
      tripCaptureMap[c.trip_id].push({ summary: c.summary ?? null, metadata: (c.metadata ?? {}) as Record<string, unknown> });
    }
  }

  let openTodos: { summary: string; remind_at: string | null }[] = [];
  if (todoProject?.id) {
    const { data: todos } = await adminClient
      .from('captures').select('summary, metadata').eq('user_id', userId).eq('folder_id', todoProject.id)
      .eq('status', 'folder').contains('tags', ['todo']).order('created_at');
    openTodos = (todos ?? []).map((t) => ({
      summary: t.summary,
      remind_at: (t.metadata as Record<string, unknown>)?.remind_at as string | null ?? null,
    }));
  }

  let watchList: UserContext['watchList'] = [];
  if (watchFolder?.id) {
    const { data: wc } = await adminClient.from('captures').select('transcript, summary, metadata')
      .eq('user_id', userId).eq('folder_id', watchFolder.id).eq('status', 'folder').limit(50);
    watchList = (wc ?? []).map((c) => {
      const m = (c.metadata ?? {}) as Record<string, unknown>;
      const seasons = (m.watch_seasons as { season: number }[] | undefined) ?? [];
      const states = (m.watch_season_states ?? {}) as Record<string, string>;
      const movieState = (m.watch_state as string | undefined) ?? 'Pending';
      let activityState = movieState;
      if (seasons.length > 0) {
        const all = seasons.map((s) => states[String(s.season)] ?? 'Pending');
        if (all.some((s) => s === 'Watching')) activityState = 'Watching';
        else if (all.every((s) => s === 'Watched')) activityState = 'Watched';
        else if (all.some((s) => s === 'Watched')) activityState = 'Partially Watched';
        else activityState = 'Pending';
      }
      return {
        title: (m.watch_title as string | undefined) ?? (c.transcript ?? ''),
        type: (m.watch_type as string | undefined) ?? 'Unknown',
        watchStatus: (m.watch_status as string | undefined) ?? 'Unknown',
        nextSeason: (m.watch_next_season as string | null | undefined) ?? null,
        streaming: (m.watch_streaming as string[] | undefined) ?? [],
        activityState,
      };
    });
  }

  let readingList: UserContext['readingList'] = [];
  if (readingFolder?.id) {
    const { data: rc } = await adminClient.from('captures').select('summary, transcript, metadata')
      .eq('user_id', userId).eq('folder_id', readingFolder.id).eq('status', 'folder').limit(20);
    readingList = (rc ?? []).map((c) => {
      const m = (c.metadata ?? {}) as Record<string, unknown>;
      return { title: (m.reading_title as string | undefined) ?? (c.summary ?? c.transcript ?? ''), url: (m.url as string | undefined) ?? null };
    });
  }

  return {
    profile: profile ?? null,
    familyMembers: familyMembers ?? [],
    upcomingEvents: events ?? [],
    upcomingBirthdays: birthdaysInWindow(people ?? [], 14),
    openTodos,
    upcomingTrips: (trips ?? []).map((t) => ({ id: t.id, destination: t.destination, start_date: t.start_date, end_date: t.end_date, status: t.status, travelers: t.travelers ?? [], summary: t.summary, itinerary: tripCaptureMap[t.id] ?? [] })),
    watchList,
    readingList,
    activeProjects: (projects ?? []).map((p) => ({ title: p.title, status: p.status, company: p.company })),
    recentConversation: (recentConv ?? []).reverse().map((c) => ({ role: c.role as 'user' | 'assistant', content: c.content, created_at: c.created_at })),
    memories: (memoriesData ?? []).map((m) => ({ category: m.category, key: m.key, value: m.value })),
  };
}

export function buildSystemPrompt(ctx: UserContext): string {
  const { profile, familyMembers, upcomingEvents, upcomingBirthdays, openTodos, upcomingTrips, watchList, readingList, activeProjects, recentConversation, memories } = ctx;
  if (!profile && familyMembers.length === 0 && upcomingEvents.length === 0 && upcomingBirthdays.length === 0 && openTodos.length === 0
    && upcomingTrips.length === 0 && watchList.length === 0 && readingList.length === 0 && activeProjects.length === 0 && memories.length === 0) return '';

  const lines: string[] = [
    '## Who you are',
    'You are Calliad — a personal assistant who knows Doug well and thinks ahead for him.',
    'Personality: warm, direct, quietly clever. You notice things without being asked. You surface the useful detail, not every detail.',
    'Tone: conversational and confident. Never stiff, never sycophantic. No "Great question!" or "Certainly!". No filler.',
    'Brevity: 1–3 sentences unless depth is genuinely needed. When you take an action, confirm it in one short sentence.',
    'Proactive: if you spot something Doug should know — a prep task, a conflict, a deadline — mention it naturally, not as a list.',
    'Memory: you remember past conversations and use them. Reference prior context when it\'s relevant.',
    'Limits: if you don\'t have the data to answer something, say so plainly — never guess at specifics like confirmation numbers, company names, or booking details you can\'t see.',
    '',
    '## About the user',
  ];

  if (profile) {
    if (profile.full_name) lines.push(`Name: ${profile.full_name}`);
    if (profile.home_city) lines.push(`Home city: ${profile.home_city}`);
    if (profile.home_airport) lines.push(`Home airport: ${profile.home_airport} (IATA)`);
    if (profile.timezone) lines.push(`Timezone: ${profile.timezone}`);

    const airlines = (profile.preferred_airlines as string[]) ?? [];
    if (airlines.length) lines.push(`Preferred airlines: ${airlines.join(', ')}`);

    const hotels = (profile.preferred_hotel_chains as string[]) ?? [];
    if (hotels.length) lines.push(`Preferred hotel chains: ${hotels.join(', ')}`);

    const cars = (profile.preferred_car_rental as string[]) ?? [];
    if (cars.length) lines.push(`Preferred car rental: ${cars.join(', ')}`);

    const diet = (profile.dietary_preferences as string[]) ?? [];
    if (diet.length) lines.push(`Dietary preferences: ${diet.join(', ')}`);

    const cities = (profile.frequent_cities as string[]) ?? [];
    if (cities.length) lines.push(`Frequently visited cities: ${cities.join(', ')}`);
  }

  if (familyMembers.length > 0) {
    lines.push('\n## Family members');
    for (const m of familyMembers) {
      const parts = [`${m.name} (${m.relationship})`];
      if (m.location_city) parts.push(`lives in ${m.location_city}`);
      if (m.birthday) parts.push(`birthday ${m.birthday}`);
      if (m.anniversary) parts.push(`anniversary ${m.anniversary}`);
      if (m.notes) parts.push(m.notes as string);
      lines.push(`- ${parts.join(', ')}`);
    }
  }

  if (upcomingEvents.length > 0) {
    lines.push('\n## Upcoming calendar events (next 90 days)');
    for (const e of upcomingEvents) {
      const d = new Date(e.start_at);
      const dateStr = e.all_day
        ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        : d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: (profile?.timezone as string | undefined) ?? 'America/Los_Angeles' });
      const parts = [e.title, dateStr];
      if (e.location) parts.push(e.location);
      lines.push(`- ${parts.join(' · ')}`);
    }
  }

  if (upcomingBirthdays.length > 0) {
    lines.push('\n## Upcoming birthdays & anniversaries (next 14 days)');
    for (const b of upcomingBirthdays) {
      const label = b.daysUntil === 0 ? 'today' : b.daysUntil === 1 ? 'tomorrow' : `in ${b.daysUntil} days`;
      lines.push(`- ${b.full_name} ${b.type} ${label}`);
    }
  }

  if (openTodos.length > 0) {
    lines.push('\n## Open to-dos');
    for (const t of openTodos) {
      if (t.remind_at) {
        const d = new Date(t.remind_at + (t.remind_at.includes('T') ? '' : 'T12:00:00'));
        const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        lines.push(`- ${t.summary} (due ${dateStr})`);
      } else {
        lines.push(`- ${t.summary}`);
      }
    }
  }

  if (upcomingTrips.length > 0) {
    lines.push('\n## Upcoming trips');
    for (const t of upcomingTrips) {
      const dest = t.destination ?? 'Unknown destination';
      const start = t.start_date ? new Date(t.start_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      const end = t.end_date ? new Date(t.end_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      const dateRange = start && end ? `${start} – ${end}` : start;
      const travelers = t.travelers.length > 1 ? ` · ${t.travelers.length} travelers` : '';
      lines.push(`- ${dest}${dateRange ? ` · ${dateRange}` : ''}${travelers} [id: ${t.id}]`);
      if (t.summary) lines.push(`  Summary: ${t.summary.slice(0, 200)}`);
      if (t.itinerary.length > 0) {
        lines.push('  Itinerary:');
        for (const item of t.itinerary) {
          lines.push(`  - ${item.summary ?? JSON.stringify(item.metadata).slice(0, 150)}`);
        }
      }
    }
  }

  if (watchList.length > 0) {
    const watching = watchList.filter((w) => w.activityState === 'Watching' || w.activityState === 'Partially Watched');
    const want = watchList.filter((w) => w.activityState === 'Pending');
    const watched = watchList.filter((w) => w.activityState === 'Watched');
    lines.push('\n## Watch list');
    if (watching.length > 0) {
      lines.push('Currently watching:');
      for (const w of watching) {
        const stream = w.streaming.length > 0 ? ` (${w.streaming.join(', ')})` : '';
        const next = w.nextSeason ? ` · Next season: ${w.nextSeason}` : '';
        lines.push(`- ${w.title} [${w.type}]${stream}${next}`);
      }
    }
    if (want.length > 0) {
      lines.push('Want to watch:');
      for (const w of want) {
        const stream = w.streaming.length > 0 ? ` (${w.streaming.join(', ')})` : '';
        const next = w.nextSeason ? ` · Next: ${w.nextSeason}` : '';
        lines.push(`- ${w.title} [${w.type}]${stream}${next}`);
      }
    }
    if (watched.length > 0) {
      lines.push(`Finished: ${watched.map((w) => w.title).join(', ')}`);
    }
  }

  if (readingList.length > 0) {
    lines.push('\n## Reading list (saved articles/books)');
    for (const r of readingList) {
      lines.push(`- ${r.title}${r.url ? ` (${r.url})` : ''}`);
    }
  }

  if (activeProjects.length > 0) {
    lines.push('\n## Active projects');
    for (const p of activeProjects) {
      const co = p.company ? ` · ${p.company}` : '';
      lines.push(`- ${p.title} [${p.status}]${co}`);
    }
  }

  if (memories.length > 0) {
    lines.push('\n## What I know about you (learned over time)');
    const byCategory = memories.reduce((acc, m) => {
      if (!acc[m.category]) acc[m.category] = [];
      acc[m.category].push(`${m.key}: ${m.value}`);
      return acc;
    }, {} as Record<string, string[]>);
    for (const [cat, items] of Object.entries(byCategory)) {
      lines.push(`${cat.charAt(0).toUpperCase() + cat.slice(1)}:`);
      for (const item of items) lines.push(`- ${item}`);
    }
  }

  if (recentConversation.length > 0) {
    lines.push('\n## Recent conversation history');
    for (const msg of recentConversation) {
      const label = msg.role === 'user' ? 'Doug' : 'Calliad';
      lines.push(`${label}: ${msg.content.slice(0, 300)}`);
    }
  }

  lines.push(`
## Trip preparation knowledge
When the user is preparing for a trip, proactively mention relevant prep tasks based on how far out the departure is. Use these lead times:

**Book well in advance (4–6 weeks before)**
- Pet boarding / kennel: popular spots fill fast; needs current vet records (only relevant if user has a pet)
- House sitter: allow time for walk-through and key handoff

**~4 weeks before (international trips)**
- International Driver's Permit (IDP): legally required in Italy, Greece, Spain, Austria, Japan; rental companies expect one in Croatia, France, Germany, Mexico, Australia, Portugal. Online application: wa.aaa.com/travel/order-idp-online ($30, allow 2–3 weeks delivery). Same-day walk-in: AAA Kiosk, 3605 132nd Ave SE, Bellevue, WA ($20, Mon–Fri 10am–5:30pm, Sat 10am–2pm, call 800-562-2582 to confirm).

**Airport transport (SEA-TAC, ~1 week before)**
- SEA-TAC general garage: $149/week cap (2026). Compare to Uber/Lyft round trip from Kirkland (~$150–$200 including return). Breakeven is roughly 7–10 days: for trips longer than ~10 days, Uber/Lyft is almost always cheaper. For shorter trips, parking wins. Always note early-morning surge pricing can push Uber to $90–$110+ each way.

**~2 weeks before**
- Amazon Subscribe & Save: skip or reschedule individual deliveries — must act at least 5–7 days before each item's processing cutoff (no blanket "pause all" exists; go to amazon.com → Account → Subscribe & Save)
- Plant care: arrange self-watering devices or a neighbor
- Home security: verify cameras and motion alerts work remotely; set up light timers

**~1 week before**
- USPS Mail Hold: free, holds mail 3–30 days; request online at usps.com/manage/hold-mail.htm — can be same-day if submitted before 2 AM CT, but 1–2 days lead time is safer
- FedEx Delivery Manager Vacation Hold: free; minimum 24 hours lead time; max 14 days; fedex.com → Delivery Manager
- UPS My Choice Vacation Hold: free tier; minimum 24 hours; max 14 days; ups.com → My Choice
- Newspaper hold: 2–3 days lead time (Seattle Times: seattletimes.com → My Account, or 1-800-542-0820)
- Prescriptions: refill before departure; ensure sufficient supply for trip duration
- Banking: notify bank and credit cards of travel dates and destination countries to prevent fraud blocks

**A few days before / day of**
- Thermostat: set to Away/Eco mode (≥55°F in winter to prevent frozen pipes)
- Refrigerator: eat down perishables; for 2+ week trips consider adjusting fridge temp
- Water main shutoff: strongly recommended for trips over 2 weeks
- Unplug non-essential electronics: coffee maker, toasters, etc.
- Check all locks and entry points`);

  return lines.join('\n');
}
