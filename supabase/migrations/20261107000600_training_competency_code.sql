-- Kode kompetensi dari pelatihan "Lainnya": dibuat dari nama (mis. AWARENESS-POP), bukan acak (TRN-4E36BD).
create or replace function app.competency_code_from_name(p_name text) returns text
language plpgsql as $$
declare base text; cand text; n int := 1;
begin
  base := regexp_replace(upper(btrim(p_name)), '[^A-Z0-9]+', '-', 'g');
  base := btrim(left(base, 24), '-');
  if base = '' then base := 'KOMPETENSI'; end if;
  cand := base;
  while exists (select 1 from public.competencies where code = cand) loop
    n := n + 1; cand := left(base, 21) || '-' || n;
  end loop;
  return cand;
end $$;

create or replace function public.training_competency_other(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_name text := app.require_text(p_name, 'Nama kompetensi'); v_id uuid;
begin
  if not (app.has_permission('hr.manage', app.hrga_dept()) or app.has_permission_anywhere('training.organize')) then
    raise exception 'Tidak berwenang' using errcode = '42501';
  end if;
  select id into v_id from public.competencies where category = 'training' and lower(btrim(name)) = lower(v_name) limit 1;
  if v_id is null then
    insert into public.competencies(code, name, category) values (app.competency_code_from_name(v_name), v_name, 'training') returning id into v_id;
  end if;
  return v_id;
end $$;
revoke execute on function public.training_competency_other(text) from public, anon;
grant execute on function public.training_competency_other(text) to authenticated;

-- Rapikan kode acak yang sudah terlanjur dibuat.
do $$
declare r record;
begin
  for r in select id, name from public.competencies where category = 'training' and code ~ '^TRN-[0-9A-F]{6}$' loop
    update public.competencies set code = app.competency_code_from_name(r.name) where id = r.id;
  end loop;
end $$;
