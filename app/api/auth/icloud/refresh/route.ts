import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { DAVClient } from 'tsdav';
import { syncCalendarEvents } from '@/lib/icloud-calendar';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: svc } = await adminClient
    .from('connected_services')
    .select('access_token, metadata')
    .eq('user_id', user.id)
    .eq('service', 'icloud_calendar')
    .single();

  if (!svc?.access_token || !svc.metadata?.apple_id) {
    return NextResponse.json({ error: 'not_connected' }, { status: 400 });
  }

  const appleId = svc.metadata.apple_id as string;
  const appPassword = svc.access_token;
  const calendarName = svc.metadata.calendar_name as string;

  const client = new DAVClient({
    serverUrl: 'https://caldav.icloud.com',
    credentials: { username: appleId, password: appPassword },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });

  try {
    await client.login();
    const calendars = await client.fetchCalendars();

    // Find the matching calendar by name
    const match = calendars.find(
      (c) => String(c.displayName ?? '') === calendarName
    ) ?? calendars.find(
      (c) => String(c.displayName ?? '').toLowerCase() === calendarName?.toLowerCase()
    );

    if (!match) {
      return NextResponse.json({
        error: `Calendar "${calendarName}" not found`,
        available: calendars.map((c) => c.displayName),
      }, { status: 404 });
    }

    // Update stored URL if it changed
    const freshUrl = match.url;
    const storedUrl = svc.metadata.calendar_url as string;

    await adminClient.from('connected_services').update({
      metadata: {
        ...(svc.metadata as object),
        calendar_url: freshUrl,
      },
    }).eq('user_id', user.id).eq('service', 'icloud_calendar');

    // Re-run sync with the fresh URL
    const syncResult = await syncCalendarEvents(user.id);

    return NextResponse.json({
      ok: true,
      urlChanged: freshUrl !== storedUrl,
      oldUrl: storedUrl,
      newUrl: freshUrl,
      synced: syncResult.synced,
      removed: syncResult.removed,
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes('401') || msg.includes('Unauthorized')) {
      return NextResponse.json({ error: 'App-specific password rejected — you may need to generate a new one' }, { status: 401 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
