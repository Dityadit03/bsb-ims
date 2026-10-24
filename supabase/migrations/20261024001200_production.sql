-- BSB IMS · M6 · Produksi hauling: rute, laporan shift (PRD), ritase & tonase per unit, delay, target bulanan
-- Unit hanya boleh mencatat ritase bila P2H shift itu layak (SMKP 4.1/4.4). Laporan disetujui orang lain dan terkunci.

insert into public.permissions(code, module, description) values
  ('prod.report','production','Menyusun laporan produksi shift'),
  ('prod.approve','production','Menyetujui laporan produksi shift'),
  ('prod.manage','production','Mengelola rute hauling dan target produksi');

insert into public.role_permissions(role_code, permission_code)
select r, p from (values
  ('SUPERVISOR','prod.report'), ('SUPERINTENDENT','prod.report'), ('SUPERINTENDENT','prod.approve'),
  ('DEPT_HEAD','prod.report'), ('DEPT_HEAD','prod.approve'), ('DEPT_HEAD','prod.manage'),
  ('PJO','prod.approve'), ('PJO','prod.manage')
) as x(r, p);

create table public.haul_routes(
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9][A-Z0-9-]*$'),
  name text not null,
  from_point text not null,
  to_point text not null,
  distance_km numeric not null check (distance_km > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.production_targets(
  id uuid primary key default gen_random_uuid(),
  month date not null check (extract(day from month) = 1),
  tonnage_target numeric not null check (tonnage_target > 0),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (month)
);

create table public.production_reports(
  id uuid primary key default gen_random_uuid(),
  report_no text not null unique,
  report_date date not null,
  shift smallint not null check (shift in (1, 2)),
  site_id uuid references public.sites(id),
  department_id uuid not null references public.departments(id),
  supervisor_id uuid not null references public.profiles(id) default auth.uid(),
  status text not null default 'draft' check (status in ('draft','submitted','approved')),
  note text,
  submitted_at timestamptz,
  submitted_by uuid references public.profiles(id),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id),
  return_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (report_date, shift)
);

create table public.haul_trips(
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.production_reports(id) on delete cascade,
  unit_id uuid not null references public.units(id),
  route_id uuid not null references public.haul_routes(id),
  operator_name text not null,
  trips int not null check (trips >= 0),
  tonnage numeric not null check (tonnage >= 0),
  hm_start numeric check (hm_start is null or hm_start >= 0),
  hm_end numeric,
  created_at timestamptz not null default now(),
  unique (report_id, unit_id, route_id),
  check (hm_end is null or hm_start is null or hm_end >= hm_start),
  check (tonnage = 0 or trips > 0)
);

create table public.production_delays(
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.production_reports(id) on delete cascade,
  unit_id uuid references public.units(id),
  category text not null check (category in ('rain','slippery','breakdown','refuel','p2h_briefing','queue','road_repair','safety','other')),
  hours numeric not null check (hours > 0 and hours <= 12),
  note text,
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['haul_routes','production_reports'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['haul_routes','production_targets','production_reports','haul_trips','production_delays'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create policy %I_read on public.%I for select to authenticated using (app.is_active_user())', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
  end loop;
end $$;
revoke insert, update, delete on public.haul_routes, public.production_targets, public.production_reports, public.haul_trips,
  public.production_delays from authenticated;

-- ---------------------------------------------------------------- master
create or replace function public.route_save(p_code text, p_name text, p_from text, p_to text, p_distance numeric, p_active boolean default true)
returns public.haul_routes language plpgsql security definer set search_path = public as $$
declare v public.haul_routes;
begin
  if not app.has_permission_anywhere('prod.manage') then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  insert into public.haul_routes(code, name, from_point, to_point, distance_km, active)
  values (upper(app.require_text(p_code, 'Kode rute')), app.require_text(p_name, 'Nama rute'), app.require_text(p_from, 'Titik muat'),
          app.require_text(p_to, 'Titik bongkar'), p_distance, p_active)
  on conflict (code) do update set name = excluded.name, from_point = excluded.from_point, to_point = excluded.to_point,
    distance_km = excluded.distance_km, active = excluded.active
  returning * into v;
  return v;
end $$;

create or replace function public.production_set_target(p_month date, p_tonnage numeric, p_note text default null)
returns public.production_targets language plpgsql security definer set search_path = public as $$
declare v public.production_targets;
begin
  if not app.has_permission_anywhere('prod.manage') then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  insert into public.production_targets(month, tonnage_target, note) values (date_trunc('month', p_month)::date, p_tonnage, p_note)
  on conflict (month) do update set tonnage_target = excluded.tonnage_target, note = excluded.note
  returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------- laporan shift
create or replace function app.prod_editable(p_report uuid) returns public.production_reports
language plpgsql security definer set search_path = public as $$
declare v public.production_reports;
begin
  select * into v from public.production_reports where id = p_report for update;
  if not found then raise exception 'Laporan tidak ditemukan' using errcode = 'P0002'; end if;
  if not app.has_permission('prod.report', v.department_id) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if v.status <> 'draft' then raise exception 'Laporan sudah dikirim/disetujui dan terkunci' using errcode = '22023'; end if;
  return v;
end $$;

create or replace function public.production_report_open(p_date date, p_shift int, p_note text default null)
returns public.production_reports language plpgsql security definer set search_path = public as $$
declare
  v public.production_reports;
  v_reg public.registrations;
  v_dept uuid := (select id from public.departments where code = 'PRD');
begin
  if not app.has_permission('prod.report', v_dept) then raise exception 'Tidak berwenang menyusun laporan produksi' using errcode = '42501'; end if;
  if p_date > app.site_today() then raise exception 'Tanggal tidak boleh di masa depan' using errcode = '22023'; end if;
  select * into v from public.production_reports where report_date = p_date and shift = p_shift;
  if found then return v; end if;
  v_reg := app.allocate_number('PRD', jsonb_build_object('date', p_date, 'SHIFT', 'S' || p_shift), null);
  insert into public.production_reports(report_no, report_date, shift, site_id, department_id, note)
  values (v_reg.number, p_date, p_shift, app.default_site(), v_dept, p_note)
  returning * into v;
  update public.registrations set ref_table = 'production_reports', ref_id = v.id where id = v_reg.id;
  return v;
end $$;

-- Ritase per unit & rute. Unit wajib punya P2H layak pada tanggal & shift yang sama.
create or replace function public.haul_trip_save(p_report uuid, p_unit uuid, p_route uuid, p_operator text, p_trips int, p_tonnage numeric,
  p_hm_start numeric default null, p_hm_end numeric default null)
returns public.haul_trips language plpgsql security definer set search_path = public as $$
declare
  r public.production_reports;
  u public.units;
  v public.haul_trips;
begin
  r := app.prod_editable(p_report);
  select * into u from public.units where id = p_unit;
  if not found or u.status = 'retired' then raise exception 'Unit tidak ditemukan' using errcode = '22023'; end if;
  if not exists(select 1 from public.haul_routes where id = p_route and active) then raise exception 'Rute tidak aktif' using errcode = '22023'; end if;
  if p_trips > 0 and not exists(select 1 from public.p2h_checks where unit_no = u.unit_no and check_date = r.report_date
                                  and shift = r.shift and conclusion in ('fit','fit_with_notes')) then
    raise exception 'Unit % belum punya P2H layak untuk tanggal dan shift ini', u.unit_no using errcode = '22023';
  end if;
  insert into public.haul_trips(report_id, unit_id, route_id, operator_name, trips, tonnage, hm_start, hm_end)
  values (p_report, p_unit, p_route, app.require_text(p_operator, 'Nama operator'), p_trips, p_tonnage, p_hm_start, p_hm_end)
  on conflict (report_id, unit_id, route_id) do update set operator_name = excluded.operator_name, trips = excluded.trips,
    tonnage = excluded.tonnage, hm_start = excluded.hm_start, hm_end = excluded.hm_end
  returning * into v;
  perform app.unit_hm(p_unit, p_hm_end);
  return v;
end $$;

create or replace function public.haul_trip_remove(p_trip uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform app.prod_editable((select report_id from public.haul_trips where id = p_trip));
  delete from public.haul_trips where id = p_trip;
end $$;

create or replace function public.production_delay_add(p_report uuid, p_category text, p_hours numeric, p_unit uuid default null, p_note text default null)
returns public.production_delays language plpgsql security definer set search_path = public as $$
declare v public.production_delays;
begin
  perform app.prod_editable(p_report);
  if p_category = 'other' and coalesce(btrim(p_note), '') = '' then raise exception 'Jelaskan hambatan lainnya' using errcode = '22023'; end if;
  insert into public.production_delays(report_id, unit_id, category, hours, note) values (p_report, p_unit, p_category, p_hours, p_note)
  returning * into v;
  return v;
end $$;

create or replace function public.production_delay_remove(p_delay uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform app.prod_editable((select report_id from public.production_delays where id = p_delay));
  delete from public.production_delays where id = p_delay;
end $$;

create or replace function public.production_submit(p_report uuid)
returns public.production_reports language plpgsql security definer set search_path = public as $$
declare v public.production_reports;
begin
  v := app.prod_editable(p_report);
  if not exists(select 1 from public.haul_trips where report_id = p_report) then
    raise exception 'Isi minimal satu baris ritase sebelum dikirim' using errcode = '22023';
  end if;
  update public.production_reports set status = 'submitted', submitted_at = now(), submitted_by = auth.uid(), return_note = null
   where id = p_report returning * into v;
  perform app.notify_users(app.users_with_permission('prod.approve', v.department_id), 'prod.submitted',
    'Laporan produksi ' || v.report_no, 'Menunggu persetujuan', '/produksi/' || v.id);
  return v;
end $$;

-- Persetujuan oleh orang lain; pengembalian wajib beralasan.
create or replace function public.production_review(p_report uuid, p_approve boolean, p_note text default null)
returns public.production_reports language plpgsql security definer set search_path = public as $$
declare v public.production_reports;
begin
  select * into v from public.production_reports where id = p_report for update;
  if not found then raise exception 'Laporan tidak ditemukan' using errcode = 'P0002'; end if;
  if not app.has_permission('prod.approve', v.department_id) then raise exception 'Tidak berwenang menyetujui' using errcode = '42501'; end if;
  if v.status <> 'submitted' then raise exception 'Laporan belum dikirim' using errcode = '22023'; end if;
  if v.submitted_by = auth.uid() then raise exception 'Pengirim tidak boleh menyetujui laporannya sendiri' using errcode = '42501'; end if;
  if p_approve then
    update public.production_reports set status = 'approved', approved_at = now(), approved_by = auth.uid() where id = p_report returning * into v;
  else
    update public.production_reports set status = 'draft', return_note = app.require_text(p_note, 'Alasan pengembalian')
     where id = p_report returning * into v;
    perform app.notify_users(array[v.submitted_by], 'prod.returned', 'Laporan ' || v.report_no || ' dikembalikan', p_note, '/produksi/' || v.id);
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------- tampilan
create view public.production_summary with (security_invoker = true) as
select r.id, r.report_no, r.report_date, r.shift, r.status, r.supervisor_id, p.full_name as supervisor_name,
       coalesce(t.trips, 0) as trips, coalesce(t.tonnage, 0) as tonnage, coalesce(t.units, 0) as units,
       coalesce(t.tkm, 0) as ton_km, coalesce(d.hours, 0) as delay_hours
  from public.production_reports r
  join public.profiles p on p.id = r.supervisor_id
  left join (select h.report_id, sum(h.trips)::int trips, sum(h.tonnage) tonnage, count(distinct h.unit_id)::int units,
                    sum(h.tonnage * rt.distance_km) tkm
               from public.haul_trips h join public.haul_routes rt on rt.id = h.route_id group by h.report_id) t on t.report_id = r.id
  left join (select report_id, sum(hours) hours from public.production_delays group by report_id) d on d.report_id = r.id;

-- Capaian bulan berjalan terhadap target (hanya laporan disetujui yang dihitung resmi)
create view public.production_month with (security_invoker = true) as
select date_trunc('month', s.report_date)::date as month,
       sum(s.tonnage) filter (where s.status = 'approved') as tonnage_approved,
       sum(s.tonnage) as tonnage_all, sum(s.trips) as trips, count(*)::int as reports,
       t.tonnage_target
  from public.production_summary s
  left join public.production_targets t on t.month = date_trunc('month', s.report_date)::date
 group by 1, t.tonnage_target;

do $$
declare v text;
begin
  foreach v in array array['production_summary','production_month'] loop
    execute format('grant select on public.%I to authenticated', v);
    execute format('revoke all on public.%I from anon', v);
  end loop;
end $$;

revoke all on function app.prod_editable(uuid) from public, anon, authenticated;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and p.proname <> 'verify_document' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
