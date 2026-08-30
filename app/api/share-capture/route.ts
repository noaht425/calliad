import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { fetchOgDescription } from '@/lib/og-fetch';

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

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { title, text, url } = await req.json() as { title?: string; text?: string; url?: string };

  const parts: string[] = [];
  if (title) parts.push(title);
  if (url && url !== title) parts.push(url);
  if (text && text !== url && text !== title) parts.push(text);
  const transcript = parts.join('\n');

  if (!transcript.trim()) return NextResponse.json({ error: 'No content to save' }, { status: 400 });

  const [readingListId, ogDescription] = await Promise.all([
    findReadingList(user.id),
    url ? fetchOgDescription(url) : Promise.resolve(null),
  ]);

  const summary = ogDescription ?? title ?? url ?? 'Shared item';

  const { data, error } = await adminClient
    .from('captures')
    .insert({
      user_id: user.id,
      source: 'share',
      transcript,
      summary,
      tags: [],
      status: readingListId ? 'folder' : 'inbox',
      folder_id: readingListId,
      transcription_status: 'done',
      trip_id: null,
      metadata: { url, title, text },
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
