import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { sendPush } from '@/lib/hub/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Fire a single test notification to every device the user has subscribed — so
// the whole VAPID → service-worker → OS chain can be verified from Settings.
export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { sent, pruned } = await sendPush(user.id, {
    title: 'Calliad',
    body: 'Test notification — push is working.',
    tag: 'test',
    url: '/',
  });
  return NextResponse.json({ sent, pruned });
}
