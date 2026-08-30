import { NextRequest, NextResponse } from 'next/server';
import { parseVCard } from '@/lib/vcard-parse';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.redirect(new URL('/', req.url), 303);
  }

  // Check for vCard file
  const file = formData.get('contact');
  if (file && file instanceof File && file.size > 0) {
    const raw = await file.text();
    const contact = parseVCard(raw);
    if (contact) {
      const encoded = Buffer.from(JSON.stringify(contact)).toString('base64url');
      return NextResponse.redirect(new URL(`/people?import=${encoded}`, req.url), 303);
    }
  }

  // Fall back: URL/text share → redirect to existing GET handler
  const title = formData.get('title')?.toString() ?? '';
  const text  = formData.get('text')?.toString() ?? '';
  const url   = formData.get('url')?.toString() ?? '';

  // Check if text itself is a vCard (some iOS versions send content as text param)
  if (text.includes('BEGIN:VCARD')) {
    const contact = parseVCard(text);
    if (contact) {
      const encoded = Buffer.from(JSON.stringify(contact)).toString('base64url');
      return NextResponse.redirect(new URL(`/people?import=${encoded}`, req.url), 303);
    }
  }

  if (title || text || url) {
    const params = new URLSearchParams();
    if (title) params.set('title', title);
    if (text)  params.set('text', text);
    if (url)   params.set('url', url);
    return NextResponse.redirect(new URL(`/share-target?${params}`, req.url), 303);
  }

  return NextResponse.redirect(new URL('/', req.url), 303);
}
