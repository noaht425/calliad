import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const runtime = 'nodejs';

const genai = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY!);

type PhotoType = 'event_flyer' | 'place_restaurant' | 'place_building' | 'recipe' | 'unknown';

interface ClassifyResult {
  type: PhotoType;
  title: string;
  description: string;
  structured_data: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get('image') as File | null;
  const latStr = formData.get('lat') as string | null;
  const lngStr = formData.get('lng') as string | null;

  if (!file) return NextResponse.json({ error: 'image required' }, { status: 400 });

  const bytes = await file.arrayBuffer();
  const base64 = Buffer.from(bytes).toString('base64');
  const mimeType = (file.type || 'image/jpeg') as string;

  const lat = latStr ? parseFloat(latStr) : null;
  const lng = lngStr ? parseFloat(lngStr) : null;

  const { data: profile } = await adminClient
    .from('user_profiles')
    .select('full_name')
    .eq('user_id', user.id)
    .single();
  const userName = ((profile?.full_name as string | undefined) ?? '').split(' ')[0] || 'you';

  const model = genai.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

  const locationHint = lat && lng
    ? `\nThe photo was taken at approximately lat=${lat.toFixed(4)}, lng=${lng.toFixed(4)}.`
    : '';

  const classifyResult = await model.generateContent([
    { inlineData: { mimeType, data: base64 } },
    `Classify this image and extract structured data.${locationHint}

Classify as exactly one of:
- "event_flyer": A flyer, poster, ticket, or signage for a concert, show, festival, sports event, or other event
- "place_restaurant": A restaurant, cafe, bar, or food establishment (exterior, menu, sign, or interior)
- "place_building": A recognizable building, landmark, or location (not a restaurant)
- "recipe": A recipe from a cookbook, magazine, handwritten card, or website screenshot
- "unknown": Anything else

Return ONLY valid JSON, no markdown:
{
  "type": "event_flyer"|"place_restaurant"|"place_building"|"recipe"|"unknown",
  "title": "short descriptive title",
  "description": "2-3 sentences describing what you see",
  "structured_data": {}
}

For event_flyer, structured_data = { "event_name": "...", "date": "YYYY-MM-DD or null", "time": "HH:MM or null", "location": "venue name and/or city", "details": "any other relevant details" }
For place_restaurant, structured_data = { "name": "...", "cuisine": "...", "address": "if visible" }
For place_building, structured_data = { "name": "...", "address": "if visible or inferrable from location", "details": "..." }
For recipe, structured_data = { "title": "...", "ingredients": ["..."], "instructions_summary": "brief 1-2 sentence summary of method", "servings": "...", "total_time": "..." }
For unknown, structured_data = {}`
  ]);

  const classifyRaw = classifyResult.response.text().replace(/```json\n?|\n?```/g, '').trim();

  let classified: ClassifyResult;
  try {
    classified = JSON.parse(classifyRaw);
  } catch {
    classified = { type: 'unknown', title: 'Photo', description: classifyRaw.slice(0, 300), structured_data: {} };
  }

  const { type, title, description, structured_data } = classified;

  // Build the curation card transcript and executor config
  let transcript: string;
  let executor: string;
  let executorParams: Record<string, unknown>;
  let choices: string[] | undefined;

  switch (type) {
    case 'event_flyer': {
      const sd = structured_data as { event_name?: string; date?: string; time?: string; location?: string; details?: string };
      const eventName = sd.event_name ?? title;
      const dateStr = sd.date
        ? new Date(sd.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
        : 'an upcoming date';
      const locationStr = sd.location ? ` at ${sd.location}` : '';
      transcript = `Looks like an event: **${eventName}**${locationStr} on ${dateStr}. Want me to add it to your calendar or set a reminder?`;
      executor = 'add_event';
      executorParams = { title: eventName, date: sd.date ?? null, time: sd.time ?? null, location: sd.location ?? null, description: sd.details ?? null };
      choices = ['Calendar', 'Reminder', 'Both'];
      break;
    }
    case 'place_restaurant': {
      const sd = structured_data as { name?: string; cuisine?: string; address?: string };
      const name = sd.name ?? title;
      const typeStr = sd.cuisine ? `${sd.cuisine} restaurant` : 'restaurant';
      transcript = `**${name}** — looks like a ${typeStr}. Want me to save it to your Places list?`;
      executor = 'save_place';
      executorParams = { name, place_type: 'restaurant', cuisine: sd.cuisine ?? null, address: sd.address ?? null, lat, lng };
      choices = ['Save to Places', 'Not now'];
      break;
    }
    case 'place_building': {
      const sd = structured_data as { name?: string; address?: string; details?: string };
      const name = sd.name ?? title;
      transcript = `${description}${name !== 'Photo' ? `\n\nThis appears to be **${name}**. ` : ' '}How can I help?`;
      executor = 'save_place';
      executorParams = { name, place_type: 'building', address: sd.address ?? null, lat, lng };
      choices = undefined; // open-ended curation
      break;
    }
    case 'recipe': {
      const sd = structured_data as { title?: string; ingredients?: string[]; instructions_summary?: string; servings?: string; total_time?: string };
      const recipeName = sd.title ?? title;
      const timeStr = sd.total_time ? ` (${sd.total_time})` : '';
      transcript = `Found a recipe for **${recipeName}**${timeStr}. Want me to save this to A Bent Fork?`;
      executor = 'save_recipe';
      executorParams = {
        title: recipeName,
        ingredients: sd.ingredients ?? [],
        instructions_summary: sd.instructions_summary ?? '',
        servings: sd.servings ?? null,
        total_time: sd.total_time ?? null,
      };
      choices = ['Save to A Bent Fork', 'Not now'];
      break;
    }
    default: {
      transcript = `${description}\n\nWhat would you like to do with this?`;
      executor = 'none';
      executorParams = {};
      choices = undefined;
      break;
    }
  }

  const now = new Date().toISOString();

  // Create photo capture record
  const { data: photoCap } = await adminClient
    .from('captures')
    .insert({
      user_id: user.id,
      source: 'photo',
      transcript: `[Photo: ${title}] ${description}`,
      summary: title,
      tags: [type.replace('_', '-')],
      status: 'inbox',
      transcription_status: 'done',
      created_at: now,
      updated_at: now,
      metadata: { photo_type: type, structured_data, lat, lng },
    })
    .select('id,user_id,raw_audio_url,transcript,summary,tags,folder_id,source,location_lat,location_lng,location_label,status,transcription_status,metadata,trip_id,created_at,updated_at')
    .single();

  // Create curation action card
  const { data: actionCard } = await adminClient
    .from('captures')
    .insert({
      user_id: user.id,
      source: 'action',
      transcript,
      summary: title,
      tags: [type.replace('_', '-')],
      status: 'inbox',
      transcription_status: 'done',
      created_at: now,
      updated_at: now,
      metadata: {
        action_type: 'curation',
        interaction_type: type,
        executor,
        executor_params: executorParams,
        source_capture_id: photoCap?.id ?? null,
        choices: choices ?? null,
        turn_count: 0,
        max_turns: 4,
        photo_type: type,
      },
    })
    .select('id,user_id,raw_audio_url,transcript,summary,tags,folder_id,source,location_lat,location_lng,location_label,status,transcription_status,metadata,trip_id,created_at,updated_at')
    .single();

  void userName; // used in prompt context above
  return NextResponse.json({ photoCap, actionCard });
}
