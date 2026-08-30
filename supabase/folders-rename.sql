-- Rename projects table to folders
alter table projects rename to folders;

-- Rename the primary key constraint
alter table folders rename constraint projects_pkey to folders_pkey;

-- Update the RLS policy
drop policy if exists "Users access own projects" on folders;
create policy "Users access own folders" on folders
  for all using (auth.uid() = user_id);

-- Rename project_id column on captures to folder_id
alter table captures rename column project_id to folder_id;

-- Update the foreign key constraint
alter table captures drop constraint if exists captures_project_id_fkey;
alter table captures add constraint captures_folder_id_fkey
  foreign key (folder_id) references folders(id) on delete set null;

-- Update the status check constraint to replace 'project' with 'folder'
alter table captures drop constraint if exists captures_status_check;
alter table captures add constraint captures_status_check
  check (status in ('inbox','archived','tasked','folder'));

-- Migrate existing data: rename status value
update captures set status = 'folder' where status = 'project';

-- Update the source check constraint to include all source values used in code
alter table captures drop constraint if exists captures_source_check;
alter table captures add constraint captures_source_check
  check (source in (
    'pwa_button','back_tap','widget','share','alexa','manual',
    'email','sent_email',
    'voice','chat','assistant','action'
  ));
