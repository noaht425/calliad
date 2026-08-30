import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await adminClient
    .from('folders')
    .select('id, user_id, name, color, icon, entity_type, parent_folder_id, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Attach capture counts
  const { data: counts } = await adminClient
    .from('captures')
    .select('folder_id')
    .eq('user_id', user.id)
    .eq('status', 'folder')
    .in('folder_id', (data ?? []).map((p) => p.id));

  const countMap: Record<string, number> = {};
  for (const row of counts ?? []) {
    if (row.folder_id) countMap[row.folder_id] = (countMap[row.folder_id] ?? 0) + 1;
  }

  return NextResponse.json((data ?? []).map((p) => ({ ...p, capture_count: countMap[p.id] ?? 0 })));
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name, color, icon, parent_folder_id } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 });

  const { data, error } = await adminClient
    .from('folders')
    .insert({ user_id: user.id, name: name.trim(), color: color ?? 'stone', icon: icon ?? '◐', ...(parent_folder_id ? { parent_folder_id } : {}) })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ...data, capture_count: 0 }, { status: 201 });
}
