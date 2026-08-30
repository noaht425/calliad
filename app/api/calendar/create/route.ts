import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { createCalendarEvent, CalendarEventInput } from '@/lib/icloud-calendar-write';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as CalendarEventInput;
  if (!body.title || !body.start_at) {
    return NextResponse.json({ error: 'title and start_at required' }, { status: 400 });
  }

  const result = await createCalendarEvent(user.id, body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  return NextResponse.json({ ok: true, uid: result.uid });
}
