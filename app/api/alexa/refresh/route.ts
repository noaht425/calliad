import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { refreshAlexaCookies } from '@/lib/alexa-lists';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? '';

  // Vercel cron path — CRON_SECRET is auto-set by Vercel
  const isCron =
    !!process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (isCron) {
    // Refresh every user with auto_refresh_enabled
    const { data: services } = await adminClient
      .from('connected_services')
      .select('user_id, metadata')
      .eq('service', 'alexa');

    const targets = (services ?? []).filter((s) => {
      const m = s.metadata as Record<string, unknown>;
      return m?.auto_refresh_enabled === true;
    });

    let refreshed = 0;
    for (const svc of targets) {
      const ok = await refreshAlexaCookies(svc.user_id);
      if (ok) refreshed++;
    }

    return NextResponse.json({ refreshed, total: targets.length });
  }

  // Manual call from settings UI
  const token = authHeader.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const ok = await refreshAlexaCookies(user.id);
  if (!ok) {
    return NextResponse.json(
      { error: 'Headless refresh failed — try re-running the setup script instead' },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
