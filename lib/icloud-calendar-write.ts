import { randomUUID } from 'crypto';
import { adminClient } from './supabase.server';
import { getICloudConnection } from './icloud-calendar';
import { syncCalendarEvents } from './icloud-calendar';

export interface CalendarEventInput {
  title: string;
  start_at: string;       // ISO 8601
  end_at?: string | null;
  all_day?: boolean;
  location?: string | null;
  description?: string | null;
  confirmation_number?: string | null;
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

function buildVCalendar(uid: string, event: CalendarEventInput): string {
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
  lines.push('X-CALLIAD-SOURCE:calliad');
  lines.push('END:VEVENT');
  lines.push('END:VCALENDAR');

  return lines.join('\r\n');
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
    const ical = buildVCalendar(uid, event);
    const targetUrl = calendarUrl ?? conn.calendarUrl;

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
    await adminClient.from('calendar_events').upsert({
      user_id: userId,
      uid,
      calendar_url: targetUrl,
      calendar_name: conn.calendarName,
      title: event.title,
      start_at: event.start_at,
      end_at: effectiveEndAt,
      all_day: allDay,
      location: event.location ?? null,
      description: event.description ?? null,
      raw_ical: ical,
      source: 'icloud',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,uid', ignoreDuplicates: false });

    syncCalendarEvents(userId).catch(() => {});

    return { ok: true, uid };
  } catch (err) {
    console.error('[icloud-calendar-write] createCalendarEvent error:', err);
    return { ok: false, error: String(err) };
  }
}

export async function addAttendeesToCalendarEvent(
  userId: string,
  uid: string,
  attendees: Array<{ name: string; email: string }>,
  organizerEmail: string,
  organizerName: string,
): Promise<CalendarWriteResult> {
  try {
    const conn = await getICloudConnection(userId);
    if (!conn) return { ok: false, error: 'iCloud Calendar not connected' };

    const { data: existing } = await adminClient
      .from('calendar_events')
      .select('raw_ical, calendar_url')
      .eq('user_id', userId)
      .eq('uid', uid)
      .single();

    if (!existing?.raw_ical) return { ok: false, error: 'Event not found or has no iCal data' };

    const attendeeLines = attendees
      .map((a) => `ATTENDEE;CN=${escapeICalText(a.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`)
      .join('\r\n');

    let ical = existing.raw_ical as string;
    // Add ORGANIZER if not already present
    if (!ical.includes('ORGANIZER')) {
      ical = ical.replace('END:VEVENT', `ORGANIZER;CN=${escapeICalText(organizerName)}:mailto:${organizerEmail}\r\nEND:VEVENT`);
    }
    ical = ical.replace('END:VEVENT', `${attendeeLines}\r\nEND:VEVENT`);

    const calUrl = (existing.calendar_url as string | null) ?? conn.calendarUrl;
    await conn.client.updateCalendarObject({
      calendarObject: {
        url: `${calUrl}${uid}.ics`,
        etag: undefined,
        data: ical,
      },
    });

    syncCalendarEvents(userId).catch(() => {});
    return { ok: true, uid };
  } catch (err) {
    console.error('[icloud-calendar-write] addAttendeesToCalendarEvent error:', err);
    return { ok: false, error: String(err) };
  }
}

export async function updateCalendarEvent(
  userId: string,
  uid: string,
  updates: Partial<CalendarEventInput>
): Promise<CalendarWriteResult> {
  try {
    const conn = await getICloudConnection(userId);
    if (!conn) return { ok: false, error: 'iCloud Calendar not connected' };

    // Fetch the existing raw iCal for this UID from our DB
    const { data: existing } = await adminClient
      .from('calendar_events')
      .select('raw_ical, start_at, end_at, title, location, description, all_day')
      .eq('user_id', userId)
      .eq('uid', uid)
      .single();

    if (!existing) return { ok: false, error: 'Event not found locally — sync first' };

    const merged: CalendarEventInput = {
      title: updates.title ?? existing.title,
      start_at: updates.start_at ?? existing.start_at,
      end_at: updates.end_at ?? existing.end_at,
      all_day: updates.all_day ?? existing.all_day,
      location: updates.location ?? existing.location,
      description: updates.description ?? existing.description,
      confirmation_number: updates.confirmation_number,
    };

    const ical = buildVCalendar(uid, merged);

    await conn.client.updateCalendarObject({
      calendarObject: {
        url: `${conn.calendarUrl}${uid}.ics`,
        etag: undefined,
        data: ical,
      },
    });

    syncCalendarEvents(userId).catch(() => {});
    return { ok: true, uid };
  } catch (err) {
    console.error('[icloud-calendar-write] updateCalendarEvent error:', err);
    return { ok: false, error: String(err) };
  }
}
