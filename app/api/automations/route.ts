import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { AUTO_KINDS, getAutoAllow, setAutoAllow } from '@/lib/actions/auto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  return user ?? null;
}

export async function GET(req: NextRequest) {
  if (!(await requireUser(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ kinds: AUTO_KINDS, allow: await getAutoAllow() });
}

// PATCH { kind, on }
export async function PATCH(req: NextRequest) {
  if (!(await requireUser(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { kind?: string; on?: boolean };
  if (!b.kind || !AUTO_KINDS.some((k) => k.kind === b.kind)) {
    return NextResponse.json({ error: 'unknown kind' }, { status: 400 });
  }
  const allow = await setAutoAllow({ [b.kind]: !!b.on });
  return NextResponse.json({ allow });
}
