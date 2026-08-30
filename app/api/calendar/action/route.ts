import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { createCalendarEvent } from '@/lib/icloud-calendar-write';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as {
    capture_id: string;
    title: string;
    start_at: string;
    end_at?: string | null;
    all_day?: boolean;
    location?: string | null;
    description?: string | null;
    calendar_url?: string;
  };

  if (!body.capture_id || !body.title || !body.start_at) {
    return NextResponse.json({ error: 'capture_id, title, and start_at required' }, { status: 400 });
  }

  const result = await createCalendarEvent(
    user.id,
    {
      title: body.title,
      start_at: body.start_at,
      end_at: body.end_at ?? null,
      all_day: body.all_day,
      location: body.location ?? null,
      description: body.description ?? null,
    },
    body.calendar_url,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  // Archive the action card
  await adminClient
    .from('captures')
    .update({ status: 'archived' })
    .eq('id', body.capture_id)
    .eq('user_id', user.id);

  return NextResponse.json({ ok: true, uid: result.uid });
}
