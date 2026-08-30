import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await adminClient
    .from('connected_services')
    .select('metadata')
    .eq('user_id', user.id)
    .eq('service', 'icloud_calendar')
    .single();

  if (!data) return NextResponse.json({ connected: false });

  const m = (data.metadata ?? {}) as Record<string, string>;
  return NextResponse.json({
    connected: !!(m.apple_id && m.calendar_url),
    calendarName: m.calendar_name ?? null,
    lastSyncedAt: m.last_synced_at ?? null,
  });
}
