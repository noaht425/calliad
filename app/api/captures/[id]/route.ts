import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: capture } = await adminClient
    .from('captures')
    .select('id, raw_audio_url')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (!capture) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Delete audio file from Storage
  if (capture.raw_audio_url) {
    await adminClient.storage.from('audio').remove([capture.raw_audio_url]);
  }

  // Future: delete derived records here (actions, reminders, calendar events, etc.)
  // await adminClient.from('actions').delete().eq('capture_id', id);

  const { error } = await adminClient.from('captures').delete().eq('id', id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return new NextResponse(null, { status: 204 });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const patch = await req.json();
  const allowed = ['status', 'folder_id', 'trip_id', 'project_id', 'tags', 'summary', 'metadata'];
  const safe = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));

  const { data, error } = await adminClient
    .from('captures')
    .update(safe)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
