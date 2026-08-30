import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { getAlexaListItems } from '@/lib/alexa-lists';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { items, notConnected, error } = await getAlexaListItems(user.id);

  if (notConnected) return NextResponse.json({ error: 'Alexa not connected' }, { status: 404 });
  if (error) return NextResponse.json({ error }, { status: 502 });
  if (items.length === 0) return NextResponse.json({ pulled: 0, skipped: 0, total: 0 });

  const { data: shoppingFolder } = await adminClient
    .from('folders')
    .select('id')
    .eq('user_id', user.id)
    .eq('entity_type', 'folder')
    .ilike('name', '%shopping%')
    .single();

  if (!shoppingFolder) return NextResponse.json({ error: 'Shopping folder not found' }, { status: 404 });

  const { data: existing } = await adminClient
    .from('captures')
    .select('transcript')
    .eq('user_id', user.id)
    .eq('folder_id', shoppingFolder.id)
    .eq('status', 'folder');

  const existingNames = new Set((existing ?? []).map((c) => c.transcript.toLowerCase().trim()));

  const newItems = items.filter((item) => !existingNames.has(item.toLowerCase().trim()));
  let pulled = 0;

  for (const item of newItems) {
    const { error: insertErr } = await adminClient.from('captures').insert({
      user_id: user.id,
      source: 'alexa',
      transcript: item,
      summary: item,
      tags: ['shopping'],
      status: 'folder',
      folder_id: shoppingFolder.id,
      transcription_status: 'done',
      trip_id: null,
    });
    if (!insertErr) pulled++;
    else console.error('[alexa/pull] insert failed for item:', item, insertErr);
  }

  return NextResponse.json({ pulled, skipped: items.length - newItems.length, total: items.length });
}
