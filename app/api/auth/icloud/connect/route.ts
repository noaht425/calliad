import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { DAVClient } from 'tsdav';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as {
    apple_id: string;
    app_password: string;
    calendar_url?: string;
    calendar_name?: string;
  };

  const { apple_id, app_password, calendar_url, calendar_name } = body;
  if (!apple_id || !app_password) {
    return NextResponse.json({ error: 'apple_id and app_password required' }, { status: 400 });
  }

  const client = new DAVClient({
    serverUrl: 'https://caldav.icloud.com',
    credentials: { username: apple_id, password: app_password },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });

  try {
    await client.login();
    const calendars = await client.fetchCalendars();

    // Filter to calendars that can hold events (not tasks/reminders)
    const eventCalendars = calendars
      .filter((c) => {
        const comps = (c.components ?? []) as string[];
        return comps.length === 0 || comps.includes('VEVENT');
      })
      .map((c) => ({ url: c.url, displayName: c.displayName ?? c.url }));

    if (!calendar_url) {
      // Test-only: return the calendar list for the user to pick from
      return NextResponse.json({ ok: true, calendars: eventCalendars });
    }

    // Save the connection
    const calName = calendar_name ?? eventCalendars.find((c) => c.url === calendar_url)?.displayName ?? 'iCloud Calendar';

    await adminClient.from('connected_services').upsert(
      {
        user_id: user.id,
        service: 'icloud_calendar',
        access_token: app_password,
        metadata: {
          apple_id,
          calendar_url,
          calendar_name: calName,
          calendars: eventCalendars,
          last_synced_at: null,
        },
        token_expires_at: null,
      },
      { onConflict: 'user_id,service' }
    );

    // Trigger initial sync inline (small window to avoid timeout)
    try {
      const { syncCalendarEvents } = await import('@/lib/icloud-calendar');
      await syncCalendarEvents(user.id);
    } catch (syncErr) {
      console.error('[icloud/connect] initial sync failed:', syncErr);
    }

    return NextResponse.json({ ok: true, calendarName: calName });
  } catch (err) {
    console.error('[icloud/connect]', err);
    const msg = String(err);
    if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('auth')) {
      return NextResponse.json({ error: 'Invalid Apple ID or App-Specific Password' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Connection failed' }, { status: 500 });
  }
}
