import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import type { Milestone } from '@/lib/types';

const MILESTONE_LABELS: Record<string, string> = {
  inquiry: 'Initial inquiry',
  quote: 'Quote received',
  proposal: 'Proposal received',
  agreement: 'Agreement / contract signed',
  payment: 'Payment made',
  start_date: 'Work started',
  completion: 'Project completed',
};

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { capture_id } = await req.json();
  if (!capture_id) return NextResponse.json({ error: 'capture_id required' }, { status: 400 });

  const { data: suggestion } = await adminClient
    .from('captures')
    .select('id, metadata')
    .eq('id', capture_id)
    .eq('user_id', user.id)
    .single();

  if (!suggestion) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const meta = (suggestion.metadata ?? {}) as Record<string, unknown>;
  const company = meta.company as string | null;
  const topic = meta.topic as string | null;
  const captureIds = (meta.capture_ids as string[] | undefined) ?? [];

  const title = topic
    ? topic.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    : (company ?? 'New Project');

  // Find the Projects parent folder to associate
  const { data: projectsFolder } = await adminClient
    .from('folders')
    .select('id')
    .eq('user_id', user.id)
    .ilike('name', 'projects')
    .is('parent_folder_id', null)
    .limit(1)
    .maybeSingle();

  // Build milestones from project_signal phases on linked captures
  let milestones: Milestone[] = [];
  if (captureIds.length > 0) {
    const { data: linkedCaptures } = await adminClient
      .from('captures')
      .select('metadata')
      .in('id', captureIds)
      .eq('user_id', user.id);

    const phaseMap = new Map<string, string>();
    for (const cap of linkedCaptures ?? []) {
      const cMeta = (cap.metadata ?? {}) as Record<string, unknown>;
      const ps = cMeta.project_signal as { detected?: boolean; phase?: string | null } | undefined;
      const sentDate = cMeta.sent_date as string | undefined;
      if (ps?.detected && ps.phase && sentDate && !phaseMap.has(ps.phase)) {
        phaseMap.set(ps.phase, sentDate);
      }
    }

    const phaseOrder = ['inquiry', 'quote', 'proposal', 'agreement', 'payment', 'start_date', 'completion'];
    milestones = phaseOrder
      .filter((p) => phaseMap.has(p))
      .map((p) => ({
        phase: p,
        date: phaseMap.get(p) ?? null,
        label: MILESTONE_LABELS[p] ?? p,
        notes: null,
      }));
  }

  // Create the project entry
  const { data: project, error: projectErr } = await adminClient
    .from('projects')
    .insert({
      user_id: user.id,
      folder_id: projectsFolder?.id ?? null,
      title,
      company,
      status: 'active',
      milestones,
    })
    .select()
    .single();

  if (projectErr || !project) return NextResponse.json({ error: projectErr?.message ?? 'Failed to create project' }, { status: 500 });

  // Link all related captures to the project
  if (captureIds.length > 0) {
    await adminClient
      .from('captures')
      .update({ project_id: project.id, status: 'folder' })
      .in('id', captureIds)
      .eq('user_id', user.id);
  }

  // Archive the suggestion card
  await adminClient
    .from('captures')
    .update({ status: 'archived' })
    .eq('id', capture_id)
    .eq('user_id', user.id);

  return NextResponse.json({ project }, { status: 201 });
}
