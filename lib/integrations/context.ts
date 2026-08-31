import { adminClient } from '@/lib/supabase.server';

export interface IntegrationContext {
  events: { title: string; start_at: string; end_at: string | null; all_day: boolean; location: string | null }[];
  emails: { from_addr: string; subject: string; snippet: string | null; received_at: string | null }[];
}

/**
 * The read-only awareness slice for a turn / the morning brief: upcoming calendar
 * events + recent watched-label email. Not injected in Phase 0; wired into the
 * brief + nudge triggers next.
 */
export async function getIntegrationContext(
  userId: string,
  opts: { daysAhead?: number; emailLimit?: number } = {},
): Promise<IntegrationContext> {
  const daysAhead = opts.daysAhead ?? 14;
  const emailLimit = opts.emailLimit ?? 10;
  const now = new Date();
  const horizon = new Date(now.getTime() + daysAhead * 86400000);

  const [{ data: events }, { data: emails }] = await Promise.all([
    adminClient
      .from('calendar_events')
      .select('title, start_at, end_at, all_day, location')
      .eq('user_id', userId)
      .gte('start_at', now.toISOString())
      .lte('start_at', horizon.toISOString())
      .order('start_at')
      .limit(40),
    adminClient
      .from('email_items')
      .select('from_addr, subject, snippet, received_at')
      .eq('user_id', userId)
      .order('received_at', { ascending: false })
      .limit(emailLimit),
  ]);

  return { events: events ?? [], emails: emails ?? [] };
}
