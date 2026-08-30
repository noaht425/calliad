import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data } = await adminClient
    .from('connected_services')
    .select('metadata, token_expires_at')
    .eq('user_id', user.id)
    .eq('service', 'alexa')
    .single();

  if (!data) return NextResponse.json({ connected: false });

  const m = (data.metadata ?? {}) as Record<string, unknown>;

  return NextResponse.json({
    connected: true,
    autoRefreshEnabled: (m.auto_refresh_enabled as boolean) ?? false,
    lastRefreshedAt: (m.last_refreshed_at as string) ?? null,
    cookieExpiresAt: data.token_expires_at,
  });
}
