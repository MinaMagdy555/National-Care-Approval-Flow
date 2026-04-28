create table if not exists public.approval_tasks (
  id text primary key,
  payload jsonb not null,
  environment text not null,
  created_by text not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.approval_notifications (
  id text primary key,
  user_id text not null,
  task_id text not null,
  read boolean not null default false,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists approval_tasks_environment_idx on public.approval_tasks (environment);
create index if not exists approval_tasks_status_idx on public.approval_tasks (status);
create index if not exists approval_notifications_user_id_idx on public.approval_notifications (user_id);

insert into storage.buckets (id, name, public)
values ('task-files', 'task-files', true)
on conflict (id) do update set public = true;

update storage.buckets
set
  public = true,
  file_size_limit = 209715200,
  allowed_mime_types = array['image/png', 'image/jpeg', 'video/mp4', 'application/pdf']
where id = 'task-files';

alter table public.approval_tasks enable row level security;
alter table public.approval_notifications enable row level security;

drop policy if exists "Allow public app reads tasks" on public.approval_tasks;
drop policy if exists "Allow public app writes tasks" on public.approval_tasks;
drop policy if exists "Allow public app reads notifications" on public.approval_notifications;
drop policy if exists "Allow public app writes notifications" on public.approval_notifications;

create policy "Allow public app reads tasks"
on public.approval_tasks for select
to anon
using (true);

create policy "Allow public app writes tasks"
on public.approval_tasks for all
to anon
using (true)
with check (true);

create policy "Allow public app reads notifications"
on public.approval_notifications for select
to anon
using (true);

create policy "Allow public app writes notifications"
on public.approval_notifications for all
to anon
using (true)
with check (true);

drop policy if exists "Allow public task file reads" on storage.objects;
drop policy if exists "Allow public task file writes" on storage.objects;

create policy "Allow public task file reads"
on storage.objects for select
to anon
using (bucket_id = 'task-files');

create policy "Allow public task file writes"
on storage.objects for all
to anon
using (bucket_id = 'task-files')
with check (bucket_id = 'task-files');

do $$
begin
  alter publication supabase_realtime add table public.approval_tasks;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.approval_notifications;
exception
  when duplicate_object then null;
end $$;
