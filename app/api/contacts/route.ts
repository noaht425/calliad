import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import {
  findContacts, setRelationship, listContacts, contactCounts, hideContact, updateContactFields, logContact,
  type Relationship,
} from '@/lib/integrations/icloud-contacts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  return user ?? null;
}

// GET ?q=jess           → fuzzy search
//     ?tab=family|friend|colleague|acquaintance|all  → the People page list
//     ?filed=1          → only ones with a relationship set
// always returns { items, counts }
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const q = sp.get('q');
  const tab = sp.get('tab');

  let items;
  if (q) items = await findContacts(user.id, q);
  else if (tab) items = await listContacts(user.id, { relationship: (tab === 'all' ? 'all' : tab) as Relationship | 'all' });
  else items = await listContacts(user.id, { withRelationship: sp.get('filed') === '1' });

  return NextResponse.json({ items, counts: await contactCounts(user.id) });
}

// PATCH { id, relationship?, note?, name?, birthday?, hidden? }
export async function PATCH(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as {
    id?: string; relationship?: string | null; note?: string | null;
    name?: string; birthday?: string | null; hidden?: boolean;
    anniversary?: string | null; contact_cadence?: string | null; logContact?: boolean;
  };
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  if (b.logContact) {
    const row = await logContact(user.id, b.id);
    return NextResponse.json({ ok: true, contact: row });
  }
  if (typeof b.hidden === 'boolean') {
    await hideContact(user.id, b.id, b.hidden);
    return NextResponse.json({ ok: true });
  }
  if (b.name !== undefined || b.birthday !== undefined || b.anniversary !== undefined || b.contact_cadence !== undefined) {
    await updateContactFields(user.id, b.id, {
      name: b.name, birthday: b.birthday, anniversary: b.anniversary, contact_cadence: b.contact_cadence,
    });
    return NextResponse.json({ ok: true });
  }
  if (b.relationship === null) {
    await adminClient.from('contacts')
      .update({ relationship: null, relationship_note: null, updated_at: new Date().toISOString() })
      .eq('user_id', user.id).eq('id', b.id);
    return NextResponse.json({ ok: true });
  }
  const valid = ['family', 'friend', 'colleague', 'acquaintance'];
  if (b.relationship && valid.includes(b.relationship)) {
    await setRelationship(user.id, b.id, b.relationship as Relationship, b.note ?? null);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
}
