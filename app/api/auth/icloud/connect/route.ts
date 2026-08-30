import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { listICloudCalendars, syncCalendarEvents, type SelectedCalendar } from '@/lib/integrations/icloud-calendar';

export const runtime = 'nodejs';

// POST { apple_id, app_password }                    → returns calendar list to pick from
// POST { apple_id, app_password, calendar_urls: [] } → saves the selection + first sync
export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { apple_id, app_password, calendar_urls } = (await req.json()) as {
    apple_id?: string; app_password?: string; calendar_urls?: string[];
  };
  if (!apple_id || !app_password) {
    return NextResponse.json({ error: 'apple_id and app_password required' }, { status: 400 });
  }

  let all: SelectedCalendar[];
  try {
    all = await listICloudCalendars(apple_id, app_password);
  } catch (err) {
    const msg = String(err);
    if (/401|unauthor|auth/i.test(msg)) {
      return NextResponse.json({ error: 'Invalid Apple ID or app-specific password' }, { status: 401 });
    }
    console.error('[icloud/connect]', err);
    return NextResponse.json({ error: 'Connection failed' }, { status: 500 });
  }

  if (!calendar_urls || calendar_urls.length === 0) {
    return NextResponse.json({ ok: true, calendars: all });
  }

  const selected = all.filter((c) => calendar_urls.includes(c.url));
  if (selected.length === 0) {
    return NextResponse.json({ error: 'none of the given calendar_urls matched' }, { status: 400 });
  }

  await adminClient.from('connected_services').upsert(
    {
      user_id: user.id,
      service: 'icloud_calendar',
      access_token: app_password,
      token_expires_at: null,
      metadata: { apple_id, calendars: selected, last_synced_at: null },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,service' },
  );

  try {
    const r = await syncCalendarEvents(user.id);
    return NextResponse.json({ ok: true, calendars: selected.map((c) => c.name), firstSync: r });
  } catch (syncErr) {
    console.error('[icloud/connect] first sync failed', syncErr);
    return NextResponse.json({ ok: true, calendars: selected.map((c) => c.name), firstSync: { error: 'sync_failed' } });
  }
}
