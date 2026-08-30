import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { enabled } = await req.json() as { enabled: boolean };

  const { data: existing } = await adminClient
    .from('connected_services')
    .select('metadata')
    .eq('user_id', user.id)
    .eq('service', 'alexa')
    .single();

  if (!existing) return NextResponse.json({ error: 'not connected' }, { status: 404 });

  const metadata = {
    ...((existing.metadata as Record<string, unknown>) ?? {}),
    auto_refresh_enabled: enabled,
  };

  await adminClient
    .from('connected_services')
    .update({ metadata })
    .eq('user_id', user.id)
    .eq('service', 'alexa');

  return NextResponse.json({ ok: true, autoRefreshEnabled: enabled });
}
