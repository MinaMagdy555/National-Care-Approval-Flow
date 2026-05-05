create schema if not exists app_private;

create table if not exists app_private.settings (
  key text primary key,
  value text not null
);

insert into app_private.settings (key, value)
values ('bootstrap_admin_email', 'minamagdy5555@gmail.com')
on conflict (key) do nothing;

create table if not exists public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  name text not null default 'New user',
  role text not null default 'team_member'
    check (role in ('team_member', 'reviewer', 'art_director', 'team_leader', 'admin')),
  requested_role text not null default 'team_member'
    check (requested_role in ('team_member', 'reviewer', 'art_director', 'team_leader', 'admin')),
  approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected')),
  is_admin boolean not null default false,
  legacy_id text unique,
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create index if not exists user_profiles_email_idx on public.user_profiles (lower(email));
create index if not exists user_profiles_approval_status_idx on public.user_profiles (approval_status);
create index if not exists user_profiles_legacy_id_idx on public.user_profiles (legacy_id);
create index if not exists approval_tasks_environment_idx on public.approval_tasks (environment);
create index if not exists approval_tasks_status_idx on public.approval_tasks (status);
create index if not exists approval_notifications_user_id_idx on public.approval_notifications (user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_profiles_updated_at on public.user_profiles;
create trigger set_user_profiles_updated_at
before update on public.user_profiles
for each row execute function public.set_updated_at();

create or replace function app_private.is_approved_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles
    where id = auth.uid()
      and approval_status = 'approved'
  );
$$;

create or replace function app_private.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles
    where id = auth.uid()
      and approval_status = 'approved'
      and (is_admin = true or role = 'admin')
  );
$$;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  bootstrap_email text;
  requested_role_value text;
  display_name text;
  user_email text;
  is_bootstrap_admin boolean;
begin
  bootstrap_email := lower(coalesce((
    select value
    from app_private.settings
    where key = 'bootstrap_admin_email'
    limit 1
  ), ''));

  requested_role_value := coalesce(new.raw_user_meta_data ->> 'requested_role', 'team_member');
  if requested_role_value not in ('team_member', 'reviewer', 'art_director', 'team_leader', 'admin') then
    requested_role_value := 'team_member';
  end if;

  user_email := lower(coalesce(new.email, ''));
  display_name := nullif(trim(coalesce(
    new.raw_user_meta_data ->> 'name',
    new.raw_user_meta_data ->> 'full_name',
    split_part(user_email, '@', 1),
    'New user'
  )), '');
  is_bootstrap_admin := bootstrap_email <> '' and user_email = bootstrap_email;

  insert into public.user_profiles (
    id,
    email,
    name,
    role,
    requested_role,
    approval_status,
    is_admin,
    approved_by,
    approved_at
  )
  values (
    new.id,
    user_email,
    coalesce(display_name, 'New user'),
    case when is_bootstrap_admin then 'reviewer' else 'team_member' end,
    requested_role_value,
    case when is_bootstrap_admin then 'approved' else 'pending' end,
    is_bootstrap_admin,
    case when is_bootstrap_admin then new.id else null end,
    case when is_bootstrap_admin then now() else null end
  )
  on conflict (id) do update
  set
    email = excluded.email,
    name = coalesce(nullif(public.user_profiles.name, 'New user'), excluded.name),
    updated_at = now();

  return new;
end;
$$;

create or replace function public.ensure_current_user_profile()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
  auth_user auth.users%rowtype;
  bootstrap_email text;
  requested_role_value text;
  display_name text;
  user_email text;
  is_bootstrap_admin boolean;
begin
  current_user_id := auth.uid();
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select *
  into auth_user
  from auth.users
  where id = current_user_id;

  if auth_user.id is null then
    raise exception 'Authenticated user record was not found';
  end if;

  bootstrap_email := lower(coalesce((
    select value
    from app_private.settings
    where key = 'bootstrap_admin_email'
    limit 1
  ), ''));

  requested_role_value := coalesce(auth_user.raw_user_meta_data ->> 'requested_role', 'team_member');
  if requested_role_value not in ('team_member', 'reviewer', 'art_director', 'team_leader', 'admin') then
    requested_role_value := 'team_member';
  end if;

  user_email := lower(coalesce(auth_user.email, ''));
  display_name := nullif(trim(coalesce(
    auth_user.raw_user_meta_data ->> 'name',
    auth_user.raw_user_meta_data ->> 'full_name',
    split_part(user_email, '@', 1),
    'New user'
  )), '');
  is_bootstrap_admin := bootstrap_email <> '' and user_email = bootstrap_email;

  insert into public.user_profiles (
    id,
    email,
    name,
    role,
    requested_role,
    approval_status,
    is_admin,
    approved_by,
    approved_at
  )
  values (
    auth_user.id,
    user_email,
    coalesce(display_name, 'New user'),
    case when is_bootstrap_admin then 'reviewer' else 'team_member' end,
    requested_role_value,
    case when is_bootstrap_admin then 'approved' else 'pending' end,
    is_bootstrap_admin,
    case when is_bootstrap_admin then auth_user.id else null end,
    case when is_bootstrap_admin then now() else null end
  )
  on conflict (id) do nothing;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_user_profile();

insert into public.user_profiles (
  id,
  email,
  name,
  role,
  requested_role,
  approval_status,
  is_admin,
  approved_by,
  approved_at
)
select
  users.id,
  lower(coalesce(users.email, '')),
  coalesce(nullif(trim(coalesce(
    users.raw_user_meta_data ->> 'name',
    users.raw_user_meta_data ->> 'full_name',
    split_part(lower(coalesce(users.email, '')), '@', 1)
  )), ''), 'New user'),
  case
    when lower(coalesce(users.email, '')) = lower(coalesce(settings.value, '')) then 'reviewer'
    else 'team_member'
  end,
  case
    when users.raw_user_meta_data ->> 'requested_role' in ('team_member', 'reviewer', 'art_director', 'team_leader', 'admin')
      then users.raw_user_meta_data ->> 'requested_role'
    else 'team_member'
  end,
  case
    when lower(coalesce(users.email, '')) = lower(coalesce(settings.value, '')) then 'approved'
    else 'pending'
  end,
  lower(coalesce(users.email, '')) = lower(coalesce(settings.value, '')),
  case
    when lower(coalesce(users.email, '')) = lower(coalesce(settings.value, '')) then users.id
    else null
  end,
  case
    when lower(coalesce(users.email, '')) = lower(coalesce(settings.value, '')) then now()
    else null
  end
from auth.users
left join app_private.settings settings on settings.key = 'bootstrap_admin_email'
on conflict (id) do nothing;

update public.user_profiles profile
set
  role = 'reviewer',
  requested_role = 'reviewer',
  approval_status = 'approved',
  is_admin = true,
  approved_by = profile.id,
  approved_at = coalesce(profile.approved_at, now()),
  updated_at = now()
from app_private.settings settings
where settings.key = 'bootstrap_admin_email'
  and lower(profile.email) = lower(settings.value)
  and settings.value <> '';

insert into storage.buckets (id, name, public)
values ('task-files', 'task-files', true)
on conflict (id) do update set public = true;

update storage.buckets
set
  public = true,
  file_size_limit = 209715200,
  allowed_mime_types = array['image/png', 'image/jpeg', 'video/mp4', 'application/pdf']
where id = 'task-files';

alter table public.user_profiles enable row level security;
alter table public.approval_tasks enable row level security;
alter table public.approval_notifications enable row level security;

revoke all on public.user_profiles from anon;
revoke all on public.approval_tasks from anon;
revoke all on public.approval_notifications from anon;

grant usage on schema public to anon, authenticated;
grant select, update on public.user_profiles to authenticated;
grant select, insert, update, delete on public.approval_tasks to authenticated;
grant select, insert, update, delete on public.approval_notifications to authenticated;
grant usage on schema app_private to anon, authenticated;
grant execute on all functions in schema app_private to anon, authenticated;
grant execute on function public.ensure_current_user_profile() to authenticated;

drop policy if exists "Users can read own profile" on public.user_profiles;
drop policy if exists "Approved users can read approved profiles" on public.user_profiles;
drop policy if exists "Admins can read all profiles" on public.user_profiles;
drop policy if exists "Pending users can update own profile request" on public.user_profiles;
drop policy if exists "Admins can update profiles" on public.user_profiles;

create policy "Users can read own profile"
on public.user_profiles for select
to authenticated
using (id = auth.uid());

create policy "Approved users can read approved profiles"
on public.user_profiles for select
to authenticated
using (approval_status = 'approved' and app_private.is_approved_user());

create policy "Admins can read all profiles"
on public.user_profiles for select
to authenticated
using (app_private.is_admin_user());

create policy "Pending users can update own profile request"
on public.user_profiles for update
to authenticated
using (id = auth.uid() and approval_status in ('pending', 'rejected'))
with check (
  id = auth.uid()
  and approval_status in ('pending', 'rejected')
  and role = 'team_member'
  and is_admin = false
  and legacy_id is null
  and approved_by is null
  and approved_at is null
);

create policy "Admins can update profiles"
on public.user_profiles for update
to authenticated
using (app_private.is_admin_user())
with check (app_private.is_admin_user());

drop policy if exists "Allow public app reads tasks" on public.approval_tasks;
drop policy if exists "Allow public app writes tasks" on public.approval_tasks;
drop policy if exists "Allow public app reads notifications" on public.approval_notifications;
drop policy if exists "Allow public app writes notifications" on public.approval_notifications;
drop policy if exists "Approved users can use tasks" on public.approval_tasks;
drop policy if exists "Approved users can use notifications" on public.approval_notifications;

create policy "Approved users can use tasks"
on public.approval_tasks for all
to authenticated
using (app_private.is_approved_user())
with check (app_private.is_approved_user());

create policy "Approved users can use notifications"
on public.approval_notifications for all
to authenticated
using (app_private.is_approved_user())
with check (app_private.is_approved_user());

drop policy if exists "Allow public task file reads" on storage.objects;
drop policy if exists "Allow public task file writes" on storage.objects;
drop policy if exists "Public task file reads" on storage.objects;
drop policy if exists "Approved users can upload task files" on storage.objects;
drop policy if exists "Approved users can update task files" on storage.objects;
drop policy if exists "Approved users can delete task files" on storage.objects;

create policy "Public task file reads"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'task-files');

create policy "Approved users can upload task files"
on storage.objects for insert
to authenticated
with check (bucket_id = 'task-files' and app_private.is_approved_user());

create policy "Approved users can update task files"
on storage.objects for update
to authenticated
using (bucket_id = 'task-files' and app_private.is_approved_user())
with check (bucket_id = 'task-files' and app_private.is_approved_user());

create policy "Approved users can delete task files"
on storage.objects for delete
to authenticated
using (bucket_id = 'task-files' and app_private.is_approved_user());

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

notify pgrst, 'reload schema';
