import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase.server';

async function findReadingList(userId: string): Promise<string | null> {
  const { data } = await adminClient
    .from('folders')
    .select('id')
    .eq('user_id', userId)
    .ilike('name', '%reading%')
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  const url = searchParams.get('url');
  const title = searchParams.get('title');
  const text = searchParams.get('text');

  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 401 });

  const { data: profile } = await adminClient
    .from('user_profiles')
    .select('user_id')
    .eq('share_token', token)
    .single();

  if (!profile) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  const parts: string[] = [];
  if (title) parts.push(title);
  if (url && url !== title) parts.push(url);
  if (text && text !== url && text !== title) parts.push(text);
  const transcript = parts.join('\n');

  if (!transcript.trim()) return NextResponse.json({ error: 'No content' }, { status: 400 });

  const readingListId = await findReadingList(profile.user_id);

  const { error } = await adminClient.from('captures').insert({
    user_id: profile.user_id,
    source: 'share',
    transcript,
    summary: title ?? url ?? 'Shared item',
    tags: [],
    status: readingListId ? 'folder' : 'inbox',
    folder_id: readingListId,
    transcription_status: 'done',
    trip_id: null,
    metadata: { url, title, text },
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
