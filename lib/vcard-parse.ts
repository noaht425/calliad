// vCard parsing utilities — no Node.js APIs, safe in browser and edge runtime.

export interface ParsedContact {
  name: string;
  birthday: string | null;    // MM-DD
  birth_year: number | null;
  anniversary: string | null; // MM-DD
  email: string | null;
  location_city: string | null;
  notes: string | null;
  external_id: string | null; // vCard UID
}

function unfold(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '');
}

function extractProp(vcard: string, prop: string): string | null {
  const propLower = prop.toLowerCase();
  for (const line of unfold(vcard).split('\n')) {
    const dotIdx = line.indexOf('.');
    const colonIdx = line.indexOf(':');
    const bare = dotIdx !== -1 && (colonIdx === -1 || dotIdx < colonIdx)
      ? line.slice(dotIdx + 1)
      : line;
    const bareLower = bare.toLowerCase();
    if (bareLower.startsWith(propLower + ':') || bareLower.startsWith(propLower + ';')) {
      return bare.slice(bare.indexOf(':') + 1).trim();
    }
  }
  return null;
}

function extractAppleAnniversary(vcard: string): string | null {
  const lines = unfold(vcard).split('\n');
  const prefixes = new Set<string>();
  for (const line of lines) {
    const dotIdx = line.indexOf('.');
    const colonIdx = line.indexOf(':');
    if (dotIdx === -1 || colonIdx === -1 || dotIdx >= colonIdx) continue;
    const bare = line.slice(dotIdx + 1);
    if (/^x-ablabel[;:]/i.test(bare) && /anniversary/i.test(line.slice(colonIdx + 1)))
      prefixes.add(line.slice(0, dotIdx).toLowerCase());
  }
  if (!prefixes.size) return null;
  for (const line of lines) {
    const dotIdx = line.indexOf('.');
    const colonIdx = line.indexOf(':');
    if (dotIdx === -1 || colonIdx === -1 || dotIdx >= colonIdx) continue;
    if (!prefixes.has(line.slice(0, dotIdx).toLowerCase())) continue;
    const bare = line.slice(dotIdx + 1);
    if (/^(x-abdate|anniversary)[;:]/i.test(bare))
      return bare.slice(bare.indexOf(':') + 1).trim();
  }
  return null;
}

function parseDate(raw: string): { mmdd: string; year: number | null } | null {
  const noYear = raw.match(/^--(\d{2})(\d{2})$/);
  if (noYear) return { mmdd: `${noYear[1]}-${noYear[2]}`, year: null };
  const withDashes = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (withDashes) {
    const y = parseInt(withDashes[1], 10);
    return { mmdd: `${withDashes[2]}-${withDashes[3]}`, year: y < 1900 ? null : y };
  }
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    const y = parseInt(compact[1], 10);
    return { mmdd: `${compact[2]}-${compact[3]}`, year: y < 1900 ? null : y };
  }
  return null;
}

export function parseVCard(raw: string): ParsedContact | null {
  if (!raw.includes('BEGIN:VCARD')) return null;

  const fn = extractProp(raw, 'FN');
  if (!fn) return null;
  const name = fn.replace(/\\,/g, ',').replace(/\\;/g, ';').trim();
  if (!name) return null;

  let birthday: string | null = null;
  let birth_year: number | null = null;
  const bdayRaw = extractProp(raw, 'BDAY');
  if (bdayRaw) {
    const parsed = parseDate(bdayRaw);
    if (parsed) { birthday = parsed.mmdd; birth_year = parsed.year; }
  }

  let anniversary: string | null = null;
  const annivRaw = extractAppleAnniversary(raw)
    ?? extractProp(raw, 'ANNIVERSARY')
    ?? extractProp(raw, 'X-ANNIVERSARY');
  if (annivRaw) {
    const parsed = parseDate(annivRaw);
    if (parsed) anniversary = parsed.mmdd;
  }

  // First EMAIL
  let email: string | null = null;
  for (const line of unfold(raw).split('\n')) {
    if (/^email[;:]/i.test(line) || /\.email[;:]/i.test(line)) {
      email = line.slice(line.indexOf(':') + 1).trim() || null;
      break;
    }
  }

  // City from ADR field (;;street;city;state;zip;country)
  let location_city: string | null = null;
  const adrRaw = extractProp(raw, 'ADR');
  if (adrRaw) {
    const parts = adrRaw.split(';');
    const city = parts[3]?.trim();
    if (city) location_city = city;
  }

  const noteRaw = extractProp(raw, 'NOTE');
  const notes = noteRaw ? noteRaw.replace(/\\n/g, ' ').trim() || null : null;

  const uidRaw = extractProp(raw, 'UID');
  const external_id = uidRaw ? uidRaw.trim() || null : null;

  return { name, birthday, birth_year, anniversary, email, location_city, notes, external_id };
}
