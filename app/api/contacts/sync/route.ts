import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { syncContacts } from '@/lib/icloud-contacts';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');

  // Cron invocation
  if (authHeader === `Bearer ${process.env.CRON_SECRET}`) {
    const { data: services } = await adminClient
      .from('connected_services')
      .select('user_id')
      .eq('service', 'icloud_calendar');

    const results = await Promise.allSettled(
      (services ?? []).map((s) => syncContacts(s.user_id))
    );

    const total = results.reduce(
      (acc, r) => acc + (r.status === 'fulfilled' ? r.value.synced : 0),
      0
    );
    return NextResponse.json({ ok: true, synced: total });
  }

  // Manual invocation
  const token = authHeader?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result = await syncContacts(user.id);
  return NextResponse.json({ ok: true, ...result });
}
