import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { runTripReconciliation } from '@/lib/trip-intelligence';
import { runCurationDetectors } from '@/lib/curation-detectors';
import { promoteScheduledTodos } from '@/lib/todo-detector';
import { detectAndCreateCalendarCard } from '@/lib/calendar-detector';
import { runTripPrepDetector } from '@/lib/trip-prep-detector';
import { addToAlexaList } from '@/lib/alexa-lists';
import { checkFollowUps, checkUnsubscribeMonitoring } from '@/lib/gmail';
import { detectUnsubscribesFromCaptures } from '@/lib/unsubscribe-detector';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const runtime = 'nodejs';

const genai = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY!);

async function reExtractShoppingItems(transcript: string): Promise<string[] | null> {
  const model = genai.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
  const result = await model.generateContent(
    `Is this a request to add items to a shopping or grocery list? If yes, extract the individual items. Return JSON only: {"shopping_items": ["item1"] or null}\n\nText: "${transcript}"`
  );
  const raw = result.response.text().replace(/```json\n?|\n?```/g, '').trim();
  try {
    const { shopping_items } = JSON.parse(raw);
    return shopping_items ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const results = {
    trip_reconciliation: { processed: 0, action_cards_created: 0, verified: 0 },
    shopping: { processed: 0, filed: 0 },
    projects: { filed: 0 },
    curation: { cards_created: 0 },
    unsubscribes: { detected: 0, archived: 0 },
  };

  // --- Project matching runs FIRST so emails get filed before the stale-email cleanup ---
  // (cleanup archives inbox emails > 7 days old; without this ordering, old project emails
  //  would be archived before domain/tag/name matching ever sees them)
  try {
    const { data: allProjects } = await adminClient
      .from('projects')
      .select('id, title, company, project_tag, project_domain, folder_id')
      .eq('user_id', user.id);

    const { data: inboxCaptures } = await adminClient
      .from('captures')
      .select('id, metadata, summary, tags, transcript')
      .eq('user_id', user.id)
      .eq('status', 'inbox');

    for (const cap of inboxCaptures ?? []) {
      const meta = (cap.metadata ?? {}) as Record<string, unknown>;
      const capTags = (cap.tags ?? []) as string[];
      const summaryLower = ((cap.summary as string | null) ?? '').toLowerCase();
      const subjectLower = ((meta.subject as string | null) ?? '').toLowerCase();

      let match = null;

      // 0. Sender domain match
      const transcriptText = (cap as unknown as { transcript?: string }).transcript ?? '';
      const domainMatch = transcriptText.match(/^From:.*?@([\w.-]+)/im);
      const senderDomain = domainMatch ? domainMatch[1].toLowerCase() : null;
      if (senderDomain) {
        const domainMatches = (allProjects ?? []).filter((p) =>
          p.project_domain && (p.project_domain as string).toLowerCase() === senderDomain
        );
        if (domainMatches.length === 1) match = domainMatches[0];
      }

      // 1. Tag match
      if (!match) for (const project of allProjects ?? []) {
        if (!project.project_tag) continue;
        if (capTags.includes(project.project_tag)) { match = project; break; }
      }

      // 2. Project name keyword match
      if (!match) {
        for (const project of allProjects ?? []) {
          const nameLower = (project.title as string).toLowerCase();
          if (summaryLower.includes(nameLower) || subjectLower.includes(nameLower)) { match = project; break; }
        }
      }

      // 3. Company name match via project_signal metadata
      if (!match) {
        const ps = meta.project_signal as { detected?: boolean; company?: string | null } | undefined;
        if (ps?.detected && ps.company) {
          const companyLower = ps.company.toLowerCase();
          const companyMatches = (allProjects ?? []).filter((p) =>
            p.company && (
              (p.company as string).toLowerCase().includes(companyLower) ||
              companyLower.includes((p.company as string).toLowerCase())
            )
          );
          if (companyMatches.length === 1) match = companyMatches[0];
        }
      }

      if (!match) continue;

      await adminClient.from('captures')
        .update({ status: 'folder', project_id: match.id, folder_id: match.folder_id ?? null })
        .eq('id', cap.id)
        .eq('user_id', user.id);
      results.projects.filed++;
    }
  } catch (err) {
    console.error('[intelligence sync] project matching error:', err);
  }

  // --- Cleanup: archive inbox captures that belong elsewhere or are stale ---
  // Runs AFTER project matching so project emails aren't archived before they can be filed.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  await Promise.all([
    // Email/action captures linked to a trip → live on the Trip page now
    adminClient.from('captures').update({ status: 'archived' })
      .eq('user_id', user.id)
      .eq('source', 'email')
      .eq('status', 'inbox')
      .not('trip_id', 'is', null),
    adminClient.from('captures').update({ status: 'archived' })
      .eq('user_id', user.id)
      .eq('source', 'action')
      .eq('status', 'inbox')
      .not('trip_id', 'is', null),
    // Email captures older than 7 days with no trip link → unprocessable, archive them
    adminClient.from('captures').update({ status: 'archived' })
      .eq('user_id', user.id)
      .eq('source', 'email')
      .eq('status', 'inbox')
      .is('trip_id', null)
      .lt('created_at', sevenDaysAgo),
    // Conversation captures (assistant replies, chat messages) older than 7 days → transient, archive them
    adminClient.from('captures').update({ status: 'archived' })
      .eq('user_id', user.id)
      .in('source', ['assistant', 'chat'])
      .eq('status', 'inbox')
      .lt('created_at', sevenDaysAgo),
  ]);

  // --- Trip reconciliation: all inbox email captures with calendar_events ---
  const { data: emailCaptures } = await adminClient
    .from('captures')
    .select('id, metadata, trip_id')
    .eq('user_id', user.id)
    .eq('source', 'email')
    .eq('status', 'inbox');

  const tripCaptures = (emailCaptures ?? []).filter((c) => {
    const meta = (c.metadata ?? {}) as Record<string, unknown>;
    // Skip captures already linked to a trip (already reconciled)
    if (c.trip_id) return false;
    return Array.isArray(meta.calendar_events) && (meta.calendar_events as unknown[]).length > 0;
  });

  // Count existing action cards before run so we can report new ones created
  const { count: actionCardsBefore } = await adminClient
    .from('captures')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('source', 'action')
    .eq('status', 'inbox');

  for (const cap of tripCaptures) {
    try {
      const meta = (cap.metadata ?? {}) as Record<string, unknown>;
      const events = meta.calendar_events as never[];
      await runTripReconciliation(user.id, cap.id, events);
      results.trip_reconciliation.processed++;
    } catch (err) {
      console.error('[intelligence sync] trip reconciliation error for', cap.id, err);
    }
  }

  const { count: actionCardsAfter } = await adminClient
    .from('captures')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('source', 'action')
    .eq('status', 'inbox');

  results.trip_reconciliation.action_cards_created = (actionCardsAfter ?? 0) - (actionCardsBefore ?? 0);

  // Count verified (metadata.verified updated this run is hard to count exactly — approximate)
  const { count: verifiedCount } = await adminClient
    .from('captures')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('source', 'email')
    .contains('metadata', { verified: true });

  results.trip_reconciliation.verified = verifiedCount ?? 0;

  // --- Shopping: inbox captures tagged 'shopping' still sitting in inbox ---
  const { data: shoppingCaptures } = await adminClient
    .from('captures')
    .select('id, transcript, tags, source')
    .eq('user_id', user.id)
    .eq('status', 'inbox')
    .contains('tags', ['shopping']);

  for (const cap of shoppingCaptures ?? []) {
    if (!cap.transcript?.trim()) continue;
    try {
      const items = await reExtractShoppingItems(cap.transcript);
      if (!items?.length) continue;

      const alexaResult = await addToAlexaList(user.id, items);
      if (alexaResult.added.length > 0) {
        const { data: proj } = await adminClient
          .from('folders')
          .select('id')
          .eq('user_id', user.id)
          .ilike('name', '%shopping%')
          .limit(1)
          .single();

        await adminClient
          .from('captures')
          .update({
            status: proj ? 'folder' : 'archived',
            folder_id: proj?.id ?? null,
          })
          .eq('id', cap.id);

        results.shopping.filed++;
      }
      results.shopping.processed++;
    } catch (err) {
      console.error('[intelligence sync] shopping error for', cap.id, err);
    }
  }

  // --- Promote reminder-due todos to inbox ---
  try {
    await promoteScheduledTodos(user.id);
  } catch (err) {
    console.error('[intelligence sync] todo promotion error:', err);
  }

  // --- Calendar event detection: voice captures with scheduling intent ---
  const { data: svc } = await adminClient
    .from('connected_services')
    .select('id')
    .eq('user_id', user.id)
    .eq('service', 'icloud_calendar')
    .maybeSingle();

  if (svc) {
    const { data: voiceCaptures } = await adminClient
      .from('captures')
      .select('id, transcript, metadata')
      .eq('user_id', user.id)
      .eq('status', 'inbox')
      .not('transcript', 'is', null)
      // email/sent_email go through their own pipelines; action/assistant/chat are system-generated
      .not('source', 'in', '(email,sent_email,action,assistant,chat)');

    for (const cap of voiceCaptures ?? []) {
      const capMeta = (cap.metadata ?? {}) as Record<string, unknown>;
      if (capMeta.calendar_checked) continue;
      if (!cap.transcript?.trim()) continue;
      try {
        await detectAndCreateCalendarCard(user.id, cap.id, cap.transcript);
      } catch (err) {
        console.error('[intelligence sync] calendar detection error for', cap.id, err);
      }
      await adminClient.from('captures').update({
        metadata: { ...capMeta, calendar_checked: true },
      }).eq('id', cap.id);
    }
  }

  // --- Curation detectors: surface anomalies as curation cards ---
  try {
    results.curation.cards_created = await runCurationDetectors(user.id);
  } catch (err) {
    console.error('[intelligence sync] curation detectors error:', err);
  }

  // --- Trip prep reminders: proactive action cards based on departure lead times ---
  try {
    await runTripPrepDetector(user.id);
  } catch (err) {
    console.error('[intelligence sync] trip prep detector error:', err);
  }

  // --- Follow-up checker: sent emails past their reply window with no response ---
  try {
    await checkFollowUps(user.id);
  } catch (err) {
    console.error('[intelligence sync] follow-up check error:', err);
  }

  // --- Unsubscribe: scan all inbox captures for unsubscribes, then monitor for failures ---
  try {
    const unsubResult = await detectUnsubscribesFromCaptures(user.id);
    results.unsubscribes.detected = unsubResult.detected;
    results.unsubscribes.archived = unsubResult.archived;
  } catch (err) {
    console.error('[intelligence sync] unsubscribe detection error:', err);
  }

  try {
    await checkUnsubscribeMonitoring(user.id);
  } catch (err) {
    console.error('[intelligence sync] unsubscribe monitoring error:', err);
  }

  return NextResponse.json({ ok: true, results });
}
