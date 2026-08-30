import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // All projects with their domain setting
  const { data: projects } = await adminClient
    .from('projects')
    .select('id, title, project_domain, folder_id')
    .eq('user_id', user.id);

  // All inbox email captures: show transcript prefix and extracted domain
  const { data: captures } = await adminClient
    .from('captures')
    .select('id, summary, transcript, source, created_at')
    .eq('user_id', user.id)
    .eq('status', 'inbox')
    .eq('source', 'email')
    .order('created_at', { ascending: false })
    .limit(20);

  const captureInfo = (captures ?? []).map((c) => {
    const t = (c as unknown as { transcript?: string }).transcript ?? '';
    const transcriptPreview = t.slice(0, 150);
    const domainMatch = t.match(/^From:.*?@([\w.-]+)/im);
    const extractedDomain = domainMatch ? domainMatch[1].toLowerCase() : null;
    return {
      id: c.id,
      summary: c.summary,
      created_at: c.created_at,
      transcript_preview: transcriptPreview,
      extracted_domain: extractedDomain,
    };
  });

  return NextResponse.json({
    projects_with_domain: (projects ?? []).map((p) => ({
      id: p.id,
      title: p.title,
      project_domain: (p as unknown as { project_domain?: string }).project_domain ?? null,
      folder_id: p.folder_id,
    })),
    inbox_email_captures: captureInfo,
  });
}
