import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { updateCalendarEvent, CalendarEventInput } from '@/lib/icloud-calendar-write';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { uid, ...updates } = await req.json() as { uid: string } & Partial<CalendarEventInput>;
  if (!uid) return NextResponse.json({ error: 'uid required' }, { status: 400 });

  const result = await updateCalendarEvent(user.id, uid, updates);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  return NextResponse.json({ ok: true, uid: result.uid });
}
