import { adminClient } from './supabase.server';
import { createCalendarEvent } from './icloud-calendar-write';

function smartMergeTravelers(existing: string[], incoming: string[]): string[] {
  const result = [...existing];
  for (const name of incoming) {
    const parts = name.trim().split(/\s+/);
    const inLast = parts[parts.length - 1].toLowerCase();
    const inFirst = parts[0].toLowerCase();
    const isDuplicate = result.some((r) => {
      const rp = r.trim().split(/\s+/);
      const rLast = rp[rp.length - 1].toLowerCase();
      const rFirst = rp[0].toLowerCase();
      return rLast === inLast && (rFirst.startsWith(inFirst) || inFirst.startsWith(rFirst));
    });
    if (!isDuplicate) result.push(name);
  }
  return result;
}

export interface CurationExecutionResult {
  message: string;
  resolved: boolean;
}

export async function executeCuration(
  userId: string,
  executor: string,
  params: Record<string, unknown>
): Promise<CurationExecutionResult> {
  switch (executor) {
    case 'merge_trips':
      return mergeTrips(userId, params);
    case 'add_travelers':
      return addTravelers(userId, params);
    case 'link_capture':
      return linkCapture(userId, params);
    case 'update_trip_dates':
      return updateTripDates(userId, params);
    case 'create_separate_trip':
      return createSeparateTrip(userId, params);
    case 'add_to_calendar':
      return addToCalendar(userId, params);
    case 'add_event':
      return addEvent(userId, params);
    case 'add_todo':
      return addTodo(userId, params);
    case 'save_place':
      return savePlace(userId, params);
    case 'save_recipe':
      return saveRecipe(userId, params);
    case 'dismiss':
      return { message: "Got it, I'll leave that alone.", resolved: true };
    case 'none':
    default:
      return { message: 'Done.', resolved: true };
  }
}

async function mergeTrips(userId: string, params: Record<string, unknown>): Promise<CurationExecutionResult> {
  const { primaryTripId, secondaryTripId, mergedStartDate, mergedEndDate } = params as {
    primaryTripId: string;
    secondaryTripId: string;
    mergedStartDate?: string;
    mergedEndDate?: string;
  };

  const [{ data: primary }, { data: secondary }] = await Promise.all([
    adminClient.from('trips').select('id, travelers, title, destination').eq('id', primaryTripId).eq('user_id', userId).single(),
    adminClient.from('trips').select('id, travelers').eq('id', secondaryTripId).eq('user_id', userId).single(),
  ]);

  if (!primary || !secondary) {
    return { message: "Couldn't find those trips — they may have already been merged.", resolved: true };
  }

  const mergedTravelers = Array.from(
    new Set([...(primary.travelers as string[] ?? []), ...(secondary.travelers as string[] ?? [])])
  );

  await Promise.all([
    adminClient.from('trips').update({
      travelers: mergedTravelers,
      ...(mergedStartDate ? { start_date: mergedStartDate } : {}),
      ...(mergedEndDate ? { end_date: mergedEndDate } : {}),
      updated_at: new Date().toISOString(),
    }).eq('id', primaryTripId).eq('user_id', userId),

    // Re-link all captures from secondary trip to primary
    adminClient.from('captures').update({ trip_id: primaryTripId })
      .eq('trip_id', secondaryTripId).eq('user_id', userId),

    // Archive secondary trip
    adminClient.from('trips').update({ status: 'archived' })
      .eq('id', secondaryTripId).eq('user_id', userId),
  ]);

  return {
    message: `Merged — all bookings are now under "${primary.destination ?? primary.title}".`,
    resolved: true,
  };
}

async function addTravelers(userId: string, params: Record<string, unknown>): Promise<CurationExecutionResult> {
  const { tripId, travelers } = params as { tripId: string; travelers: string[] };

  const { data: trip } = await adminClient.from('trips').select('travelers').eq('id', tripId).eq('user_id', userId).single();
  if (!trip) return { message: "Couldn't find that trip.", resolved: true };

  const merged = smartMergeTravelers(trip.travelers as string[] ?? [], travelers);
  await adminClient.from('trips').update({ travelers: merged, updated_at: new Date().toISOString() })
    .eq('id', tripId).eq('user_id', userId);

  return {
    message: `Added ${travelers.join(', ')} as traveler${travelers.length > 1 ? 's' : ''}.`,
    resolved: true,
  };
}

async function linkCapture(userId: string, params: Record<string, unknown>): Promise<CurationExecutionResult> {
  const { captureId, tripId } = params as { captureId: string; tripId: string };
  await adminClient.from('captures').update({ trip_id: tripId }).eq('id', captureId).eq('user_id', userId);
  return { message: 'Linked to your trip.', resolved: true };
}

async function updateTripDates(userId: string, params: Record<string, unknown>): Promise<CurationExecutionResult> {
  const { tripId, startDate, endDate } = params as { tripId: string; startDate?: string; endDate?: string };
  await adminClient.from('trips').update({
    ...(startDate ? { start_date: startDate } : {}),
    ...(endDate ? { end_date: endDate } : {}),
    updated_at: new Date().toISOString(),
  }).eq('id', tripId).eq('user_id', userId);
  return { message: 'Trip dates updated.', resolved: true };
}

async function addToCalendar(userId: string, params: Record<string, unknown>): Promise<CurationExecutionResult> {
  const result = await createCalendarEvent(userId, {
    title: params.title as string,
    start_at: params.start_at as string,
    end_at: params.end_at as string | null,
    location: params.location as string | null,
    description: params.description as string | null,
    confirmation_number: params.confirmation_number as string | null,
    all_day: params.all_day as boolean | undefined,
  });
  if (!result.ok) return { message: `Couldn't add to calendar: ${result.error}`, resolved: true };
  return { message: `Added "${params.title}" to your calendar.`, resolved: true };
}

async function addTodo(userId: string, params: Record<string, unknown>): Promise<CurationExecutionResult> {
  const { text, remind_at, todoProjectId } = params as {
    text: string;
    remind_at?: string;
    todoProjectId?: string;
  };
  // calendar/reminder flags injected by chat route from selected_choice
  const calendar = (params.calendar as boolean | undefined) ?? !params.selected_choice;
  const reminder = (params.reminder as boolean | undefined) ?? true;

  const promises: PromiseLike<unknown>[] = [];

  // File in the To-Do folder
  if (todoProjectId) {
    promises.push(
      adminClient.from('captures').insert({
        user_id: userId,
        source: 'app',
        transcript: text,
        summary: text,
        tags: ['todo'],
        status: 'folder',
        folder_id: todoProjectId,
        transcription_status: 'done',
        metadata: remind_at ? { remind_at } : {},
      }).then(() => {})
    );
  }

  // Write to calendar if Calendar or Both selected
  if (calendar && remind_at) {
    promises.push(createCalendarEvent(userId, { title: text, start_at: remind_at, all_day: true }));
  }

  await Promise.all(promises);

  const parts: string[] = ['Added to your To-Do list.'];
  if (reminder && remind_at) {
    parts.push(`I'll remind you on ${new Date(remind_at + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}.`);
  }
  if (calendar && remind_at) parts.push("It's also on your calendar.");
  return { message: parts.join(' '), resolved: true };
}

async function createSeparateTrip(userId: string, params: Record<string, unknown>): Promise<CurationExecutionResult> {
  const { captureIds, destination, startDate, endDate, folderId } = params as {
    captureIds: string[];
    destination: string;
    startDate: string;
    endDate?: string;
    folderId?: string;
  };

  const { data: newTrip } = await adminClient.from('trips').insert({
    user_id: userId,
    folder_id: folderId ?? null,
    title: `${destination} · ${startDate}`,
    destination,
    start_date: startDate,
    end_date: endDate ?? null,
    travelers: [],
    status: 'planned',
  }).select('id').single();

  if (newTrip && captureIds.length) {
    await adminClient.from('captures').update({ trip_id: newTrip.id })
      .in('id', captureIds).eq('user_id', userId);
  }

  return {
    message: `Created a separate trip to ${destination}${captureIds.length ? ` and linked ${captureIds.length} item${captureIds.length > 1 ? 's' : ''}` : ''}.`,
    resolved: true,
  };
}

async function addEvent(userId: string, params: Record<string, unknown>): Promise<CurationExecutionResult> {
  const { title, date, time, location, description } = params as {
    title: string;
    date?: string | null;
    time?: string | null;
    location?: string | null;
    description?: string | null;
  };
  const calendar = (params.calendar as boolean | undefined) ?? true;
  const reminder = (params.reminder as boolean | undefined) ?? false;

  let start_at: string | null = null;
  if (date) {
    start_at = time ? `${date}T${time}:00` : `${date}T00:00:00`;
  }

  const parts: string[] = [];

  if (calendar && start_at) {
    const result = await createCalendarEvent(userId, {
      title,
      start_at,
      end_at: null,
      location: location ?? null,
      description: description ?? null,
      confirmation_number: null,
      all_day: !time,
    });
    if (result.ok) {
      parts.push(`Added "${title}" to your calendar.`);
    } else {
      parts.push(`Couldn't add to calendar: ${result.error}`);
    }
  }

  if (reminder && start_at) {
    await adminClient.from('captures').insert({
      user_id: userId,
      source: 'app',
      transcript: `Reminder: ${title}`,
      summary: `Reminder: ${title}`,
      tags: ['reminder'],
      status: 'inbox',
      transcription_status: 'done',
      metadata: { remind_at: start_at },
    });
    parts.push('Reminder set.');
  }

  if (parts.length === 0) {
    parts.push(start_at ? `Noted — "${title}" is on ${date}.` : `Noted — "${title}".`);
  }

  return { message: parts.join(' '), resolved: true };
}

async function savePlace(userId: string, params: Record<string, unknown>): Promise<CurationExecutionResult> {
  const { name, place_type, cuisine, address, lat, lng } = params as {
    name: string;
    place_type: 'restaurant' | 'building';
    cuisine?: string | null;
    address?: string | null;
    lat?: number | null;
    lng?: number | null;
  };

  const selectedChoice = params.selected_choice as string | undefined;
  if (selectedChoice === 'Not now') {
    return { message: "No problem, I'll leave it.", resolved: true };
  }

  // Find or create a Places folder
  const { data: existing } = await adminClient
    .from('folders')
    .select('id')
    .eq('user_id', userId)
    .ilike('name', '%places%')
    .limit(1)
    .single();

  let projectId = existing?.id;
  if (!projectId) {
    const { data: created } = await adminClient
      .from('folders')
      .insert({ user_id: userId, name: 'Places', icon: '📍', color: 'green' })
      .select('id')
      .single();
    projectId = created?.id ?? null;
  }

  const tags = ['place', place_type === 'restaurant' ? 'restaurant' : 'location'];
  if (cuisine) tags.push(cuisine.toLowerCase());

  const details = [
    cuisine ? `Cuisine: ${cuisine}` : null,
    address ? `Address: ${address}` : null,
    lat && lng ? `Location: ${lat.toFixed(4)}, ${lng.toFixed(4)}` : null,
  ].filter(Boolean).join('\n');

  await adminClient.from('captures').insert({
    user_id: userId,
    source: 'photo',
    transcript: [name, details].filter(Boolean).join('\n'),
    summary: name,
    tags,
    status: projectId ? 'folder' : 'inbox',
    folder_id: projectId ?? null,
    transcription_status: 'done',
    metadata: { place_type, cuisine: cuisine ?? null, address: address ?? null, lat: lat ?? null, lng: lng ?? null },
  });

  const typeLabel = place_type === 'restaurant' ? 'restaurant' : 'place';
  return {
    message: `Saved **${name}** to your Places list.${cuisine ? ` (${cuisine} ${typeLabel})` : ''}`,
    resolved: true,
  };
}

async function saveRecipe(userId: string, params: Record<string, unknown>): Promise<CurationExecutionResult> {
  const { title, ingredients, instructions_summary, servings, total_time } = params as {
    title: string;
    ingredients?: string[];
    instructions_summary?: string;
    servings?: string | null;
    total_time?: string | null;
  };

  const selectedChoice = params.selected_choice as string | undefined;
  if (selectedChoice === 'Not now') {
    return { message: "No problem — the recipe photo is still in your inbox.", resolved: true };
  }

  // Find or create a Recipes folder
  const { data: existing } = await adminClient
    .from('folders')
    .select('id')
    .eq('user_id', userId)
    .ilike('name', '%recipe%')
    .limit(1)
    .single();

  let projectId = existing?.id;
  if (!projectId) {
    const { data: created } = await adminClient
      .from('folders')
      .insert({ user_id: userId, name: 'Recipes', icon: '🍽️', color: 'orange' })
      .select('id')
      .single();
    projectId = created?.id ?? null;
  }

  const transcript = [
    `Recipe: ${title}`,
    servings ? `Serves: ${servings}` : null,
    total_time ? `Time: ${total_time}` : null,
    ingredients?.length ? `\nIngredients:\n${ingredients.map((i) => `• ${i}`).join('\n')}` : null,
    instructions_summary ? `\nMethod: ${instructions_summary}` : null,
  ].filter(Boolean).join('\n');

  await adminClient.from('captures').insert({
    user_id: userId,
    source: 'photo',
    transcript,
    summary: title,
    tags: ['recipe'],
    status: projectId ? 'folder' : 'inbox',
    folder_id: projectId ?? null,
    transcription_status: 'done',
    metadata: { recipe_title: title, ingredients: ingredients ?? [], servings: servings ?? null, total_time: total_time ?? null },
  });

  return {
    message: `Saved **${title}** to your Recipes. The A Bent Fork integration is on the roadmap — for now it's saved in Calliad.`,
    resolved: true,
  };
}
