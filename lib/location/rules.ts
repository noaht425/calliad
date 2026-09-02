import { adminClient } from '@/lib/supabase.server';
import { notifyUser, isQuietHours } from '@/lib/hub/notify';
import { fetchFlightStatus, flightLine, flightStatusAvailable } from '@/lib/watch/flight';

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';

export function placeKind(name: string): 'home' | 'work' | 'gym' | 'pharmacy' | 'airport' | 'store' | 'other' {
  const n = name.toLowerCase();
  if (/\bhome\b|house|apartment|apt\b/.test(n)) return 'home';
  if (/\bwork\b|office|campus|school|lab\b/.test(n)) return 'work';
  if (/gym|fitness|climbing|yoga/.test(n)) return 'gym';
  if (/pharmacy|cvs|walgreens|rite ?aid|drugstore/.test(n)) return 'pharmacy';
  if (/airport|terminal|\b[A-Z]{3}\b/.test(name)) return 'airport';
  if (/store|market|grocery|target|costco|shop\b|mall/.test(n)) return 'store';
  return 'other';
}

interface LocEvent { id: string; user_id: string; place: string; event: 'arrive' | 'leave'; at: string }

/** Short line for the brain: where Noah is / was, if recent. */
export async function locationContextLine(userId: string): Promise<string> {
  const { data } = await adminClient
    .from('location_events')
    .select('place, event, at')
    .eq('user_id', userId)
    .order('at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return '';
  const ageMin = (Date.now() - Date.parse(data.at as string)) / 60000;
  if (ageMin > 14 * 60) return '';
  const when = new Date(data.at as string).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
  const where =
    data.event === 'arrive'
      ? `Noah arrived at ${data.place} around ${when}${ageMin < 90 ? ' (likely still there)' : ''}.`
      : `Noah left ${data.place} around ${when}.`;
  return `## Location\n${where} Use this only if it's relevant to what he's asking; don't volunteer it.`;
}

async function firstLeaveHomeToday(userId: string, before: string): Promise<boolean> {
  const startOfDay = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
  startOfDay.setHours(0, 0, 0, 0);
  const { count } = await adminClient
    .from('location_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('event', 'leave')
    .ilike('place', '%home%')
    .gte('at', startOfDay.toISOString())
    .lt('at', before);
  return (count ?? 0) === 0;
}

/** React to one fresh location event. Fires immediately (geofence events are
 *  time-sensitive); still respects quiet hours. */
export async function runLocationRules(ev: LocEvent): Promise<string[]> {
  if (isQuietHours()) return [];
  const kind = placeKind(ev.place);
  const fired: string[] = [];

  // arrive at an airport → the flight you're tracking today
  if (ev.event === 'arrive' && kind === 'airport' && flightStatusAvailable()) {
    const today = new Date().toISOString().slice(0, 10);
    const { data: w } = await adminClient
      .from('watchers')
      .select('spec')
      .eq('user_id', ev.user_id)
      .eq('kind', 'flight')
      .eq('status', 'active')
      .contains('spec', { date: today })
      .limit(1)
      .maybeSingle();
    const no = (w?.spec as { flightNo?: string } | undefined)?.flightNo;
    if (no) {
      const s = await fetchFlightStatus(no, today).catch(() => null);
      if (s) {
        await notifyUser(ev.user_id, { title: 'At the airport', body: flightLine(no, s), tag: 'loc-airport' });
        fired.push('airport-flight');
      }
    }
  }

  // arrive at a pharmacy / store → a matching open task
  if (ev.event === 'arrive' && (kind === 'pharmacy' || kind === 'store')) {
    const term = kind === 'pharmacy' ? '(refill|prescription|pharmacy|rx|meds? pickup)' : '(buy|pick up|grocery|store|get )';
    const { data: loops } = await adminClient
      .from('open_loops')
      .select('title')
      .eq('user_id', ev.user_id)
      .eq('status', 'open')
      .limit(20);
    const hit = (loops ?? []).find((l) => new RegExp(term, 'i').test(String(l.title)));
    if (hit) {
      await notifyUser(ev.user_id, {
        title: kind === 'pharmacy' ? 'At the pharmacy' : 'At the store',
        body: `You've got "${hit.title}" on your list.`,
        tag: 'loc-errand',
      });
      fired.push('errand');
    }
  }

  // first time leaving home today, and something's on the calendar → a light check
  if (ev.event === 'leave' && kind === 'home' && (await firstLeaveHomeToday(ev.user_id, ev.at))) {
    const horizon = new Date(Date.now() + 12 * 3600_000).toISOString();
    const { count } = await adminClient
      .from('calendar_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', ev.user_id)
      .eq('all_day', false)
      .gte('start_at', ev.at)
      .lte('start_at', horizon);
    if ((count ?? 0) > 0) {
      await notifyUser(ev.user_id, {
        title: 'Heading out',
        body: 'Doors locked, anything on the stove? (First time out today.)',
        tag: 'loc-leavehome',
      });
      fired.push('leave-home-check');
    }
  }

  return fired;
}
