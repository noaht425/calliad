-- Hide a contact inside Calliad without touching iCloud (a synced row would just
-- come back on the next sync).
alter table contacts add column if not exists hidden boolean not null default false;
create index if not exists idx_contacts_user_hidden on contacts (user_id, hidden);
