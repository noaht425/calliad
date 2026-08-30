-- Add 'email' as a valid capture source
alter table captures drop constraint if exists captures_source_check;
alter table captures add constraint captures_source_check
  check (source in ('pwa_button','back_tap','widget','share','alexa','manual','email'));

-- Add metadata column to captures for structured extraction results (calendar events, etc.)
alter table captures add column if not exists metadata jsonb;
