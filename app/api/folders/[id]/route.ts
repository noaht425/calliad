import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const patch = await req.json();
  const allowed = ['name', 'color', 'icon'];
  const safe = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
  if (safe.name) safe.name = (safe.name as string).trim();

  const { data, error } = await adminClient
    .from('folders')
    .update(safe)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Move captures back to inbox before deleting the folder
  await adminClient
    .from('captures')
    .update({ status: 'inbox', folder_id: null })
    .eq('folder_id', id)
    .eq('user_id', user.id);

  const { error } = await adminClient
    .from('folders')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
