import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { getGmailStatus, scanGmailLabel } from '@/lib/integrations/gmail';
import { syncCalendarEvents } from '@/lib/integrations/icloud-calendar';
import { syncReminders } from '@/lib/integrations/icloud-reminders';
import { materializeSchedule } from '@/lib/integrations/schedule';
import { getIntegrationContext } from '@/lib/integrations/context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  return user ?? null;
}

// GET → connection status + counts + a preview of the awareness slice.
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [gmail, icloudSvc, evCount, schedCount, emCount, remCount, ctx] = await Promise.all([
    getGmailStatus(user.id),
    adminClient.from('connected_services').select('metadata').eq('user_id', user.id).eq('service', 'icloud_calendar').maybeSingle(),
    adminClient.from('calendar_events').select('id', { count: 'exact', head: true }).eq('user_id', user.id).neq('source', 'schedule'),
    adminClient.from('calendar_events').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('source', 'schedule'),
    adminClient.from('email_items').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    adminClient.from('reminders').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('completed', false),
    getIntegrationContext(user.id, { daysAhead: 14, emailLimit: 5 }),
  ]);

  const icm = (icloudSvc.data?.metadata ?? null) as Record<string, unknown> | null;
  const icalNames = Array.isArray(icm?.calendars)
    ? (icm!.calendars as { name: string }[]).map((c) => c.name)
    : icm?.calendar_name
      ? [icm.calendar_name as string]
      : [];
  return NextResponse.json({
    gmail,
    icloud: icm
      ? { connected: true, calendars: icalNames, lastSyncedAt: icm.last_synced_at ?? null }
      : { connected: false },
    counts: {
      calendar_events: evCount.count ?? 0,
      schedule_events: schedCount.count ?? 0,
      email_items: emCount.count ?? 0,
      open_reminders: remCount.count ?? 0,
    },
    preview: ctx,
  });
}

// POST { what: 'calendar' | 'gmail' | 'all' } → run a sync now.
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { what = 'all' } = (await req.json().catch(() => ({}))) as { what?: string };
  const out: Record<string, unknown> = {};
  if (what === 'calendar' || what === 'all') {
    out.calendar = await syncCalendarEvents(user.id);
    out.reminders = await syncReminders(user.id).catch((e) => ({ error: String(e) }));
  }
  if (what === 'gmail' || what === 'all') out.gmail = await scanGmailLabel(user.id);
  if (what === 'schedule') out.schedule = await materializeSchedule(user.id);
  return NextResponse.json({ ok: true, ...out });
}

// DELETE ?service=gmail|icloud_calendar → forget the connection (and its synced rows).
export async function DELETE(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = req.nextUrl.searchParams.get('service');
  if (service !== 'gmail' && service !== 'icloud_calendar') {
    return NextResponse.json({ error: 'service must be gmail or icloud_calendar' }, { status: 400 });
  }

  await adminClient.from('connected_services').delete().eq('user_id', user.id).eq('service', service);
  if (service === 'icloud_calendar') {
    await adminClient.from('calendar_events').delete().eq('user_id', user.id).eq('source', 'icloud');
    await adminClient.from('reminders').delete().eq('user_id', user.id);
  } else {
    await adminClient.from('email_items').delete().eq('user_id', user.id);
  }
  return NextResponse.json({ ok: true, disconnected: service });
}
