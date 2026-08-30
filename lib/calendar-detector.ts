import { GoogleGenerativeAI } from '@google/generative-ai';
import { adminClient } from './supabase.server';

const genai = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY!);

interface CalendarExtraction {
  is_calendar_event: boolean;
  title: string | null;
  start_at: string | null;
  end_at: string | null;
  all_day: boolean;
  location: string | null;
  description: string | null;
}

async function extractCalendarEvent(transcript: string, today: string): Promise<CalendarExtraction | null> {
  const model = genai.getGenerativeModel({ model: 'gemini-3.6-flash' });
  const result = await model.generateContent(
    `Today is ${today}. Does this text describe a specific calendar event or appointment (with a date and/or time)?
Examples: "dentist on Thursday at 2pm", "dinner with Sarah next Friday", "flight to Chicago on October 23rd".
NOT a calendar event: reminders, shopping items, general notes, recurring habits.

Return JSON only:
{
  "is_calendar_event": boolean,
  "title": string | null,
  "start_at": string | null,  // ISO 8601 UTC, null if no date
  "end_at": string | null,    // ISO 8601 UTC, null if not specified
  "all_day": boolean,
  "location": string | null,
  "description": string | null
}

Text: "${transcript.replace(/"/g, "'")}"`,
  );
  const raw = result.response.text().replace(/```json\n?|\n?```/g, '').trim();
  try {
    return JSON.parse(raw) as CalendarExtraction;
  } catch {
    return null;
  }
}

export async function detectAndCreateCalendarCard(
  userId: string,
  captureId: string,
  transcript: string,
): Promise<boolean> {
  // Dedup: skip if we already created an action card for this source capture
  const { data: existing } = await adminClient
    .from('captures')
    .select('id')
    .eq('user_id', userId)
    .eq('source', 'action')
    .contains('metadata', { source_capture_id: captureId, action_type: 'add_to_calendar' })
    .limit(1)
    .maybeSingle();

  if (existing) return false;

  const today = new Date().toISOString().slice(0, 10);
  const extraction = await extractCalendarEvent(transcript, today);
  if (!extraction?.is_calendar_event || !extraction.title || !extraction.start_at) return false;

  // Get stored calendar list for the dropdown
  const { data: svc } = await adminClient
    .from('connected_services')
    .select('metadata')
    .eq('user_id', userId)
    .eq('service', 'icloud_calendar')
    .single();

  const meta = (svc?.metadata ?? {}) as Record<string, unknown>;
  const calendars = (meta.calendars as { url: string; displayName: string }[] | undefined) ?? [];
  const defaultUrl = meta.calendar_url as string | undefined;

  await adminClient.from('captures').insert({
    user_id: userId,
    source: 'action',
    transcript: `Add to calendar: ${extraction.title}`,
    summary: `Add to calendar: ${extraction.title}`,
    status: 'inbox',
    metadata: {
      action_type: 'add_to_calendar',
      source_capture_id: captureId,
      title: extraction.title,
      start_at: extraction.start_at,
      end_at: extraction.end_at ?? null,
      all_day: extraction.all_day,
      location: extraction.location ?? null,
      description: extraction.description ?? null,
      calendars,
      selected_calendar_url: defaultUrl ?? calendars[0]?.url ?? null,
    },
  });

  return true;
}
