-- BSB IMS · M0 · Core: organisasi, pengguna, RBAC + scope, audit log, lampiran
-- Konvensi: PK uuid, nomor bisnis bukan PK, semua perubahan penting tercatat di audit_logs.

create extension if not exists pgcrypto;

create schema if not exists app;
grant usage on schema app to authenticated, anon;

-- ---------------------------------------------------------------- helpers
create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

-- ---------------------------------------------------------------- pengaturan
create table public.app_settings(
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- ---------------------------------------------------------------- organisasi
create table public.sites(
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{2,10}$'),
  name text not null,
  client_company text,
  timezone text not null default 'Asia/Makassar',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.departments(
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z]{2,6}$'),
  name text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.sections(
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id),
  code text not null check (code ~ '^[A-Z]{2,6}$'),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (department_id, code)
);

create table public.positions(
  id uuid primary key default gen_random_uuid(),
  department_id uuid references public.departments(id),
  code text not null,
  name text not null,
  level text not null check (level in ('PJO','DH','SH','SPV','FOR','STAFF','OPR')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (department_id, code)
);

create table public.work_areas(
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id),
  code text not null,
  name text not null,
  area_type text not null default 'area' check (area_type in ('pit','hauling_road','port','workshop','office','mess','area')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (site_id, code)
);

-- ---------------------------------------------------------------- pengguna
-- Akun baru hanya aktif otomatis jika domainnya diizinkan atau emailnya ada di allowlist.
create table public.allowed_domains(
  domain text primary key check (domain = lower(domain)),
  note text,
  created_at timestamptz not null default now()
);

create table public.allowed_emails(
  email text primary key check (email = lower(email)),
  initial_role text,
  note text,
  created_at timestamptz not null default now()
);

create table public.profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  nik text unique,
  site_id uuid references public.sites(id),
  department_id uuid references public.departments(id),
  section_id uuid references public.sections(id),
  position_id uuid references public.positions(id),
  status text not null default 'pending' check (status in ('pending','active','suspended','exited')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.roles(
  code text primary key check (code ~ '^[A-Z_]{2,30}$'),
  name text not null,
  description text,
  is_system boolean not null default false
);

create table public.permissions(
  code text primary key check (code ~ '^[a-z_]+\.[a-z_]+$'),
  module text not null,
  description text not null
);

create table public.role_permissions(
  role_code text not null references public.roles(code) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_code, permission_code)
);

-- Scope: site_id / department_id null = berlaku untuk semua.
create table public.user_roles(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_code text not null references public.roles(code),
  site_id uuid references public.sites(id),
  department_id uuid references public.departments(id),
  valid_from date not null default current_date,
  valid_until date,
  basis text,                       -- dasar penunjukan, mis. nomor SK
  granted_by uuid references public.profiles(id),
  granted_at timestamptz not null default now(),
  check (valid_until is null or valid_until >= valid_from),
  unique nulls not distinct (user_id, role_code, site_id, department_id)
);
create index user_roles_user_idx on public.user_roles(user_id);

create or replace function app.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and status = 'active')
$$;

create or replace function app.has_permission(p_perm text, p_department uuid default null, p_site uuid default null)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1
      from public.user_roles ur
      join public.role_permissions rp on rp.role_code = ur.role_code
      join public.profiles p on p.id = ur.user_id
     where ur.user_id = auth.uid()
       and p.status = 'active'
       and rp.permission_code = p_perm
       and current_date >= ur.valid_from
       and (ur.valid_until is null or current_date <= ur.valid_until)
       and (ur.department_id is null or ur.department_id = p_department)
       and (ur.site_id is null or ur.site_id = p_site)
  )
$$;

-- Daftar izin efektif pengguna yang sedang login (dipakai UI untuk menampilkan menu).
create or replace function public.my_permissions()
returns table(permission_code text, site_id uuid, department_id uuid)
language sql stable security definer set search_path = public as $$
  select distinct rp.permission_code, ur.site_id, ur.department_id
    from public.user_roles ur
    join public.role_permissions rp on rp.role_code = ur.role_code
    join public.profiles p on p.id = ur.user_id
   where ur.user_id = auth.uid()
     and p.status = 'active'
     and current_date >= ur.valid_from
     and (ur.valid_until is null or current_date <= ur.valid_until)
$$;

create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(new.email);
  v_domain text := split_part(lower(new.email), '@', 2);
  v_allow public.allowed_emails;
  v_active boolean;
begin
  select * into v_allow from public.allowed_emails where email = v_email;
  v_active := v_allow.email is not null
              or exists(select 1 from public.allowed_domains where domain = v_domain);
  insert into public.profiles(id, email, full_name, status)
  values (new.id, v_email,
          coalesce(nullif(new.raw_user_meta_data->>'full_name',''), nullif(new.raw_user_meta_data->>'name',''), split_part(v_email,'@',1)),
          case when v_active then 'active' else 'pending' end)
  on conflict (id) do nothing;
  if v_allow.initial_role is not null then
    insert into public.user_roles(user_id, role_code, basis)
    values (new.id, v_allow.initial_role, 'allowlist awal')
    on conflict do nothing;
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------- audit log (append-only)
create table public.audit_logs(
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid references public.profiles(id),
  action text not null,                 -- INSERT / UPDATE / DELETE / atau aksi bisnis mis. 'document.approve'
  table_name text,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  context jsonb
);
create index audit_logs_record_idx on public.audit_logs(table_name, record_id);
create index audit_logs_actor_idx on public.audit_logs(actor_id, occurred_at desc);

create or replace function app.audit_logs_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_logs bersifat append-only' using errcode = '42501';
end $$;
create trigger audit_logs_no_update before update or delete on public.audit_logs
  for each row execute function app.audit_logs_immutable();
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function app.audit_logs_immutable();

create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
begin
  if tg_op = 'UPDATE' and v_old = v_new then return new; end if;
  insert into public.audit_logs(actor_id, action, table_name, record_id, old_data, new_data)
  values (auth.uid(), tg_op, tg_table_name,
          coalesce(v_new->>'id', v_old->>'id', v_new->>'code', v_old->>'code', v_new->>'key', v_old->>'key'),
          v_old, v_new);
  return coalesce(new, old);
end $$;

-- Catat aksi bisnis (approve, release, void, dst.) dari fungsi lain.
create or replace function app.log_event(p_action text, p_table text, p_record text, p_context jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_logs(actor_id, action, table_name, record_id, context)
  values (auth.uid(), p_action, p_table, p_record, p_context)
$$;

-- ---------------------------------------------------------------- lampiran
create table public.attachments(
  id uuid primary key default gen_random_uuid(),
  bucket text not null default 'records',
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  owner_table text,
  owner_id uuid,
  classification text not null default 'internal' check (classification in ('internal','restricted','confidential')),
  uploaded_by uuid references public.profiles(id) default auth.uid(),
  uploaded_at timestamptz not null default now(),
  unique (bucket, storage_path)
);
create index attachments_owner_idx on public.attachments(owner_table, owner_id);

-- ---------------------------------------------------------------- triggers
do $$
declare t text;
begin
  foreach t in array array['sites','departments','sections','positions','work_areas','profiles'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['sites','departments','sections','positions','work_areas','profiles',
                           'roles','role_permissions','user_roles','allowed_domains','allowed_emails','app_settings','attachments'] loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
  end loop;
end $$;
