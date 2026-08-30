import { DAVClient, DAVCalendar } from 'tsdav';
import { adminClient } from '@/lib/supabase.server';

export interface ParsedCalendarEvent {
  uid: string;
  calendarUrl: string;
  calendarName: string;
  title: string;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
  rawIcal: string;
}

export interface SelectedCalendar { url: string; name: string }

export interface ICloudConnection {
  client: DAVClient;
  calendars: SelectedCalendar[];
}

export async function getICloudConnection(userId: string): Promise<ICloudConnection | null> {
  const { data } = await adminClient
    .from('connected_services')
    .select('access_token, metadata')
    .eq('user_id', userId)
    .eq('service', 'icloud_calendar')
    .maybeSingle();

  if (!data?.access_token) return null;
  const m = (data.metadata ?? {}) as Record<string, unknown>;
  const appleId = m.apple_id as string | undefined;

  // New shape: metadata.calendars = [{url,name}]. Fall back to the old single-cal shape.
  let calendars = (m.calendars as SelectedCalendar[] | undefined) ?? [];
  if (calendars.length === 0 && m.calendar_url) {
    calendars = [{ url: m.calendar_url as string, name: (m.calendar_name as string) ?? 'iCloud Calendar' }];
  }
  if (!appleId || calendars.length === 0) return null;

  const client = new DAVClient({
    serverUrl: 'https://caldav.icloud.com',
    credentials: { username: appleId, password: data.access_token },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });
  await client.login();
  return { client, calendars };
}

function unfoldiCal(ical: string): string {
  return ical.replace(/\r?\n[ \t]/g, '');
}

function getICalProp(block: string, name: string): { params: string; value: string } | null {
  const m = block.match(new RegExp(`(?:^|\\n)${name}(;[^:\\r\\n]*)?:([^\\r\\n]*)`, 'i'));
  if (!m) return null;
  return { params: m[1] ?? '', value: m[2]?.trim() ?? '' };
}

function icalDateToISO(value: string, params: string): string {
  if (params.includes('VALUE=DATE')) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`;
  }
  const isUtc = value.endsWith('Z');
  const v = value.replace('Z', '');
  const year = parseInt(v.slice(0, 4), 10);
  const month = parseInt(v.slice(4, 6), 10) - 1;
  const day = parseInt(v.slice(6, 8), 10);
  const hour = parseInt(v.slice(9, 11) || '0', 10);
  const min = parseInt(v.slice(11, 13) || '0', 10);
  const sec = parseInt(v.slice(13, 15) || '0', 10);
  if (isUtc) return new Date(Date.UTC(year, month, day, hour, min, sec)).toISOString();

  const tzid = params.match(/TZID=([^;:]+)/)?.[1];
  if (!tzid) return new Date(Date.UTC(year, month, day, hour, min, sec)).toISOString();
  try {
    const approxUtc = new Date(Date.UTC(year, month, day, hour, min, sec));
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tzid,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(approxUtc);
    const get = (type: string) => parseInt(parts.find((p) => p.type === type)!.value, 10);
    const renderedMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    const localMs = Date.UTC(year, month, day, hour, min, sec);
    return new Date(approxUtc.getTime() + (localMs - renderedMs)).toISOString();
  } catch {
    return new Date(Date.UTC(year, month, day, hour, min, sec)).toISOString();
  }
}

export function parseICalEvent(ical: string, calendarUrl: string, calendarName: string): ParsedCalendarEvent | null {
  const unfolded = unfoldiCal(ical);
  const match = unfolded.match(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/);
  if (!match) return null;
  const block = match[1];
  const uid = getICalProp(block, 'UID')?.value;
  const summary = getICalProp(block, 'SUMMARY')?.value;
  const dtstart = getICalProp(block, 'DTSTART');
  if (!uid || !summary || !dtstart) return null;
  const dtend = getICalProp(block, 'DTEND');
  return {
    uid,
    calendarUrl,
    calendarName,
    title: summary,
    startAt: icalDateToISO(dtstart.value, dtstart.params),
    endAt: dtend ? icalDateToISO(dtend.value, dtend.params) : null,
    allDay: dtstart.params.includes('VALUE=DATE'),
    location: getICalProp(block, 'LOCATION')?.value?.replace(/\\,/g, ',') || null,
    description: getICalProp(block, 'DESCRIPTION')?.value?.replace(/\\n/g, '\n').replace(/\\,/g, ',') || null,
    rawIcal: ical,
  };
}

/** List every event-capable calendar for the given credentials (for the picker). */
export async function listICloudCalendars(appleId: string, appPassword: string): Promise<SelectedCalendar[]> {
  const client = new DAVClient({
    serverUrl: 'https://caldav.icloud.com',
    credentials: { username: appleId, password: appPassword },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });
  await client.login();
  const cals = await client.fetchCalendars();
  return cals
    .filter((c) => {
      const comps = (c.components ?? []) as string[];
      return comps.length === 0 || comps.includes('VEVENT');
    })
    .map((c) => ({ url: c.url, name: (c.displayName as string) ?? c.url }));
}

// Stale recurring events in the real calendar (old lessons etc. with no end date)
// that expand:true resurrects. Case-insensitive substring match on the title.
// Add more as they surface — or make this user-editable later.
const IGNORE_TITLE_SUBSTRINGS = ['piano lesson', 'trumpet lesson', 'house cleaners'];
const isIgnored = (title: string) =>
  IGNORE_TITLE_SUBSTRINGS.some((s) => title.toLowerCase().includes(s));

export async function syncCalendarEvents(
  userId: string,
): Promise<{ synced: number; removed: number; calendars: number; error?: string }> {
  const conn = await getICloudConnection(userId);
  if (!conn) return { synced: 0, removed: 0, calendars: 0, error: 'not_connected' };

  const now = new Date();
  const windowStart = new Date(now.getTime() - 7 * 86400000);
  const windowEnd = new Date(now.getTime() + 365 * 86400000);

  const events: ParsedCalendarEvent[] = [];
  const syncedUrls: string[] = [];

  for (const cal of conn.calendars) {
    try {
      const objects = await conn.client.fetchCalendarObjects({
        calendar: { url: cal.url } as DAVCalendar,
        timeRange: { start: windowStart.toISOString(), end: windowEnd.toISOString() },
        // Ask iCloud to expand recurring events into concrete instances within the
        // window (otherwise we get the master VEVENT on its original seed date).
        expand: true,
      });
      for (const obj of objects) {
        if (!obj.data) continue;
        // An expanded object can contain several VEVENTs (one per occurrence).
        for (const block of String(obj.data).match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? []) {
          const parsed = parseICalEvent(block, cal.url, cal.name);
          if (parsed && !isIgnored(parsed.title)) events.push(parsed);
        }
      }
      syncedUrls.push(cal.url);
    } catch (err) {
      console.error('[icloud] calendar sync failed', cal.name, err);
    }
  }

  // Expanded recurring instances share one UID — key each row by uid + start so
  // occurrences don't collapse into a single row on upsert.
  const rowKey = (e: ParsedCalendarEvent) => `${e.uid}::${e.startAt}`;

  if (events.length > 0) {
    await adminClient.from('calendar_events').upsert(
      events.map((e) => ({
        user_id: userId,
        uid: rowKey(e),
        calendar_url: e.calendarUrl,
        calendar_name: e.calendarName,
        title: e.title,
        start_at: e.startAt,
        end_at: e.endAt,
        all_day: e.allDay,
        location: e.location,
        description: e.description,
        raw_ical: e.rawIcal,
        source: 'icloud',
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'user_id,uid', ignoreDuplicates: false },
    );
  }

  // Prune only within calendars we actually synced this run.
  let removed = 0;
  if (syncedUrls.length > 0) {
    const syncedUids = new Set(events.map((e) => rowKey(e)));
    const { data: existing } = await adminClient
      .from('calendar_events')
      .select('uid')
      .eq('user_id', userId)
      .eq('source', 'icloud')
      .in('calendar_url', syncedUrls)
      .gte('start_at', windowStart.toISOString())
      .lte('start_at', windowEnd.toISOString());
    const toDelete = (existing ?? []).map((r) => r.uid).filter((uid) => !syncedUids.has(uid));
    if (toDelete.length > 0) {
      await adminClient.from('calendar_events').delete().eq('user_id', userId).in('uid', toDelete);
      removed = toDelete.length;
    }
  }

  const { data: svc } = await adminClient
    .from('connected_services')
    .select('metadata')
    .eq('user_id', userId)
    .eq('service', 'icloud_calendar')
    .maybeSingle();
  await adminClient
    .from('connected_services')
    .update({ metadata: { ...((svc?.metadata ?? {}) as object), last_synced_at: new Date().toISOString() } })
    .eq('user_id', userId)
    .eq('service', 'icloud_calendar');

  return { synced: events.length, removed, calendars: syncedUrls.length };
}
