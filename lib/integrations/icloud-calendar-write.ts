import { randomUUID } from 'crypto';
import { adminClient } from '@/lib/supabase.server';
import { getICloudConnection } from '@/lib/integrations/icloud-calendar';
import { syncCalendarEvents } from '@/lib/integrations/icloud-calendar';

export interface CalendarEventInput {
  title: string;
  start_at: string;       // ISO 8601
  end_at?: string | null;
  all_day?: boolean;
  location?: string | null;
  description?: string | null;
  confirmation_number?: string | null;
  // resolved from `location` (venue → city); stored, not written to iCal
  city?: string | null;
  region?: string | null;
  country?: string | null;
  lat?: number | null;
  lon?: number | null;
  // guests to put on the event (ATTENDEE lines); iCloud may or may not email
  // them, so callers also hand Noah a mailto to send himself.
  attendees?: { name: string; email: string }[];
}

export interface CalendarWriteResult {
  ok: boolean;
  uid?: string;
  error?: string;
}

function formatICalDate(iso: string, allDay = false): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (allDay) {
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  }
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function escapeICalText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function buildVCalendar(uid: string, event: CalendarEventInput, organizerEmail?: string): string {
  const allDay = event.all_day ?? false;
  const startFmt = allDay ? 'VALUE=DATE' : 'TZID=UTC';
  const startVal = formatICalDate(event.start_at, allDay);

  let endVal: string;
  if (event.end_at) {
    endVal = formatICalDate(event.end_at, allDay);
  } else if (allDay) {
    // All-day events: end = start + 1 day
    const d = new Date(event.start_at);
    d.setUTCDate(d.getUTCDate() + 1);
    endVal = formatICalDate(d.toISOString(), true);
  } else {
    // Default 1-hour duration
    const d = new Date(event.start_at);
    d.setUTCHours(d.getUTCHours() + 1);
    endVal = formatICalDate(d.toISOString(), false);
  }

  const descLines: string[] = [];
  if (event.confirmation_number) descLines.push(`Confirmation: ${event.confirmation_number}`);
  if (event.description) descLines.push(event.description);
  const desc = descLines.join('\\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Calliad//Calliad//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatICalDate(new Date().toISOString())}`,
    allDay ? `DTSTART;${startFmt}:${startVal}` : `DTSTART:${startVal}`,
    allDay ? `DTEND;${startFmt}:${endVal}` : `DTEND:${endVal}`,
    `SUMMARY:${escapeICalText(event.title)}`,
  ];

  if (event.location) lines.push(`LOCATION:${escapeICalText(event.location)}`);
  if (desc) lines.push(`DESCRIPTION:${escapeICalText(desc)}`);

  const guests = (event.attendees ?? []).filter((a) => a.email);
  if (guests.length) {
    if (organizerEmail) lines.push(`ORGANIZER:mailto:${organizerEmail}`);
    for (const g of guests) {
      lines.push(
        `ATTENDEE;CN=${escapeICalText(g.name || g.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${g.email}`,
      );
    }
  }

  lines.push('X-CALLIAD-SOURCE:calliad');
  lines.push('END:VEVENT');
  lines.push('END:VCALENDAR');

  return lines.join('\r\n');
}

// Find the CalDAV object URL + etag for an event by its iCal UID. Native
// iCloud events don't live at `${calendarUrl}${uid}.ics`, so we have to look.
async function resolveObject(
  conn: NonNullable<Awaited<ReturnType<typeof getICloudConnection>>>,
  calendarUrl: string,
  uid: string,
): Promise<{ url: string; etag?: string } | null> {
  try {
    const objects = await conn.client.fetchCalendarObjects({
      calendar: { url: calendarUrl } as never,
      timeRange: {
        start: new Date(Date.now() - 400 * 86400000).toISOString(),
        end: new Date(Date.now() + 400 * 86400000).toISOString(),
      },
      expand: false,
    });
    const needle = new RegExp(`UID:\\s*${uid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    for (const o of objects) {
      if (o.data && needle.test(String(o.data))) return { url: o.url, etag: o.etag };
    }
  } catch (err) {
    console.error('[icloud-calendar-write] resolveObject error:', err);
  }
  return null;
}

export interface CalendarChange {
  title?: string;
  start_at?: string;
  end_at?: string | null;
  all_day?: boolean;
  location?: string | null;
  description?: string | null;
}

export async function updateCalendarEvent(
  userId: string,
  uid: string,
  change: CalendarChange,
): Promise<CalendarWriteResult> {
  try {
    const conn = await getICloudConnection(userId);
    if (!conn) return { ok: false, error: 'iCloud Calendar not connected' };

    const { data: row } = await adminClient
      .from('calendar_events')
      .select('calendar_url, calendar_name, title, start_at, end_at, all_day, location, description')
      .eq('user_id', userId)
      .eq('uid', uid)
      .maybeSingle();
    if (!row) return { ok: false, error: 'event not found' };

    const calendarUrl: string = row.calendar_url ?? conn.calendars[0].url;
    const target = await resolveObject(conn, calendarUrl, uid);
    if (!target) return { ok: false, error: 'could not locate the event on the server' };

    const merged: CalendarEventInput = {
      title: change.title ?? row.title ?? 'Untitled',
      start_at: change.start_at ?? row.start_at,
      end_at: change.end_at !== undefined ? change.end_at : row.end_at,
      all_day: change.all_day ?? row.all_day ?? false,
      location: change.location !== undefined ? change.location : row.location,
      description: change.description !== undefined ? change.description : row.description,
    };
    const ical = buildVCalendar(uid, merged);

    await conn.client.updateCalendarObject({
      calendarObject: { url: target.url, data: ical, etag: target.etag },
    });

    await adminClient.from('calendar_events').update({
      title: merged.title,
      start_at: merged.start_at,
      end_at: merged.end_at,
      all_day: merged.all_day,
      location: merged.location ?? null,
      description: merged.description ?? null,
      raw_ical: ical,
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId).eq('uid', uid);

    syncCalendarEvents(userId).catch(() => {});
    return { ok: true, uid };
  } catch (err) {
    console.error('[icloud-calendar-write] updateCalendarEvent error:', err);
    return { ok: false, error: String(err) };
  }
}

export async function deleteCalendarEvent(userId: string, uid: string): Promise<CalendarWriteResult> {
  try {
    const conn = await getICloudConnection(userId);
    if (!conn) return { ok: false, error: 'iCloud Calendar not connected' };

    const { data: row } = await adminClient
      .from('calendar_events')
      .select('calendar_url')
      .eq('user_id', userId)
      .eq('uid', uid)
      .maybeSingle();
    const calendarUrl: string = row?.calendar_url ?? conn.calendars[0].url;

    const target = await resolveObject(conn, calendarUrl, uid);
    if (!target) return { ok: false, error: 'could not locate the event on the server' };

    await conn.client.deleteCalendarObject({ calendarObject: { url: target.url, etag: target.etag } });
    await adminClient.from('calendar_events').delete().eq('user_id', userId).eq('uid', uid);
    return { ok: true, uid };
  } catch (err) {
    console.error('[icloud-calendar-write] deleteCalendarEvent error:', err);
    return { ok: false, error: String(err) };
  }
}

export async function createCalendarEvent(
  userId: string,
  event: CalendarEventInput,
  calendarUrl?: string,
): Promise<CalendarWriteResult> {
  try {
    const conn = await getICloudConnection(userId);
    if (!conn) return { ok: false, error: 'iCloud Calendar not connected' };

    const uid = `${randomUUID()}@calliad`;
    const ical = buildVCalendar(uid, event, conn.appleId);
    const targetUrl = calendarUrl ?? conn.calendars[0].url;

    await conn.client.createCalendarObject({
      calendar: { url: targetUrl } as never,
      filename: `${uid}.ics`,
      iCalString: ical,
    });

    // Write directly to calendar_events so Calliad can query this event immediately.
    // Background sync still runs for events created outside Calliad (native Calendar app etc.).
    // Upsert on user_id+uid means the sync will refresh — never duplicate — this row.
    const allDay = event.all_day ?? false;
    let effectiveEndAt: string;
    if (event.end_at) {
      effectiveEndAt = event.end_at;
    } else if (allDay) {
      const d = new Date(event.start_at);
      d.setUTCDate(d.getUTCDate() + 1);
      effectiveEndAt = d.toISOString();
    } else {
      const d = new Date(event.start_at);
      d.setUTCHours(d.getUTCHours() + 1);
      effectiveEndAt = d.toISOString();
    }
    const baseRow = {
      user_id: userId,
      uid,
      calendar_url: targetUrl,
      calendar_name: conn.calendars[0].name,
      title: event.title,
      start_at: event.start_at,
      end_at: effectiveEndAt,
      all_day: allDay,
      location: event.location ?? null,
      description: event.description ?? null,
      raw_ical: ical,
      source: 'icloud',
      updated_at: new Date().toISOString(),
    };
    const geoRow = {
      city: event.city ?? null,
      region: event.region ?? null,
      country: event.country ?? null,
      lat: event.lat ?? null,
      lon: event.lon ?? null,
      geo_resolved_at: event.lat != null || event.city != null ? new Date().toISOString() : null,
    };
    const opts = { onConflict: 'user_id,uid', ignoreDuplicates: false } as const;
    const wrote = await adminClient.from('calendar_events').upsert({ ...baseRow, ...geoRow }, opts);
    // 0029 adds the geo columns; if it hasn't been applied yet, fall back so a
    // calendar add still works.
    if (wrote.error && /column .* does not exist/i.test(wrote.error.message ?? '')) {
      await adminClient.from('calendar_events').upsert(baseRow, opts);
    }

    syncCalendarEvents(userId).catch(() => {});

    return { ok: true, uid };
  } catch (err) {
    console.error('[icloud-calendar-write] createCalendarEvent error:', err);
    return { ok: false, error: String(err) };
  }
}
