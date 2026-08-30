import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getGmailStatus } from '@/lib/gmail';

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json(await getGmailStatus(user.id));
}
