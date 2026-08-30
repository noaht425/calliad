import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Try by project id first
  let { data: project } = await adminClient
    .from('projects')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  // Try by folder_id (URL may carry the folder UUID, not the projects-table UUID)
  if (!project) {
    const { data: byFolder } = await adminClient
      .from('projects')
      .select('*')
      .eq('folder_id', id)
      .eq('user_id', user.id)
      .maybeSingle();
    project = byFolder ?? null;
  }

  // Last resort: build a virtual project from the folder row so the page always loads
  let virtualFolderId: string | null = null;
  if (!project) {
    const { data: folder } = await adminClient
      .from('folders')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (folder && folder.entity_type === 'project') {
      virtualFolderId = folder.id;
      project = {
        id: folder.id,
        user_id: user.id,
        folder_id: folder.id,
        title: folder.name,
        company: null,
        status: 'active',
        start_date: null,
        end_date: null,
        summary: null,
        milestones: [],
        created_at: folder.created_at,
        updated_at: folder.created_at,
      } as never;
    }
  }

  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // For virtual (folder-backed) projects, query captures by folder_id instead
  const capturesQuery = adminClient
    .from('captures')
    .select('id,user_id,transcript,summary,tags,source,status,metadata,created_at,updated_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  // Use the real project.id for the query (URL id may be the folder UUID)
  const { data: captures } = virtualFolderId
    ? await capturesQuery.eq('folder_id', virtualFolderId)
    : await capturesQuery.eq('project_id', (project as { id: string }).id);

  return NextResponse.json({ project, captures: captures ?? [] });
}

const MILESTONE_LABELS: Record<string, string> = {
  inquiry: 'Initial inquiry',
  quote: 'Quote received',
  proposal: 'Proposal received',
  agreement: 'Agreement signed',
  payment: 'Payment made',
  start_date: 'Work started',
  completion: 'Project completed',
};
const MILESTONE_ORDER = ['inquiry', 'quote', 'proposal', 'agreement', 'payment', 'start_date', 'completion'];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();

  // Special action: sync milestones from linked email phase signals
  if (body.action === 'sync_milestones') {
    const { data: project } = await adminClient
      .from('projects')
      .select('milestones')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    const { data: caps } = await adminClient
      .from('captures')
      .select('metadata')
      .eq('project_id', id)
      .eq('user_id', user.id);

    const existing = (project?.milestones ?? []) as Array<{ phase: string; date: string | null; label: string; notes: string | null }>;
    const existingPhases = new Set(existing.map((m) => m.phase));
    const phaseMap = new Map<string, string>();

    for (const cap of caps ?? []) {
      const meta = (cap.metadata ?? {}) as Record<string, unknown>;
      const ps = meta.project_signal as { phase?: string | null } | undefined;
      const sentDate = meta.sent_date as string | undefined;
      if (ps?.phase && sentDate && !phaseMap.has(ps.phase) && !existingPhases.has(ps.phase)) {
        phaseMap.set(ps.phase, sentDate);
      }
    }

    const newMilestones = MILESTONE_ORDER
      .filter((p) => phaseMap.has(p))
      .map((p) => ({ phase: p, date: phaseMap.get(p)!, label: MILESTONE_LABELS[p] ?? p, notes: null }));

    const merged = [...existing, ...newMilestones];
    const { data, error } = await adminClient
      .from('projects')
      .update({ milestones: merged, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  const allowed = ['title', 'company', 'project_tag', 'project_domain', 'status', 'start_date', 'end_date', 'summary', 'milestones'];
  const safe = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
  if (safe.title) safe.title = (safe.title as string).trim();
  safe.updated_at = new Date().toISOString();

  // Try update by id first (use select() not single() so 0 rows returns [] not an error)
  const { data: byId } = await adminClient
    .from('projects')
    .update(safe)
    .eq('id', id)
    .eq('user_id', user.id)
    .select();
  let data = byId?.[0] ?? null;

  // If no row matched, try by folder_id
  if (!data) {
    const { data: byFolder } = await adminClient
      .from('projects')
      .update(safe)
      .eq('folder_id', id)
      .eq('user_id', user.id)
      .select();
    data = byFolder?.[0] ?? null;
  }

  // Still nothing — virtual folder-backed project with no projects row yet; create one on demand
  if (!data) {
    const { data: folder } = await adminClient
      .from('folders')
      .select('id, name')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (folder) {
      const { data: inserted, error: insertErr } = await adminClient
        .from('projects')
        .insert({ user_id: user.id, folder_id: folder.id, title: folder.name, ...safe })
        .select()
        .single();
      if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
      data = inserted;
    }
  }

  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Find the project (may be stored by id or folder_id)
  let projectId = id;
  let folderId: string | null = null;

  const { data: byId } = await adminClient.from('projects').select('id, folder_id').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (byId) {
    projectId = byId.id;
    folderId = byId.folder_id;
  } else {
    const { data: byFolder } = await adminClient.from('projects').select('id, folder_id').eq('folder_id', id).eq('user_id', user.id).maybeSingle();
    if (byFolder) {
      projectId = byFolder.id;
      folderId = byFolder.folder_id ?? id;
    } else {
      // Virtual project — no projects row, id IS the folder id
      folderId = id;
    }
  }

  // Return captures to inbox (match by project_id or folder_id)
  await Promise.all([
    adminClient.from('captures').update({ project_id: null, folder_id: null, status: 'inbox' }).eq('project_id', projectId).eq('user_id', user.id),
    folderId ? adminClient.from('captures').update({ project_id: null, folder_id: null, status: 'inbox' }).eq('folder_id', folderId).eq('user_id', user.id) : Promise.resolve(),
  ]);

  // Delete projects row (may be 0 rows for virtual projects — that's fine)
  await adminClient.from('projects').delete().eq('id', projectId).eq('user_id', user.id);

  // Delete the folder row
  if (folderId) {
    await adminClient.from('folders').delete().eq('id', folderId).eq('user_id', user.id);
  }

  return new NextResponse(null, { status: 204 });
}
