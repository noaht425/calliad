import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getUserContext, buildSystemPrompt } from '@/lib/context';
import { addToAlexaList } from '@/lib/alexa-lists';
import { maybeCreateTodoCurationCard } from '@/lib/todo-detector';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export const runtime = 'nodejs';

const genai = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY!);

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { capture_id } = await req.json();
  if (!capture_id) return NextResponse.json({ error: 'capture_id required' }, { status: 400 });

  const { data: capture, error: fetchErr } = await adminClient
    .from('captures')
    .select('*')
    .eq('id', capture_id)
    .eq('user_id', user.id)
    .single();

  if (fetchErr || !capture) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!capture.raw_audio_url) return NextResponse.json({ error: 'No audio' }, { status: 400 });

  await adminClient.from('captures').update({ transcription_status: 'processing' }).eq('id', capture_id);

  try {
    const isMp4 = capture.raw_audio_url.endsWith('.mp4');
    const groqExt = isMp4 ? 'mp4' : 'webm';
    const mimeType = isMp4 ? 'audio/mp4' : 'audio/webm';

    // Download via signed URL to get a native Node.js ArrayBuffer (avoids Supabase Blob quirks)
    const { data: signedData, error: signErr } = await adminClient.storage
      .from('audio')
      .createSignedUrl(capture.raw_audio_url, 60);
    if (signErr || !signedData?.signedUrl) throw new Error(`Signed URL failed: ${signErr?.message}`);

    const audioRes = await fetch(signedData.signedUrl);
    if (!audioRes.ok) throw new Error(`Audio fetch failed: ${audioRes.status}`);
    const arrayBuffer = await audioRes.arrayBuffer();
    console.log('[transcribe] audio size:', arrayBuffer.byteLength, 'ext:', groqExt, 'path:', capture.raw_audio_url);
    if (arrayBuffer.byteLength === 0) throw new Error('Downloaded audio is empty');
    // Start user context fetch immediately — it doesn't need the transcript
    const ctxPromise = getUserContext(user.id);

    // Use the Groq SDK — it handles FormData serialization correctly for audio files
    let transcript: string;
    try {
      const transcription = await groq.audio.transcriptions.create({
        file: new File([arrayBuffer], `audio.${groqExt}`, { type: mimeType }),
        model: 'whisper-large-v3-turbo',
      });
      transcript = (transcription.text ?? '').trim();
    } catch (groqErr: unknown) {
      const msg = groqErr instanceof Error ? groqErr.message : String(groqErr);
      console.error('[transcribe] Groq SDK error:', msg, '| path:', capture.raw_audio_url);
      // Mark error but KEEP the capture and audio file so we can inspect/retry.
      // We only auto-delete on empty/silent captures — format errors need investigation.
      await adminClient.from('captures').update({ transcription_status: 'error' }).eq('id', capture_id);
      return NextResponse.json({ error: `groq_error: ${msg}` }, { status: 500 });
    }

    if (!transcript) {
      // Groq returned empty — audio was silent or too short; clean up so inbox stays clear
      console.log('[transcribe] empty transcript from Groq — deleting capture', capture_id);
      await adminClient.from('captures').delete().eq('id', capture_id);
      // Best-effort: also remove the stored audio file
      adminClient.storage.from('audio').remove([capture.raw_audio_url]).catch(() => {});
      return NextResponse.json({ deleted: true }, { status: 200 });
    }

    const ctx = await ctxPromise;
    const systemPrompt = buildSystemPrompt(ctx);

    const tagModel = genai.getGenerativeModel({
      model: 'gemini-2.5-flash-lite',
      systemInstruction: systemPrompt || undefined,
    });

    const tagResult = await tagModel.generateContent(
      `Analyze this voice note and return JSON only (no markdown):
{
  "summary": "1-2 sentence summary",
  "tags": ["tag1","tag2"],
  "is_question": true/false,
  "shopping_items": ["item1"] or null,
  "todo": {
    "is_todo": true/false,
    "text": "clean task description without date words",
    "extracted_date": "YYYY-MM-DD or null",
    "extracted_time": "morning/afternoon/evening/HH:MM or null"
  }
}

Rules:
- is_question: true if the note is a question asking for information (e.g. "what hotel did we stay at", "when is my dentist", "where did I save that recipe", "did I ever capture X") — the user wants Calliad to look up an answer from their history
- shopping_items: only if the note is explicitly adding grocery/shopping list items; otherwise null
- todo.is_todo: true for tasks, reminders, errands ("set traps", "call dentist", "pick up", "remember to"); false if is_question is true
- todo.text: the task itself, without date/time qualifiers
- todo.extracted_date: parse relative dates using today = ${new Date().toISOString().slice(0, 10)} (e.g. "tomorrow" = next day, "Thursday" = nearest upcoming Thursday)
- todo.extracted_time: if a time of day is mentioned, otherwise null
- A shopping list is NOT a todo

Voice note: "${transcript}"`
    );

    const tagText = tagResult.response.text().replace(/```json\n?|\n?```/g, '').trim();
    const { summary, tags, is_question, shopping_items, todo } = JSON.parse(tagText);
    console.log('[transcribe] todo:', JSON.stringify(todo));

    const embedRes = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-embedding-001:embedContent?key=${process.env.GOOGLE_AI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/gemini-embedding-001',
          content: { parts: [{ text: transcript }] },
          outputDimensionality: 768,
        }),
      }
    );
    if (!embedRes.ok) throw new Error(`Embedding failed: ${await embedRes.text()}`);
    const embedJson = await embedRes.json() as { embedding: { values: number[] } };
    const embedding: number[] = embedJson.embedding.values;

    // If this is a question, gather context from three sources and synthesize an answer:
    // 1. Semantic search (captures WITH embeddings — voice notes, future emails)
    // 2. Full-text search (captures WITHOUT embeddings — existing email captures)
    // 3. Trips table (destination, dates, summary for all past trips)
    let answerMetadata: Record<string, unknown> | null = null;
    if (is_question) {
      try {
        type CaptureHit = { transcript?: string; summary?: string; created_at: string };
        type TripHit = { title?: string; destination?: string; start_date?: string; end_date?: string; summary?: string };

        type PersonHit = { name: string; relationship: string; birthday: string | null; anniversary: string | null; location_city: string | null; notes: string | null };

        const [semanticRes, textRes, tripsRes, peopleRes] = await Promise.all([
          // 1. Semantic search — captures that have embeddings
          adminClient.rpc('search_captures', {
            query_embedding: embedding,
            query_user_id: user.id,
            match_count: 8,
          }),
          // 2. Full-text search — catches email captures without embeddings
          adminClient.from('captures')
            .select('transcript, summary, created_at')
            .eq('user_id', user.id)
            .eq('transcription_status', 'done')
            .textSearch('transcript', transcript.split(' ').filter((w) => w.length > 3).join(' | '), { type: 'plain', config: 'english' })
            .limit(5),
          // 3. All trips — small table, include all for date/destination context
          adminClient.from('trips')
            .select('title, destination, start_date, end_date, summary')
            .eq('user_id', user.id)
            .order('start_date', { ascending: false })
            .limit(20),
          // 4. All people (family + friends) — answers birthday/personal questions
          adminClient.from('family_members')
            .select('name, relationship, birthday, anniversary, location_city, notes')
            .eq('user_id', user.id)
            .order('name'),
        ]);

        const semanticHits = (semanticRes.data ?? []) as CaptureHit[];
        const textHits = (textRes.data ?? []) as CaptureHit[];
        const trips = (tripsRes.data ?? []) as TripHit[];
        const people = (peopleRes.data ?? []) as PersonHit[];

        // Deduplicate by summary, prefer semantic hits
        const seenSummaries = new Set<string>();
        const allHits: CaptureHit[] = [];
        for (const h of [...semanticHits, ...textHits]) {
          const key = h.summary || h.transcript?.slice(0, 80) || '';
          if (!seenSummaries.has(key)) { seenSummaries.add(key); allHits.push(h); }
          if (allHits.length >= 8) break;
        }

        const captureContext = allHits
          .map((r) => `[${new Date(r.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}] ${r.summary || r.transcript?.slice(0, 300)}`)
          .join('\n');

        const tripContext = trips
          .map((t) => `Trip: ${t.title ?? t.destination} | ${t.destination} | ${t.start_date ?? '?'} to ${t.end_date ?? '?'}${t.summary ? ' — ' + t.summary : ''}`)
          .join('\n');

        const peopleContext = people
          .map((p) => {
            const parts = [`${p.name} (${p.relationship})`];
            if (p.birthday) parts.push(`birthday: ${p.birthday}`);
            if (p.anniversary) parts.push(`anniversary: ${p.anniversary}`);
            if (p.location_city) parts.push(`lives in ${p.location_city}`);
            if (p.notes) parts.push(p.notes);
            return parts.join(', ');
          })
          .join('\n');

        const context = [
          captureContext ? `Captures:\n${captureContext}` : '',
          tripContext ? `Past trips:\n${tripContext}` : '',
          peopleContext ? `People you know:\n${peopleContext}` : '',
        ].filter(Boolean).join('\n\n');

        if (context) {
          const answerResult = await tagModel.generateContent(
            `The user asked: "${transcript}"

${context}

Answer the question directly and concisely based on this information. If you cannot find a clear answer, say what you did find and note that the specific detail may not have been captured yet. Reply in 1-3 sentences, no markdown.`
          );
          answerMetadata = { answer: answerResult.response.text().trim() };
        } else {
          answerMetadata = { answer: "I couldn't find any relevant captures or trips about that. You may not have recorded that information yet." };
        }
      } catch (qErr) {
        console.error('[transcribe] question answering failed:', qErr);
      }
    }

    let captureStatus = 'inbox';
    let captureFolderId: string | null = null;

    console.log('[transcribe] shopping_items:', JSON.stringify(shopping_items));
    if (shopping_items?.length) {
      try {
        const alexaResult = await addToAlexaList(user.id, shopping_items);
        console.log('[transcribe] alexa result:', JSON.stringify(alexaResult));
        if (alexaResult.added.length > 0) {
          const { data: proj } = await adminClient
            .from('folders')
            .select('id')
            .eq('user_id', user.id)
            .ilike('name', '%shopping%')
            .limit(1)
            .single();
          captureStatus = 'folder';
          captureFolderId = proj?.id ?? null;
          if (!proj) captureStatus = 'archived';
        }
      } catch (alexaErr) {
        console.error('[transcribe] alexa error:', alexaErr);
      }
    }

    const { data: updated } = await adminClient
      .from('captures')
      .update({
        transcript,
        summary,
        tags,
        embedding,
        transcription_status: 'done',
        status: captureStatus,
        folder_id: captureFolderId,
        ...(answerMetadata ? { metadata: answerMetadata } : {}),
      })
      .eq('id', capture_id)
      .select('id,user_id,raw_audio_url,transcript,summary,tags,folder_id,source,location_lat,location_lng,location_label,status,transcription_status,metadata,created_at,updated_at')
      .single();

    // Await todo creation — questions are never treated as todos
    let todoArchived = false;
    if (todo?.is_todo && !shopping_items?.length && !is_question) {
      await maybeCreateTodoCurationCard(user.id, capture_id, todo).catch((e) =>
        console.error('[todo] failed:', e)
      );
      todoArchived = todo.is_todo;
    }

    // If the voice note was archived by the todo flow, signal the client to remove it
    if (todoArchived) return NextResponse.json({ deleted: true });
    return NextResponse.json(updated);
  } catch (err) {
    console.error('[transcribe]', err);
    await adminClient.from('captures').update({ transcription_status: 'error' }).eq('id', capture_id);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
