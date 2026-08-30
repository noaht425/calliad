import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Birthdays page reads from here — now backed by family_members
  const { data, error: dbErr } = await adminClient
    .from('family_members')
    .select('id, name AS full_name, birthday, anniversary, birth_year')
    .eq('user_id', user.id)
    .or('birthday.not.is.null,anniversary.not.is.null')
    .order('name');

  if (dbErr) {
    console.error('[contacts GET] db error:', dbErr.message, dbErr.code);
    return NextResponse.json({ error: dbErr.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

export async function PATCH(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { id?: string; field?: string };
  if (!body.id || (body.field !== 'birthday' && body.field !== 'anniversary')) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const { error: dbErr } = await adminClient
    .from('family_members')
    .update({ [body.field]: null })
    .eq('id', body.id)
    .eq('user_id', user.id);

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
