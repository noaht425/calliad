import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getGmailAuthUrl } from '@/lib/gmail';

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
    ?? req.nextUrl.searchParams.get('token')
    ?? '';
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = getGmailAuthUrl(user.id);
  return NextResponse.redirect(url);
}
