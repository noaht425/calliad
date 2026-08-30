-- Run this in Supabase SQL Editor AFTER profile-schema.sql
-- (If profile-schema.sql hasn't been run yet, run it first to create the connected_services table)

alter table connected_services add column if not exists metadata jsonb;
