import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { listNotes, saveNote, deleteNote, searchNotes } from '@/lib/memory/notes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  return user ?? null;
}

// GET            → recent notes
// GET ?q=search  → semantic search
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const q = req.nextUrl.searchParams.get('q');
  if (q?.trim()) return NextResponse.json({ items: await searchNotes(user.id, q.trim(), 12) });
  return NextResponse.json({ items: await listNotes(user.id) });
}

// POST { content }
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { content?: string };
  if (!b.content?.trim()) return NextResponse.json({ error: 'content required' }, { status: 400 });
  const ok = await saveNote(user.id, b.content, { source: 'manual' });
  return NextResponse.json({ ok });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await deleteNote(user.id, id);
  return NextResponse.json({ ok: true });
}
