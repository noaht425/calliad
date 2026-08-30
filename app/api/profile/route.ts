import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await adminClient
    .from('user_profiles')
    .select('*, share_token')
    .eq('user_id', user.id)
    .single();

  const { data: familyMembers } = await adminClient
    .from('family_members')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  return NextResponse.json({ profile: profile ?? null, familyMembers: familyMembers ?? [] });
}

export async function PATCH(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const allowed = ['full_name', 'home_city', 'home_airport', 'timezone',
    'preferred_airlines', 'preferred_hotel_chains', 'preferred_car_rental',
    'dietary_preferences', 'frequent_cities', 'language_override'];
  const patch = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));

  // Metadata flags stored as JSONB (no schema migration needed)
  const metadataKeys = ['has_pet'] as const;
  const metadataUpdates = Object.fromEntries(
    Object.entries(body).filter(([k]) => (metadataKeys as readonly string[]).includes(k))
  );
  if (Object.keys(metadataUpdates).length > 0) {
    // Fetch existing metadata and merge
    const { data: existing } = await adminClient
      .from('user_profiles')
      .select('metadata')
      .eq('user_id', user.id)
      .single();
    patch.metadata = { ...((existing?.metadata as Record<string, unknown>) ?? {}), ...metadataUpdates };
  }

  const { data, error } = await adminClient
    .from('user_profiles')
    .upsert({ user_id: user.id, ...patch }, { onConflict: 'user_id' })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
