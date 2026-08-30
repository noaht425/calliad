import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await adminClient
    .from('projects')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Attach capture counts
  const { data: counts } = await adminClient
    .from('captures')
    .select('project_id')
    .eq('user_id', user.id)
    .in('project_id', (data ?? []).map((p) => p.id));

  const countMap: Record<string, number> = {};
  for (const row of counts ?? []) {
    if (row.project_id) countMap[row.project_id] = (countMap[row.project_id] ?? 0) + 1;
  }

  return NextResponse.json((data ?? []).map((p) => ({ ...p, capture_count: countMap[p.id] ?? 0 })));
}
