-- WO servis berkala (PM) wajib bertaut ke rencana PM; beri pesan jelas, bukan galat constraint mentah.
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
  if p_type = 'pm' and p_pm_plan is null then
    raise exception 'WO servis berkala harus memilih rencana PM unit ini (isi dulu di panel Servis berkala)' using errcode = '22023';
  end if;
  if p_pm_plan is not null and not exists(select 1 from public.pm_plans where id = p_pm_plan and unit_id = p_unit) then
    raise exception 'Rencana PM bukan milik unit ini' using errcode = '22023';
  end if;
  perform app.unit_hm(p_unit, p_hm);
  return app.wo_open(p_unit, p_type, p_priority, p_description, p_hm, p_source_table, p_source_id, p_pm_plan, p_idempotency_key);
end $$;
revoke execute on function public.wo_create(uuid, text, text, text, numeric, uuid, text, uuid, text) from public, anon;
grant execute on function public.wo_create(uuid, text, text, text, numeric, uuid, text, uuid, text) to authenticated;
