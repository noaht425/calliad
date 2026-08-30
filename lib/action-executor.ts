import { GoogleGenerativeAI } from '@google/generative-ai';
import { adminClient } from './supabase.server';

export interface ActionCard {
  id: string;
  metadata: Record<string, unknown>;
  transcript?: string;
}

export interface ExecutionResult {
  message: string;
  resolved: boolean;
  flightSearchUrl?: string;
}

async function buildFlightSearchUrl(
  userId: string,
  destination: string,
  tripStart: string
): Promise<string | null> {
  try {
    const { data: userProfile } = await adminClient
      .from('user_profiles')
      .select('preferred_airlines, home_airport')
      .eq('user_id', userId)
      .single();

    const preferredAirlines = (userProfile?.preferred_airlines as string[] | null) ?? [];
    const homeAirport = (userProfile?.home_airport as string | null) ?? 'SEA';
    const prefersAlaska = preferredAirlines.some((a) => /alaska/i.test(a));

    const genai = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY!);
    const model = genai.getGenerativeModel({ model: 'gemini-3.6-flash' });

    const routeResult = await model.generateContent(
      `Does Alaska Airlines operate regular commercial flights between ${homeAirport} and ${destination}? ` +
      `Answer with JSON only, no markdown: {"alaska_serves":true,"destination_iata":"XXX"}`
    );
    const routeRaw = routeResult.response.text().replace(/```json\n?|\n?```/g, '').trim();
    const { alaska_serves, destination_iata } = JSON.parse(routeRaw) as {
      alaska_serves: boolean;
      destination_iata: string;
    };

    if (prefersAlaska && alaska_serves && destination_iata) {
      return `https://www.alaskaair.com/search/results?A=1&O=${homeAirport}&D=${destination_iata}`;
    } else {
      const q = encodeURIComponent(`flights from ${homeAirport} to ${destination} on ${tripStart}`);
      return `https://www.google.com/travel/flights?q=${q}`;
    }
  } catch {
    // Fall back to generic Google Flights search
    const q = encodeURIComponent(`flights to ${destination}`);
    return `https://www.google.com/travel/flights?q=${q}`;
  }
}

export async function executeActionCard(
  userId: string,
  actionCard: ActionCard,
  verdict: 'yes' | 'no' | 'unclear',
  userReplyText?: string
): Promise<ExecutionResult> {
  const meta = actionCard.metadata;
  const actionType = meta.action_type as string;

  if (verdict === 'unclear') {
    return {
      message: "I'm not sure how to read that — just say yes or no to this one and I'll take care of it.",
      resolved: false,
    };
  }

  if (verdict === 'no') {
    await adminClient.from('captures').update({ status: 'archived' }).eq('id', actionCard.id);
    return {
      message: "Got it, I'll leave that for now. Just let me know if you change your mind.",
      resolved: true,
    };
  }

  // verdict === 'yes'
  if (actionType === 'trip_proposal') {
    const sourceCaptureId = meta.source_capture_id as string | undefined;
    const tripId = meta.trip_id as string | undefined;
    const destination = meta.destination as string;
    const tripLabel = meta.trip_label as string;
    const missingElements = (meta.missing_elements as string[]) ?? [];
    const tripStart = (meta.trip_start as string) ?? '';

    if (sourceCaptureId) {
      const { data: existing } = await adminClient
        .from('captures')
        .select('metadata')
        .eq('id', sourceCaptureId)
        .eq('user_id', userId)
        .single();

      await adminClient
        .from('captures')
        .update({
          metadata: {
            ...(existing?.metadata as object ?? {}),
            verified: true,
            verified_at: new Date().toISOString(),
            user_confirmed: true,
          },
        })
        .eq('id', sourceCaptureId)
        .eq('user_id', userId);
    }

    // Archive all email captures linked to this trip — they live on the Trip page now
    if (tripId) {
      await adminClient
        .from('captures')
        .update({ status: 'archived' })
        .eq('user_id', userId)
        .eq('trip_id', tripId)
        .eq('source', 'email')
        .eq('status', 'inbox');
    }

    await adminClient.from('captures').update({ status: 'archived' }).eq('id', actionCard.id);

    // Build a short display label from the trip label
    const [dest] = (tripLabel ?? '').split(' · ');
    const shortDest = dest ? dest.split(',').slice(0, 2).join(',').trim() : (destination ?? 'your trip');

    // Parse what the user said they need / don't need
    const reply = userReplyText ?? '';
    const wantsFlights = /flight|fly|airline|airfare|ticket/i.test(reply);
    const noHotel = /no hotel|don.t need.*hotel|hotel.*covered|hotel.*organiz|hotel.*taken care/i.test(reply);
    const noCar = /no car|don.t need.*car|car.*not|won.t need.*car|don.t.*rental/i.test(reply);

    // Filter what's actually still missing after user's reply
    const stillMissing = missingElements.filter(
      (el) => !(noHotel && el === 'hotel') && !(noCar && el === 'car_rental') && !(wantsFlights && el === 'flight')
    );

    // Build flight search link if user wants flights
    let flightSearchUrl: string | undefined;
    if (wantsFlights && destination) {
      flightSearchUrl = (await buildFlightSearchUrl(userId, destination, tripStart)) ?? undefined;
    }

    // Build context-aware message
    let message: string;
    if (wantsFlights && flightSearchUrl) {
      const isAlaska = flightSearchUrl.includes('alaskaair.com');
      message = `On it — here's where to search for flights to ${shortDest} on ${isAlaska ? 'Alaska Airlines' : 'Google Flights'}.`;
    } else if (stillMissing.length) {
      message = `${shortDest} confirmed. Still to sort: ${stillMissing.join(', ')}.`;
    } else {
      message = `${shortDest} is all set.`;
    }

    return { message, resolved: true, flightSearchUrl };
  }

  if (actionType === 'project_suggestion') {
    const projectName = meta.project_name as string;
    const captureIds = (meta.capture_ids as string[]) ?? [];
    const icon = (meta.suggested_icon as string) ?? '📁';
    const color = (meta.suggested_color as string) ?? 'blue';

    const { data: project } = await adminClient
      .from('folders')
      .insert({ user_id: userId, name: projectName, icon, color })
      .select('id')
      .single();

    if (project && captureIds.length) {
      await adminClient
        .from('captures')
        .update({ status: 'folder', folder_id: project.id })
        .in('id', captureIds)
        .eq('user_id', userId);
    }

    await adminClient.from('captures').update({ status: 'archived' }).eq('id', actionCard.id);

    return {
      message: `Created "${projectName}"${captureIds.length ? ` and filed ${captureIds.length} item${captureIds.length === 1 ? '' : 's'} into it` : ''}.`,
      resolved: true,
    };
  }

  if (actionType === 'follow_up') {
    const sourceCaptureId = meta.source_capture_id as string | undefined;
    const subject = meta.subject as string | undefined;
    const toName = meta.to_name as string | undefined;
    const toAddresses = (meta.to_addresses as string[] | undefined) ?? [];
    const sentDate = meta.sent_date as string | undefined;

    // Fetch the original sent email for context
    let originalBody = '';
    if (sourceCaptureId) {
      const { data: srcCap } = await adminClient
        .from('captures')
        .select('transcript')
        .eq('id', sourceCaptureId)
        .single();
      originalBody = srcCap?.transcript ?? '';
    }

    const genai = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY!);
    const model = genai.getGenerativeModel({ model: 'gemini-3.6-flash' });

    const daysAgo = sentDate
      ? Math.round((Date.now() - new Date(sentDate).getTime()) / 86400000)
      : 3;

    const result = await model.generateContent(
      `Draft a short, friendly follow-up email based on this original message I sent.

Original sent email:
${originalBody.slice(0, 1500)}

To: ${toAddresses.join(', ')}
Sent: ${daysAgo} days ago

Write ONLY the email body — no subject line, no salutation header, no markdown. 2-3 sentences max.
Be friendly and not pushy. Briefly reference what the original ask was, then end with something like "Happy to answer any questions."
Do not start with "I hope this email finds you well" or similar clichés.`
    );

    const draft = result.response.text().trim();
    await adminClient.from('captures').update({ status: 'archived' }).eq('id', actionCard.id);

    return {
      message: `Here's a draft follow-up for ${toName ?? toAddresses[0] ?? 'them'}:\n\n---\n${draft}\n---\n\nCopy that into your email app when you're ready to send.`,
      resolved: true,
    };
  }

  if (actionType === 'trip_prep') {
    const originalQuestion = actionCard.transcript ?? '';
    const genai = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY!);
    const model = genai.getGenerativeModel({ model: 'gemini-3.6-flash' });
    let message = 'Noted — consider it handled.';
    try {
      const result = await model.generateContent(
        `You are Calliad, a smart personal assistant. You sent the user this reminder:\n"${originalQuestion.slice(0, 500)}"\n\nThe user replied: "${(userReplyText ?? '').slice(0, 300)}"\n\nWrite ONE short sentence acknowledging their reply. Sound like a smart friend who understood what they just confirmed — not a customer service bot. React to what they actually said (e.g. if they said they already handled it, acknowledge that specifically). Do NOT start with "Got it", "Noted", "Sure", or "Of course". Return only the sentence, no quotes.`
      );
      message = result.response.text().trim() || message;
    } catch (err) { console.error('[action-executor] trip_prep ack generation failed:', err); }
    await adminClient.from('captures').update({ status: 'archived' }).eq('id', actionCard.id);
    return { message, resolved: true };
  }

  // Fallback for unknown action types
  await adminClient.from('captures').update({ status: 'archived' }).eq('id', actionCard.id);
  return { message: 'Done!', resolved: true };
}
