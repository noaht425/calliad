import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sub = await req.json();
  const endpoint: string = sub.endpoint;
  const keys = sub.keys as { p256dh: string; auth: string };

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
  }

  // Upsert by endpoint so re-registrations don't duplicate
  const { error } = await adminClient
    .from('push_subscriptions')
    .upsert({ user_id: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth }, { onConflict: 'endpoint' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
