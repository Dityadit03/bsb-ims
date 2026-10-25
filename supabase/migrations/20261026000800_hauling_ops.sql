-- Operasional hauling: manajemen ban, perencanaan stok (ROP / ABC / hari cukup / suku cadang kritis), produktivitas unit.

-- ---------------------------------------------------------------- perencanaan stok
alter table public.materials add column lead_time_days int not null default 7 check (lead_time_days between 0 and 365);
alter table public.materials add column critical boolean not null default false;

create or replace function public.material_planning_set(p_material uuid, p_lead_time_days int, p_critical boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not app.has_permission('log.warehouse', app.log_dept()) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if p_lead_time_days is null or p_lead_time_days < 0 or p_lead_time_days > 365 then raise exception 'Lead time 0-365 hari' using errcode = '22023'; end if;
  update public.materials set lead_time_days = p_lead_time_days, critical = coalesce(p_critical, false) where id = p_material;
  if not found then raise exception 'Barang tidak ditemukan' using errcode = 'P0002'; end if;
  perform app.log_event('material.planning', 'materials', p_material::text, jsonb_build_object('lead', p_lead_time_days, 'critical', p_critical));
end $$;

-- Pemakaian rata-rata 90 hari (pengeluaran + BBM). ROP = pakai/hari x lead time + stok minimum.
-- Usulan pesan = naik ke (pakai/hari x (lead time + 14 hari)) + minimum, dikurangi stok dan PO yang masih berjalan.
create view public.stock_planning with (security_invoker = true) as
with use90 as (
  select material_id, sum(-qty) as used from public.stock_movements
   where movement_type in ('issue','fuel') and moved_at >= now() - interval '90 days' group by 1),
oo as (
  select l.material_id, sum(l.qty - l.qty_received) as q from public.purchase_order_lines l
    join public.purchase_orders o on o.id = l.po_id and o.status in ('issued','partial') group by 1),
base as (
  select m.id as material_id, m.code, m.name, m.category, m.uom, m.stock_qty, m.min_stock, m.avg_cost, m.lead_time_days, m.critical,
         coalesce(u.used, 0) / 90.0 as daily, coalesce(oo.q, 0) as on_order,
         coalesce(u.used, 0) / 90.0 * 365 * m.avg_cost as annual_value
    from public.materials m left join use90 u on u.material_id = m.id left join oo on oo.material_id = m.id
   where m.active),
ranked as (
  select b.*, sum(annual_value) over (order by annual_value desc, code) / nullif(sum(annual_value) over (), 0) as cum
    from base b)
select material_id, code, name, category, uom, stock_qty, min_stock, avg_cost, lead_time_days, critical, on_order,
       round(daily::numeric, 3) as daily_use,
       case when daily > 0 then round((stock_qty / daily)::numeric, 1) end as cover_days,
       ceil(daily * lead_time_days + min_stock) as reorder_point,
       greatest(0, ceil(daily * (lead_time_days + 14) + min_stock - stock_qty - on_order)) as suggested_qty,
       (stock_qty + on_order) <= ceil(daily * lead_time_days + min_stock) as reorder_now,
       case when annual_value <= 0 then 'C' when cum <= 0.8 then 'A' when cum <= 0.95 then 'B' else 'C' end as abc,
       round(annual_value::numeric) as annual_value
  from ranked;

-- ---------------------------------------------------------------- produktivitas unit (30 hari)
create view public.unit_productivity with (security_invoker = true) as
with t as (
  select ht.unit_id, count(distinct r.id) as shifts, sum(ht.trips) as trips, sum(ht.tonnage) as tonnage,
         sum(case when ht.hm_end is not null and ht.hm_start is not null then ht.hm_end - ht.hm_start end) as hm_worked
    from public.haul_trips ht join public.production_reports r on r.id = ht.report_id
   where r.report_date >= current_date - 30 and r.status in ('submitted','approved') group by 1),
d as (
  select d.unit_id, sum(d.hours) as delay_hours from public.production_delays d join public.production_reports r on r.id = d.report_id
   where r.report_date >= current_date - 30 and d.unit_id is not null group by 1),
f as (
  select unit_id, sum(liters) as liters from public.fuel_fills where moved_at >= now() - interval '30 days' group by 1)
select u.id as unit_id, u.unit_no, u.unit_type, coalesce(t.shifts, 0) as shifts, coalesce(t.trips, 0) as trips,
       round(coalesce(t.tonnage, 0)::numeric, 1) as tonnage, round(coalesce(t.hm_worked, 0)::numeric, 1) as hm_worked,
       case when t.hm_worked > 0 then round((t.tonnage / t.hm_worked)::numeric, 1) end as ton_per_hm,
       round(coalesce(d.delay_hours, 0)::numeric, 1) as delay_hours, round(coalesce(f.liters, 0)::numeric) as fuel_liters,
       case when t.tonnage > 0 and f.liters > 0 then round((f.liters / t.tonnage)::numeric, 2) end as l_per_ton
  from public.units u left join t on t.unit_id = u.id left join d on d.unit_id = u.id left join f on f.unit_id = u.id
 where u.status <> 'retired';

-- ---------------------------------------------------------------- manajemen ban
create table public.tyres(
  id uuid primary key default gen_random_uuid(),
  tyre_no text not null unique,
  serial_no text not null check (btrim(serial_no) <> ''),
  size text not null default '11.00-20',
  brand text,
  pattern text,
  new_cost numeric not null default 0 check (new_cost >= 0),
  total_cost numeric not null default 0 check (total_cost >= 0),
  otd_mm numeric not null default 20 check (otd_mm > 0),
  min_tread_mm numeric not null default 3 check (min_tread_mm >= 0),
  status text not null default 'in_stock' check (status in ('in_stock','installed','repair','scrapped')),
  installed_unit_id uuid references public.units(id),
  position text check (position is null or position ~ '^[A-Z0-9]{1,4}$'),
  installed_unit_hm numeric,
  accumulated_hm numeric not null default 0 check (accumulated_hm >= 0),
  retread_count int not null default 0,
  last_rtd_mm numeric check (last_rtd_mm is null or last_rtd_mm >= 0),
  last_psi numeric check (last_psi is null or last_psi >= 0),
  last_measured_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (brand, serial_no),
  check (status <> 'installed' or (installed_unit_id is not null and installed_unit_hm is not null and position is not null)),
  check (status = 'installed' or installed_unit_id is null)
);
create unique index tyres_slot_uq on public.tyres(installed_unit_id, position) where status = 'installed';

create table public.tyre_events(
  id uuid primary key default gen_random_uuid(),
  tyre_id uuid not null references public.tyres(id),
  kind text not null check (kind in ('register','install','remove','measure','retread','scrap')),
  unit_id uuid references public.units(id),
  position text,
  unit_hm numeric,
  run_hm numeric,
  rtd_mm numeric,
  psi numeric,
  reason text check (reason in ('worn','puncture','sidewall','blowout','heat','separation','other')),
  cost numeric check (cost is null or cost >= 0),
  note text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index tyre_events_idx on public.tyre_events(tyre_id, created_at);

do $$
declare t text;
begin
  foreach t in array array['tyres','tyre_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create policy %I_read on public.%I for select to authenticated using (app.is_active_user())', t, t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
  end loop;
  create trigger tyres_touch before update on public.tyres for each row execute function app.touch_updated_at();
end $$;

insert into public.numbering_schemes(code, name, pattern, module) values
  ('TYR','Register ban','TYR-BSB-{N5}','plant');

create or replace function public.tyre_register(p_serial text, p_size text, p_brand text, p_pattern text, p_cost numeric,
  p_otd numeric default 20, p_min_tread numeric default 3, p_initial_hm numeric default 0, p_note text default null)
returns public.tyres language plpgsql security definer set search_path = public as $$
declare v public.tyres; v_reg public.registrations;
begin
  if not app.has_permission('plant.manage', app.plant_dept()) then raise exception 'Tidak berwenang mengelola ban' using errcode = '42501'; end if;
  if p_otd is null or p_otd <= 0 or p_min_tread is null or p_min_tread >= p_otd then
    raise exception 'Kedalaman alur baru harus lebih besar dari batas buang' using errcode = '22023';
  end if;
  if exists(select 1 from public.tyres where upper(serial_no) = upper(btrim(coalesce(p_serial, ''))) and coalesce(upper(brand), '') = coalesce(upper(btrim(p_brand)), '')) then
    raise exception 'Ban dengan nomor seri % sudah terdaftar', p_serial using errcode = '23505';
  end if;
  v_reg := app.allocate_number('TYR', '{}');
  insert into public.tyres(tyre_no, serial_no, size, brand, pattern, new_cost, total_cost, otd_mm, min_tread_mm, accumulated_hm, last_rtd_mm, last_measured_at, note)
  values (v_reg.number, upper(app.require_text(p_serial, 'Nomor seri')), coalesce(nullif(btrim(p_size), ''), '11.00-20'), nullif(btrim(coalesce(p_brand, '')), ''),
          nullif(btrim(coalesce(p_pattern, '')), ''), coalesce(p_cost, 0), coalesce(p_cost, 0), p_otd, p_min_tread, coalesce(p_initial_hm, 0), p_otd, now(), p_note)
  returning * into v;
  update public.registrations set ref_table = 'tyres', ref_id = v.id where id = v_reg.id;
  insert into public.tyre_events(tyre_id, kind, run_hm, rtd_mm, cost, note) values (v.id, 'register', v.accumulated_hm, p_otd, p_cost, 'Terdaftar');
  return v;
end $$;

create or replace function public.tyre_install(p_tyre uuid, p_unit uuid, p_unit_hm numeric, p_position text, p_rtd numeric default null, p_psi numeric default null)
returns public.tyres language plpgsql security definer set search_path = public as $$
declare v public.tyres; u public.units; v_pos text := upper(btrim(coalesce(p_position, '')));
begin
  select * into v from public.tyres where id = p_tyre for update;
  if not found then raise exception 'Ban tidak ditemukan' using errcode = 'P0002'; end if;
  select * into u from public.units where id = p_unit for update;
  if not found or u.status = 'retired' then raise exception 'Unit tidak ditemukan' using errcode = '22023'; end if;
  if not app.has_permission('plant.work', u.department_id) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if v.status <> 'in_stock' then raise exception 'Ban % tidak ada di stok (status %)', v.tyre_no, v.status using errcode = '22023'; end if;
  if v_pos !~ '^[A-Z0-9]{1,4}$' then raise exception 'Posisi ban wajib diisi (mis. 1L, 1R, 2LO, 2LI)' using errcode = '22023'; end if;
  if p_unit_hm is null or p_unit_hm < u.current_hm then
    raise exception 'HM unit saat pasang (%) tidak boleh lebih kecil dari HM terakhir unit (%)', p_unit_hm, u.current_hm using errcode = '22023';
  end if;
  if coalesce(p_rtd, v.last_rtd_mm, v.otd_mm) <= v.min_tread_mm then
    raise exception 'Alur ban % sudah di batas buang; tidak boleh dipasang', v.tyre_no using errcode = '22023';
  end if;
  if exists(select 1 from public.tyres where installed_unit_id = p_unit and position = v_pos and status = 'installed') then
    raise exception 'Unit % sudah memakai ban di posisi %; lepas dulu', u.unit_no, v_pos using errcode = '23505';
  end if;
  perform app.unit_hm(p_unit, p_unit_hm);
  update public.tyres set status = 'installed', installed_unit_id = p_unit, position = v_pos, installed_unit_hm = p_unit_hm,
         last_rtd_mm = coalesce(p_rtd, last_rtd_mm), last_psi = coalesce(p_psi, last_psi), last_measured_at = now() where id = p_tyre returning * into v;
  insert into public.tyre_events(tyre_id, kind, unit_id, position, unit_hm, run_hm, rtd_mm, psi) values (v.id, 'install', p_unit, v_pos, p_unit_hm, v.accumulated_hm, v.last_rtd_mm, p_psi);
  return v;
end $$;

-- Ukur alur (RTD) dan tekanan saat ban terpasang. Alur tidak boleh naik dari ukuran sebelumnya.
create or replace function public.tyre_measure(p_tyre uuid, p_rtd numeric, p_psi numeric default null, p_note text default null)
returns public.tyres language plpgsql security definer set search_path = public as $$
declare v public.tyres; u public.units;
begin
  select * into v from public.tyres where id = p_tyre for update;
  if not found then raise exception 'Ban tidak ditemukan' using errcode = 'P0002'; end if;
  if v.status <> 'installed' then raise exception 'Hanya ban terpasang yang diukur' using errcode = '22023'; end if;
  select * into u from public.units where id = v.installed_unit_id;
  if not (app.has_permission('plant.work', u.department_id) or app.has_permission('plant.report', u.department_id)) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if p_rtd is null or p_rtd < 0 or p_rtd > v.otd_mm then raise exception 'Alur tidak masuk akal (0 - % mm)', v.otd_mm using errcode = '22023'; end if;
  if v.last_rtd_mm is not null and p_rtd > v.last_rtd_mm + 0.5 then
    raise exception 'Alur % mm lebih dalam dari ukuran sebelumnya (% mm); periksa pengukuran', p_rtd, v.last_rtd_mm using errcode = '22023';
  end if;
  update public.tyres set last_rtd_mm = p_rtd, last_psi = coalesce(p_psi, last_psi), last_measured_at = now() where id = p_tyre returning * into v;
  insert into public.tyre_events(tyre_id, kind, unit_id, position, unit_hm, run_hm, rtd_mm, psi, note)
  values (v.id, 'measure', u.id, v.position, u.current_hm, v.accumulated_hm + greatest(0, u.current_hm - v.installed_unit_hm), p_rtd, p_psi, p_note);
  return v;
end $$;

create or replace function public.tyre_remove(p_tyre uuid, p_unit_hm numeric, p_rtd numeric, p_reason text, p_next text default 'in_stock', p_note text default null)
returns public.tyres language plpgsql security definer set search_path = public as $$
declare v public.tyres; u public.units; v_run numeric;
begin
  select * into v from public.tyres where id = p_tyre for update;
  if not found then raise exception 'Ban tidak ditemukan' using errcode = 'P0002'; end if;
  if v.status <> 'installed' then raise exception 'Ban % tidak sedang terpasang', v.tyre_no using errcode = '22023'; end if;
  select * into u from public.units where id = v.installed_unit_id for update;
  if not app.has_permission('plant.work', u.department_id) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if p_reason is null or p_reason not in ('worn','puncture','sidewall','blowout','heat','separation','other') then raise exception 'Alasan pelepasan wajib diisi' using errcode = '22023'; end if;
  if p_next not in ('in_stock','repair','scrap') then raise exception 'Tujuan setelah lepas tidak valid' using errcode = '22023'; end if;
  if p_rtd is null or p_rtd < 0 or p_rtd > v.otd_mm then raise exception 'Alur saat lepas wajib diisi (0 - % mm)', v.otd_mm using errcode = '22023'; end if;
  if p_unit_hm is null or p_unit_hm < v.installed_unit_hm or p_unit_hm < u.current_hm then
    raise exception 'HM saat lepas tidak boleh lebih kecil dari HM pasang (%) atau HM terakhir unit (%)', v.installed_unit_hm, u.current_hm using errcode = '22023';
  end if;
  perform app.unit_hm(u.id, p_unit_hm);
  v_run := v.accumulated_hm + (p_unit_hm - v.installed_unit_hm);
  update public.tyres set status = case p_next when 'scrap' then 'scrapped' when 'repair' then 'repair' else 'in_stock' end,
         accumulated_hm = v_run, last_rtd_mm = p_rtd, last_measured_at = now(),
         installed_unit_id = null, position = null, installed_unit_hm = null where id = p_tyre returning * into v;
  insert into public.tyre_events(tyre_id, kind, unit_id, position, unit_hm, run_hm, rtd_mm, reason, note)
  values (v.id, case when p_next = 'scrap' then 'scrap' else 'remove' end, u.id, null, p_unit_hm, v_run, p_rtd, p_reason, p_note);
  return v;
end $$;

-- Ban kembali dari vulkanisir: alur baru, biaya ditambahkan ke total biaya ban
create or replace function public.tyre_retread_done(p_tyre uuid, p_cost numeric, p_otd numeric default null, p_note text default null)
returns public.tyres language plpgsql security definer set search_path = public as $$
declare v public.tyres;
begin
  if not app.has_permission('plant.manage', app.plant_dept()) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  select * into v from public.tyres where id = p_tyre for update;
  if not found then raise exception 'Ban tidak ditemukan' using errcode = 'P0002'; end if;
  if v.status <> 'repair' then raise exception 'Ban % tidak sedang diperbaiki/vulkanisir', v.tyre_no using errcode = '22023'; end if;
  if p_cost is null or p_cost < 0 then raise exception 'Biaya wajib diisi' using errcode = '22023'; end if;
  update public.tyres set status = 'in_stock', retread_count = retread_count + 1, total_cost = total_cost + p_cost,
         last_rtd_mm = coalesce(p_otd, otd_mm), last_measured_at = now() where id = p_tyre returning * into v;
  insert into public.tyre_events(tyre_id, kind, run_hm, rtd_mm, cost, note) values (v.id, 'retread', v.accumulated_hm, v.last_rtd_mm, p_cost, p_note);
  return v;
end $$;

-- Status ban: umur berjalan (termasuk HM unit saat ini), sisa alur, laju aus, biaya per HM, peringatan
create view public.tyre_status with (security_invoker = true) as
select t.id as tyre_id, t.tyre_no, t.serial_no, t.size, t.brand, t.pattern, t.status, t.position, t.retread_count, t.last_psi, t.last_measured_at,
       t.installed_unit_id as unit_id, u.unit_no, t.otd_mm, t.min_tread_mm, t.last_rtd_mm, t.total_cost,
       round(t.accumulated_hm + case when t.status = 'installed' then greatest(0, u.current_hm - t.installed_unit_hm) else 0 end, 0) as run_hm,
       case when t.last_rtd_mm is not null then round((100 * greatest(0, t.last_rtd_mm - t.min_tread_mm) / (t.otd_mm - t.min_tread_mm))::numeric) end as usable_pct,
       case when t.accumulated_hm + case when t.status = 'installed' then greatest(0, u.current_hm - t.installed_unit_hm) else 0 end > 0 and t.last_rtd_mm is not null
            then round(((t.otd_mm - t.last_rtd_mm) / (t.accumulated_hm + case when t.status = 'installed' then greatest(0, u.current_hm - t.installed_unit_hm) else 0 end) * 1000)::numeric, 2) end as wear_mm_per_1000hm,
       case when t.accumulated_hm + case when t.status = 'installed' then greatest(0, u.current_hm - t.installed_unit_hm) else 0 end > 0
            then round((t.total_cost / (t.accumulated_hm + case when t.status = 'installed' then greatest(0, u.current_hm - t.installed_unit_hm) else 0 end))::numeric) end as cost_per_hm,
       case when t.status <> 'installed' then null
            when t.last_rtd_mm is not null and t.last_rtd_mm <= t.min_tread_mm then 'replace'
            when t.last_rtd_mm is not null and t.last_rtd_mm <= t.min_tread_mm + 2 then 'soon'
            when t.last_measured_at is null or t.last_measured_at < now() - interval '14 days' then 'measure'
            else 'ok' end as alert
  from public.tyres t left join public.units u on u.id = t.installed_unit_id;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and p.proname not in ('verify_document','feed_rows') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
