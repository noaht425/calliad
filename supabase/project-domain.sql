-- Add sender domain matching to projects
-- Run in Supabase SQL editor

alter table projects add column if not exists project_domain text;
