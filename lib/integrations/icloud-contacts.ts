import { DAVClient } from 'tsdav';
import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';

// iCloud Contacts over CardDAV — same Apple ID + app-specific password as the
// calendar connection (stored in connected_services under 'icloud_calendar').

export type Relationship = 'family' | 'friend' | 'colleague' | 'acquaintance';

export interface Contact {
  id: string;
  uid: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  emails: string[];
  phones: string[];
  org: string | null;
  birthday: string | null;
  groups: string[];
  note: string | null;
  relationship: Relationship | null;
  relationship_note: string | null;
}

async function client(userId: string): Promise<DAVClient | null> {
  const { data } = await adminClient
    .from('connected_services')
    .select('access_token, metadata')
    .eq('user_id', userId)
    .eq('service', 'icloud_calendar')
    .maybeSingle();
  const appleId = (data?.metadata as Record<string, unknown> | null)?.apple_id as string | undefined;
  if (!data?.access_token || !appleId) return null;
  const c = new DAVClient({
    serverUrl: 'https://contacts.icloud.com',
    credentials: { username: appleId, password: data.access_token },
    authMethod: 'Basic',
    defaultAccountType: 'carddav',
  });
  await c.login();
  return c;
}

// ── vCard parsing ─────────────────────────────────────────────────────────
const unfold = (s: string) => s.replace(/\r?\n[ \t]/g, '');
function all(card: string, name: string): string[] {
  return [...unfold(card).matchAll(new RegExp(`^${name}[^:\\r\\n]*:(.+)$`, 'gim'))].map((m) => m[1].trim()).filter(Boolean);
}
const one = (card: string, name: string) => all(card, name)[0] ?? null;

function parseVCard(card: string): Omit<Contact, 'id' | 'relationship' | 'relationship_note' | 'groups'> | null {
  const uid = one(card, 'UID');
  if (!uid) return null;
  const n = one(card, 'N'); // Last;First;Middle;Prefix;Suffix
  const [last, first] = (n ?? '').split(';').map((s) => s.replace(/\\,/g, ',').trim());
  const fn = one(card, 'FN')?.replace(/\\,/g, ',') ?? [first, last].filter(Boolean).join(' ');
  if (!fn) return null;
  const bday = one(card, 'BDAY');
  return {
    uid,
    name: fn,
    first_name: first || null,
    last_name: last || null,
    emails: all(card, 'EMAIL').map((e) => e.toLowerCase()),
    phones: all(card, 'TEL'),
    org: one(card, 'ORG')?.replace(/\\,/g, ',').replace(/;+$/, '') || null,
    birthday: bday ? bday.replace(/^(\d{4})-?(\d{2})-?(\d{2}).*/, (_, y, m, d) => (y === '1604' ? `${m}-${d}` : `${y}-${m}-${d}`)) : null,
    note: one(card, 'NOTE')?.replace(/\\n/g, '\n').replace(/\\,/g, ',') || null,
  };
}

// ── sync ─────────────────────────────────────────────────────────────────
export async function syncContacts(userId: string): Promise<{ synced: number; removed: number; error?: string }> {
  const c = await client(userId);
  if (!c) return { synced: 0, removed: 0, error: 'not_connected' };
  try {
    const books = await c.fetchAddressBooks();
    const raw: string[] = [];
    for (const b of books) {
      const vcs = await c.fetchVCards({ addressBook: b });
      for (const v of vcs) if (v.data) raw.push(String(v.data));
    }

    // group cards → member UID → [group names]
    const groupOf = new Map<string, string[]>();
    for (const card of raw) {
      if (!/X-ADDRESSBOOKSERVER-KIND:group/i.test(card)) continue;
      const gname = one(card, 'FN');
      if (!gname) continue;
      for (const m of card.matchAll(/X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:([0-9A-Fa-f-]+)/g)) {
        const list = groupOf.get(m[1].toUpperCase()) ?? [];
        list.push(gname);
        groupOf.set(m[1].toUpperCase(), list);
      }
    }

    const parsed = raw
      .filter((card) => !/X-ADDRESSBOOKSERVER-KIND:group/i.test(card))
      .map(parseVCard)
      .filter((x): x is NonNullable<typeof x> => !!x);

    if (parsed.length) {
      await adminClient.from('contacts').upsert(
        parsed.map((p) => ({
          user_id: userId,
          ...p,
          groups: groupOf.get(p.uid.toUpperCase()) ?? [],
          source: 'icloud',
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'user_id,uid', ignoreDuplicates: false },
      );
    }

    const liveUids = new Set(parsed.map((p) => p.uid));
    const { data: existing } = await adminClient.from('contacts').select('uid').eq('user_id', userId).eq('source', 'icloud');
    const stale = (existing ?? []).map((x) => x.uid).filter((u) => !liveUids.has(u));
    if (stale.length) await adminClient.from('contacts').delete().eq('user_id', userId).in('uid', stale);

    await audit.log('trigger_fired', 'cron', 'sync', { part: 'contacts', synced: parsed.length, removed: stale.length });
    return { synced: parsed.length, removed: stale.length };
  } catch (e) {
    return { synced: 0, removed: 0, error: String(e) };
  }
}

// ── lookup ───────────────────────────────────────────────────────────────
const SEL = 'id, uid, name, first_name, last_name, emails, phones, org, birthday, groups, note, relationship, relationship_note';

export async function findContacts(userId: string, query: string): Promise<Contact[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const { data } = await adminClient.from('contacts').select(SEL).eq('user_id', userId);
  const rows = (data ?? []) as Contact[];
  const scored = rows
    .map((r) => {
      const name = r.name.toLowerCase();
      const first = (r.first_name ?? '').toLowerCase();
      let score = 0;
      if (name === q || first === q) score = 5;
      else if (name.startsWith(q) || first.startsWith(q)) score = 3;
      else if (name.includes(q) || first.includes(q) || (r.last_name ?? '').toLowerCase().includes(q)) score = 1;
      return { r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  // collapse duplicate cards for the same person (common in iCloud) — keep the fullest
  const byName = new Map<string, { r: Contact; score: number }>();
  for (const s of scored) {
    const k = s.r.name.toLowerCase();
    const prev = byName.get(k);
    const rich = (c: Contact) => c.emails.length + c.phones.length + (c.relationship ? 3 : 0) + (c.org ? 1 : 0);
    if (!prev || rich(s.r) > rich(prev.r)) byName.set(k, s);
  }
  return [...byName.values()].sort((a, b) => b.score - a.score).slice(0, 6).map((x) => x.r);
}

export async function setRelationship(userId: string, id: string, relationship: Relationship, note?: string | null): Promise<void> {
  await adminClient
    .from('contacts')
    .update({ relationship, relationship_note: note ?? null, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('id', id);
  await audit.log('outbound_message', 'calliad', null, { action: 'set_relationship', id, relationship, note });
}

export async function listContacts(userId: string, opts: { withRelationship?: boolean } = {}): Promise<Contact[]> {
  let q = adminClient.from('contacts').select(SEL).eq('user_id', userId).order('name');
  if (opts.withRelationship) q = q.not('relationship', 'is', null);
  const { data } = await q;
  return (data ?? []) as Contact[];
}

// ── kinship term → relationship bucket ───────────────────────────────────
const FAMILY = /^(mom|mother|dad|father|sister|brother|son|daughter|wife|husband|partner|fianc[ée]e?|cousin|aunt|uncle|niece|nephew|grandma|grandmother|grandpa|grandfather|grandparent|sister-in-law|brother-in-law|mother-in-law|father-in-law|stepmom|stepdad|stepsister|stepbrother|half-sister|half-brother)$/i;
const FRIEND = /^(friend|buddy|pal|bestie|best friend|roommate|housemate|neighbou?r)$/i;
const COLLEAGUE = /^(colleague|coworker|co-worker|boss|manager|advisor|adviser|professor|classmate|labmate|teammate|mentor|supervisor|student)$/i;

export function relationshipFor(term: string): Relationship | null {
  const t = term.trim().toLowerCase();
  if (FAMILY.test(t)) return 'family';
  if (FRIEND.test(t)) return 'friend';
  if (COLLEAGUE.test(t)) return 'colleague';
  return null;
}

// "my niece Jessica" / "Jessica, my niece" → { term, name }
const REL_WORDS =
  'mom|mother|dad|father|sister|brother|son|daughter|wife|husband|partner|fianc[ée]e?|cousin|aunt|uncle|niece|nephew|grandma|grandmother|grandpa|grandfather|sister-in-law|brother-in-law|mother-in-law|father-in-law|stepmom|stepdad|stepsister|stepbrother|friend|buddy|pal|roommate|housemate|neighbou?r|colleague|coworker|co-worker|boss|manager|advisor|adviser|professor|classmate|labmate|teammate|mentor|student';

export function detectRelationshipMention(text: string): { term: string; name: string } | null {
  // Case-sensitive on the NAME (must be a real capitalised proper noun); the
  // relationship word stays lower-case (how people actually write it).
  const NAME = `[A-Z][a-z]+(?:\\s+[A-Z][a-z]+){0,2}`;
  const a = text.match(new RegExp(`\\b[Mm]y\\s+(${REL_WORDS})\\s+(${NAME})`));
  if (a) return { term: a[1].toLowerCase(), name: a[2] };
  const b = text.match(new RegExp(`\\b(${NAME}),?\\s+[Mm]y\\s+(${REL_WORDS})\\b`));
  if (b) return { term: b[2].toLowerCase(), name: b[1] };
  return null;
}

/**
 * A brief block naming any known contacts referenced in the turn (for the brain).
 * Targeted: a name right after a person-verb ("call/email/meet/ask/tell/with/from
 * <Name>") or a two-word "First Last". Avoids scanning every capitalised word
 * against 800+ contacts and lighting up on "Will", "Mark", etc.
 */
export async function contactContextLine(userId: string, text: string): Promise<string> {
  const cands = new Set<string>();
  for (const m of text.matchAll(/\b(?:call|calling|text|texting|email|emailing|message|messaging|meet|meeting|see|seeing|ask|asking|tell|telling|invite|inviting|visit|visiting|with|from|to|and)\s+([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]+)?)/g)) cands.add(m[1]);
  for (const m of text.matchAll(/\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b/g)) cands.add(m[1]); // First Last
  const names = [...cands].slice(0, 8);
  if (!names.length) return '';

  const hits: string[] = [];
  for (const n of names) {
    const lc = n.toLowerCase();
    const c = (await findContacts(userId, n))[0];
    if (c && (c.name.toLowerCase() === lc || (c.first_name ?? '').toLowerCase() === lc.split(' ')[0])) {
      hits.push(`- "${n}" → ${c.name}${c.relationship ? ` (${c.relationship_note || c.relationship})` : ''}${c.org ? `, ${c.org}` : ''}`);
    }
  }
  if (!hits.length) return '';
  return `## Contacts in this message\n${hits.join('\n')}\nUse the full name / relationship if it helps; don't announce the lookup.`;
}
