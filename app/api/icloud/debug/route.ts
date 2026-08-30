import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getICloudConnection } from '@/lib/icloud-calendar';
import { DAVCalendar } from 'tsdav';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const conn = await getICloudConnection(user.id);
    if (!conn) return NextResponse.json({ error: 'not_connected' }, { status: 400 });

    const { client, calendarUrl, calendarName } = conn;

    // Fetch all calendars to see what's available
    const allCalendars = await client.fetchCalendars();

    // Fetch objects from the stored calendar URL without any filter
    const calendar = { url: calendarUrl } as DAVCalendar;
    let objectCount = 0;
    let objectSample: string[] = [];
    let fetchError: string | null = null;

    try {
      const objects = await client.fetchCalendarObjects({ calendar });
      objectCount = objects.length;
      objectSample = objects.slice(0, 3).map((o) => String(o.data ?? '').slice(0, 200));
    } catch (e) {
      fetchError = String(e);
    }

    return NextResponse.json({
      storedCalendarUrl: calendarUrl,
      calendarName,
      availableCalendars: allCalendars.map((c) => ({ displayName: c.displayName, url: c.url })),
      objectCount,
      objectSample,
      fetchError,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
