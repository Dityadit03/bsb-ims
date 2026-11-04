-- Pelatihan internal: kompetensi "Lainnya" dibuat/dicari otomatis dari nama yang diketik penyelenggara.
create or replace function public.training_competency_other(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_name text := app.require_text(p_name, 'Nama kompetensi'); v_id uuid;
begin
  if not (app.has_permission('hr.manage', app.hrga_dept()) or app.has_permission_anywhere('training.organize')) then
    raise exception 'Tidak berwenang' using errcode = '42501';
  end if;
  select id into v_id from public.competencies where category = 'training' and lower(btrim(name)) = lower(v_name) limit 1;
  if v_id is null then
    insert into public.competencies(code, name, category) values ('TRN-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)), v_name, 'training') returning id into v_id;
  end if;
  return v_id;
end $$;
revoke execute on function public.training_competency_other(text) from public, anon;
grant execute on function public.training_competency_other(text) to authenticated;
