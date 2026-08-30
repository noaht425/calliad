'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { BottomNav } from '@/components/BottomNav';
import { getProject, updateProject, deleteProject, assessProject } from '@/lib/api';
import type { Project, Capture, Milestone } from '@/lib/types';

const MILESTONE_ORDER = ['inquiry', 'quote', 'proposal', 'agreement', 'payment', 'start_date', 'completion'];
const MILESTONE_LABELS: Record<string, string> = {
  inquiry: 'Initial inquiry',
  quote: 'Quote received',
  proposal: 'Proposal received',
  agreement: 'Agreement signed',
  payment: 'Payment made',
  start_date: 'Work started',
  completion: 'Project completed',
};
const MILESTONE_ICONS: Record<string, string> = {
  inquiry: '💬',
  quote: '📋',
  proposal: '📄',
  agreement: '✍️',
  payment: '💳',
  start_date: '🔨',
  completion: '✅',
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso + (iso.length === 10 ? 'T12:00:00' : ''));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusBadge(status: string) {
  const base = 'text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border cursor-pointer';
  if (status === 'planning') return <span className={`${base} bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800/40`}>Planning</span>;
  if (status === 'active') return <span className={`${base} bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/40`}>Active</span>;
  if (status === 'completed') return <span className={`${base} bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700`}>Completed</span>;
  return <span className={`${base} bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 border-zinc-200 dark:border-zinc-700`}>{status}</span>;
}

export default function ProjectPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const [project, setProject] = useState<Project | null>(null);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingPhase, setEditingPhase] = useState<string | null>(null);
  const [phaseDateDraft, setPhaseDateDraft] = useState('');
  const [editingCompany, setEditingCompany] = useState(false);
  const [companyDraft, setCompanyDraft] = useState('');
  const [editingTag, setEditingTag] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [editingDomain, setEditingDomain] = useState(false);
  const [domainDraft, setDomainDraft] = useState('');
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState('');
  const [assessing, setAssessing] = useState(false);
  const [assessResult, setAssessResult] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !session) router.push('/login');
  }, [loading, session, router]);

  useEffect(() => {
    if (!session || !id) return;
    getProject(id).then(async ({ project: p, captures: c }) => {
      setProject(p);
      setCaptures(c);
      // Auto-sync milestones from email phase signals when none are set yet
      if ((p.milestones ?? []).length === 0 && c.length > 0) {
        try {
          const synced = await updateProject(p.id, { action: 'sync_milestones' } as never);
          setProject(synced);
        } catch {}
      }
    }).catch(() => router.push('/folders'));
  }, [session, id, router]);

  const saveTitle = useCallback(async () => {
    if (!project || !titleDraft.trim() || titleDraft.trim() === project.title) {
      setEditingTitle(false);
      return;
    }
    setSaving(true);
    try {
      const updated = await updateProject(project.id, { title: titleDraft.trim() });
      setProject(updated);
    } catch {}
    setSaving(false);
    setEditingTitle(false);
  }, [project, titleDraft]);

  const saveCompany = useCallback(async () => {
    if (!project) return;
    const trimmed = companyDraft.trim();
    if (trimmed === (project.company ?? '')) { setEditingCompany(false); return; }
    setSaving(true);
    try {
      const updated = await updateProject(project.id, { company: trimmed || null });
      setProject(updated);
    } catch {}
    setSaving(false);
    setEditingCompany(false);
  }, [project, companyDraft]);

  const saveTag = useCallback(async () => {
    if (!project) return;
    const normalized = tagDraft.trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if (normalized === (project.project_tag ?? '')) { setEditingTag(false); return; }
    setSaving(true);
    try {
      const updated = await updateProject(project.id, { project_tag: normalized || null });
      setProject(updated);
    } catch {}
    setSaving(false);
    setEditingTag(false);
  }, [project, tagDraft]);

  const saveDomain = useCallback(async () => {
    if (!project) return;
    const trimmed = domainDraft.trim().toLowerCase().replace(/^@/, '');
    if (trimmed === (project.project_domain ?? '')) { setEditingDomain(false); return; }
    setSaving(true);
    try {
      const updated = await updateProject(project.id, { project_domain: trimmed || null });
      setProject(updated);
    } catch {}
    setSaving(false);
    setEditingDomain(false);
  }, [project, domainDraft]);

  const saveSummary = useCallback(async () => {
    if (!project) return;
    const trimmed = summaryDraft.trim();
    if (trimmed === (project.summary ?? '')) { setEditingSummary(false); return; }
    setSaving(true);
    try {
      const updated = await updateProject(project.id, { summary: trimmed || null });
      setProject(updated);
    } catch {}
    setSaving(false);
    setEditingSummary(false);
  }, [project, summaryDraft]);

  const cycleStatus = useCallback(async () => {
    if (!project) return;
    const order: Project['status'][] = ['planning', 'active', 'completed', 'archived'];
    const next = order[(order.indexOf(project.status) + 1) % order.length];
    const updated = await updateProject(project.id, { status: next });
    setProject(updated);
  }, [project]);

  const saveMilestoneDate = useCallback(async (phase: string, date: string) => {
    if (!project) return;
    const existing = (project.milestones ?? []) as Milestone[];
    let updated: Milestone[];
    if (!date) {
      updated = existing.filter((m) => m.phase !== phase);
    } else {
      const idx = existing.findIndex((m) => m.phase === phase);
      if (idx >= 0) {
        updated = existing.map((m) => m.phase === phase ? { ...m, date } : m);
      } else {
        updated = [...existing, { phase, date, label: MILESTONE_LABELS[phase] ?? phase, notes: null }];
      }
    }
    const result = await updateProject(project.id, { milestones: updated });
    setProject(result);
    setEditingPhase(null);
  }, [project]);

  const handleAssess = useCallback(async () => {
    if (!project || assessing) return;
    setAssessing(true);
    setAssessResult(null);
    try {
      const { project: updated, filed } = await assessProject(project.id);
      setProject(updated);
      if (filed > 0) setAssessResult(`${filed} inbox item${filed === 1 ? '' : 's'} filed here`);
      else setAssessResult('Assessment complete');
      setTimeout(() => setAssessResult(null), 4000);
    } catch (e) {
      setAssessResult(e instanceof Error ? e.message : 'Assessment failed');
      setTimeout(() => setAssessResult(null), 6000);
    }
    setAssessing(false);
  }, [project, assessing]);

  const handleDelete = useCallback(async () => {
    if (!project) return;
    await deleteProject(project.id);
    router.push('/folders');
  }, [project, router]);

  if (loading || !session || !project) {
    return (
      <div className="min-h-screen bg-[#fafaf8] dark:bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 animate-spin" />
      </div>
    );
  }

  const milestones = (project.milestones ?? []) as Milestone[];
  const completedPhases = new Set(milestones.map((m) => m.phase));
  const allPhases = MILESTONE_ORDER.map((phase) => ({
    phase,
    milestone: milestones.find((m) => m.phase === phase) ?? null,
  }));

  return (
    <div className="min-h-screen bg-[#fafaf8] dark:bg-[#0a0a0a]">
      <header className="sticky top-0 z-10 bg-[#fafaf8]/80 dark:bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-zinc-200/60 dark:border-zinc-800/60 px-4 py-3">
        <div className="max-w-xl mx-auto flex items-center gap-3">
          <button onClick={() => router.push('/folders')} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors shrink-0">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            {editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
                className="text-base font-semibold bg-transparent text-zinc-900 dark:text-zinc-100 outline-none w-full border-b border-zinc-300 dark:border-zinc-600 pb-0.5"
                disabled={saving}
              />
            ) : (
              <button
                onClick={() => { setTitleDraft(project.title); setEditingTitle(true); }}
                className="text-base font-semibold text-zinc-900 dark:text-zinc-100 hover:opacity-70 transition-opacity text-left truncate max-w-full"
              >
                {project.title}
              </button>
            )}
            {editingCompany ? (
              <input
                autoFocus
                value={companyDraft}
                onChange={(e) => setCompanyDraft(e.target.value)}
                onBlur={saveCompany}
                onKeyDown={(e) => { if (e.key === 'Enter') saveCompany(); if (e.key === 'Escape') setEditingCompany(false); }}
                placeholder="Company / contractor"
                className="text-[11px] font-mono bg-transparent text-zinc-500 dark:text-zinc-400 outline-none border-b border-zinc-300 dark:border-zinc-600 w-full mt-0.5"
                disabled={saving}
              />
            ) : (
              <button
                onClick={() => { setCompanyDraft(project.company ?? ''); setEditingCompany(true); }}
                className={`text-[11px] font-mono truncate block text-left mt-0.5 ${project.company ? 'text-zinc-400 dark:text-zinc-500 hover:opacity-70' : 'text-zinc-300 dark:text-zinc-700 hover:text-zinc-400'} transition-opacity`}
              >
                {project.company || '+ company'}
              </button>
            )}
            {editingTag ? (
              <input
                autoFocus
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onBlur={saveTag}
                onKeyDown={(e) => { if (e.key === 'Enter') saveTag(); if (e.key === 'Escape') setEditingTag(false); }}
                placeholder="project-tag"
                className="text-[11px] font-mono bg-transparent text-violet-500 dark:text-violet-400 outline-none border-b border-zinc-300 dark:border-zinc-600 w-full mt-0.5"
                disabled={saving}
              />
            ) : (
              <button
                onClick={() => { setTagDraft(project.project_tag ?? ''); setEditingTag(true); }}
                className="mt-1 text-left"
              >
                {project.project_tag ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/30 border border-violet-200 dark:border-violet-800/40 text-[10px] font-mono text-violet-600 dark:text-violet-400 hover:opacity-70 transition-opacity">
                    #{project.project_tag}
                  </span>
                ) : (
                  <span className="text-[11px] font-mono text-zinc-300 dark:text-zinc-700 hover:text-zinc-400 transition-colors">+ tag</span>
                )}
              </button>
            )}
            {editingDomain ? (
              <input
                autoFocus
                value={domainDraft}
                onChange={(e) => setDomainDraft(e.target.value)}
                onBlur={saveDomain}
                onKeyDown={(e) => { if (e.key === 'Enter') saveDomain(); if (e.key === 'Escape') setEditingDomain(false); }}
                placeholder="vendor.com"
                className="text-[11px] font-mono bg-transparent text-zinc-500 dark:text-zinc-400 outline-none border-b border-zinc-300 dark:border-zinc-600 w-full mt-0.5"
                disabled={saving}
              />
            ) : (
              <button
                onClick={() => { setDomainDraft(project.project_domain ?? ''); setEditingDomain(true); }}
                className={`text-[11px] font-mono truncate block text-left mt-0.5 ${project.project_domain ? 'text-zinc-400 dark:text-zinc-500 hover:opacity-70' : 'text-zinc-300 dark:text-zinc-700 hover:text-zinc-400'} transition-opacity`}
              >
                {project.project_domain ? `@${project.project_domain}` : '+ email domain'}
              </button>
            )}
          </div>
          <button onClick={cycleStatus} className="shrink-0">
            {statusBadge(project.status)}
          </button>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 pt-4 pb-32 space-y-6">

        {/* Milestone timeline */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[10px] font-mono text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">Milestones</h2>
            <div className="flex items-center gap-2">
              {assessResult && (
                <span className="text-[10px] font-mono text-emerald-500 dark:text-emerald-400">{assessResult}</span>
              )}
              <button
                onClick={handleAssess}
                disabled={assessing}
                className="flex items-center gap-1 text-[10px] font-mono text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 disabled:opacity-40 transition-colors px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700"
              >
                {assessing ? (
                  <span className="w-3 h-3 rounded-full border border-current border-t-transparent animate-spin inline-block" />
                ) : (
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                )}
                {assessing ? 'Assessing…' : 'Assess'}
              </button>
            </div>
          </div>
          <div className="space-y-0">
            {allPhases.map(({ phase, milestone }, i) => {
              const isDone = completedPhases.has(phase);
              const isLast = i === allPhases.length - 1;
              return (
                <div key={phase} className="flex gap-3">
                  {/* Timeline spine */}
                  <div className="flex flex-col items-center w-6 shrink-0">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] shrink-0 mt-0.5 transition-colors ${
                      isDone
                        ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-300 dark:text-zinc-600'
                    }`}>
                      {isDone ? '✓' : '·'}
                    </div>
                    {!isLast && (
                      <div className={`w-px flex-1 mt-1 mb-1 ${isDone ? 'bg-emerald-200 dark:bg-emerald-800/40' : 'bg-zinc-200 dark:bg-zinc-800'}`} />
                    )}
                  </div>
                  {/* Milestone content */}
                  <div className={`pb-4 flex-1 min-w-0`}>
                    {editingPhase === phase ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm">{MILESTONE_ICONS[phase]}</span>
                        <input
                          type="date"
                          autoFocus
                          defaultValue={milestone?.date ?? ''}
                          onChange={(e) => setPhaseDateDraft(e.target.value)}
                          className="text-sm bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg px-2 py-0.5 text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-400"
                        />
                        <button
                          onClick={() => saveMilestoneDate(phase, phaseDateDraft)}
                          className="text-xs font-mono text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 px-1.5 py-0.5 transition-colors"
                        >
                          Save
                        </button>
                        {milestone?.date && (
                          <button
                            onClick={() => saveMilestoneDate(phase, '')}
                            className="text-xs font-mono text-zinc-400 hover:text-red-500 dark:hover:text-red-400 px-1.5 py-0.5 transition-colors"
                          >
                            Clear
                          </button>
                        )}
                        <button
                          onClick={() => setEditingPhase(null)}
                          className="text-xs font-mono text-zinc-300 dark:text-zinc-600 hover:text-zinc-500 dark:hover:text-zinc-400 px-1.5 py-0.5 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setPhaseDateDraft(milestone?.date ?? ''); setEditingPhase(phase); }}
                        className="text-left w-full group"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{MILESTONE_ICONS[phase]}</span>
                          <p className={`text-sm font-medium ${isDone ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 dark:text-zinc-600'} group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors`}>
                            {MILESTONE_LABELS[phase]}
                          </p>
                          {!isDone && (
                            <span className="text-[10px] font-mono text-zinc-300 dark:text-zinc-700 group-hover:text-zinc-400 dark:group-hover:text-zinc-500 transition-colors">+ date</span>
                          )}
                        </div>
                        {milestone?.date && (
                          <p className="text-[11px] font-mono text-zinc-400 dark:text-zinc-500 ml-6">{formatDate(milestone.date)}</p>
                        )}
                        {milestone?.notes && (
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 ml-6 mt-0.5">{milestone.notes}</p>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Summary */}
        <section>
          <h2 className="text-[10px] font-mono text-zinc-400 dark:text-zinc-600 uppercase tracking-widest mb-2">Summary</h2>
          {editingSummary ? (
            <div>
              <textarea
                autoFocus
                value={summaryDraft}
                onChange={(e) => setSummaryDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setEditingSummary(false); }}
                placeholder="Add a summary…"
                rows={3}
                className="w-full text-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3 py-2 text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-400 resize-none"
                disabled={saving}
              />
              <div className="flex gap-2 mt-1.5">
                <button onClick={saveSummary} className="text-xs font-mono text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 px-1.5 py-0.5 transition-colors">Save</button>
                <button onClick={() => setEditingSummary(false)} className="text-xs font-mono text-zinc-300 dark:text-zinc-600 hover:text-zinc-500 dark:hover:text-zinc-400 px-1.5 py-0.5 transition-colors">Cancel</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => { setSummaryDraft(project.summary ?? ''); setEditingSummary(true); }}
              className="text-left w-full group"
            >
              {project.summary ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-400 group-hover:text-zinc-700 dark:group-hover:text-zinc-300 transition-colors leading-relaxed">{project.summary}</p>
              ) : (
                <p className="text-sm text-zinc-300 dark:text-zinc-700 group-hover:text-zinc-400 dark:group-hover:text-zinc-500 transition-colors">+ summary</p>
              )}
            </button>
          )}
        </section>

        {/* Emails / captures */}
        {captures.length > 0 && (
          <section>
            <h2 className="text-[10px] font-mono text-zinc-400 dark:text-zinc-600 uppercase tracking-widest mb-3">
              Emails · {captures.length}
            </h2>
            <div className="space-y-2">
              {captures.map((cap) => {
                const cMeta = (cap.metadata ?? {}) as Record<string, unknown>;
                const subject = cMeta.subject as string | undefined;
                const sentDate = cMeta.sent_date as string | undefined;
                const phase = (cMeta.project_signal as { phase?: string } | undefined)?.phase;
                return (
                  <div key={cap.id} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        {subject && <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{subject}</p>}
                        <p className="text-xs text-zinc-400 dark:text-zinc-500 line-clamp-2 mt-0.5">{cap.summary || cap.transcript}</p>
                      </div>
                      <div className="text-right shrink-0">
                        {sentDate && <p className="text-[10px] font-mono text-zinc-400">{formatDate(sentDate)}</p>}
                        {phase && <p className="text-[10px] font-mono text-zinc-300 dark:text-zinc-600 mt-0.5">{phase}</p>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Delete */}
        <section className="pt-2">
          {confirmDelete ? (
            <div className="flex items-center justify-between bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/40 rounded-xl p-3">
              <span className="text-sm text-red-600 dark:text-red-400">Delete this project?</span>
              <div className="flex gap-2">
                <button onClick={() => setConfirmDelete(false)} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 px-2 py-1 transition-colors">Cancel</button>
                <button onClick={handleDelete} className="text-xs text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 font-medium px-2 py-1 transition-colors">Delete</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="text-xs font-mono text-zinc-300 dark:text-zinc-700 hover:text-red-500 dark:hover:text-red-500 transition-colors">
              Delete project
            </button>
          )}
        </section>

      </main>
      <BottomNav />
    </div>
  );
}
