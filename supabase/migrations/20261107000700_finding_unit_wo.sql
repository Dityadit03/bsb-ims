-- Temuan SHE (hazard, temuan inspeksi) bisa dikaitkan ke unit; Plant membuat WO perbaikan langsung dari temuan.
alter table public.hazard_reports add column unit_id uuid references public.units(id);
alter table public.inspection_findings add column unit_id uuid references public.units(id);

create or replace function public.finding_set_unit(p_table text, p_id uuid, p_unit uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_dept uuid; v_status text; v_reporter uuid; u public.units;
begin
  if p_table = 'hazard_reports' then
    select pic_department_id, status, reporter_id into v_dept, v_status, v_reporter from public.hazard_reports where id = p_id;
  elsif p_table = 'inspection_findings' then
    select f.pic_department_id, f.status, i.inspector_id into v_dept, v_status, v_reporter
      from public.inspection_findings f join public.inspections i on i.id = f.inspection_id where f.id = p_id;
  else
    raise exception 'Jenis rekaman tidak didukung' using errcode = '22023';
  end if;
  if v_dept is null then raise exception 'Rekaman tidak ditemukan' using errcode = 'P0002'; end if;
  if not (v_reporter = auth.uid() or app.has_permission('she.followup', v_dept)
          or app.has_permission_anywhere('plant.manage') or app.has_permission_anywhere('user.manage')) then
    raise exception 'Tidak berwenang mengaitkan unit' using errcode = '42501';
  end if;
  if v_status <> 'open' then raise exception 'Rekaman sudah ditutup' using errcode = '22023'; end if;
  if p_unit is not null then
    select * into u from public.units where id = p_unit;
    if not found or u.status = 'retired' then raise exception 'Unit tidak ditemukan atau sudah tidak aktif' using errcode = '22023'; end if;
  end if;
  if p_table = 'hazard_reports' then update public.hazard_reports set unit_id = p_unit where id = p_id;
  else update public.inspection_findings set unit_id = p_unit where id = p_id; end if;
  perform app.log_event('she.finding_unit', p_table, p_id::text, jsonb_build_object('unit', p_unit));
end $$;

create or replace function public.finding_create_wo(p_table text, p_id uuid) returns public.work_orders
language plpgsql security definer set search_path = public as $$
declare v_unit uuid; v_no text; v_desc text; v_risk text; v_status text; u public.units; v public.work_orders; v_prio text;
begin
  if p_table = 'hazard_reports' then
    select unit_id, hazard_no, description, risk_level, status into v_unit, v_no, v_desc, v_risk, v_status from public.hazard_reports where id = p_id;
  elsif p_table = 'inspection_findings' then
    select f.unit_id, i.inspection_no || '-' || f.seq, f.description, f.risk_level, f.status into v_unit, v_no, v_desc, v_risk, v_status
      from public.inspection_findings f join public.inspections i on i.id = f.inspection_id where f.id = p_id;
  else
    raise exception 'Jenis rekaman tidak didukung' using errcode = '22023';
  end if;
  if v_no is null then raise exception 'Rekaman tidak ditemukan' using errcode = 'P0002'; end if;
  if v_unit is null then raise exception 'Kaitkan unit pada temuan ini dulu' using errcode = '22023'; end if;
  if v_status <> 'open' then raise exception 'Temuan sudah ditutup' using errcode = '22023'; end if;
  select * into u from public.units where id = v_unit;
  if not app.has_permission('plant.manage', u.department_id) then
    raise exception 'WO dibuat oleh pengelola Plant' using errcode = '42501';
  end if;
  if exists(select 1 from public.work_orders where source_table = p_table and source_id = p_id) then
    raise exception 'Temuan ini sudah punya WO' using errcode = '23505';
  end if;
  v_prio := case v_risk when 'extreme' then 'urgent' when 'high' then 'high' when 'low' then 'low' else 'medium' end;
  v := app.wo_open(v_unit, 'repair', v_prio, 'Temuan ' || v_no || ': ' || v_desc, null, p_table, p_id, null, null);
  perform app.log_event('she.finding_wo', p_table, p_id::text, jsonb_build_object('wo', v.wo_no));
  return v;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname in ('finding_set_unit', 'finding_create_wo') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
