import { adminClient } from './supabase.server';

export interface CurationCardSpec {
  anomaly_id: string;
  curation_type: string;
  transcript: string;
  trip_label?: string;
  interaction_type: 'yes_no' | 'choice' | 'open';
  choices?: string[];
  executor: string;
  executor_params: Record<string, unknown>;
  trip_ids?: string[];
  capture_ids?: string[];
}

export async function runCurationDetectors(userId: string, maxTurns = 3): Promise<number> {
  const specs = await detectDuplicateTrips(userId);
  let created = 0;

  for (const spec of specs) {
    // Skip if an inbox curation card for this anomaly already exists
    const { count } = await adminClient
      .from('captures')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('source', 'action')
      .eq('status', 'inbox')
      .contains('metadata', { anomaly_id: spec.anomaly_id });

    if ((count ?? 0) > 0) continue;

    await adminClient.from('captures').insert({
      user_id: userId,
      source: 'action',
      status: 'inbox',
      transcription_status: 'done',
      transcript: spec.transcript,
      summary: null,
      tags: ['curation'],
      metadata: {
        action_type: 'curation',
        curation_type: spec.curation_type,
        anomaly_id: spec.anomaly_id,
        turn_count: 0,
        max_turns: maxTurns,
        interaction_type: spec.interaction_type,
        ...(spec.choices ? { choices: spec.choices } : {}),
        executor: spec.executor,
        executor_params: spec.executor_params,
        ...(spec.trip_label ? { trip_label: spec.trip_label } : {}),
        ...(spec.trip_ids ? { trip_ids: spec.trip_ids } : {}),
        ...(spec.capture_ids ? { capture_ids: spec.capture_ids } : {}),
      },
    });
    created++;
  }

  return created;
}

async function detectDuplicateTrips(userId: string): Promise<CurationCardSpec[]> {
  const specs: CurationCardSpec[] = [];

  const { data: trips } = await adminClient
    .from('trips')
    .select('id, title, destination, start_date, end_date, status')
    .eq('user_id', userId)
    .in('status', ['planned', 'active', 'completed'])
    .not('start_date', 'is', null);

  if (!trips || trips.length < 2) return specs;

  const checked = new Set<string>();

  for (let i = 0; i < trips.length; i++) {
    for (let j = i + 1; j < trips.length; j++) {
      const a = trips[i];
      const b = trips[j];

      const pairKey = [a.id, b.id].sort().join(':');
      if (checked.has(pairKey)) continue;
      checked.add(pairKey);

      // Check destination similarity — share at least one significant word
      const aWords = (a.destination ?? a.title ?? '').toLowerCase().split(/[\s,·]+/).filter((w: string) => w.length > 3);
      const bWords = (b.destination ?? b.title ?? '').toLowerCase().split(/[\s,·]+/).filter((w: string) => w.length > 3);
      const hasSharedWord = aWords.some((w: string) => bWords.includes(w));
      if (!hasSharedWord) continue;

      const aStart = a.start_date as string;
      const aEnd = (a.end_date ?? a.start_date) as string;
      const bStart = b.start_date as string;
      const bEnd = (b.end_date ?? b.start_date) as string;

      // Overlapping or adjacent within 2 days
      const overlaps = aStart <= bEnd && bStart <= aEnd;
      const adjacent =
        !overlaps &&
        Math.abs(new Date(aEnd).getTime() - new Date(bStart).getTime()) < 2 * 86400000;

      if (!overlaps && !adjacent) continue;

      // Primary = earlier start
      const [primary, secondary] = aStart <= bStart ? [a, b] : [b, a];
      const mergedStart = aStart < bStart ? aStart : bStart;
      const mergedEnd = aEnd > bEnd ? aEnd : bEnd;
      const destination = primary.destination ?? primary.title;

      const aLabel = tripLabel(a.destination ?? a.title, a.start_date, a.end_date);
      const bLabel = tripLabel(b.destination ?? b.title, b.start_date, b.end_date);

      specs.push({
        anomaly_id: `duplicate_trip:${pairKey}`,
        curation_type: 'duplicate_trip',
        transcript: `I noticed two overlapping ${destination} trips — "${aLabel}" and "${bLabel}". Should I merge them into one trip (${fmtDate(mergedStart)}–${fmtDate(mergedEnd)})?`,
        trip_label: destination,
        interaction_type: 'yes_no',
        executor: 'merge_trips',
        executor_params: {
          primaryTripId: primary.id,
          secondaryTripId: secondary.id,
          mergedStartDate: mergedStart,
          mergedEndDate: mergedEnd,
        },
        trip_ids: [primary.id, secondary.id],
      });
    }
  }

  return specs;
}

function tripLabel(destination: string | null, startDate: string | null, endDate: string | null): string {
  const dest = destination ?? 'Unknown';
  const start = startDate ? fmtDate(startDate) : '';
  const end = endDate && endDate !== startDate ? fmtDate(endDate) : '';
  if (start && end) return `${dest} ${start}–${end}`;
  if (start) return `${dest} ${start}`;
  return dest;
}

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
