import Anthropic from '@anthropic-ai/sdk';
import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';
import { anthropicCostUsd } from '@/lib/router/tiers';
import { upsertLoop } from '@/lib/memory/loops';

const anthropic = new Anthropic();
const MODEL = 'claude-sonnet-5'; // T2 — structured doc extraction, correctness matters

export interface SyllabusExtract {
  course: { code: string | null; title: string | null; instructor: string | null; term: string | null };
  exams: { label: string; date: string | null; weight_pct: number | null; topics: string[] }[];
  assignments: { label: string; due_date: string | null; weight_pct: number | null; notes: string | null }[];
  grading: { component: string; weight_pct: number | null }[];
  notes: string | null;
}

const EXTRACT_PROMPT = `You are extracting structured data from a course syllabus. Return ONLY JSON matching this schema — no prose, no markdown fence:

{
  "course": {"code": "e.g. CLCV-390", "title": "...", "instructor": "...", "term": "e.g. Fall 2026"},
  "exams": [{"label": "Midterm", "date": "YYYY-MM-DD or null", "weight_pct": 25, "topics": ["..."]}],
  "assignments": [{"label": "Response paper 1", "due_date": "YYYY-MM-DD or null", "weight_pct": 10, "notes": "..."}],
  "grading": [{"component": "Participation", "weight_pct": 15}],
  "notes": "one or two sentences of anything else load-bearing (attendance policy, late policy), or null"
}

Rules:
- Dates as YYYY-MM-DD. If the syllabus gives a weekday + month/day without a year, use the term's year. If a date is truly not determinable, use null — never guess.
- Include every graded exam, quiz, paper, project, and problem set with a due date. Recurring weekly work (e.g. "weekly reading responses") → one assignment entry with notes explaining the cadence, due_date null.
- weight_pct is a number (percent of final grade) or null.
- If a field isn't in the document, use null / empty array. Do not invent.`;

function isPdf(filename: string, mime?: string): boolean {
  return mime === 'application/pdf' || /\.pdf$/i.test(filename);
}

export async function ingestSyllabus(
  userId: string,
  input: { filename: string; mime?: string; bytesBase64?: string; text?: string },
): Promise<{ ok: true; documentId: string; course: string | null; loopsFiled: number; eventsFiled: number; extract: SyllabusExtract } | { ok: false; error: string }> {
  const started = Date.now();

  const content: Anthropic.ContentBlockParam[] = [];
  if (input.bytesBase64 && isPdf(input.filename, input.mime)) {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: input.bytesBase64 } });
  } else if (input.text?.trim()) {
    content.push({ type: 'document', source: { type: 'text', media_type: 'text/plain', data: input.text.slice(0, 60000) } });
  } else {
    return { ok: false, error: 'need a PDF or text' };
  }
  content.push({ type: 'text', text: EXTRACT_PROMPT });

  let raw = '';
  let usage: Anthropic.Messages.Usage | undefined;
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      messages: [{ role: 'user', content }],
    });
    usage = msg.usage;
    raw = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
  } catch (err) {
    await audit.log('error', 'system', null, { where: 'ingestSyllabus', message: String(err) });
    return { ok: false, error: `extraction failed: ${String(err)}` };
  }

  const cost = usage ? anthropicCostUsd(MODEL, usage) : 0;
  await audit.modelCall({
    conversation_id: null, purpose: 'extract', tier: 'T2', model: MODEL,
    input_tokens: usage?.input_tokens ?? 0,
    cached_read_tokens: usage?.cache_read_input_tokens ?? 0,
    cache_write_tokens: usage?.cache_creation_input_tokens ?? 0,
    output_tokens: usage?.output_tokens ?? 0,
    cost_usd: cost, latency_ms: Date.now() - started,
  });

  let extract: SyllabusExtract;
  try {
    extract = JSON.parse(raw.replace(/^```json\n?|\n?```$/g, '').trim());
  } catch {
    return { ok: false, error: 'model did not return valid JSON' };
  }

  const course = extract.course?.code ?? null;

  const { data: doc } = await adminClient
    .from('documents')
    .insert({
      user_id: userId, kind: 'syllabus', filename: input.filename, course,
      raw_text: input.text ?? null, extracted: extract,
    })
    .select('id')
    .single();

  // Clean replace: drop existing open syllabus-sourced loops + calendar rows for
  // this course, then re-file both. The loop drives deadline nudges; the
  // all-day calendar row makes the deadline show up in the schedule views and
  // the morning brief.
  if (course) {
    await adminClient
      .from('open_loops')
      .delete()
      .eq('user_id', userId)
      .eq('source', 'syllabus')
      .eq('status', 'open')
      .contains('tags', [course.toLowerCase()]);
    await adminClient
      .from('calendar_events')
      .delete()
      .eq('user_id', userId)
      .eq('source', 'syllabus')
      .like('uid', `syllabus::${course}::%`);
  }

  const tagBase = course ? [course.toLowerCase()] : [];
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const calRows: Record<string, unknown>[] = [];
  const dated: { label: string; date: string; kind: 'exam' | 'assignment' }[] = [];
  for (const e of extract.exams ?? []) if (e.date) dated.push({ label: e.label, date: e.date, kind: 'exam' });
  for (const a of extract.assignments ?? []) if (a.due_date) dated.push({ label: a.label, date: a.due_date, kind: 'assignment' });

  let filed = 0;
  for (const e of extract.exams ?? []) {
    if (!e.date) continue;
    await upsertLoop(userId, {
      title: `${course ? course + ' ' : ''}${e.label}`.trim(),
      body: [e.weight_pct != null ? `${e.weight_pct}% of grade` : null, e.topics?.length ? `topics: ${e.topics.join(', ')}` : null].filter(Boolean).join(' · ') || null,
      due_at: `${e.date}T09:00:00Z`,
      tags: [...tagBase, 'exam'],
      source: 'syllabus',
    });
    filed++;
  }
  for (const a of extract.assignments ?? []) {
    if (!a.due_date) continue;
    await upsertLoop(userId, {
      title: `${course ? course + ' ' : ''}${a.label}`.trim(),
      body: [a.weight_pct != null ? `${a.weight_pct}% of grade` : null, a.notes].filter(Boolean).join(' · ') || null,
      due_at: `${a.due_date}T23:59:00Z`,
      tags: [...tagBase, 'assignment'],
      source: 'syllabus',
    });
    filed++;
  }

  if (course) {
    for (const d of dated) {
      calRows.push({
        user_id: userId,
        uid: `syllabus::${course}::${d.kind}-${slug(d.label)}-${d.date}`,
        calendar_url: null,
        calendar_name: 'Coursework',
        title: `${course} ${d.label}${d.kind === 'exam' ? '' : ' due'}`.trim(),
        start_at: `${d.date}T12:00:00Z`, // noon-UTC anchor keeps an all-day item on the right local date
        end_at: null,
        all_day: true,
        location: null,
        description: `From the ${course} syllabus.`,
        raw_ical: null,
        source: 'syllabus',
        updated_at: new Date().toISOString(),
      });
    }
    if (calRows.length) {
      await adminClient.from('calendar_events').upsert(calRows, { onConflict: 'user_id,uid' });
    }
  }

  return { ok: true, documentId: doc?.id ?? '', course, loopsFiled: filed, eventsFiled: calRows.length, extract };
}
