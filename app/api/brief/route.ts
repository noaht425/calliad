import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { composeBrief } from '@/lib/brief/compose';
import { sendPush } from '@/lib/hub/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Manual brief run (bearer auth). GET → generate + return text. ?push=1 also pushes.
export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const brief = await composeBrief(user.id, 'manual');
  if (!brief.deferred && req.nextUrl.searchParams.get('push') === '1') {
    await sendPush(user.id, { title: 'Morning brief', body: brief.text.slice(0, 160), url: '/', tag: 'brief' });
  }
  return NextResponse.json({
    ok: true,
    deferred: brief.deferred,
    conversationId: brief.conversationId,
    costUsd: brief.costUsd,
    text: brief.text,
  });
}
