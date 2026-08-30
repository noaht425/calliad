import { supabase } from './supabase';
import type { Capture, CaptureSource, Folder, Trip, Project, Unsubscribe } from './types';

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function uploadCapture(
  audioBlob: Blob,
  source: CaptureSource,
  location?: { lat: number; lng: number; label?: string }
): Promise<Capture> {
  const form = new FormData();
  const ext = audioBlob.type.includes('mp4') ? 'mp4' : 'webm';
  form.append('audio', audioBlob, `capture.${ext}`);
  form.append('source', source);
  if (location) {
    form.append('location_lat', String(location.lat));
    form.append('location_lng', String(location.lng));
    if (location.label) form.append('location_label', location.label);
  }

  const res = await fetch('/api/captures', {
    method: 'POST',
    headers: await authHeaders(),
    body: form,
  });
  if (!res.ok) throw new Error('Upload failed');
  return res.json();
}

export async function triggerTranscription(captureId: string): Promise<Capture | { deleted: true }> {
  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ capture_id: captureId }),
  });
  if (!res.ok) throw new Error('Transcription failed');
  return res.json();
}

export async function listCaptures(status = 'inbox'): Promise<Capture[]> {
  const res = await fetch(`/api/captures?status=${status}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error('Fetch failed');
  return res.json();
}

export async function updateCapture(
  id: string,
  patch: Partial<Pick<Capture, 'status' | 'folder_id' | 'trip_id' | 'tags'>>
): Promise<Capture> {
  const res = await fetch(`/api/captures/${id}`, {
    method: 'PATCH',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error('Update failed');
  return res.json();
}

export async function deleteCapture(id: string): Promise<void> {
  const res = await fetch(`/api/captures/${id}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!res.ok && res.status !== 204) throw new Error('Delete failed');
}

export async function listFolders(): Promise<Folder[]> {
  const res = await fetch('/api/folders', { headers: await authHeaders() });
  if (!res.ok) throw new Error('Fetch failed');
  return res.json();
}

export async function createFolder(p: { name: string; color: string; icon: string }): Promise<Folder> {
  const res = await fetch('/api/folders', {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify(p),
  });
  if (!res.ok) throw new Error('Create failed');
  return res.json();
}

export async function updateFolder(
  id: string,
  patch: Partial<Pick<Folder, 'name' | 'color' | 'icon'>>
): Promise<Folder> {
  const res = await fetch(`/api/folders/${id}`, {
    method: 'PATCH',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error('Update failed');
  return res.json();
}

export async function deleteFolder(id: string): Promise<void> {
  const res = await fetch(`/api/folders/${id}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!res.ok && res.status !== 204) throw new Error('Delete failed');
}

export async function listFolderCaptures(folderId: string): Promise<Capture[]> {
  const res = await fetch(`/api/captures?status=folder&folder_id=${folderId}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error('Fetch failed');
  return res.json();
}

export async function fileCapture(captureId: string, folderId: string): Promise<Capture> {
  return updateCapture(captureId, { status: 'folder', folder_id: folderId });
}

export async function fileCaptureToTrip(captureId: string, tripId: string): Promise<Capture> {
  return updateCapture(captureId, { status: 'archived', trip_id: tripId });
}

export async function sendChatMessage(
  text: string,
  actionCardId?: string
): Promise<{ userCapture: Capture; assistantCapture: Capture; curationResolved?: boolean; updatedCurationCard?: Capture }> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, action_card_id: actionCardId }),
  });
  if (!res.ok) throw new Error('Chat failed');
  return res.json();
}

export async function listTrips(includeArchived = false): Promise<Trip[]> {
  const res = await fetch(`/api/trips${includeArchived ? '?archived=true' : ''}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error('Fetch failed');
  return res.json();
}

export async function getTrip(id: string): Promise<{ trip: Trip; captures: Capture[] }> {
  const res = await fetch(`/api/trips/${id}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error('Fetch failed');
  return res.json();
}

export async function updateTrip(id: string, patch: Partial<Pick<Trip, 'status' | 'title' | 'summary'>>): Promise<Trip> {
  const res = await fetch(`/api/trips/${id}`, {
    method: 'PATCH',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error('Update failed');
  return res.json();
}

export async function sendPhotoCapture(
  file: File,
  location?: { lat: number; lng: number } | null
): Promise<{ photoCap: Capture; actionCard: Capture }> {
  const form = new FormData();
  form.append('image', file);
  if (location) {
    form.append('lat', String(location.lat));
    form.append('lng', String(location.lng));
  }
  const res = await fetch('/api/photo', {
    method: 'POST',
    headers: await authHeaders(),
    body: form,
  });
  if (!res.ok) throw new Error('Photo upload failed');
  return res.json();
}

export async function searchCaptures(q: string): Promise<Capture[]> {
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error('Search failed');
  const data = await res.json();
  return data.results;
}

export async function listProjects(): Promise<Project[]> {
  const res = await fetch('/api/projects', { headers: await authHeaders() });
  if (!res.ok) throw new Error('Failed to list projects');
  return res.json();
}

export async function getProject(id: string): Promise<{ project: Project; captures: Capture[] }> {
  const res = await fetch(`/api/projects/${id}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error('Failed to get project');
  return res.json();
}

export async function updateProject(id: string, patch: Partial<Pick<Project, 'title' | 'company' | 'project_tag' | 'project_domain' | 'status' | 'start_date' | 'end_date' | 'summary' | 'milestones'>>): Promise<Project> {
  const res = await fetch(`/api/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...await authHeaders() },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error('Failed to update project');
  return res.json();
}

export async function deleteProject(id: string): Promise<void> {
  await fetch(`/api/projects/${id}`, { method: 'DELETE', headers: await authHeaders() });
}

export async function assessProject(id: string): Promise<{ project: Project; filed: number }> {
  const res = await fetch(`/api/projects/${id}/assess`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? 'Assessment failed');
  }
  return res.json();
}

export async function listUnsubscribes(): Promise<Unsubscribe[]> {
  const res = await fetch('/api/unsubscribes', { headers: await authHeaders() });
  if (!res.ok) throw new Error('Fetch failed');
  return res.json();
}

export async function createUnsubscribe(data: {
  sender_name: string;
  sender_domain: string;
  sender_email?: string;
  unsubscribed_at?: string;
}): Promise<Unsubscribe> {
  const res = await fetch('/api/unsubscribes', {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? 'Create failed');
  return body;
}

export async function deleteUnsubscribe(id: string): Promise<void> {
  await fetch(`/api/unsubscribes/${id}`, { method: 'DELETE', headers: await authHeaders() });
}

export async function scanInboxForUnsubscribes(): Promise<{ scanned: number; detected: number; archived: number }> {
  const res = await fetch('/api/unsubscribes/scan', {
    method: 'POST',
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error('Scan failed');
  return res.json();
}

export async function confirmProjectSuggestion(captureId: string): Promise<Folder> {
  const res = await fetch('/api/project-suggestion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...await authHeaders() },
    body: JSON.stringify({ capture_id: captureId }),
  });
  if (!res.ok) throw new Error('Failed to create project folder');
  const data = await res.json();
  return data.folder;
}
