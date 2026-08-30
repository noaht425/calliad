import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { randomUUID } from 'crypto';

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const newToken = randomUUID();
  const { error } = await adminClient
    .from('user_profiles')
    .upsert({ user_id: user.id, share_token: newToken }, { onConflict: 'user_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ share_token: newToken });
}
