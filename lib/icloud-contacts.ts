import { DAVClient } from 'tsdav';
import { adminClient } from './supabase.server';

interface ContactRecord {
  full_name: string;
  birthday: string | null;   // MM-DD
  anniversary: string | null; // MM-DD
  birth_year: number | null;
  external_id: string;       // vCard UID
}

async function getContactsClient(userId: string): Promise<{ client: DAVClient; appleId: string } | null> {
  // Re-use icloud_calendar credentials — same Apple ID + app-specific password
  const { data } = await adminClient
    .from('connected_services')
    .select('access_token, metadata')
    .eq('user_id', userId)
    .eq('service', 'icloud_calendar')
    .single();

  if (!data?.access_token) return null;
  const m = (data.metadata ?? {}) as Record<string, string>;
  if (!m.apple_id) return null;

  const client = new DAVClient({
    serverUrl: 'https://contacts.icloud.com',
    credentials: { username: m.apple_id, password: data.access_token },
    authMethod: 'Basic',
    defaultAccountType: 'carddav',
  });

  await client.login();
  return { client, appleId: m.apple_id };
}

function parseVCardDate(raw: string): { month: string; day: string; year: number | null } | null {
  // Handles: YYYY-MM-DD, YYYYMMDD, --MMDD (no year)
  const noYear = raw.match(/^--(\d{2})(\d{2})$/);
  if (noYear) return { month: noYear[1], day: noYear[2], year: null };

  const withDashes = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (withDashes) {
    const y = parseInt(withDashes[1], 10);
    return { month: withDashes[2], day: withDashes[3], year: y < 1900 ? null : y };
  }

  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    const y = parseInt(compact[1], 10);
    return { month: compact[2], day: compact[3], year: y < 1900 ? null : y };
  }

  return null;
}

function extractVCardProp(vcard: string, prop: string): string | null {
  // Normalize CRLF → LF
  const normalized = vcard.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Unfold RFC 6350 folded lines (continuation lines start with space or tab)
  const unfolded = normalized.replace(/\n[ \t]/g, '');
  const propLower = prop.toLowerCase();

  for (const line of unfolded.split('\n')) {
    // Strip optional group prefix: item1., item2., X-., etc.
    const dotIdx = line.indexOf('.');
    const colonIdx = line.indexOf(':');
    const bare = (dotIdx !== -1 && (colonIdx === -1 || dotIdx < colonIdx))
      ? line.slice(dotIdx + 1)
      : line;
    const bareLower = bare.toLowerCase();
    if (bareLower.startsWith(propLower + ':') || bareLower.startsWith(propLower + ';')) {
      const valueStart = bare.indexOf(':');
      if (valueStart !== -1) return bare.slice(valueStart + 1).trim();
    }
  }
  return null;
}

function extractAppleAnniversary(vcard: string): string | null {
  const normalized = vcard.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const unfolded = normalized.replace(/\n[ \t]/g, '');
  const lines = unfolded.split('\n');

  // Find item prefixes whose X-ABLabel value contains "anniversary"
  const prefixes = new Set<string>();
  for (const line of lines) {
    const dotIdx = line.indexOf('.');
    const colonIdx = line.indexOf(':');
    if (dotIdx === -1 || colonIdx === -1 || dotIdx >= colonIdx) continue;
    const bare = line.slice(dotIdx + 1);
    if (/^x-ablabel[;:]/i.test(bare) && /anniversary/i.test(line.slice(colonIdx + 1))) {
      prefixes.add(line.slice(0, dotIdx).toLowerCase());
    }
  }
  if (prefixes.size === 0) return null;

  // Find the X-ABDATE (or ANNIVERSARY) field sharing that prefix
  for (const line of lines) {
    const dotIdx = line.indexOf('.');
    const colonIdx = line.indexOf(':');
    if (dotIdx === -1 || colonIdx === -1 || dotIdx >= colonIdx) continue;
    if (!prefixes.has(line.slice(0, dotIdx).toLowerCase())) continue;
    const bare = line.slice(dotIdx + 1);
    if (/^(x-abdate|anniversary)[;:]/i.test(bare)) {
      return bare.slice(bare.indexOf(':') + 1).trim();
    }
  }
  return null;
}

function parseContact(vcard: string): ContactRecord | null {
  const uid = extractVCardProp(vcard, 'UID');
  if (!uid) return null;

  const fn = extractVCardProp(vcard, 'FN');
  if (!fn) return null;

  // Extract dates first — the LinkedIn filter must run AFTER so we don't
  // accidentally drop real contacts whose only stored field is an anniversary.
  let birthday: string | null = null;
  let birthYear: number | null = null;
  const bdayRaw = extractVCardProp(vcard, 'BDAY');
  if (bdayRaw) {
    const parsed = parseVCardDate(bdayRaw);
    if (parsed) {
      birthday = `${parsed.month}-${parsed.day}`;
      birthYear = parsed.year;
    }
  }

  let anniversary: string | null = null;
  // Apple stores anniversaries as itemN.X-ABDATE + itemN.X-ABLabel:_$!<Anniversary>!$_
  // Standard ANNIVERSARY property is a fallback for vCard 4.0 contacts.
  const annivRaw = extractAppleAnniversary(vcard) ?? extractVCardProp(vcard, 'ANNIVERSARY') ?? extractVCardProp(vcard, 'X-ANNIVERSARY');
  if (annivRaw) {
    const parsed = parseVCardDate(annivRaw);
    if (parsed) anniversary = `${parsed.month}-${parsed.day}`;
  }

  // Must have at least one date
  if (!birthday && !anniversary) return null;

  // LinkedIn/social imports carry scraped birthdays but never wedding anniversaries.
  // Apply the phone/email filter only to birthday-only contacts so we don't drop
  // real contacts who happen to have no phone/email stored alongside their anniversary.
  if (!anniversary) {
    const normalized = vcard.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const hasTel = /\nTEL[;:]/i.test(normalized);
    const hasEmail = /\nEMAIL[;:]/i.test(normalized);
    if (!hasTel && !hasEmail) return null;
  }

  return {
    full_name: fn.replace(/\\,/g, ',').replace(/\\;/g, ';'),
    birthday,
    anniversary,
    birth_year: birthYear,
    external_id: uid,
  };
}

export async function syncContacts(userId: string): Promise<{ synced: number; pruned?: number; error?: string }> {
  try {
    const conn = await getContactsClient(userId);
    if (!conn) return { synced: 0, error: 'iCloud Calendar not connected — using same credentials' };

    const { client } = conn;
    const addressBooks = await client.fetchAddressBooks();
    if (!addressBooks.length) return { synced: 0, error: 'No address books found' };

    const contacts: ContactRecord[] = [];
    let totalVCards = 0;
    let annivInRaw = 0;   // vCards that contain "ANNIVERSARY" anywhere
    let annivParsed = 0;  // vCards where extractVCardProp succeeded

    for (const ab of addressBooks) {
      const vcards = await client.fetchVCards({ addressBook: ab });
      totalVCards += vcards.length;
      for (const vcard of vcards) {
        if (!vcard.data) continue;
        const raw = String(vcard.data);
        // Diagnostic: log every vCard that mentions ANNIVERSARY
        if (/anniversary/i.test(raw)) {
          annivInRaw++;
          const fn = extractVCardProp(raw, 'FN') ?? '(unknown)';
          const annivRaw = extractVCardProp(raw, 'ANNIVERSARY') ?? extractVCardProp(raw, 'X-ANNIVERSARY');
          if (annivRaw) annivParsed++;
          // Log a short excerpt of the raw line so we can see the exact format
          const match = raw.replace(/\r\n/g, '\n').split('\n').find((l) => /anniversary/i.test(l));
          console.log(`[icloud-contacts] ANNIVERSARY vCard: FN="${fn}" raw="${annivRaw}" line="${match}"`);
        }
        const parsed = parseContact(raw);
        if (parsed) contacts.push(parsed);
      }
    }

    console.log(`[icloud-contacts] address books: ${addressBooks.length}, vCards: ${totalVCards}, with birthday/anniversary: ${contacts.length}, ANNIVERSARY in raw: ${annivInRaw}, ANNIVERSARY parsed: ${annivParsed}`);

    // Fetch existing iCloud-sourced rows (external_id is a vCard UID, not facebook:*)
    const { data: existing } = await adminClient
      .from('family_members')
      .select('id, external_id')
      .eq('user_id', userId)
      .not('external_id', 'is', null)
      .not('external_id', 'like', 'facebook:%');

    if (contacts.length === 0) {
      if (totalVCards > 0 && existing?.length) {
        const ids = existing.map((r) => r.id);
        await adminClient.from('family_members').delete().in('id', ids);
      }
      return { synced: 0 };
    }

    const { error: upsertErr } = await adminClient.from('family_members').upsert(
      contacts.map((c) => ({
        user_id: userId,
        name: c.full_name,
        relationship: 'friend',
        birthday: c.birthday,
        anniversary: c.anniversary,
        birth_year: c.birth_year,
        external_id: c.external_id,
      })),
      { onConflict: 'user_id,external_id', ignoreDuplicates: false }
    );

    if (upsertErr) {
      console.error('[icloud-contacts] upsert error:', upsertErr.message);
      return { synced: 0, error: upsertErr.message };
    }

    // Prune iCloud rows that were removed or filtered out since last sync
    const keptIds = new Set(contacts.map((c) => c.external_id));
    const toDelete = (existing ?? []).filter((r) => !keptIds.has(r.external_id!)).map((r) => r.id);
    if (toDelete.length) {
      await adminClient.from('family_members').delete().in('id', toDelete);
      console.log(`[icloud-contacts] pruned ${toDelete.length} stale rows`);
    }

    return { synced: contacts.length, pruned: toDelete.length };
  } catch (err) {
    console.error('[icloud-contacts] sync error:', err);
    return { synced: 0, error: String(err) };
  }
}
