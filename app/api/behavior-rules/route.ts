import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  return user ?? null;
}

// GET → active + paused rules
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data } = await adminClient
    .from('behavior_rules')
    .select('id, rule_text, source, status, created_at')
    .eq('user_id', user.id)
    .in('status', ['active', 'paused'])
    .order('created_at');
  return NextResponse.json({ rules: data ?? [] });
}

// POST { rule_text } → add an explicit rule
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { rule_text?: string };
  const rule = b.rule_text?.trim();
  if (!rule) return NextResponse.json({ error: 'rule_text required' }, { status: 400 });
  const { data } = await adminClient
    .from('behavior_rules')
    .insert({ user_id: user.id, rule_text: rule.slice(0, 200), source: 'explicit', status: 'active' })
    .select('id, rule_text, source, status, created_at')
    .single();
  return NextResponse.json({ rule: data });
}

// PATCH { id, status: 'active' | 'paused' }
export async function PATCH(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { id?: string; status?: string };
  if (!b.id || !['active', 'paused'].includes(b.status ?? '')) {
    return NextResponse.json({ error: 'id and status (active|paused) required' }, { status: 400 });
  }
  await adminClient
    .from('behavior_rules')
    .update({ status: b.status, updated_at: new Date().toISOString() })
    .eq('id', b.id)
    .eq('user_id', user.id);
  return NextResponse.json({ ok: true });
}

// DELETE ?id= → dismiss
export async function DELETE(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await adminClient
    .from('behavior_rules')
    .update({ status: 'dismissed' })
    .eq('id', id)
    .eq('user_id', user.id);
  return NextResponse.json({ ok: true });
}
