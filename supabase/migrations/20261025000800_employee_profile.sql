-- BSB IMS · HRIS · Profil karyawan lengkap: NIK karyawan (NRP) otomatis tanpa duplikat, No. KTP unik, alamat terpisah,
-- No. SIM, jumlah anak, status penerimaan (lokal / non lokal), golongan karyawan (staff / non staff).
-- Umur dan masa kerja dihitung otomatis di view profile_register.

insert into public.numbering_schemes(code, name, pattern, module) values
  ('NRP','NIK / NRP karyawan','BSB-{N4}','hrga');

alter table public.employees
  add column recruitment_origin text check (recruitment_origin in ('local','non_local')),
  add column worker_class text check (worker_class in ('staff','non_staff'));

alter table public.employee_private
  add column kelurahan text, add column kecamatan text, add column kabupaten text, add column provinsi text,
  add column sim_no text,
  add column children_count int check (children_count is null or children_count between 0 and 30);

-- satu No. KTP hanya untuk satu karyawan
create unique index employee_private_nik_uniq on public.employee_private(nik) where nik is not null;

-- NIK/NRP berikutnya: nomor urut skema NRP; nomor yang sudah dipakai (hasil impor) dilompati
create or replace function app.next_nrp() returns text language plpgsql security definer set search_path = public as $$
declare v text; n int := 0;
begin
  loop
    n := n + 1;
    v := (app.allocate_number('NRP', '{}'::jsonb)).number;
    exit when not exists(select 1 from public.employees where nrp = v);
    if n > 10000 then raise exception 'Gagal membuat NIK karyawan'; end if;
  end loop;
  return v;
end $$;

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
  if v_nrp is null then v_nrp := app.next_nrp(); end if;
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

create or replace function public.employee_private_save(p_employee uuid, p_data jsonb)
returns public.employee_private language plpgsql security definer set search_path = public as $$
declare
  v public.employee_private;
  k text;
  allowed text[] := array['nik','kk_no','birth_place','birth_date','gender','religion','marital_status','ptkp_status','blood_type','address_ktp',
    'address_domicile','phone','personal_email','emergency_name','emergency_relation','emergency_phone','education_level','education_major',
    'npwp','bpjs_tk_no','bpjs_kes_no','bank_name','bank_account','bank_holder','uniform_size','shoe_size',
    'kelurahan','kecamatan','kabupaten','provinsi','sim_no','children_count'];
begin
  perform app.require_hr('hr.manage');
  if not exists(select 1 from public.employees where id = p_employee) then raise exception 'Karyawan tidak ditemukan' using errcode = 'P0002'; end if;
  if nullif(btrim(p_data->>'nik'), '') is not null and exists(
    select 1 from public.employee_private where nik = btrim(p_data->>'nik') and employee_id <> p_employee) then
    raise exception 'No. KTP % sudah dipakai karyawan lain', btrim(p_data->>'nik') using errcode = '23505';
  end if;
  insert into public.employee_private(employee_id) values (p_employee) on conflict do nothing;
  for k in select jsonb_object_keys(coalesce(p_data, '{}')) loop
    if not k = any(allowed) then raise exception 'Kolom % tidak dikenal', k using errcode = '22023'; end if;
    execute format('update public.employee_private set %I = $1::%s where employee_id = $2', k,
      case k when 'birth_date' then 'date' when 'children_count' then 'int' else 'text' end)
      using nullif(btrim(p_data->>k), ''), p_employee;
  end loop;
  select * into v from public.employee_private where employee_id = p_employee;
  return v;
end $$;

-- Golongan karyawan dan status penerimaan (tidak sensitif, ikut terlihat seperti data organisasi)
create or replace function public.employee_classify(p_employee uuid, p_origin text, p_class text)
returns public.employees language plpgsql security definer set search_path = public as $$
declare v public.employees;
begin
  perform app.require_hr('hr.manage');
  update public.employees set recruitment_origin = nullif(btrim(coalesce(p_origin, '')), ''), worker_class = nullif(btrim(coalesce(p_class, '')), '')
   where id = p_employee returning * into v;
  if not found then raise exception 'Karyawan tidak ditemukan' using errcode = 'P0002'; end if;
  return v;
end $$;

-- Profil lengkap untuk tampilan dan ekspor. Security invoker: baris hanya untuk yang berhak (HRGA / karyawan ybs).
create or replace view public.profile_register with (security_invoker = true) as
select e.id as employee_id, e.nrp, e.full_name, e.status, d.code as department_code, p.name as position_name,
       e.employment_type, e.company, e.join_date, e.exit_date, e.point_of_hire, e.recruitment_origin, e.worker_class,
       pr.nik as ktp_no, pr.kk_no, pr.gender, pr.blood_type, pr.birth_place, pr.birth_date,
       case when pr.birth_date is null then null else extract(year from age(current_date, pr.birth_date))::int end as age,
       pr.religion, pr.phone, pr.emergency_name, pr.emergency_relation, pr.emergency_phone,
       pr.address_ktp, pr.kelurahan, pr.kecamatan, pr.kabupaten, pr.provinsi, pr.sim_no,
       pr.education_level, pr.education_major, pr.marital_status, pr.children_count,
       case when e.join_date is null then null else
         extract(year from age(coalesce(e.exit_date, current_date), e.join_date))::int * 12
         + extract(month from age(coalesce(e.exit_date, current_date), e.join_date))::int end as tenure_months
  from public.employees e
  join public.departments d on d.id = e.department_id
  left join public.positions p on p.id = e.position_id
  left join public.employee_private pr on pr.employee_id = e.id;
grant select on public.profile_register to authenticated;
revoke all on public.profile_register from anon;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.proname not in ('verify_document','feed_rows') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
revoke all on function app.next_nrp() from public, anon, authenticated;
