import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { scanGmailForTravelExtended, scanGmailSentExtended } from '@/lib/gmail';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { days?: number; type?: string };
  const days = typeof body.days === 'number' && body.days > 0 ? body.days : 1095;
  const type = body.type === 'sent' ? 'sent' : 'travel';

  const result = type === 'sent'
    ? await scanGmailSentExtended(user.id, days)
    : await scanGmailForTravelExtended(user.id, days);
  return NextResponse.json({ ok: true, ...result });
}
