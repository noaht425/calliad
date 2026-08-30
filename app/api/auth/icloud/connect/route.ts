import { NextRequest, NextResponse } from 'next/server';
import { DAVClient } from 'tsdav';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';

export const runtime = 'nodejs';

// POST { apple_id, app_password }               → returns calendar list to pick from
// POST { apple_id, app_password, calendar_url } → saves the connection + first sync
export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { apple_id, app_password, calendar_url, calendar_name } = (await req.json()) as {
    apple_id?: string; app_password?: string; calendar_url?: string; calendar_name?: string;
  };
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
    const eventCalendars = calendars
      .filter((c) => {
        const comps = (c.components ?? []) as string[];
        return comps.length === 0 || comps.includes('VEVENT');
      })
      .map((c) => ({ url: c.url, displayName: (c.displayName as string) ?? c.url }));

    if (!calendar_url) {
      return NextResponse.json({ ok: true, calendars: eventCalendars });
    }

    const calName =
      calendar_name ?? eventCalendars.find((c) => c.url === calendar_url)?.displayName ?? 'iCloud Calendar';

    await adminClient.from('connected_services').upsert(
      {
        user_id: user.id,
        service: 'icloud_calendar',
        access_token: app_password,
        token_expires_at: null,
        metadata: { apple_id, calendar_url, calendar_name: calName, last_synced_at: null },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,service' },
    );

    try {
      const { syncCalendarEvents } = await import('@/lib/integrations/icloud-calendar');
      const r = await syncCalendarEvents(user.id);
      return NextResponse.json({ ok: true, calendarName: calName, firstSync: r });
    } catch (syncErr) {
      console.error('[icloud/connect] first sync failed', syncErr);
      return NextResponse.json({ ok: true, calendarName: calName, firstSync: { error: 'sync_failed' } });
    }
  } catch (err) {
    const msg = String(err);
    if (/401|unauthor|auth/i.test(msg)) {
      return NextResponse.json({ error: 'Invalid Apple ID or app-specific password' }, { status: 401 });
    }
    console.error('[icloud/connect]', err);
    return NextResponse.json({ error: 'Connection failed' }, { status: 500 });
  }
}
