import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const includeArchived = searchParams.get('archived') === 'true';

  let query = adminClient
    .from('trips')
    .select('id, user_id, folder_id, title, destination, start_date, end_date, travelers, status, summary, created_at, updated_at')
    .eq('user_id', user.id)
    .order('start_date', { ascending: true });

  if (!includeArchived) query = query.neq('status', 'archived');

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}
