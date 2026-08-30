import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MILESTONE_LABELS: Record<string, string> = {
  inquiry: 'Initial inquiry',
  quote: 'Quote received',
  proposal: 'Proposal received',
  agreement: 'Agreement signed',
  payment: 'Payment made',
  start_date: 'Work started',
  completion: 'Project completed',
};
const MILESTONE_ORDER = ['inquiry', 'quote', 'proposal', 'agreement', 'payment', 'start_date', 'completion'];

function formatCapture(cap: Record<string, unknown>, index: number): string {
  const meta = (cap.metadata ?? {}) as Record<string, unknown>;
  const subject = meta.subject as string | undefined;
  const sentDate = meta.sent_date as string | undefined;
  const date = sentDate ?? cap.created_at as string;
  const text = cap.summary ?? cap.transcript ?? '';
  return `[${index + 1}] ${date ? date.slice(0, 10) : 'unknown date'} — ${subject ? `"${subject}" — ` : ''}${String(text).slice(0, 300)}`;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Load project (by projects.id or folder_id)
  let { data: project } = await adminClient
    .from('projects')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!project) {
    const { data: byFolder } = await adminClient
      .from('projects')
      .select('*')
      .eq('folder_id', id)
      .eq('user_id', user.id)
      .maybeSingle();
    project = byFolder ?? null;
  }

  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Linked captures
  const { data: linked } = await adminClient
    .from('captures')
    .select('id,transcript,summary,metadata,created_at,source')
    .eq('project_id', project.id)
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  // Inbox captures (candidates to file)
  const { data: inbox } = await adminClient
    .from('captures')
    .select('id,transcript,summary,metadata,created_at,source')
    .eq('user_id', user.id)
    .eq('status', 'inbox')
    .order('created_at', { ascending: false })
    .limit(50);

  const linkedText = (linked ?? []).map((c, i) => formatCapture(c as Record<string, unknown>, i)).join('\n');
  const inboxText = (inbox ?? []).map((c, i) => formatCapture(c as Record<string, unknown>, i)).join('\n');

  const prompt = `You are a smart project assistant helping to assess and consolidate information for a home services project.

PROJECT: "${project.title}"${project.company ? ` — Contractor: ${project.company}` : ''}
CURRENT STATUS: ${project.status}
CURRENT SUMMARY: ${project.summary ?? 'none'}

LINKED EMAILS & NOTES (${(linked ?? []).length} items):
${linkedText || '(none yet)'}

INBOX ITEMS — evaluate each to decide if it belongs to this project (${(inbox ?? []).length} items):
${inboxText || '(none)'}

Respond with valid JSON only, no markdown:
{
  "milestones": [
    { "phase": "inquiry|quote|proposal|agreement|payment|start_date|completion", "date": "YYYY-MM-DD", "notes": "brief evidence note" }
  ],
  "status": "planning|active|completed|archived",
  "company": "the main contractor or company name, or null if not clearly identifiable",
  "summary": "2-3 sentence summary of where the project stands right now",
  "inbox_ids_to_file": ["uuid1", "uuid2"]
}

Rules:
- Only include milestones with clear evidence. Use the date of the relevant email/note.
- "completion" milestone only if work is clearly done.
- Set status "completed" only if work is done AND final payment made or explicitly confirmed complete.
- inbox_ids_to_file: include only inbox item IDs (the bracketed number maps to position in the inbox list above, but return the actual UUID from the data) that clearly relate to this project. Be conservative — only obvious matches.
- The inbox items above are indexed [1], [2], … but you must return their actual IDs. The IDs are embedded in the context as UUIDs — if you cannot determine them, return an empty array.
- Keep the summary factual and concise.`;

  let rawText: string;
  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY!);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(prompt);
    rawText = result.response.text();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Gemini call failed: ${msg}` }, { status: 500 });
  }

  // Extract the JSON object regardless of surrounding text or markdown fences
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return NextResponse.json({ error: 'No JSON in AI response', preview: rawText.slice(0, 300) }, { status: 500 });
  }

  let parsed: {
    milestones: Array<{ phase: string; date: string; notes: string | null }>;
    status: string;
    company?: string | null;
    summary: string;
    inbox_ids_to_file: string[];
  };

  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return NextResponse.json({ error: 'AI response JSON could not be parsed', preview: jsonMatch[0].slice(0, 300) }, { status: 500 });
  }

  // Build validated milestones
  const validStatuses = ['planning', 'active', 'completed', 'archived'];
  const milestones = (parsed.milestones ?? [])
    .filter((m) => MILESTONE_ORDER.includes(m.phase) && m.date)
    .sort((a, b) => MILESTONE_ORDER.indexOf(a.phase) - MILESTONE_ORDER.indexOf(b.phase))
    .map((m) => ({
      phase: m.phase,
      date: m.date,
      label: MILESTONE_LABELS[m.phase] ?? m.phase,
      notes: m.notes ?? null,
    }));

  const newStatus = validStatuses.includes(parsed.status) ? parsed.status : project.status;

  // Update project
  const { data: updated } = await adminClient
    .from('projects')
    .update({
      milestones,
      status: newStatus,
      ...(parsed.company ? { company: parsed.company } : {}),
      summary: parsed.summary ?? project.summary,
      updated_at: new Date().toISOString(),
    })
    .eq('id', project.id)
    .eq('user_id', user.id)
    .select()
    .single();

  // File inbox items that belong to this project
  const inboxIds = (parsed.inbox_ids_to_file ?? []).filter(
    (maybeId) => (inbox ?? []).some((c) => c.id === maybeId)
  );

  let filed = 0;
  if (inboxIds.length > 0) {
    await adminClient
      .from('captures')
      .update({ project_id: project.id, status: 'folder' })
      .in('id', inboxIds)
      .eq('user_id', user.id);
    filed = inboxIds.length;
  }

  return NextResponse.json({ project: updated ?? project, filed });
}
