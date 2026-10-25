-- BSB IMS · NIK karyawan mengikuti format perusahaan: YY.MM.NNN (tahun & bulan masuk, nomor urut per tahun), mis. 24.05.064.
-- Menggantikan format sementara BSB-{N4} dari migrasi 20261025000800. Nomor urut per tahun melanjutkan data yang sudah ada.

update public.numbering_schemes set pattern = '{YYYY}-{N3}', name = 'NIK karyawan (urutan per tahun)' where code = 'NRP';

-- lanjutkan urutan dari NIK karyawan yang sudah ada
insert into public.numbering_counters(scheme_code, scope_key, period, last_value)
select 'NRP', 'ALL', 'YYYY=20' || m[1], max(m[2]::int)
  from (select regexp_match(nrp, '^(\d{2})\.\d{2}\.(\d{3})$') m from public.employees) x
 where m is not null group by m[1]
on conflict (scheme_code, scope_key, period) do update set last_value = greatest(public.numbering_counters.last_value, excluded.last_value);

create or replace function app.next_nrp(p_join date default null) returns text language plpgsql security definer set search_path = public as $$
declare d date := coalesce(p_join, app.site_today()); v text; n int := 0;
begin
  loop
    n := n + 1;
    v := to_char(d, 'YY.MM.') || right((app.allocate_number('NRP', jsonb_build_object('date', d))).number, 3);
    exit when not exists(select 1 from public.employees where nrp = v);
    if n > 10000 then raise exception 'Gagal membuat NIK karyawan'; end if;
  end loop;
  return v;
end $$;
revoke all on function app.next_nrp(date) from public, anon, authenticated;

create or replace function public.employee_save(p_nrp text, p_full_name text, p_department uuid, p_position uuid default null,
  p_employment_type text default 'permanent', p_company text default null, p_join_date date default null, p_email text default null,
  p_section uuid default null)
returns public.employees language plpgsql security definer set search_path = public as $$
declare
  v public.employees;
  v_profile uuid;
  v_nrp text := nullif(upper(btrim(coalesce(p_nrp, ''))), '');
begin
  perform app.require_hr('hr.manage');
  if v_nrp is null then v_nrp := app.next_nrp(p_join_date); end if;
  if p_position is not null and not exists(select 1 from public.positions where id = p_position and (department_id is null or department_id = p_department)) then
    raise exception 'Jabatan tidak sesuai departemen' using errcode = '22023';
  end if;
  if coalesce(btrim(p_email), '') <> '' then
    select id into v_profile from public.profiles where lower(email) = lower(btrim(p_email));
    if v_profile is null then raise exception 'Akun dengan email % belum pernah login', p_email using errcode = '22023'; end if;
  end if;
  insert into public.employees(nrp, full_name, department_id, section_id, position_id, employment_type, company, join_date, profile_id)
  values (v_nrp, app.require_text(p_full_name, 'Nama'), p_department, p_section, p_position,
          coalesce(p_employment_type, 'permanent'), nullif(btrim(coalesce(p_company, '')), ''), p_join_date, v_profile)
  on conflict (nrp) do update set full_name = excluded.full_name, department_id = excluded.department_id, section_id = excluded.section_id,
    position_id = excluded.position_id, employment_type = excluded.employment_type, company = excluded.company,
    join_date = excluded.join_date, profile_id = coalesce(excluded.profile_id, employees.profile_id)
  returning * into v;
  if v.status <> 'active' then raise exception 'Karyawan % sudah keluar', v.nrp using errcode = '22023'; end if;
  return v;
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
