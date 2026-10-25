-- BSB IMS · Plant lanjutan: kode downtime, biaya WO & biaya per jam unit (CPH), KPI keandalan (MTBF, MTTR, PA, UA, kepatuhan PM),
-- riwayat HM unit, dan register umur komponen (engine, transmisi, final drive, dst.) dengan pasang / lepas / overhaul.
-- HM unit tetap diinput manual (P2H, WO, ritase, pengeluaran BBM); setiap kenaikan HM kini tercatat di unit_hm_log.

insert into public.app_settings(key, value, description) values
  ('labor_rate_per_hour', '50000', 'Tarif jam kerja mekanik (Rp/jam) untuk biaya WO dan CPH'),
  ('component_warn_pct', '90', 'Komponen ditandai segera overhaul bila umur ≥ persen ini dari target umur');

insert into public.numbering_schemes(code, name, pattern, module) values
  ('CMP','Register komponen','CMP-BSB-{N5}','plant');

-- ---------------------------------------------------------------- riwayat HM unit
create table public.unit_hm_log(
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id),
  hm numeric not null check (hm >= 0),
  recorded_at timestamptz not null default now()
);
create index unit_hm_log_idx on public.unit_hm_log(unit_id, recorded_at desc);
insert into public.unit_hm_log(unit_id, hm, recorded_at)
select id, current_hm, coalesce(hm_updated_at, created_at) from public.units;

create or replace function app.unit_hm(p_unit uuid, p_hm numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_hm is null then return; end if;
  update public.units set current_hm = p_hm, hm_updated_at = now() where id = p_unit and p_hm > current_hm;
  if found then insert into public.unit_hm_log(unit_id, hm) values (p_unit, p_hm); end if;
end $$;

-- ---------------------------------------------------------------- WO: kode downtime & jam kerja mekanik
alter table public.work_orders
  add column downtime_code text check (downtime_code in ('planned_pm','breakdown','waiting_part','waiting_mechanic','accident','weather','other')),
  add column labor_hours numeric not null default 0 check (labor_hours >= 0 and labor_hours <= 1000);

create or replace function public.wo_costing(p_id uuid, p_downtime_code text, p_labor_hours numeric)
returns public.work_orders language plpgsql security definer set search_path = public as $$
declare v public.work_orders; u public.units;
begin
  select * into v from public.work_orders where id = p_id for update;
  if not found then raise exception 'WO tidak ditemukan' using errcode = 'P0002'; end if;
  select * into u from public.units where id = v.unit_id;
  if not app.has_permission('plant.work', u.department_id) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if v.status = 'cancelled' then raise exception 'WO sudah dibatalkan' using errcode = '22023'; end if;
  if p_downtime_code is not null and p_downtime_code not in ('planned_pm','breakdown','waiting_part','waiting_mechanic','accident','weather','other') then
    raise exception 'Kode downtime tidak dikenal' using errcode = '22023';
  end if;
  if coalesce(p_labor_hours, 0) < 0 or coalesce(p_labor_hours, 0) > 1000 then raise exception 'Jam kerja tidak valid' using errcode = '22023'; end if;
  update public.work_orders set downtime_code = p_downtime_code, labor_hours = coalesce(p_labor_hours, 0) where id = p_id returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------- tampilan biaya & keandalan
create view public.wo_cost with (security_invoker = true) as
select w.id as wo_id, w.wo_no, w.unit_id, u.unit_no, w.wo_type, w.status, w.downtime_code, w.labor_hours,
       coalesce(p.parts_cost, 0) as parts_cost,
       round(w.labor_hours * coalesce((select value::text::numeric from public.app_settings where key = 'labor_rate_per_hour'), 0)) as labor_cost,
       coalesce(p.parts_cost, 0) + round(w.labor_hours * coalesce((select value::text::numeric from public.app_settings where key = 'labor_rate_per_hour'), 0)) as total_cost
  from public.work_orders w
  join public.units u on u.id = w.unit_id
  left join lateral (select sum(-s.qty * s.unit_cost) as parts_cost from public.stock_movements s
                      where s.wo_id = w.id and s.movement_type = 'issue') p on true;

-- Biaya 90 hari terakhir per unit dan biaya per jam (CPH = biaya / selisih HM)
create view public.unit_cost_summary with (security_invoker = true) as
with since as (select now() - interval '90 days' as t),
parts as (select w.unit_id, sum(-s.qty * s.unit_cost) as v from public.stock_movements s join public.work_orders w on w.id = s.wo_id, since
           where s.movement_type = 'issue' and s.moved_at >= since.t group by w.unit_id),
fuel as (select s.unit_id, sum(-s.qty * s.unit_cost) as v, sum(-s.qty) as liters from public.stock_movements s, since
          where s.movement_type = 'fuel' and s.moved_at >= since.t group by s.unit_id),
labor as (select w.unit_id, sum(w.labor_hours) as h from public.work_orders w, since
           where w.status = 'done' and w.completed_at >= since.t group by w.unit_id),
hm as (select u.id as unit_id,
              u.current_hm - coalesce((select l.hm from public.unit_hm_log l, since where l.unit_id = u.id and l.recorded_at <= since.t order by l.recorded_at desc limit 1),
                                      (select min(l.hm) from public.unit_hm_log l where l.unit_id = u.id), u.current_hm) as hm_delta
         from public.units u)
select u.id as unit_id, u.unit_no, u.unit_type, u.status,
       round(coalesce(parts.v, 0)) as parts_cost_90d,
       round(coalesce(fuel.v, 0)) as fuel_cost_90d,
       round(coalesce(labor.h, 0) * coalesce((select value::text::numeric from public.app_settings where key = 'labor_rate_per_hour'), 0)) as labor_cost_90d,
       round(coalesce(parts.v, 0) + coalesce(fuel.v, 0)
             + coalesce(labor.h, 0) * coalesce((select value::text::numeric from public.app_settings where key = 'labor_rate_per_hour'), 0)) as total_cost_90d,
       round(coalesce(fuel.liters, 0), 1) as fuel_liters_90d,
       round(hm.hm_delta, 1) as hm_90d,
       case when hm.hm_delta > 0 then round((coalesce(parts.v, 0) + coalesce(fuel.v, 0)
             + coalesce(labor.h, 0) * coalesce((select value::text::numeric from public.app_settings where key = 'labor_rate_per_hour'), 0)) / hm.hm_delta) end as cph,
       case when hm.hm_delta > 0 and coalesce(fuel.liters, 0) > 0 then round(fuel.liters / hm.hm_delta, 1) end as fuel_l_per_hm
  from public.units u
  join hm on hm.unit_id = u.id
  left join parts on parts.unit_id = u.id
  left join fuel on fuel.unit_id = u.id
  left join labor on labor.unit_id = u.id
 where u.status <> 'retired';

-- KPI keandalan 90 hari: MTBF = jam operasi tersedia / jumlah kerusakan; MTTR = jam henti kerusakan / jumlah kerusakan
create view public.unit_reliability with (security_invoker = true) as
with since as (select now() - interval '90 days' as t),
bd as (
  select w.unit_id, count(*) filter (where w.reported_at >= since.t) as failures,
         sum(extract(epoch from (least(coalesce(w.completed_at, now()), now()) - greatest(w.reported_at, since.t))) / 3600.0) as hours
    from public.work_orders w, since
   where w.wo_type = 'breakdown' and w.status <> 'cancelled' and coalesce(w.completed_at, now()) > since.t
   group by w.unit_id),
pm as (
  select w.unit_id, count(*) as opened, count(*) filter (where w.status = 'done') as done
    from public.work_orders w, since where w.wo_type = 'pm' and w.status <> 'cancelled' and w.reported_at >= since.t group by w.unit_id),
op as (
  select t.unit_id, sum(t.hm_end - t.hm_start) as hours
    from public.haul_trips t join public.production_reports r on r.id = t.report_id
   where r.report_date >= current_date - 90 and t.hm_start is not null and t.hm_end is not null group by t.unit_id)
select u.id as unit_id, u.unit_no, u.unit_type, u.status, u.ownership,
       coalesce(bd.failures, 0) as failures_90d,
       round(coalesce(bd.hours, 0)::numeric, 1) as downtime_hours_90d,
       round((100 * (2160 - least(coalesce(bd.hours, 0), 2160)) / 2160)::numeric, 1) as pa_90d,
       case when coalesce(bd.failures, 0) > 0 then round(((2160 - least(coalesce(bd.hours, 0), 2160)) / bd.failures)::numeric, 1) end as mtbf_hours,
       case when coalesce(bd.failures, 0) > 0 then round((bd.hours / bd.failures)::numeric, 1) end as mttr_hours,
       coalesce(pm.opened, 0) as pm_opened_90d, coalesce(pm.done, 0) as pm_done_90d,
       case when coalesce(pm.opened, 0) > 0 then round((100.0 * pm.done / pm.opened)::numeric) end as pm_compliance_pct,
       round(coalesce(op.hours, 0)::numeric, 1) as operating_hours_90d,
       case when op.hours is not null then least(100, round((100 * op.hours / nullif(2160 - least(coalesce(bd.hours, 0), 2160), 0))::numeric, 1)) end as ua_90d
  from public.units u
  left join bd on bd.unit_id = u.id left join pm on pm.unit_id = u.id left join op on op.unit_id = u.id
 where u.status <> 'retired';

create view public.downtime_by_code with (security_invoker = true) as
select coalesce(w.downtime_code, case w.wo_type when 'pm' then 'planned_pm' when 'breakdown' then 'breakdown' else 'other' end) as code,
       count(*) as wo_count,
       round(sum(extract(epoch from (least(coalesce(w.completed_at, now()), now()) - greatest(w.reported_at, now() - interval '90 days'))) / 3600.0)::numeric, 1) as hours,
       count(*) filter (where w.downtime_code is null) as unclassified
  from public.work_orders w
 where w.wo_type in ('breakdown','pm','repair') and w.status <> 'cancelled' and coalesce(w.completed_at, now()) > now() - interval '90 days'
 group by 1;

-- ---------------------------------------------------------------- register komponen
create table public.components(
  id uuid primary key default gen_random_uuid(),
  comp_no text not null unique,
  component_type text not null check (component_type in ('engine','transmission','final_drive','differential','hydraulic_pump','turbocharger','axle','other')),
  serial_no text not null check (btrim(serial_no) <> ''),
  brand text,
  part_no text,
  life_target_hm numeric not null check (life_target_hm > 0),
  accumulated_hm numeric not null default 0 check (accumulated_hm >= 0),
  rebuild_count int not null default 0,
  status text not null default 'in_stock' check (status in ('in_stock','installed','rebuild','scrapped')),
  installed_unit_id uuid references public.units(id),
  position text,
  installed_unit_hm numeric,
  installed_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (component_type, serial_no),
  check (status <> 'installed' or (installed_unit_id is not null and installed_unit_hm is not null)),
  check (status = 'installed' or installed_unit_id is null)
);
create unique index components_slot_uq on public.components(installed_unit_id, component_type, coalesce(position, '')) where status = 'installed';

create table public.component_events(
  id uuid primary key default gen_random_uuid(),
  component_id uuid not null references public.components(id),
  kind text not null check (kind in ('register','install','remove','rebuild','scrap')),
  unit_id uuid references public.units(id),
  unit_hm numeric,
  run_hm numeric,
  reason text check (reason in ('planned_overhaul','failure','condition','other')),
  wo_id uuid references public.work_orders(id),
  cost numeric check (cost is null or cost >= 0),
  note text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index component_events_idx on public.component_events(component_id, created_at);

do $$
declare t text;
begin
  foreach t in array array['unit_hm_log','components','component_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create policy %I_read on public.%I for select to authenticated using (app.is_active_user())', t, t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
  end loop;
  create trigger components_touch before update on public.components for each row execute function app.touch_updated_at();
end $$;

create or replace function app.plant_dept() returns uuid language sql stable as $$ select id from public.departments where code = 'PLT' $$;

create or replace function public.component_save(p_type text, p_serial text, p_brand text, p_part_no text, p_life_target numeric,
  p_initial_hm numeric default 0, p_note text default null)
returns public.components language plpgsql security definer set search_path = public as $$
declare v public.components; v_reg public.registrations;
begin
  if not app.has_permission('plant.manage', app.plant_dept()) then raise exception 'Tidak berwenang mengelola komponen' using errcode = '42501'; end if;
  if exists(select 1 from public.components where component_type = p_type and upper(serial_no) = upper(btrim(coalesce(p_serial, '')))) then
    raise exception 'Komponen dengan nomor seri % sudah terdaftar', p_serial using errcode = '23505';
  end if;
  v_reg := app.allocate_number('CMP', '{}');
  insert into public.components(comp_no, component_type, serial_no, brand, part_no, life_target_hm, accumulated_hm, note)
  values (v_reg.number, p_type, upper(app.require_text(p_serial, 'Nomor seri')), nullif(btrim(coalesce(p_brand, '')), ''),
          nullif(btrim(coalesce(p_part_no, '')), ''), p_life_target, coalesce(p_initial_hm, 0), p_note)
  returning * into v;
  update public.registrations set ref_table = 'components', ref_id = v.id where id = v_reg.id;
  insert into public.component_events(component_id, kind, run_hm, note) values (v.id, 'register', v.accumulated_hm, 'Terdaftar');
  return v;
end $$;

create or replace function public.component_install(p_component uuid, p_unit uuid, p_unit_hm numeric, p_position text default null,
  p_wo uuid default null, p_note text default null)
returns public.components language plpgsql security definer set search_path = public as $$
declare v public.components; u public.units;
begin
  select * into v from public.components where id = p_component for update;
  if not found then raise exception 'Komponen tidak ditemukan' using errcode = 'P0002'; end if;
  select * into u from public.units where id = p_unit for update;
  if not found or u.status = 'retired' then raise exception 'Unit tidak ditemukan' using errcode = '22023'; end if;
  if not app.has_permission('plant.work', u.department_id) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if v.status <> 'in_stock' then raise exception 'Komponen % tidak ada di stok (status %)', v.comp_no, v.status using errcode = '22023'; end if;
  if p_unit_hm is null or p_unit_hm < u.current_hm then
    raise exception 'HM unit saat pasang (%) tidak boleh lebih kecil dari HM terakhir unit (%)', p_unit_hm, u.current_hm using errcode = '22023';
  end if;
  if v.accumulated_hm >= v.life_target_hm then
    raise exception 'Umur komponen % sudah melewati target; overhaul dulu', v.comp_no using errcode = '22023';
  end if;
  if exists(select 1 from public.components where installed_unit_id = p_unit and component_type = v.component_type
              and coalesce(position, '') = coalesce(nullif(btrim(coalesce(p_position, '')), ''), '') and status = 'installed') then
    raise exception 'Unit % sudah memakai % di posisi tersebut; lepas dulu', u.unit_no, v.component_type using errcode = '23505';
  end if;
  if p_wo is not null and not exists(select 1 from public.work_orders where id = p_wo and unit_id = p_unit and status in ('open','in_progress','waiting_part','done')) then
    raise exception 'WO tidak sesuai unit' using errcode = '22023';
  end if;
  perform app.unit_hm(p_unit, p_unit_hm);
  update public.components set status = 'installed', installed_unit_id = p_unit, installed_unit_hm = p_unit_hm, installed_at = now(),
         position = nullif(btrim(coalesce(p_position, '')), '') where id = p_component returning * into v;
  insert into public.component_events(component_id, kind, unit_id, unit_hm, run_hm, wo_id, note)
  values (v.id, 'install', p_unit, p_unit_hm, v.accumulated_hm, p_wo, p_note);
  return v;
end $$;

create or replace function public.component_remove(p_component uuid, p_unit_hm numeric, p_reason text, p_next text default 'rebuild',
  p_wo uuid default null, p_note text default null)
returns public.components language plpgsql security definer set search_path = public as $$
declare v public.components; u public.units; v_run numeric;
begin
  select * into v from public.components where id = p_component for update;
  if not found then raise exception 'Komponen tidak ditemukan' using errcode = 'P0002'; end if;
  if v.status <> 'installed' then raise exception 'Komponen % tidak sedang terpasang', v.comp_no using errcode = '22023'; end if;
  select * into u from public.units where id = v.installed_unit_id for update;
  if not app.has_permission('plant.work', u.department_id) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if p_reason is null or p_reason not in ('planned_overhaul','failure','condition','other') then
    raise exception 'Alasan pelepasan wajib diisi' using errcode = '22023';
  end if;
  if p_next not in ('in_stock','rebuild','scrap') then raise exception 'Tujuan setelah lepas tidak valid' using errcode = '22023'; end if;
  if p_unit_hm is null or p_unit_hm < v.installed_unit_hm then
    raise exception 'HM saat lepas (%) lebih kecil dari HM saat pasang (%)', p_unit_hm, v.installed_unit_hm using errcode = '22023';
  end if;
  if p_unit_hm < u.current_hm then raise exception 'HM saat lepas lebih kecil dari HM terakhir unit (%)', u.current_hm using errcode = '22023'; end if;
  perform app.unit_hm(u.id, p_unit_hm);
  v_run := p_unit_hm - v.installed_unit_hm;
  update public.components set accumulated_hm = accumulated_hm + v_run, installed_unit_id = null, installed_unit_hm = null, installed_at = null, position = null,
         status = case p_next when 'scrap' then 'scrapped' when 'rebuild' then 'rebuild' else 'in_stock' end
   where id = p_component returning * into v;
  insert into public.component_events(component_id, kind, unit_id, unit_hm, run_hm, reason, wo_id, note)
  values (v.id, 'remove', u.id, p_unit_hm, v_run, p_reason, p_wo, p_note);
  return v;
end $$;

-- Overhaul selesai: umur dihitung ulang dari nol (p_reset) atau dilanjutkan; kembali ke stok
create or replace function public.component_rebuild_done(p_component uuid, p_cost numeric default null, p_reset boolean default true,
  p_life_target numeric default null, p_note text default null)
returns public.components language plpgsql security definer set search_path = public as $$
declare v public.components;
begin
  if not app.has_permission('plant.manage', app.plant_dept()) then raise exception 'Tidak berwenang mengelola komponen' using errcode = '42501'; end if;
  select * into v from public.components where id = p_component for update;
  if not found then raise exception 'Komponen tidak ditemukan' using errcode = 'P0002'; end if;
  if v.status <> 'rebuild' then raise exception 'Komponen % tidak sedang overhaul', v.comp_no using errcode = '22023'; end if;
  update public.components set status = 'in_stock', rebuild_count = rebuild_count + 1, accumulated_hm = case when p_reset then 0 else accumulated_hm end,
         life_target_hm = coalesce(p_life_target, life_target_hm) where id = p_component returning * into v;
  insert into public.component_events(component_id, kind, cost, note) values (v.id, 'rebuild', p_cost, p_note);
  return v;
end $$;

create or replace function public.component_scrap(p_component uuid, p_note text)
returns public.components language plpgsql security definer set search_path = public as $$
declare v public.components;
begin
  if not app.has_permission('plant.manage', app.plant_dept()) then raise exception 'Tidak berwenang mengelola komponen' using errcode = '42501'; end if;
  select * into v from public.components where id = p_component for update;
  if not found then raise exception 'Komponen tidak ditemukan' using errcode = 'P0002'; end if;
  if v.status not in ('in_stock','rebuild') then raise exception 'Komponen harus dilepas dulu sebelum dibuang' using errcode = '22023'; end if;
  update public.components set status = 'scrapped' where id = p_component returning * into v;
  insert into public.component_events(component_id, kind, note) values (v.id, 'scrap', app.require_text(p_note, 'Alasan'));
  return v;
end $$;

create view public.component_view with (security_invoker = true) as
select c.*, u.unit_no,
       c.accumulated_hm + case when c.status = 'installed' then greatest(u.current_hm - c.installed_unit_hm, 0) else 0 end as life_hm,
       round(100 * (c.accumulated_hm + case when c.status = 'installed' then greatest(u.current_hm - c.installed_unit_hm, 0) else 0 end) / c.life_target_hm) as life_pct,
       greatest(c.life_target_hm - (c.accumulated_hm + case when c.status = 'installed' then greatest(u.current_hm - c.installed_unit_hm, 0) else 0 end), 0) as remaining_hm,
       (c.status in ('installed','in_stock')
         and 100 * (c.accumulated_hm + case when c.status = 'installed' then greatest(u.current_hm - c.installed_unit_hm, 0) else 0 end) / c.life_target_hm
             >= coalesce((select value::text::numeric from public.app_settings where key = 'component_warn_pct'), 90)) as due
  from public.components c left join public.units u on u.id = c.installed_unit_id;

create view public.component_event_view with (security_invoker = true) as
select e.*, c.comp_no, c.component_type, c.serial_no, u.unit_no, w.wo_no, p.full_name as by_name
  from public.component_events e join public.components c on c.id = e.component_id
  left join public.units u on u.id = e.unit_id left join public.work_orders w on w.id = e.wo_id left join public.profiles p on p.id = e.created_by;

-- Rata-rata jam pakai per pemasangan menurut jenis & merek (dasar menilai kualitas suku cadang)
create view public.component_life_stats with (security_invoker = true) as
select c.component_type, coalesce(c.brand, '–') as brand, count(*) as removals, round(avg(e.run_hm), 0) as avg_run_hm,
       count(*) filter (where e.reason = 'failure') as failures
  from public.component_events e join public.components c on c.id = e.component_id
 where e.kind = 'remove' group by 1, 2;

do $$
declare v text;
begin
  foreach v in array array['wo_cost','unit_cost_summary','unit_reliability','downtime_by_code','component_view','component_event_view','component_life_stats'] loop
    execute format('grant select on public.%I to authenticated', v);
    execute format('revoke all on public.%I from anon', v);
  end loop;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and p.proname not in ('verify_document','feed_rows') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
revoke all on function app.unit_hm(uuid, numeric) from public, anon, authenticated;
