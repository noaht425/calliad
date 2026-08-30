'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { listFolders } from '@/lib/api';
import { colorBg } from '@/lib/projectColors';
import { BottomNav } from '@/components/BottomNav';
import type { Folder } from '@/lib/types';

export default function ProjectsPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [projects, setProjects] = useState<Folder[]>([]);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    if (!loading && !session) router.push('/login');
  }, [loading, session, router]);

  const load = useCallback(async () => {
    setFetching(true);
    try {
      const all = await listFolders();
      setProjects(all.filter((f) => f.entity_type !== 'folder'));
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => { if (session) load(); }, [session, load]);

  if (loading || !session) {
    return (
      <div className="min-h-screen bg-[#fafaf8] dark:bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 animate-spin" />
      </div>
    );
  }

  const topLevel = projects.filter((p) => !p.parent_folder_id);
  const childrenMap = new Map<string, Folder[]>();
  for (const child of projects.filter((p) => p.parent_folder_id)) {
    const arr = childrenMap.get(child.parent_folder_id!) ?? [];
    arr.push(child);
    childrenMap.set(child.parent_folder_id!, arr);
  }

  return (
    <div className="min-h-screen bg-[#fafaf8] dark:bg-[#0a0a0a]">
      <header className="sticky top-0 z-10 bg-[#fafaf8]/80 dark:bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-zinc-200/60 dark:border-zinc-800/60 px-4 py-3">
        <div className="max-w-xl mx-auto flex items-center gap-3">
          <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex-1">Projects</h1>
          <span className="text-[11px] font-mono text-zinc-400 dark:text-zinc-600">{topLevel.length} project{topLevel.length !== 1 ? 's' : ''}</span>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 pt-4 pb-32 space-y-2">
        {fetching ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 animate-spin" />
          </div>
        ) : topLevel.length === 0 ? (
          <p className="text-center text-zinc-400 dark:text-zinc-600 text-sm py-12">No projects yet.</p>
        ) : (
          topLevel.map((project) => {
            const children = childrenMap.get(project.id) ?? [];
            return (
              <div key={project.id} className="space-y-1">
                <button
                  onClick={() => router.push(project.entity_type === 'project' ? `/projects/${project.id}` : `/folders/${project.id}`)}
                  className="w-full text-left bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 flex items-center gap-3 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors">
                  <div className={`w-9 h-9 rounded-xl ${colorBg(project.color)} flex items-center justify-center text-base shrink-0`}>{project.icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{project.name}</p>
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500 font-mono">
                      {children.length > 0
                        ? `${children.length} sub-project${children.length === 1 ? '' : 's'}`
                        : project.capture_count === 0 ? 'empty' : `${project.capture_count} item${project.capture_count === 1 ? '' : 's'}`}
                    </p>
                  </div>
                  <svg className="w-4 h-4 text-zinc-300 dark:text-zinc-700 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
                {children.length > 0 && (
                  <div className="ml-6 space-y-1">
                    {children.map((child) => (
                      <button key={child.id}
                        onClick={() => router.push(child.entity_type === 'project' ? `/projects/${child.id}` : `/folders/${child.id}`)}
                        className="w-full text-left bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex items-center gap-3 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors">
                        <div className={`w-7 h-7 rounded-lg ${colorBg(child.color)} flex items-center justify-center text-sm shrink-0`}>{child.icon}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{child.name}</p>
                          <p className="text-[11px] text-zinc-400 dark:text-zinc-500 font-mono">
                            {child.capture_count === 0 ? 'empty' : `${child.capture_count} item${child.capture_count === 1 ? '' : 's'}`}
                          </p>
                        </div>
                        <svg className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-700 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </main>

      <BottomNav />
    </div>
  );
}
