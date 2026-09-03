-- Where an event actually is. Resolved from the event's free-text `location`
-- (a venue name → its city) so Calliad can catch same-day plans that sit in
-- different cities. Calliad-owned: the iCloud sync upsert doesn't touch these,
-- and they're filled lazily (on create, or the first time a conflict check
-- geocodes an existing row).

alter table calendar_events add column if not exists city    text;
alter table calendar_events add column if not exists region  text;              -- state / province
alter table calendar_events add column if not exists country text;
alter table calendar_events add column if not exists lat     double precision;
alter table calendar_events add column if not exists lon     double precision;
alter table calendar_events add column if not exists geo_resolved_at timestamptz; -- last geocode attempt (success or give-up)
