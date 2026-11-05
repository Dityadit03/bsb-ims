-- Isolasi data per site. Admin sistem dan pengguna HO (site berjenis 'ho') dapat berpindah site aktif; pengguna lain terkunci di site asalnya.
-- Mekanisme: kolom site_id + kebijakan RESTRICTIVE (dikalikan AND dengan kebijakan akses yang sudah ada).

-- ---------------------------------------------------------------- 1) daftar site untuk halaman login (satu-satunya fungsi publik baru)
create or replace function public.login_sites() returns table(code text, name text, email_domain text)
language sql stable security definer set search_path = public as $$
  select s.code, s.name, s.email_domain from public.sites s where s.active order by (s.kind = 'ho'), s.name
$$;
revoke execute on function public.login_sites() from public;
grant execute on function public.login_sites() to anon, authenticated;

-- ---------------------------------------------------------------- 2) konteks site aktif
create table public.user_site_context(
  user_id uuid primary key references public.profiles(id) on delete cascade,
  site_id uuid not null references public.sites(id),
  updated_at timestamptz not null default now()
);
alter table public.user_site_context enable row level security;
revoke all on public.user_site_context from anon;
revoke insert, update, delete on public.user_site_context from authenticated;
create policy user_site_context_own on public.user_site_context for select to authenticated using (user_id = auth.uid());

-- boleh berpindah site: admin sistem, atau akun yang site asalnya berjenis HO
create or replace function app.can_roam() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles p join public.sites s on s.id = p.site_id where p.id = auth.uid() and s.kind = 'ho')
      or exists(select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role_code = 'SYS_ADMIN'
                and current_date >= ur.valid_from and (ur.valid_until is null or current_date <= ur.valid_until))
$$;

create or replace function app.active_site() returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select c.site_id from public.user_site_context c join public.sites s on s.id = c.site_id
      where c.user_id = auth.uid() and s.active and app.can_roam()),
    (select p.site_id from public.profiles p where p.id = auth.uid()),
    app.default_site())
$$;
create or replace function app.my_site() returns uuid language sql stable security definer set search_path = public as $$
  select app.active_site()
$$;

create or replace function public.site_switch(p_code text) returns text language plpgsql security definer set search_path = public as $$
declare s public.sites;
begin
  select * into s from public.sites where code = upper(btrim(p_code)) and active;
  if not found then raise exception 'Site tidak dikenal' using errcode = '22023'; end if;
  if not app.can_roam() and s.id is distinct from (select site_id from public.profiles where id = auth.uid()) then
    raise exception 'Akun ini hanya dapat memakai site asalnya' using errcode = '42501';
  end if;
  insert into public.user_site_context(user_id, site_id) values (auth.uid(), s.id)
  on conflict (user_id) do update set site_id = excluded.site_id, updated_at = now();
  perform app.log_event('site.switch', 'sites', s.code);
  return s.code;
end $$;

-- ---------------------------------------------------------------- 3) kelola daftar site (admin sistem)
create or replace function public.site_save(p_code text, p_name text, p_email_domain text default null, p_kind text default 'site', p_active boolean default true)
returns public.sites language plpgsql security definer set search_path = public as $$
declare v public.sites; c text := upper(btrim(p_code));
begin
  if not exists(select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role_code = 'SYS_ADMIN'
                and current_date >= ur.valid_from and (ur.valid_until is null or current_date <= ur.valid_until)) then
    raise exception 'Hanya admin sistem yang mengelola daftar site' using errcode = '42501';
  end if;
  if p_kind not in ('site','ho') then raise exception 'Jenis site tidak valid' using errcode = '22023'; end if;
  if c = 'BDA' and not coalesce(p_active, true) then raise exception 'Site BDA tidak dapat dinonaktifkan' using errcode = '22023'; end if;
  insert into public.sites(code, name, email_domain, kind, active)
  values (c, app.require_text(p_name, 'Nama site'), nullif(lower(btrim(p_email_domain)), ''), p_kind, coalesce(p_active, true))
  on conflict (code) do update set name = excluded.name, email_domain = excluded.email_domain, kind = excluded.kind, active = excluded.active, updated_at = now()
  returning * into v;
  return v;
end $$;
revoke execute on function public.site_switch(text), public.site_save(text, text, text, text, boolean) from public, anon;
grant execute on function public.site_switch(text), public.site_save(text, text, text, text, boolean) to authenticated;
revoke execute on function app.can_roam(), app.active_site() from public, anon;
grant execute on function app.can_roam(), app.active_site() to authenticated;

-- ---------------------------------------------------------------- 4) isolasi: kolom site_id + kebijakan restrictive
create or replace function app.site_isolate(p_table regclass) returns void language plpgsql as $$
declare t text := (select relname from pg_class where oid = p_table);
begin
  if not exists(select 1 from pg_attribute where attrelid = p_table and attname = 'site_id' and not attisdropped) then
    -- default konstan = BDA mengisi baris lama tanpa UPDATE (tabel append-only tidak terganggu)
    execute format('alter table %s add column site_id uuid not null default %L references public.sites(id)', p_table, app.default_site());
  end if;
  execute format('alter table %s alter column site_id set default app.active_site()', p_table);
  execute format('drop policy if exists site_isolation on %s', p_table);
  execute format($f$create policy site_isolation on %s as restrictive for all to authenticated
                    using (coalesce(site_id, (select app.default_site())) = (select app.active_site())) with check (coalesce(site_id, (select app.default_site())) = (select app.active_site()))$f$, p_table);
  execute format('create index if not exists %I on %s(site_id)', t || '_site_idx', p_table);
end $$;
revoke execute on function app.site_isolate(regclass) from public, anon, authenticated;

-- Tabel yang SENGAJA dipakai bersama semua site (master organisasi, katalog, konfigurasi, pengguna, dokumen perusahaan, pengadaan lintas site).
do $$
declare
  shared text[] := array[
    'sites','profiles','user_roles','user_site_context','roles','permissions','role_permissions','allowed_domains','allowed_emails','app_settings',
    'departments','sections','positions','notifications','notification_outbox','notification_prefs','push_subscriptions','nik_registrations',
    'numbering_counters','numbering_schemes','registrations','feed_tokens','client_requests','holidays','leave_types','claim_types','pay_components',
    'competencies','competency_requirements','compliance_frameworks','compliance_clauses','clause_mappings','document_types','documents','document_versions',
    'document_distributions','workflow_definitions','workflow_versions','workflow_instances','workflow_tasks','approval_events','delegations','approver_designations',
    'catalog_groups','catalog_models','catalog_parts','attachments','roster_policies','spip_check_items','resource_links','suppliers',
    'purchase_requisitions','purchase_requisition_lines','supplier_quotes','purchase_orders','purchase_order_lines'];
  r record;
begin
  for r in select c.oid::regclass as tbl, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and not (c.relname = any(shared)) loop
    perform app.site_isolate(r.tbl);
  end loop;
end $$;

-- Info site untuk header: site aktif, site asal, dan apakah boleh berpindah
create or replace function public.my_site_info() returns table(active_code text, active_name text, home_code text, can_roam boolean)
language sql stable security definer set search_path = public as $$
  select a.code, a.name, h.code, app.can_roam()
    from public.sites a, public.sites h
   where a.id = app.active_site() and h.id = coalesce((select p.site_id from public.profiles p where p.id = auth.uid()), app.default_site())
$$;
revoke execute on function public.my_site_info() from public, anon;
grant execute on function public.my_site_info() to authenticated;
