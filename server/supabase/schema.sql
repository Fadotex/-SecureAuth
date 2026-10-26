-- Run once in the Supabase Dashboard SQL Editor.
-- The API server is the only application client. The browser never receives
-- the Supabase secret key and never queries these tables directly.

create table if not exists public.users (
  id uuid primary key,
  name text not null check (char_length(name) between 1 and 100),
  email text not null unique check (char_length(email) <= 254),
  password_hash text not null,
  salt text not null,
  role text not null check (role in ('inputer', 'manager', 'admin', 'administrator')),
  two_factor_enabled boolean not null default false,
  two_factor_secret_encrypted text,
  pending_two_factor_secret_encrypted text,
  created_at timestamptz not null default now()
);

create table if not exists public.records (
  id uuid primary key,
  resident_name text not null,
  student_id text not null,
  block text not null,
  room_details text not null,
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'approved', 'archived')),
  created_by uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key,
  user_id uuid references public.users(id) on delete set null,
  action text not null,
  details text,
  created_at timestamptz not null default now()
);

create table if not exists public.deleted_users (
  id uuid primary key,
  user_id uuid not null,
  email text not null,
  deleted_by uuid references public.users(id) on delete set null,
  deleted_at timestamptz not null default now(),
  reason text not null default 'manual-removal'
);

alter table public.users enable row level security;
alter table public.records enable row level security;
alter table public.audit_logs enable row level security;
alter table public.deleted_users enable row level security;

revoke all on table public.users from public, anon, authenticated;
revoke all on table public.records from public, anon, authenticated;
revoke all on table public.audit_logs from public, anon, authenticated;
revoke all on table public.deleted_users from public, anon, authenticated;
grant all on table public.users to service_role;
grant all on table public.records to service_role;
grant all on table public.audit_logs to service_role;
grant all on table public.deleted_users to service_role;
