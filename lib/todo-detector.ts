import { adminClient } from './supabase.server';

export interface TodoExtraction {
  is_todo: boolean;
  text: string;
  extracted_date: string | null;
  extracted_time: string | null;
}

export async function findOrCreateTodoFolder(userId: string): Promise<string | null> {
  const { data: existing } = await adminClient
    .from('folders')
    .select('id')
    .eq('user_id', userId)
    .ilike('name', '%to-do%')
    .limit(1)
    .maybeSingle();

  if (existing) return existing.id;

  // Auto-create the To-Do folder if it doesn't exist
  const { data: created } = await adminClient
    .from('folders')
    .insert({
      user_id: userId,
      name: 'To-Do',
      color: 'orange',
      icon: '✅',
      entity_type: 'folder',
    })
    .select('id')
    .single();

  return created?.id ?? null;
}

export async function maybeCreateTodoCurationCard(
  userId: string,
  sourceCaptureId: string,
  todo: TodoExtraction
): Promise<void> {
  console.log('[todo] called: is_todo=', todo.is_todo, 'text=', todo.text);
  if (!todo.is_todo || !todo.text?.trim()) return;

  // Dedup: one todo per source capture
  const { data: existing } = await adminClient
    .from('captures')
    .select('id')
    .eq('user_id', userId)
    .eq('source', 'assistant')
    .eq('status', 'folder')
    .contains('metadata', { source_capture_id: sourceCaptureId })
    .maybeSingle();

  if (existing) { console.log('[todo] duplicate, skipping'); return; }

  const todoProjectId = await findOrCreateTodoFolder(userId);
  console.log('[todo] project id:', todoProjectId);
  if (!todoProjectId) return;

  let remind_at: string | null = null;
  if (todo.extracted_date) {
    remind_at = todo.extracted_date;
    if (todo.extracted_time && !['morning', 'afternoon', 'evening'].includes(todo.extracted_time)) {
      remind_at = `${todo.extracted_date}T${todo.extracted_time}:00`;
    }
  }

  // Auto-add directly to To-Do folder — no curation card needed
  const { error: insertErr } = await adminClient.from('captures').insert({
    user_id: userId,
    source: 'assistant',
    transcript: todo.text,
    summary: todo.text,
    tags: ['todo'],
    status: 'folder',
    folder_id: todoProjectId,
    transcription_status: 'done',
    metadata: {
      source_capture_id: sourceCaptureId,
      ...(remind_at ? { remind_at } : {}),
    },
  });

  if (insertErr) {
    console.error('[todo] insert failed:', insertErr.message);
    return;
  }

  // Archive the original voice note now that the todo is confirmed created
  await adminClient.from('captures')
    .update({ status: 'archived' })
    .eq('id', sourceCaptureId)
    .eq('user_id', userId);

  console.log('[todo] created and source archived:', sourceCaptureId);
}

// Called by Intelligence Sync to promote reminder-due todos to inbox
export async function promoteScheduledTodos(userId: string): Promise<number> {
  const now = new Date().toISOString();

  // Find folder captures in any To-Do folder where remind_at has passed
  const { data: todoCaps } = await adminClient
    .from('captures')
    .select('id, transcript, metadata')
    .eq('user_id', userId)
    .eq('status', 'folder')
    .eq('source', 'assistant')
    .contains('tags', ['todo']);

  let promoted = 0;
  for (const cap of todoCaps ?? []) {
    const meta = (cap.metadata ?? {}) as Record<string, unknown>;
    const remindAt = meta.remind_at as string | undefined;
    if (!remindAt || remindAt > now) continue;

    // Create a reminder in inbox and clear remind_at
    await Promise.all([
      adminClient.from('captures').insert({
        user_id: userId,
        source: 'assistant',
        transcript: `Reminder: ${cap.transcript}`,
        summary: `Reminder: ${cap.transcript}`,
        tags: ['todo', 'reminder'],
        status: 'inbox',
        transcription_status: 'done',
      }),
      adminClient.from('captures').update({
        metadata: { ...meta, remind_at: null },
      }).eq('id', cap.id),
    ]);
    promoted++;
  }
  return promoted;
}
