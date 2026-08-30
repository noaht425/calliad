import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await adminClient
    .from('unsubscribes')
    .select('*')
    .eq('user_id', user.id)
    .order('unsubscribed_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { sender_name, sender_domain, sender_email, unsubscribed_at } = body as Record<string, string>;
  if (!sender_name?.trim() || !sender_domain?.trim()) {
    return NextResponse.json({ error: 'sender_name and sender_domain are required' }, { status: 400 });
  }

  const domain = sender_domain.toLowerCase().trim();

  const { data: existing } = await adminClient
    .from('unsubscribes')
    .select('id')
    .eq('user_id', user.id)
    .eq('sender_domain', domain)
    .maybeSingle();

  if (existing) return NextResponse.json({ error: 'Already tracking this sender' }, { status: 409 });

  const { data, error } = await adminClient
    .from('unsubscribes')
    .insert({
      user_id: user.id,
      sender_name: sender_name.trim(),
      sender_domain: domain,
      sender_email: sender_email?.trim() || null,
      unsubscribed_at: unsubscribed_at ?? new Date().toISOString().slice(0, 10),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
