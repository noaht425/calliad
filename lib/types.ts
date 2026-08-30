export type CaptureSource = 'pwa_button' | 'back_tap' | 'widget' | 'share' | 'alexa' | 'manual' | 'email' | 'chat' | 'assistant' | 'action' | 'photo';

export interface Unsubscribe {
  id: string;
  user_id: string;
  sender_name: string;
  sender_domain: string;
  sender_email: string | null;
  unsubscribed_at: string;
  last_marketing_email_at: string | null;
  created_at: string;
}
export type CaptureStatus = 'inbox' | 'archived' | 'tasked' | 'folder';
export type TranscriptionStatus = 'pending' | 'processing' | 'done' | 'error';

export interface Capture {
  id: string;
  user_id: string;
  raw_audio_url?: string;
  transcript: string;
  summary?: string;
  tags: string[];
  folder_id?: string | null;
  source: CaptureSource;
  location_lat?: number;
  location_lng?: number;
  location_label?: string;
  status: CaptureStatus;
  transcription_status: TranscriptionStatus;
  metadata?: Record<string, unknown> | null;
  trip_id?: string | null;
  project_id?: string | null;
  created_at: string;
  updated_at: string;
}

export type ProjectStatus = 'planning' | 'active' | 'completed' | 'archived';

export interface Milestone {
  phase: string;
  date: string | null;
  label: string;
  notes: string | null;
}

export interface Project {
  id: string;
  user_id: string;
  folder_id: string | null;
  title: string;
  company: string | null;
  project_tag: string | null;
  project_domain: string | null;
  status: ProjectStatus;
  start_date: string | null;
  end_date: string | null;
  summary: string | null;
  milestones: Milestone[];
  created_at: string;
  updated_at: string;
  capture_count?: number;
}

export interface Folder {
  id: string;
  user_id: string;
  name: string;
  color: string;
  icon: string;
  entity_type?: 'folder' | 'project';
  parent_folder_id?: string | null;
  created_at: string;
  capture_count?: number;
}

export type TripStatus = 'planned' | 'active' | 'completed' | 'archived';

export interface Trip {
  id: string;
  user_id: string;
  folder_id?: string | null;
  title: string;
  destination?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  travelers: string[];
  status: TripStatus;
  summary?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// Offline queue entry (IndexedDB)
export interface QueuedCapture {
  local_id: string;           // client-generated uuid
  audio_blob: Blob;
  source: CaptureSource;
  location_lat?: number;
  location_lng?: number;
  location_label?: string;
  created_at: string;
  synced: boolean;
}
