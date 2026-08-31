import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { captureLink, listItems } from '@/lib/capture/link';
import { audit } from '@/lib/hub/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  return user ?? null;
}

// GET ?kind=reading|watch|link → list
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const kind = req.nextUrl.searchParams.get('kind') ?? undefined;
  return NextResponse.json({ items: await listItems(user.id, kind) });
}

// POST { url, source? } → capture
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { url?: string; source?: 'chat' | 'share' };
  if (!b.url?.trim()) return NextResponse.json({ error: 'url required' }, { status: 400 });

  const r = await captureLink(user.id, b.url, { source: b.source ?? 'share' });
  if (r.ok) {
    await audit.log('tool_call', 'calliad', null, {
      tool: 'capture_link', url: b.url, kind: r.item.kind, deduped: r.deduped,
    });
  }
  return NextResponse.json(r, { status: r.ok ? 200 : 422 });
}

// PATCH { id, status: 'done'|'unread'|'archived' }
export async function PATCH(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { id?: string; status?: string };
  if (!b.id || !['done', 'unread', 'archived'].includes(b.status ?? '')) {
    return NextResponse.json({ error: 'id and status required' }, { status: 400 });
  }
  await adminClient.from('list_items').update({ status: b.status }).eq('user_id', user.id).eq('id', b.id);
  return NextResponse.json({ ok: true });
}
