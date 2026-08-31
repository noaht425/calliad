import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';
import { checkSecret } from '@/lib/hub/guard';
import { syncCalendarEvents } from '@/lib/integrations/icloud-calendar';
import { syncReminders } from '@/lib/integrations/icloud-reminders';
import { scanGmailLabel } from '@/lib/integrations/gmail';

export const runtime = 'nodejs';
export const maxDuration = 120;

// Periodic pull for every connected user. Vercel Cron fires GET; external pingers
// can POST with x-cron-secret for a finer cadence than the Hobby-plan daily limit.
async function handle(req: NextRequest) {
  const denied = checkSecret(req, 'CRON_SECRET', ['x-cron-secret']);
  if (denied) return denied;

  const { data: services } = await adminClient
    .from('connected_services')
    .select('user_id, service');

  const byUser = new Map<string, Set<string>>();
  for (const s of services ?? []) {
    if (!byUser.has(s.user_id)) byUser.set(s.user_id, new Set());
    byUser.get(s.user_id)!.add(s.service);
  }

  const results: Record<string, unknown>[] = [];
  for (const [userId, svcs] of byUser) {
    const r: Record<string, unknown> = { userId };
    if (svcs.has('icloud_calendar')) {
      r.calendar = await syncCalendarEvents(userId).catch((e) => ({ error: String(e) }));
      r.reminders = await syncReminders(userId).catch((e) => ({ error: String(e) }));
    }
    if (svcs.has('gmail')) r.gmail = await scanGmailLabel(userId).catch((e) => ({ error: String(e) }));
    results.push(r);
  }

  await audit.log('trigger_fired', 'cron', 'sync', { at: new Date().toISOString(), users: results.length, results });
  return NextResponse.json({ ok: true, users: results.length, results });
}

export const GET = handle;
export const POST = handle;
