import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await adminClient
    .from('connected_services')
    .select('service')
    .eq('user_id', user.id);

  const services = (data ?? []).map((r: { service: string }) => r.service);
  return NextResponse.json({ amazon: services.includes('amazon') });
}
