import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const [{ data: trip, error: tripErr }, { data: captures }] = await Promise.all([
    adminClient
      .from('trips')
      .select('id, user_id, folder_id, title, destination, start_date, end_date, travelers, status, summary, metadata, created_at, updated_at')
      .eq('id', id)
      .eq('user_id', user.id)
      .single(),
    adminClient
      .from('captures')
      .select('id,user_id,transcript,summary,tags,source,status,transcription_status,metadata,trip_id,created_at,updated_at')
      .eq('user_id', user.id)
      .eq('trip_id', id)
      .order('created_at', { ascending: true }),
  ]);

  if (tripErr || !trip) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ trip, captures: captures ?? [] });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const patch = await req.json();
  const allowed = ['status', 'title', 'summary', 'metadata'];
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (key in patch) update[key] = patch[key];
  }

  const { data, error } = await adminClient
    .from('trips')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
