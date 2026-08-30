import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { pushToAbentfork } from '@/lib/abentfork';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { capture_id } = await req.json() as { capture_id: string };
  if (!capture_id) return NextResponse.json({ error: 'capture_id required' }, { status: 400 });

  const { data: capture } = await adminClient
    .from('captures')
    .select('id, metadata, summary, transcript, tags')
    .eq('id', capture_id)
    .eq('user_id', user.id)
    .single();

  if (!capture) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const meta = (capture.metadata ?? {}) as Record<string, unknown>;
  const url = (meta.url as string | undefined) ?? '';
  const title = (meta.title as string | undefined) ?? capture.summary ?? capture.transcript ?? '';
  const notes = capture.transcript !== title ? capture.transcript : undefined;

  if (!url) return NextResponse.json({ error: 'No URL found on capture' }, { status: 400 });

  const result = await pushToAbentfork({
    capture_id: capture.id,
    url,
    title,
    notes,
    submitted_at: new Date().toISOString(),
  });

  return NextResponse.json(result);
}
