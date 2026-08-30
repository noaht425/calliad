import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, FunctionCallingMode, SchemaType, type Tool } from '@google/generative-ai';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { getUserContext, buildSystemPrompt } from '@/lib/context';
import { addToAlexaList } from '@/lib/alexa-lists';
import { executeActionCard } from '@/lib/action-executor';
import { executeCuration } from '@/lib/curation-executor';
import { createCalendarEvent, addAttendeesToCalendarEvent } from '@/lib/icloud-calendar-write';
import { findOrCreateTodoFolder } from '@/lib/todo-detector';
import { pushToAbentfork } from '@/lib/abentfork';

export const runtime = 'nodejs';

const genai = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY!);

// Tools Gemini can call during normal chat. Adding a new capability = adding an entry here.
// "respond" is always called — it carries the text reply, summary, and tags.
// Action tools are called when the user's message warrants them.
// Cast needed: SDK's Schema union requires literal type narrowing TypeScript can't auto-infer.
const CHAT_TOOLS: Tool[] = [{
  functionDeclarations: [
    {
      name: 'respond',
      description: 'ALWAYS call this. Provides your natural language reply to the user, a summary of what they said, and relevant tags.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          text: { type: SchemaType.STRING, description: 'Conversational reply (1-3 sentences). If action tools are also being called, briefly acknowledge the request — the system will append the actual confirmation.' },
          summary: { type: SchemaType.STRING, description: '1-2 sentence summary of what the user said, referring to them by name' },
          tags: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: '2-3 short lowercase tags' },
        },
        required: ['text', 'summary', 'tags'],
      },
    },
    {
      name: 'add_calendar_event',
      description: 'Add an event or appointment to the user\'s iCloud calendar. Use when the user wants to schedule something at a specific date and/or time.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          title: { type: SchemaType.STRING, description: 'Event title' },
          start_at: { type: SchemaType.STRING, description: 'Start time as UTC ISO 8601. Seattle is PDT (UTC-7) Mar–Nov, PST (UTC-8) Nov–Mar.' },
          end_at: { type: SchemaType.STRING, description: 'End time as UTC ISO 8601, or omit if unknown' },
          all_day: { type: SchemaType.BOOLEAN, description: 'True only for all-day events with no specific time' },
          location: { type: SchemaType.STRING, description: 'Optional venue or address' },
          description: { type: SchemaType.STRING, description: 'Optional notes' },
        },
        required: ['title', 'start_at'],
      },
    },
    {
      name: 'add_todo',
      description: 'Add a task, reminder, or to-do item to the user\'s To-Do list. Use when the user wants to track something they need to do.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          task_text: { type: SchemaType.STRING, description: 'Clean task description without date/time qualifiers' },
          due_date: { type: SchemaType.STRING, description: 'Due date in YYYY-MM-DD format, or omit if none mentioned' },
          due_time: { type: SchemaType.STRING, description: 'Due time as HH:MM, or morning/afternoon/evening, or omit if none mentioned' },
        },
        required: ['task_text'],
      },
    },
    {
      name: 'add_to_shopping_list',
      description: 'Add items to the grocery or shopping list. Use only when the user explicitly wants to add grocery or shopping items.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          items: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: 'Items to add' },
        },
        required: ['items'],
      },
    },
    {
      name: 'add_to_watch_list',
      description: 'Add TV shows or movies to the Watch List. Use when the user wants to remember something to watch.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          items: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: 'Show or movie titles to add. IMPORTANT: preserve any qualifying details the user provides — e.g. if they say "Scorpio the TV show" store "Scorpio (TV series)", if they say "the 2019 movie Joker" store "Joker (2019 film)". These qualifiers are used later to find the correct title when multiple exist.' },
        },
        required: ['items'],
      },
    },
    {
      name: 'update_calendar_event',
      description: 'Update one or more existing calendar events — add attendees/invitees, change title, location, or notes. IMPORTANT: call this tool ONCE per request. For broad requests ("all Kraken games", "every hockey game") use a single short keyword like "Kraken" as search_title and omit date_from/date_to — the system will find all matching events. Only provide date_from/date_to when the user specifies a narrow date range.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          search_title: { type: SchemaType.STRING, description: 'One short keyword to search event titles (e.g. "Kraken", "dentist"). Do NOT use a full event title or phrase — one word finds more matches.' },
          date_from: { type: SchemaType.STRING, description: 'ISO 8601 date — only match events on or after this date. Omit for open-ended searches.' },
          date_to: { type: SchemaType.STRING, description: 'ISO 8601 date — only match events on or before this date. Omit for open-ended searches.' },
          add_attendees: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: 'Names of people to invite as attendees (looked up from contacts)' },
        },
        required: ['search_title'],
      },
    },
    {
      name: 'save_memory',
      description: 'Save something you\'ve learned about the user to long-term memory. Call this when the user mentions personal context worth remembering — places they own, preferences, routines, facts about family, lifestyle details. ALWAYS briefly acknowledge what you\'re saving in your respond text (e.g. "Got it, I\'ll remember that...").',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          category: { type: SchemaType.STRING, description: 'One of: home, travel, food, people, preferences, routines, places, health, general' },
          key: { type: SchemaType.STRING, description: 'Short descriptive slug, e.g. "second_home_location", "italy_drive_route", "morning_routine"' },
          value: { type: SchemaType.STRING, description: 'The fact or detail to remember, written as a complete statement' },
        },
        required: ['category', 'key', 'value'],
      },
    },
    {
      name: 'save_note',
      description: 'Save a general note, thought, or piece of information to the inbox. Use when the user shares something worth remembering that doesn\'t fit a more specific category (to-do, calendar, watch list, shopping).',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          content: { type: SchemaType.STRING, description: 'The note content to save' },
        },
        required: ['content'],
      },
    },
    {
      name: 'add_to_reading_list',
      description: 'Save an article, book, or link to the reading list. Use when the user wants to remember something to read later.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          title: { type: SchemaType.STRING, description: 'Title or description of the article or book' },
          url: { type: SchemaType.STRING, description: 'URL if one was provided, otherwise omit' },
        },
        required: ['title'],
      },
    },
    {
      name: 'forward_to_abentfork',
      description: 'Send a recipe or food-related URL from the user\'s captures to abentfork.com for saving. Use when the user asks to "send this to abentfork", "add this recipe to abentfork", or similar.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          capture_id: { type: SchemaType.STRING, description: 'The ID of the capture containing the recipe URL to forward' },
          url: { type: SchemaType.STRING, description: 'The recipe URL to forward' },
          title: { type: SchemaType.STRING, description: 'Title or name of the recipe' },
          notes: { type: SchemaType.STRING, description: 'Optional extra notes to include with the recipe' },
        },
        required: ['url', 'title'],
      },
    },
  ],
}];

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { text, action_card_id } = await req.json() as { text: string; action_card_id?: string };
  if (!text?.trim()) return NextResponse.json({ error: 'text required' }, { status: 400 });

  const now = new Date().toISOString();

  // Insert user message capture immediately
  const { data: userCapture, error: insertErr } = await adminClient
    .from('captures')
    .insert({
      user_id: user.id,
      source: 'chat',
      transcript: text.trim(),
      summary: null,
      tags: [],
      status: 'inbox',
      transcription_status: 'processing',
      trip_id: null,
    })
    .select('id,user_id,raw_audio_url,transcript,summary,tags,folder_id,source,location_lat,location_lng,location_label,status,transcription_status,metadata,trip_id,created_at,updated_at')
    .single();

  if (!userCapture) {
    console.error('[chat] insert failed:', insertErr);
    return NextResponse.json({ error: 'Failed to create capture', detail: insertErr }, { status: 500 });
  }

  try {
    const [ctx] = await Promise.all([getUserContext(user.id)]);
    const systemPrompt = buildSystemPrompt(ctx);
    const userName = ((ctx.profile?.full_name as string | undefined) ?? '').split(' ')[0] || 'the user';

    const model = genai.getGenerativeModel({
      model: 'gemini-3.6-flash',
      systemInstruction: systemPrompt || undefined,
    });

    // --- Action card response path ---
    let response: string;
    let summary: string;
    let tags: string[];
    let shopping_items: string[] | null = null;
    let curationResolved: boolean | undefined;
    let updatedCurationCard: Record<string, unknown> | null = null;
    let flightSearchUrl: string | undefined;
    // captureStatus/projectId may be updated inside the normal chat tool-calling path
    let captureStatus = 'inbox';
    let captureFolderId: string | null = null;

    if (action_card_id) {
      const { data: actionCard } = await adminClient
        .from('captures')
        .select('id, metadata, transcript')
        .eq('id', action_card_id)
        .eq('user_id', user.id)
        .eq('source', 'action')
        .single();

      if (!actionCard) {
        response = "I couldn't find that action card — it may have already been resolved.";
        summary = text.trim();
        tags = [];
      } else {
        const meta = (actionCard.metadata ?? {}) as Record<string, unknown>;

        if (meta.action_type === 'curation') {
          // Multi-turn curation card handling
          const turnCount = ((meta.turn_count as number) ?? 0) + 1;
          const maxTurns = (meta.max_turns as number) ?? 3;
          const interactionType = meta.interaction_type as string;
          const executor = meta.executor as string;
          const executorParams = (meta.executor_params ?? {}) as Record<string, unknown>;

          // Classify the user's answer
          const choices = (meta.choices as string[] | undefined) ?? [];
          const choiceList = choices.length
            ? `\nAvailable choices: ${choices.map((c, i) => `${i + 1}. "${c}"`).join(', ')}`
            : '';
          const classifyResult = await model.generateContent(
            `${userName} replied to this curation question: "${actionCard.transcript}"
${userName}'s reply: "${text.trim()}"${choiceList}

Classify:
- If choices are listed: match reply to one of the choice labels and return it as "choice:<label>" (e.g. "choice:Calendar", "choice:Both")
- "yes" = agrees/confirms (when no specific choices, or open yes_no)
- "no" = declines
- "skip" = explicitly wants to dismiss/skip for now
- "unclear" = ambiguous

Return ONLY valid JSON: {"verdict":"yes"|"no"|"skip"|"unclear"|"choice:<label>","summary":"one sentence referring to ${userName} by name","tags":["tag1"]}`
          );
          const classifyRaw = classifyResult.response.text().replace(/```json\n?|\n?```/g, '').trim();
          let classifyJson: { verdict: string; summary: string; tags: string[] };
          try {
            classifyJson = JSON.parse(classifyRaw);
          } catch {
            classifyJson = { verdict: 'unclear', summary: text.trim(), tags: ['curation'] };
          }
          const { verdict, summary: cs, tags: ct } = classifyJson;
          summary = cs;
          tags = ct ?? ['curation'];

          const isChoice = verdict.startsWith('choice:');
          const choiceLabel = isChoice ? verdict.slice(7) : null;
          const mergedParams = choiceLabel
            ? { ...executorParams, selected_choice: choiceLabel, calendar: ['Calendar', 'Both'].includes(choiceLabel), reminder: ['Reminder', 'Both'].includes(choiceLabel) }
            : executorParams;

          if (verdict === 'yes' || isChoice) {
            const execution = await executeCuration(user.id, executor, mergedParams);
            await adminClient.from('captures').update({ status: 'archived' }).eq('id', actionCard.id);
            response = execution.message;
            curationResolved = true;
            captureStatus = 'archived';

          } else if (verdict === 'no' || verdict === 'skip') {
            await adminClient.from('captures').update({ status: 'archived' }).eq('id', actionCard.id);
            response = verdict === 'skip'
              ? "Skipped — I'll bring this up again if the situation changes."
              : "Got it, I'll leave these as separate trips.";
            curationResolved = true;
            captureStatus = 'archived';

          } else {
            // Unclear / complex reply — multi-turn chat
            if (turnCount >= maxTurns) {
              // Turn limit reached — wrap up
              await adminClient.from('captures').update({ status: 'archived' }).eq('id', actionCard.id);
              response = "I'll set this aside for now and revisit when new travel data comes in.";
              curationResolved = true;
              captureStatus = 'archived';
            } else {
              // Generate a follow-up response and keep the card alive
              const followUpResult = await model.generateContent(
                `You are Calliad, a travel assistant. You asked the user: "${actionCard.transcript}"

The user said: "${text.trim()}"

This is turn ${turnCount} of ${maxTurns}. Respond naturally — acknowledge what they said and either:
- Ask a clarifying follow-up question (if you need more info)
- Tell them what you'll do and confirm (if you now know the answer)

Keep it under 2 sentences. Don't say "I understand" or similar filler.`
              );
              response = followUpResult.response.text().trim();

              // Update turn count on the card (don't change transcript)
              const newMeta = { ...meta, turn_count: turnCount };
              const { data: refreshed } = await adminClient
                .from('captures')
                .update({ metadata: newMeta })
                .eq('id', actionCard.id)
                .select('id,user_id,raw_audio_url,transcript,summary,tags,folder_id,source,location_lat,location_lng,location_label,status,transcription_status,metadata,trip_id,created_at,updated_at')
                .single();

              curationResolved = false;
              updatedCurationCard = refreshed;
            }
          }

        } else {
          // Standard action card (trip_proposal, project_suggestion, etc.)
          const missingElements = (meta.missing_elements as string[] | undefined) ?? [];
          const badgeHint = missingElements.length
            ? `Note: the card's status badge says "${missingElements.join(', ')} not booked" — ${userName} may have read that badge instead of the card body.`
            : '';

          const verdictResult = await model.generateContent(
            `${userName} is responding to a Calliad action card.

Card body (what Calliad actually asked):
${actionCard.transcript}
${badgeHint ? `\n${badgeHint}` : ''}

${userName}'s reply: "${text.trim()}"

Determine whether the reply addresses what the card body actually asked, or whether ${userName} seems to be responding to a different topic (e.g. responding about car rental when the card was asking about adding tickets to calendar).

- "yes" = confirms / agrees / says things are handled
- "no" = explicitly declines or cancels
- "mismatch" = reply is clearly about a different topic than the card body asked
- "unclear" = ambiguous

Return ONLY valid JSON (no markdown):
{"verdict":"yes"|"no"|"unclear"|"mismatch","mismatch_topic":"what ${userName} seemed to think the card was about (only if mismatch, else null)","summary":"one sentence summary referring to ${userName} by name","tags":["tag1","tag2"]}`
          );
          const verdictRaw = verdictResult.response.text().replace(/```json\n?|\n?```/g, '').trim();
          let verdictJson: Record<string, unknown>;
          try {
            verdictJson = JSON.parse(verdictRaw);
          } catch {
            // Gemini returned non-JSON — treat as unclear so card stays alive
            verdictJson = { verdict: 'unclear', summary: text.trim(), tags: [] };
          }
          const { verdict, mismatch_topic, summary: vs, tags: vt } = verdictJson as { verdict: string; mismatch_topic?: string; summary: string; tags: string[] };
          summary = vs;
          tags = vt ?? [];

          if (verdict === 'mismatch') {
            // Drop into a curation-style clarification — keep the card alive, generate
            // a response that surfaces the mismatch and re-asks the original question.
            const clarifyResult = await model.generateContent(
              `You are Calliad, a smart travel assistant helping ${userName}.

You asked: "${actionCard.transcript}"

${userName} replied: "${text.trim()}"
They seemed to be responding about ${mismatch_topic ?? 'a different topic'} rather than your question.

Write a warm, natural 1-2 sentence response. Acknowledge what they said, gently surface the mix-up, and re-ask your original question. Address ${userName} by name. Don't say "I understand" or similar filler.`
            );
            response = clarifyResult.response.text().trim();
            // Card stays alive — no archive. Next reply re-enters this same path.
          } else {
            const execution = await executeActionCard(
              user.id,
              { id: actionCard.id, metadata: meta, transcript: actionCard.transcript ?? undefined },
              verdict as 'yes' | 'no' | 'unclear',
              text.trim()
            );
            response = execution.message;
            if (execution.flightSearchUrl) {
              flightSearchUrl = execution.flightSearchUrl;
            }
            // Archive the user's reply — the action card handled the outcome
            captureStatus = 'archived';
          }
        }
      }
    } else {
      // --- Normal chat path — Gemini tool calling ---
      // Gemini decides which tools to call based on the message. Adding a new
      // capability means adding a tool declaration above — no intent strings here.
      const chatModel = genai.getGenerativeModel({
        model: 'gemini-3.6-flash',
        systemInstruction: systemPrompt || undefined,
        tools: CHAT_TOOLS,
        toolConfig: { functionCallingConfig: { mode: FunctionCallingMode.ANY } },
      });

      const toolResult = await chatModel.generateContent(
        `${userName} sent this message: "${text.trim()}"

Today is ${now}. ${userName} is in Seattle, WA (America/Los_Angeles timezone).

Call "respond" with your reply. Also call any relevant action tools if the message warrants it.`
      );

      // Extract all function calls from the response
      const calls = toolResult.response.functionCalls() ?? [];
      const respondCall = calls.find((c) => c.name === 'respond')?.args as { text: string; summary: string; tags: string[] } | undefined;
      summary = respondCall?.summary ?? text.trim();
      tags = respondCall?.tags ?? [];
      response = respondCall?.text ?? '';

      const actionConfirmations: string[] = [];
      let anyActionSucceeded = false;

      for (const call of calls) {
        if (call.name === 'add_calendar_event') {
          const ev = call.args as { title: string; start_at: string; end_at?: string; all_day?: boolean; location?: string; description?: string };
          const calResult = await createCalendarEvent(user.id, ev);
          if (calResult.ok) {
            anyActionSucceeded = true;
            const eventDate = new Date(ev.start_at).toLocaleString('en-US', {
              weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
              hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles',
            });
            actionConfirmations.push(`Added "${ev.title}" to your calendar for ${eventDate}.`);
          } else {
            actionConfirmations.push(`Couldn't add "${ev.title}" to your calendar: ${calResult.error ?? 'unknown error'}. Check your iCloud connection in Settings.`);
          }

        } else if (call.name === 'add_todo') {
          const td = call.args as { task_text: string; due_date?: string; due_time?: string };
          const todoProjectId = await findOrCreateTodoFolder(user.id);
          if (todoProjectId) {
            anyActionSucceeded = true;
            let remind_at: string | null = null;
            if (td.due_date) {
              remind_at = td.due_date;
              if (td.due_time && !['morning', 'afternoon', 'evening'].includes(td.due_time)) {
                remind_at = `${td.due_date}T${td.due_time}:00`;
              }
            }
            await adminClient.from('captures').insert({
              user_id: user.id,
              source: 'assistant',
              transcript: td.task_text,
              summary: td.task_text,
              tags: ['todo'],
              status: 'folder',
              folder_id: todoProjectId,
              transcription_status: 'done',
              metadata: {
                source_capture_id: userCapture.id,
                ...(remind_at ? { remind_at } : {}),
              },
            });
            actionConfirmations.push(
              remind_at
                ? `Added "${td.task_text}" to your To-Do list, due ${new Date(remind_at + (remind_at.includes('T') ? '' : 'T12:00:00')).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' })}.`
                : `Added "${td.task_text}" to your To-Do list.`
            );
          }

        } else if (call.name === 'add_to_shopping_list') {
          const sh = call.args as { items: string[] };
          shopping_items = sh.items;
          try {
            const alexaResult = await addToAlexaList(user.id, sh.items);
            if (alexaResult.added.length > 0) {
              anyActionSucceeded = true;
              actionConfirmations.push(`Added ${alexaResult.added.join(', ')} to your shopping list.`);
            }
          } catch {}

        } else if (call.name === 'add_to_watch_list') {
          const wl = call.args as { items: string[] };
          const { data: watchFolder } = await adminClient
            .from('folders')
            .select('id')
            .eq('user_id', user.id)
            .ilike('name', '%watch%')
            .limit(1)
            .maybeSingle();

          let watchFolderId = watchFolder?.id ?? null;
          if (!watchFolderId) {
            const { data: created } = await adminClient
              .from('folders')
              .insert({ user_id: user.id, name: 'Watch List', icon: '🎬', color: 'purple', entity_type: 'folder' })
              .select('id')
              .single();
            watchFolderId = created?.id ?? null;
          }

          if (watchFolderId) {
            for (const item of wl.items) {
              await adminClient.from('captures').insert({
                user_id: user.id,
                source: 'assistant',
                transcript: item,
                summary: item,
                tags: ['watch-list'],
                status: 'folder',
                folder_id: watchFolderId,
                transcription_status: 'done',
                metadata: { source_capture_id: userCapture.id },
              });
            }
            anyActionSucceeded = true;
            actionConfirmations.push(`Added ${wl.items.join(', ')} to your Watch List.`);
          }

        } else if (call.name === 'update_calendar_event') {
          const upd = call.args as { search_title: string; date_from?: string; date_to?: string; add_attendees?: string[] };
          let evQuery = adminClient
            .from('calendar_events')
            .select('uid, title, start_at, calendar_url')
            .eq('user_id', user.id);
          // Split into words and apply each as a separate ILIKE so "Kraken game" matches
          // "Seattle Kraken v. … hockey game" (non-contiguous phrase search).
          const searchWords = upd.search_title.trim().split(/\s+/).filter((w) => w.length > 2);
          for (const word of searchWords) {
            evQuery = evQuery.ilike('title', `%${word}%`);
          }
          if (upd.date_from) evQuery = evQuery.gte('start_at', upd.date_from);
          if (upd.date_to) {
            // Pad by 2 days: Seattle evening events land on UTC next-day (7pm PDT = 2am UTC),
            // so +1 day only reaches midnight — still 2 hours short. +2 days is safe.
            const padded = new Date(upd.date_to);
            padded.setUTCDate(padded.getUTCDate() + 2);
            evQuery = evQuery.lte('start_at', padded.toISOString());
          }
          const { data: matches } = await evQuery;

          if (!matches?.length) {
            actionConfirmations.push(`Couldn't find any events matching "${upd.search_title}" on your calendar.`);
          } else {
            // Resolve attendee emails from family_members
            const attendees: Array<{ name: string; email: string }> = [];
            for (const name of (upd.add_attendees ?? [])) {
              const { data: person } = await adminClient
                .from('family_members')
                .select('name, email')
                .eq('user_id', user.id)
                .ilike('name', `%${name}%`)
                .not('email', 'is', null)
                .limit(1)
                .single();
              if (person?.email) attendees.push({ name: person.name as string, email: person.email as string });
            }

            let updatedCount = 0;
            const failures: string[] = [];
            for (const ev of matches) {
              if (attendees.length > 0) {
                const res = await addAttendeesToCalendarEvent(
                  user.id, ev.uid as string, attendees,
                  user.email ?? '', userName,
                );
                if (res.ok) updatedCount++;
                else failures.push(ev.title as string);
              }
            }

            const eventList = matches
              .map((e) => `"${e.title}" (${new Date(e.start_at as string).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' })})`)
              .join(', ');
            const attendeeNames = attendees.map((a) => a.name).join(' and ');

            if (updatedCount > 0) {
              anyActionSucceeded = true;
              actionConfirmations.push(`Sent a calendar invite to ${attendeeNames} for ${updatedCount} event${updatedCount !== 1 ? 's' : ''}: ${eventList}.`);
            }
            if (failures.length > 0) {
              actionConfirmations.push(`Couldn't update: ${failures.join(', ')}.`);
            }
          }

        } else if (call.name === 'save_memory') {
          const sm = call.args as { category: string; key: string; value: string };
          await adminClient.from('memories').upsert({
            user_id: user.id,
            category: sm.category,
            key: sm.key,
            value: sm.value,
            source: 'chat',
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id,category,key' });
          // No actionConfirmation — Gemini's respond text carries the acknowledgment

        } else if (call.name === 'save_note') {
          const sn = call.args as { content: string };
          await adminClient.from('captures').insert({
            user_id: user.id,
            source: 'assistant',
            transcript: sn.content,
            summary: sn.content,
            tags: ['note'],
            status: 'inbox',
            transcription_status: 'done',
            metadata: { source_capture_id: userCapture.id },
          });
          anyActionSucceeded = true;
          actionConfirmations.push(`Saved to your inbox.`);

        } else if (call.name === 'add_to_reading_list') {
          const rl = call.args as { title: string; url?: string };
          const { data: readingFolder } = await adminClient
            .from('folders')
            .select('id')
            .eq('user_id', user.id)
            .ilike('name', '%reading%')
            .limit(1)
            .maybeSingle();

          let readingFolderId = readingFolder?.id ?? null;
          if (!readingFolderId) {
            const { data: created } = await adminClient
              .from('folders')
              .insert({ user_id: user.id, name: 'Reading List', icon: '📖', color: 'blue', entity_type: 'folder' })
              .select('id')
              .single();
            readingFolderId = created?.id ?? null;
          }

          if (readingFolderId) {
            await adminClient.from('captures').insert({
              user_id: user.id,
              source: 'assistant',
              transcript: rl.title,
              summary: rl.title,
              tags: ['reading-list'],
              status: 'folder',
              folder_id: readingFolderId,
              transcription_status: 'done',
              metadata: { source_capture_id: userCapture.id, ...(rl.url ? { url: rl.url } : {}), reading_title: rl.title },
            });
            anyActionSucceeded = true;
            actionConfirmations.push(`Added "${rl.title}" to your Reading List.`);
          }

        } else if (call.name === 'forward_to_abentfork') {
          const af = call.args as { capture_id?: string; url: string; title: string; notes?: string };
          const afResult = await pushToAbentfork({
            capture_id: af.capture_id ?? '',
            url: af.url,
            title: af.title,
            notes: af.notes,
            submitted_at: new Date().toISOString(),
          });
          if (afResult.ok) {
            anyActionSucceeded = true;
            actionConfirmations.push(`Sent "${af.title}" to abentfork.com.`);
          } else {
            actionConfirmations.push(`Couldn't reach abentfork.com — check with your son that the endpoint is live.`);
          }
        }
      }

      // When any action succeeded, archive the request — the artifact (todo, event, etc.) is the record.
      if (anyActionSucceeded) {
        captureStatus = 'archived';
        captureFolderId = null;
      }

      // If actions were taken, the confirmations are the response; otherwise use Gemini's text
      if (actionConfirmations.length > 0) {
        response = actionConfirmations.join(' ');
      }
    }

    // Embed the user's message for semantic search
    const embedRes = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-embedding-001:embedContent?key=${process.env.GOOGLE_AI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/gemini-embedding-001',
          content: { parts: [{ text: text.trim() }] },
          outputDimensionality: 768,
        }),
      }
    );
    const embedding = embedRes.ok
      ? ((await embedRes.json()) as { embedding: { values: number[] } }).embedding.values
      : null;


    // Update the user's capture with Gemini results
    const { data: updatedUser } = await adminClient
      .from('captures')
      .update({ summary, tags, embedding, transcription_status: 'done', status: captureStatus, folder_id: captureFolderId })
      .eq('id', userCapture.id)
      .select('id,user_id,raw_audio_url,transcript,summary,tags,folder_id,source,location_lat,location_lng,location_label,status,transcription_status,metadata,created_at,updated_at')
      .single();

    // Insert Calliad's response as its own capture, linked back to the user's question.
    // Action card replies: always show the assistant's acknowledgment in inbox so the user sees confirmation.
    // Normal chat: archive if the user's message was archived (action executed), otherwise inbox.
    const assistantStatus = action_card_id ? 'inbox' : (captureStatus === 'archived' ? 'archived' : 'inbox');
    const { data: assistantCapture } = await adminClient
      .from('captures')
      .insert({
        user_id: user.id,
        source: 'assistant',
        transcript: response,
        summary: null,
        tags: [],
        status: assistantStatus,
        transcription_status: 'done',
        metadata: {
          user_capture_id: userCapture.id,
          ...(flightSearchUrl ? { flight_search_url: flightSearchUrl } : {}),
        },
      })
      .select('id,user_id,raw_audio_url,transcript,summary,tags,folder_id,source,location_lat,location_lng,location_label,status,transcription_status,metadata,created_at,updated_at')
      .single();

    // Save exchange to persistent conversation memory (fire-and-forget)
    if (response && text.trim()) {
      void adminClient.from('conversations').insert([
        { user_id: user.id, role: 'user', content: text.trim() },
        { user_id: user.id, role: 'assistant', content: response },
      ]);
    }

    return NextResponse.json({
      userCapture: updatedUser ?? userCapture,
      assistantCapture,
      ...(curationResolved !== undefined ? { curationResolved } : {}),
      ...(updatedCurationCard ? { updatedCurationCard } : {}),
    });
  } catch (err) {
    console.error('[chat]', err);
    await adminClient
      .from('captures')
      .update({ transcription_status: 'error', status: 'archived' })
      .eq('id', userCapture.id);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
