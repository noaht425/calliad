import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { addToAlexaList, getAlexaConfig } from '@/lib/alexa-lists';

export const runtime = 'nodejs';

// Temporary test endpoint — remove after debugging
export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const config = await getAlexaConfig(user.id);
  if (!config) return NextResponse.json({ error: 'not connected' }, { status: 404 });

  const result = await addToAlexaList(user.id, ['test item from Calliad']);
  return NextResponse.json({ config: { hasCookie: !!config.cookie, csrf: config.csrf?.slice(0, 8) + '…' }, result });
}
