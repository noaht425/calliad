import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { getGmailStatus, scanGmailLabel } from '@/lib/integrations/gmail';
import { syncCalendarEvents } from '@/lib/integrations/icloud-calendar';
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

  const [gmail, icloudSvc, evCount, emCount, ctx] = await Promise.all([
    getGmailStatus(user.id),
    adminClient.from('connected_services').select('metadata').eq('user_id', user.id).eq('service', 'icloud_calendar').maybeSingle(),
    adminClient.from('calendar_events').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    adminClient.from('email_items').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    getIntegrationContext(user.id, { daysAhead: 14, emailLimit: 5 }),
  ]);

  const icm = (icloudSvc.data?.metadata ?? null) as Record<string, unknown> | null;
  return NextResponse.json({
    gmail,
    icloud: icm
      ? { connected: true, calendarName: icm.calendar_name ?? null, lastSyncedAt: icm.last_synced_at ?? null }
      : { connected: false },
    counts: { calendar_events: evCount.count ?? 0, email_items: emCount.count ?? 0 },
    preview: ctx,
  });
}

// POST { what: 'calendar' | 'gmail' | 'all' } → run a sync now.
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { what = 'all' } = (await req.json().catch(() => ({}))) as { what?: string };
  const out: Record<string, unknown> = {};
  if (what === 'calendar' || what === 'all') out.calendar = await syncCalendarEvents(user.id);
  if (what === 'gmail' || what === 'all') out.gmail = await scanGmailLabel(user.id);
  return NextResponse.json({ ok: true, ...out });
}
