-- BSB IMS · M5 · Plant: register unit, work order (WO), breakdown & downtime, PM berbasis HM, physical availability
-- P2H "tidak layak" otomatis membuka WO breakdown dan unit berstatus breakdown sampai WO selesai.
-- Nomor WO memakai skema WO yang sudah ada sejak M0.

insert into public.permissions(code, module, description) values
  ('plant.report','plant','Melaporkan kerusakan unit (membuka WO breakdown)'),
  ('plant.work','plant','Mengerjakan dan menyelesaikan work order'),
  ('plant.manage','plant','Mengelola register unit, rencana PM dan membatalkan WO');

insert into public.role_permissions(role_code, permission_code)
select r, p from (values
  ('STAFF','plant.report'), ('STAFF','plant.work'),
  ('SUPERVISOR','plant.report'), ('SUPERVISOR','plant.work'),
  ('SUPERINTENDENT','plant.report'), ('SUPERINTENDENT','plant.work'), ('SUPERINTENDENT','plant.manage'),
  ('DEPT_HEAD','plant.report'), ('DEPT_HEAD','plant.work'), ('DEPT_HEAD','plant.manage'),
  ('PJO','plant.report'), ('HSE_MANAGER','plant.report')
) as x(r, p);

-- ---------------------------------------------------------------- register unit
create table public.units(
  id uuid primary key default gen_random_uuid(),
  unit_no text not null unique check (unit_no ~ '^[A-Z0-9][A-Z0-9./-]*$'),
  unit_type text not null check (unit_type in ('DT','LV','ST','FT','WT','BUS','EXC','OTHER')),
  brand text,
  model text,
  serial_no text,
  year smallint check (year is null or year between 1980 and 2100),
  ownership text not null default 'owned' check (ownership in ('owned','rental')),
  vendor text,
  site_id uuid references public.sites(id),
  department_id uuid not null references public.departments(id),
  status text not null default 'ready' check (status in ('ready','breakdown','standby','retired')),
  current_hm numeric not null default 0 check (current_hm >= 0),
  hm_updated_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (ownership = 'owned' or coalesce(btrim(vendor), '') <> '')
);

create table public.pm_plans(
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id),
  task text not null,
  interval_hm numeric not null check (interval_hm > 0),
  last_service_hm numeric not null default 0 check (last_service_hm >= 0),
  last_service_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (unit_id, task)
);

create table public.work_orders(
  id uuid primary key default gen_random_uuid(),
  wo_no text not null unique,
  unit_id uuid not null references public.units(id),
  wo_type text not null check (wo_type in ('breakdown','pm','repair','inspection')),
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  description text not null,
  source_table text check (source_table in ('p2h_checks','inspection_findings','hazard_reports')),
  source_id uuid,
  pm_plan_id uuid references public.pm_plans(id),
  reported_by uuid references public.profiles(id) default auth.uid(),
  reported_at timestamptz not null default now(),
  hm_reported numeric check (hm_reported is null or hm_reported >= 0),
  status text not null default 'open' check (status in ('open','in_progress','waiting_part','done','cancelled')),
  mechanic_id uuid references public.profiles(id),
  started_at timestamptz,
  waiting_note text,
  action_taken text,
  hm_completed numeric check (hm_completed is null or hm_completed >= 0),
  completed_at timestamptz,
  completed_by uuid references public.profiles(id),
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (wo_type <> 'pm' or pm_plan_id is not null),
  check (status <> 'done' or (coalesce(btrim(action_taken), '') <> '' and completed_at is not null)),
  check (completed_at is null or completed_at >= reported_at)
);
create index work_orders_unit_idx on public.work_orders(unit_id, status);
create unique index work_orders_source_uq on public.work_orders(source_table, source_id) where source_id is not null;

do $$
declare t text;
begin
  foreach t in array array['units','pm_plans','work_orders'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create policy %I_read on public.%I for select to authenticated using (app.is_active_user())', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
  end loop;
end $$;
revoke insert, update, delete on public.units, public.pm_plans, public.work_orders from authenticated;

-- ---------------------------------------------------------------- pembantu
create or replace function app.wo_open(p_unit uuid, p_type text, p_priority text, p_description text, p_hm numeric,
  p_source_table text default null, p_source_id uuid default null, p_pm_plan uuid default null, p_idempotency_key text default null)
returns public.work_orders language plpgsql security definer set search_path = public as $$
declare
  v public.work_orders;
  v_reg public.registrations;
begin
  if p_idempotency_key is not null then
    select w.* into v from public.registrations r join public.work_orders w on w.wo_no = r.number where r.idempotency_key = p_idempotency_key;
    if found then return v; end if;
  end if;
  v_reg := app.allocate_number('WO', '{}', p_idempotency_key);
  insert into public.work_orders(wo_no, unit_id, wo_type, priority, description, source_table, source_id, pm_plan_id, hm_reported)
  values (v_reg.number, p_unit, p_type, p_priority, app.require_text(p_description, 'Uraian kerusakan / pekerjaan'),
          p_source_table, p_source_id, p_pm_plan, p_hm)
  returning * into v;
  update public.registrations set ref_table = 'work_orders', ref_id = v.id where id = v_reg.id;
  if p_type = 'breakdown' then
    update public.units set status = 'breakdown' where id = p_unit and status <> 'retired';
  end if;
  perform app.notify_users(app.users_with_permission('plant.work', (select department_id from public.units where id = p_unit)),
    'plant.wo', 'Work order ' || v.wo_no || ' · ' || (select unit_no from public.units where id = p_unit), left(v.description, 140), '/plant/wo/' || v.id);
  return v;
end $$;

create or replace function app.unit_hm(p_unit uuid, p_hm numeric) returns void
language sql security definer set search_path = public as $$
  update public.units set current_hm = p_hm, hm_updated_at = now() where id = p_unit and p_hm is not null and p_hm > current_hm
$$;

-- ---------------------------------------------------------------- fungsi: unit & PM
create or replace function public.unit_save(p_unit_no text, p_unit_type text, p_department uuid, p_ownership text default 'owned',
  p_vendor text default null, p_brand text default null, p_model text default null, p_serial text default null, p_year int default null,
  p_hm numeric default null, p_note text default null)
returns public.units language plpgsql security definer set search_path = public as $$
declare v public.units;
begin
  if not app.has_permission('plant.manage', p_department) then raise exception 'Tidak berwenang mengelola unit' using errcode = '42501'; end if;
  insert into public.units(unit_no, unit_type, department_id, site_id, ownership, vendor, brand, model, serial_no, year, current_hm, note)
  values (upper(app.require_text(p_unit_no, 'No. lambung')), p_unit_type, p_department, app.default_site(), p_ownership, p_vendor,
          p_brand, p_model, p_serial, p_year, coalesce(p_hm, 0), p_note)
  on conflict (unit_no) do update set unit_type = excluded.unit_type, department_id = excluded.department_id, ownership = excluded.ownership,
    vendor = excluded.vendor, brand = excluded.brand, model = excluded.model, serial_no = excluded.serial_no, year = excluded.year,
    current_hm = greatest(public.units.current_hm, excluded.current_hm), note = excluded.note
  returning * into v;
  return v;
end $$;

-- Standby / retire / siap; unit dengan WO breakdown terbuka tidak bisa dinyatakan siap.
create or replace function public.unit_set_status(p_unit uuid, p_status text, p_note text default null)
returns public.units language plpgsql security definer set search_path = public as $$
declare v public.units;
begin
  select * into v from public.units where id = p_unit for update;
  if not found then raise exception 'Unit tidak ditemukan' using errcode = 'P0002'; end if;
  if not app.has_permission('plant.manage', v.department_id) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if p_status not in ('ready','standby','retired') then raise exception 'Status breakdown hanya lewat work order' using errcode = '22023'; end if;
  if p_status = 'ready' and exists(select 1 from public.work_orders where unit_id = p_unit and wo_type = 'breakdown'
                                     and status in ('open','in_progress','waiting_part')) then
    raise exception 'Masih ada WO breakdown terbuka untuk unit ini' using errcode = '22023';
  end if;
  update public.units set status = p_status, note = coalesce(p_note, note) where id = p_unit returning * into v;
  return v;
end $$;

create or replace function public.pm_plan_save(p_unit uuid, p_task text, p_interval_hm numeric, p_last_service_hm numeric default null)
returns public.pm_plans language plpgsql security definer set search_path = public as $$
declare v public.pm_plans;
begin
  if not app.has_permission('plant.manage', (select department_id from public.units where id = p_unit)) then
    raise exception 'Tidak berwenang' using errcode = '42501';
  end if;
  insert into public.pm_plans(unit_id, task, interval_hm, last_service_hm)
  values (p_unit, app.require_text(p_task, 'Jenis servis'), p_interval_hm, coalesce(p_last_service_hm, 0))
  on conflict (unit_id, task) do update set interval_hm = excluded.interval_hm,
    last_service_hm = coalesce(p_last_service_hm, public.pm_plans.last_service_hm), active = true
  returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------- fungsi: work order
create or replace function public.wo_create(p_unit uuid, p_type text, p_description text, p_priority text default 'medium',
  p_hm numeric default null, p_pm_plan uuid default null, p_source_table text default null, p_source_id uuid default null,
  p_idempotency_key text default null)
returns public.work_orders language plpgsql security definer set search_path = public as $$
declare u public.units;
begin
  select * into u from public.units where id = p_unit;
  if not found or u.status = 'retired' then raise exception 'Unit tidak ditemukan atau sudah tidak aktif' using errcode = '22023'; end if;
  if p_type = 'breakdown' then
    if not app.has_permission_anywhere('plant.report') then raise exception 'Tidak berwenang melapor kerusakan' using errcode = '42501'; end if;
  elsif not app.has_permission('plant.manage', u.department_id) then
    raise exception 'WO terencana hanya dibuat oleh pengelola Plant' using errcode = '42501';
  end if;
  if p_pm_plan is not null and not exists(select 1 from public.pm_plans where id = p_pm_plan and unit_id = p_unit) then
    raise exception 'Rencana PM bukan milik unit ini' using errcode = '22023';
  end if;
  perform app.unit_hm(p_unit, p_hm);
  return app.wo_open(p_unit, p_type, p_priority, p_description, p_hm, p_source_table, p_source_id, p_pm_plan, p_idempotency_key);
end $$;

create or replace function public.wo_start(p_id uuid, p_mechanic uuid default null)
returns public.work_orders language plpgsql security definer set search_path = public as $$
declare v public.work_orders;
begin
  select * into v from public.work_orders where id = p_id for update;
  if not found then raise exception 'WO tidak ditemukan' using errcode = 'P0002'; end if;
  if not app.has_permission('plant.work', (select department_id from public.units where id = v.unit_id)) then
    raise exception 'Tidak berwenang mengerjakan WO' using errcode = '42501';
  end if;
  if v.status not in ('open','waiting_part') then raise exception 'WO tidak bisa dimulai dari status ini' using errcode = '22023'; end if;
  update public.work_orders set status = 'in_progress', mechanic_id = coalesce(p_mechanic, mechanic_id, auth.uid()),
         started_at = coalesce(started_at, now()), waiting_note = null
   where id = p_id returning * into v;
  return v;
end $$;

create or replace function public.wo_wait_part(p_id uuid, p_note text)
returns public.work_orders language plpgsql security definer set search_path = public as $$
declare v public.work_orders;
begin
  select * into v from public.work_orders where id = p_id for update;
  if not found then raise exception 'WO tidak ditemukan' using errcode = 'P0002'; end if;
  if not app.has_permission('plant.work', (select department_id from public.units where id = v.unit_id)) then
    raise exception 'Tidak berwenang' using errcode = '42501';
  end if;
  if v.status not in ('open','in_progress') then raise exception 'WO tidak sedang berjalan' using errcode = '22023'; end if;
  update public.work_orders set status = 'waiting_part', waiting_note = app.require_text(p_note, 'Part yang ditunggu')
   where id = p_id returning * into v;
  return v;
end $$;

-- Selesai: wajib uraian tindakan; HM tidak boleh mundur; unit kembali siap bila tak ada breakdown lain; PM mencatat servis terakhir.
create or replace function public.wo_complete(p_id uuid, p_action text, p_hm numeric default null, p_attachments uuid[] default '{}')
returns public.work_orders language plpgsql security definer set search_path = public as $$
declare
  v public.work_orders;
  u public.units;
begin
  select * into v from public.work_orders where id = p_id for update;
  if not found then raise exception 'WO tidak ditemukan' using errcode = 'P0002'; end if;
  select * into u from public.units where id = v.unit_id for update;
  if not app.has_permission('plant.work', u.department_id) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if v.status <> 'in_progress' then raise exception 'WO harus dikerjakan dulu sebelum diselesaikan' using errcode = '22023'; end if;
  if p_hm is not null and p_hm < coalesce(v.hm_reported, 0) then
    raise exception 'HM selesai tidak boleh lebih kecil dari HM saat dilaporkan' using errcode = '22023';
  end if;
  perform app.claim_attachments(p_attachments, 'work_orders', v.id);
  update public.work_orders set status = 'done', action_taken = app.require_text(p_action, 'Tindakan perbaikan'), hm_completed = p_hm,
         completed_at = now(), completed_by = auth.uid()
   where id = p_id returning * into v;
  perform app.unit_hm(u.id, p_hm);
  if v.pm_plan_id is not null then
    update public.pm_plans set last_service_hm = coalesce(p_hm, (select current_hm from public.units where id = u.id)), last_service_at = now()
     where id = v.pm_plan_id;
  end if;
  if u.status = 'breakdown' and not exists(select 1 from public.work_orders where unit_id = u.id and wo_type = 'breakdown'
                                             and status in ('open','in_progress','waiting_part')) then
    update public.units set status = 'ready' where id = u.id;
  end if;
  return v;
end $$;

create or replace function public.wo_cancel(p_id uuid, p_reason text)
returns public.work_orders language plpgsql security definer set search_path = public as $$
declare v public.work_orders;
begin
  select * into v from public.work_orders where id = p_id for update;
  if not found then raise exception 'WO tidak ditemukan' using errcode = 'P0002'; end if;
  if not app.has_permission('plant.manage', (select department_id from public.units where id = v.unit_id)) then
    raise exception 'Tidak berwenang' using errcode = '42501';
  end if;
  if v.status in ('done','cancelled') then raise exception 'WO sudah ditutup' using errcode = '22023'; end if;
  update public.work_orders set status = 'cancelled', cancel_reason = app.require_text(p_reason, 'Alasan pembatalan')
   where id = p_id returning * into v;
  if not exists(select 1 from public.work_orders where unit_id = v.unit_id and wo_type = 'breakdown' and status in ('open','in_progress','waiting_part')) then
    update public.units set status = 'ready' where id = v.unit_id and status = 'breakdown';
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------- P2H terhubung ke register unit
-- Unit yang masih breakdown tidak boleh dinyatakan layak; P2H tidak layak membuka WO breakdown otomatis; HM terbarui.
create or replace function public.p2h_submit(
  p_check_date date, p_shift int, p_department uuid, p_unit_no text, p_unit_type text, p_items jsonb,
  p_conclusion text, p_hour_meter numeric default null, p_notes text default null, p_attachments uuid[] default '{}')
returns public.p2h_checks language plpgsql security definer set search_path = public as $$
declare
  v public.p2h_checks;
  v_reg public.registrations;
  u public.units;
  v_missing text;
  v_bad int;
  v_crit int;
  v_concl text := p_conclusion;
begin
  if not app.has_permission('she.report', p_department) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if p_check_date > app.site_today() then raise exception 'Tanggal tidak boleh di masa depan' using errcode = '22023'; end if;
  select string_agg(label, ', ') into v_missing from public.p2h_items i
   where i.active and coalesce(p_items->>i.code, '') not in ('ok','not_ok','na');
  if v_missing is not null then raise exception 'Checklist belum lengkap: %', v_missing using errcode = '22023'; end if;
  select count(*) filter (where p_items->>i.code = 'not_ok'), count(*) filter (where i.is_critical and p_items->>i.code = 'not_ok')
    into v_bad, v_crit from public.p2h_items i where i.active;
  if v_crit > 0 then v_concl := 'unfit';
  elsif v_bad > 0 and v_concl = 'fit' then v_concl := 'fit_with_notes';
  end if;
  if v_bad > 0 and coalesce(btrim(p_notes), '') = '' then raise exception 'Catat temuan untuk item yang tidak OK' using errcode = '22023'; end if;
  select * into u from public.units where unit_no = upper(btrim(p_unit_no));
  if found then
    if u.status = 'retired' then raise exception 'Unit % sudah tidak aktif', u.unit_no using errcode = '22023'; end if;
    if u.status = 'breakdown' and v_concl <> 'unfit' then
      raise exception 'Unit % masih breakdown (WO belum selesai), tidak boleh dinyatakan layak', u.unit_no using errcode = '22023';
    end if;
    if p_hour_meter is not null and p_hour_meter < u.current_hm then
      raise exception 'HM % lebih kecil dari HM terakhir unit (%)', p_hour_meter, u.current_hm using errcode = '22023';
    end if;
  end if;
  v_reg := app.allocate_number('INS', jsonb_build_object('date', p_check_date), null);
  insert into public.p2h_checks(p2h_no, check_date, shift, department_id, site_id, unit_no, unit_type, hour_meter, items, notes, conclusion)
  values (v_reg.number, p_check_date, p_shift, p_department, app.default_site(), upper(app.require_text(p_unit_no, 'No. lambung')),
          coalesce(u.unit_type, p_unit_type), p_hour_meter, p_items, p_notes, v_concl)
  returning * into v;
  update public.registrations set ref_table = 'p2h_checks', ref_id = v.id where id = v_reg.id;
  perform app.claim_attachments(p_attachments, 'p2h_checks', v.id);
  if u.id is not null then
    perform app.unit_hm(u.id, p_hour_meter);
    if v_concl = 'unfit' and u.status <> 'breakdown' then
      perform app.wo_open(u.id, 'breakdown', 'urgent', 'P2H ' || v.p2h_no || ' tidak layak: ' || coalesce(p_notes, '-'), p_hour_meter,
                          'p2h_checks', v.id);
    end if;
  end if;
  if v_concl = 'unfit' then
    perform app.notify_users(app.users_with_permission('she.followup', p_department) || app.users_with_permission('she.followup',
      (select id from public.departments where code = 'PLT')), 'she.p2h_unfit', 'Unit tidak layak: ' || v.unit_no, v.notes, '/she/p2h');
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------- tampilan
create view public.work_order_register with (security_invoker = true) as
select w.*, u.unit_no, u.unit_type, u.department_id as unit_department_id,
       m.full_name as mechanic_name, r.full_name as reporter_name, p.task as pm_task,
       round(extract(epoch from (coalesce(w.completed_at, case when w.status = 'cancelled' then w.updated_at end, now()) - w.reported_at)) / 3600.0, 1)
         as downtime_hours,
       (w.status in ('open','in_progress','waiting_part')) as is_open
  from public.work_orders w
  join public.units u on u.id = w.unit_id
  left join public.profiles m on m.id = w.mechanic_id
  left join public.profiles r on r.id = w.reported_by
  left join public.pm_plans p on p.id = w.pm_plan_id;

-- Rencana PM yang jatuh tempo (sisa ≤ 10% interval)
create view public.pm_due with (security_invoker = true) as
select p.*, u.unit_no, u.unit_type, u.current_hm, (p.last_service_hm + p.interval_hm) as next_due_hm,
       (p.last_service_hm + p.interval_hm - u.current_hm) as remaining_hm,
       (u.current_hm >= p.last_service_hm + p.interval_hm) as overdue,
       exists(select 1 from public.work_orders w where w.pm_plan_id = p.id and w.status in ('open','in_progress','waiting_part')) as wo_open
  from public.pm_plans p join public.units u on u.id = p.unit_id
 where p.active and u.status <> 'retired' and u.current_hm >= p.last_service_hm + 0.9 * p.interval_hm;

-- Physical availability 30 hari terakhir: (jam kalender - jam breakdown) / jam kalender
create view public.unit_availability with (security_invoker = true) as
with bd as (
  select w.unit_id,
         sum(extract(epoch from (least(coalesce(w.completed_at, now()), now()) - greatest(w.reported_at, now() - interval '30 days'))) / 3600.0) as hours
    from public.work_orders w
   where w.wo_type = 'breakdown' and w.status <> 'cancelled'
     and coalesce(w.completed_at, now()) > now() - interval '30 days'
   group by w.unit_id
)
select u.id as unit_id, u.unit_no, u.unit_type, u.status, u.current_hm, u.ownership,
       round(coalesce(bd.hours, 0)::numeric, 1) as breakdown_hours_30d,
       round((100 * (720 - least(coalesce(bd.hours, 0), 720)) / 720)::numeric, 1) as pa_30d
  from public.units u left join bd on bd.unit_id = u.id
 where u.status <> 'retired';

do $$
declare v text;
begin
  foreach v in array array['work_order_register','pm_due','unit_availability'] loop
    execute format('grant select on public.%I to authenticated', v);
    execute format('revoke all on public.%I from anon', v);
  end loop;
end $$;

-- lampiran WO bisa diunduh lewat /api/lampiran
-- ---------------------------------------------------------------- hak eksekusi
revoke all on function app.wo_open(uuid, text, text, text, numeric, text, uuid, uuid, text), app.unit_hm(uuid, numeric)
  from public, anon, authenticated;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and p.proname <> 'verify_document' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
