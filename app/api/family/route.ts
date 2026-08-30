import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';

const ALLOWED = ['name', 'relationship', 'email', 'location_city', 'birthday', 'anniversary', 'birth_year', 'notes'];

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const relationship = url.searchParams.get('relationship');

  let query = adminClient
    .from('family_members')
    .select('id, name, relationship, email, location_city, birthday, anniversary, birth_year, notes')
    .eq('user_id', user.id)
    .order('name');

  if (relationship === 'family') {
    // 'family' is a virtual group: all non-friend relationship types (spouse, child, sibling, parent, etc.)
    query = query.neq('relationship', 'friend');
  } else if (relationship) {
    query = query.eq('relationship', relationship);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  if (!body.name || !body.relationship) {
    return NextResponse.json({ error: 'name and relationship required' }, { status: 400 });
  }

  const fields = Object.fromEntries(Object.entries(body).filter(([k]) => ALLOWED.includes(k)));
  const { data, error } = await adminClient
    .from('family_members')
    .insert({ user_id: user.id, ...fields })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
