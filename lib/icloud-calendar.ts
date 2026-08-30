import { DAVClient, DAVCalendar } from 'tsdav';
import { adminClient } from './supabase.server';

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

export interface ICloudConnection {
  client: DAVClient;
  calendarUrl: string;
  calendarName: string;
}

export async function getICloudConnection(userId: string): Promise<ICloudConnection | null> {
  const { data } = await adminClient
    .from('connected_services')
    .select('access_token, metadata')
    .eq('user_id', userId)
    .eq('service', 'icloud_calendar')
    .single();

  if (!data?.access_token) return null;
  const m = (data.metadata ?? {}) as Record<string, string>;
  if (!m.apple_id || !m.calendar_url) return null;

  const client = new DAVClient({
    serverUrl: 'https://caldav.icloud.com',
    credentials: { username: m.apple_id, password: data.access_token },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });

  await client.login();
  return { client, calendarUrl: m.calendar_url, calendarName: m.calendar_name ?? 'iCloud Calendar' };
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

  // Inverse-lookup: find the UTC time that Intl renders as our local time in tzid.
  // approxUtc treats local as UTC; we measure the rendering error and correct it.
  try {
    const approxUtc = new Date(Date.UTC(year, month, day, hour, min, sec));
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tzid,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
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

export async function syncCalendarEvents(userId: string): Promise<{ synced: number; removed: number; error?: string }> {
  const conn = await getICloudConnection(userId);
  if (!conn) return { synced: 0, removed: 0, error: 'not_connected' };

  const { client, calendarUrl, calendarName } = conn;

  const now = new Date();
  const windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days back
  const windowEnd = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  const calendar = { url: calendarUrl } as DAVCalendar;

  const objects = await client.fetchCalendarObjects({
    calendar,
    timeRange: { start: windowStart.toISOString(), end: windowEnd.toISOString() },
  });

  const events: ParsedCalendarEvent[] = [];
  for (const obj of objects) {
    if (!obj.data) continue;
    const parsed = parseICalEvent(String(obj.data), calendarUrl, calendarName);
    if (parsed) events.push(parsed);
  }

  if (events.length > 0) {
    await adminClient.from('calendar_events').upsert(
      events.map((e) => ({
        user_id: userId,
        uid: e.uid,
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
      { onConflict: 'user_id,uid', ignoreDuplicates: false }
    );
  }

  // Remove events in the window that iCloud no longer returns (deleted/moved)
  let removed = 0;
  const syncedUids = events.map((e) => e.uid);
  const { data: existing } = await adminClient
    .from('calendar_events')
    .select('uid')
    .eq('user_id', userId)
    .eq('source', 'icloud')
    .gte('start_at', windowStart.toISOString())
    .lte('start_at', windowEnd.toISOString());

  const toDelete = (existing ?? []).map((r) => r.uid).filter((uid) => !syncedUids.includes(uid));
  if (toDelete.length > 0) {
    await adminClient.from('calendar_events').delete().eq('user_id', userId).in('uid', toDelete);
    removed = toDelete.length;
  }

  // Record last sync time
  const { data: svc } = await adminClient
    .from('connected_services')
    .select('metadata')
    .eq('user_id', userId)
    .eq('service', 'icloud_calendar')
    .single();

  await adminClient
    .from('connected_services')
    .update({ metadata: { ...((svc?.metadata ?? {}) as object), last_synced_at: new Date().toISOString() } })
    .eq('user_id', userId)
    .eq('service', 'icloud_calendar');

  return { synced: events.length, removed };
}
