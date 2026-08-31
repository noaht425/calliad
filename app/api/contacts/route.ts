import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { findContacts, setRelationship, listContacts, type Relationship } from '@/lib/integrations/icloud-contacts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  return user ?? null;
}

// GET ?q=jess  → search; ?filed=1 → only ones with a relationship set
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const q = req.nextUrl.searchParams.get('q');
  if (q) return NextResponse.json({ items: await findContacts(user.id, q) });
  return NextResponse.json({ items: await listContacts(user.id, { withRelationship: req.nextUrl.searchParams.get('filed') === '1' }) });
}

// PATCH { id, relationship: family|friend|colleague|acquaintance|null, note? }
export async function PATCH(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { id?: string; relationship?: string | null; note?: string | null };
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const valid = ['family', 'friend', 'colleague', 'acquaintance'];
  if (b.relationship == null) {
    await adminClient.from('contacts').update({ relationship: null, relationship_note: null, updated_at: new Date().toISOString() }).eq('user_id', user.id).eq('id', b.id);
    return NextResponse.json({ ok: true });
  }
  if (!valid.includes(b.relationship)) return NextResponse.json({ error: 'bad relationship' }, { status: 400 });
  await setRelationship(user.id, b.id, b.relationship as Relationship, b.note ?? null);
  return NextResponse.json({ ok: true });
}
