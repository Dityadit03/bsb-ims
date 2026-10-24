-- BSB IMS · M8 · HRGA & kompetensi (SMKP 3.1, 3.2, 3.5): data karyawan, jabatan, matriks kompetensi, sertifikat/lisensi
-- dengan masa berlaku, pelatihan & induksi, register otorisasi (SIMPER), roster, permintaan GA, dan karyawan keluar →
-- akun aplikasi dinonaktifkan.

insert into public.permissions(code, module, description) values
  ('hr.manage','hrga','Mengelola data karyawan, kompetensi dan pelatihan'),
  ('hr.exit','hrga','Memproses karyawan keluar dan menonaktifkan akunnya'),
  ('hr.roster','hrga','Menyusun roster karyawan departemennya'),
  ('ga.handle','hrga','Memproses permintaan General Affairs');

insert into public.role_permissions(role_code, permission_code)
select r, p from (values
  ('STAFF','hr.manage'), ('SUPERVISOR','hr.manage'), ('SUPERINTENDENT','hr.manage'), ('DEPT_HEAD','hr.manage'),
  ('DEPT_HEAD','hr.exit'), ('PJO','hr.exit'),
  ('SUPERVISOR','hr.roster'), ('SUPERINTENDENT','hr.roster'), ('DEPT_HEAD','hr.roster'),
  ('STAFF','ga.handle'), ('SUPERVISOR','ga.handle'), ('SUPERINTENDENT','ga.handle'), ('DEPT_HEAD','ga.handle')
) as x(r, p);

insert into public.numbering_schemes(code, name, pattern, module) values
  ('GA','Permintaan General Affairs','GA-BSB-{YYYY}-{N5}','hrga');

insert into public.app_settings(key, value, description) values
  ('competency_warning_days', '30', 'Sertifikat/lisensi dianggap segera habis bila sisa masa berlaku ≤ jumlah hari ini');

create table public.employees(
  id uuid primary key default gen_random_uuid(),
  nrp text not null unique check (nrp ~ '^[A-Z0-9][A-Z0-9./-]*$'),
  full_name text not null,
  department_id uuid not null references public.departments(id),
  section_id uuid references public.sections(id),
  position_id uuid references public.positions(id),
  employment_type text not null default 'permanent' check (employment_type in ('permanent','contract','subcon')),
  company text,
  join_date date,
  status text not null default 'active' check (status in ('active','exited')),
  exit_date date,
  exit_reason text,
  profile_id uuid unique references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (employment_type <> 'subcon' or company is not null),
  check (status = 'active' or exit_date is not null)
);

create table public.competencies(
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9][A-Z0-9./-]*$'),
  name text not null,
  category text not null check (category in ('induction','medical','authorization','certificate','training')),
  validity_months int check (validity_months is null or validity_months > 0),
  unit_type text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (category <> 'authorization' or unit_type is not null)
);

-- Matriks kompetensi: jabatan → kompetensi wajib
create table public.competency_requirements(
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references public.positions(id) on delete cascade,
  competency_id uuid not null references public.competencies(id),
  created_at timestamptz not null default now(),
  unique (position_id, competency_id)
);

create table public.employee_competencies(
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  competency_id uuid not null references public.competencies(id),
  cert_no text,
  issuer text,
  issued_on date not null,
  valid_until date,
  training_id uuid,
  status text not null default 'valid' check (status in ('valid','revoked')),
  revoke_reason text,
  recorded_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (valid_until is null or valid_until >= issued_on)
);
create index on public.employee_competencies(employee_id, competency_id);

create table public.trainings(
  id uuid primary key default gen_random_uuid(),
  title text not null,
  competency_id uuid references public.competencies(id),
  held_on date not null,
  hours numeric not null check (hours > 0),
  trainer text not null,
  location text,
  status text not null default 'planned' check (status in ('planned','done','cancelled')),
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.employee_competencies add foreign key (training_id) references public.trainings(id);

create table public.training_attendees(
  id uuid primary key default gen_random_uuid(),
  training_id uuid not null references public.trainings(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  passed boolean,
  score numeric check (score is null or score between 0 and 100),
  unique (training_id, employee_id)
);

create table public.roster_entries(
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  work_date date not null,
  code text not null check (code in ('D','N','OFF','CUTI','SAKIT','IZIN')),
  set_by uuid not null references public.profiles(id) default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (employee_id, work_date)
);

create table public.ga_requests(
  id uuid primary key default gen_random_uuid(),
  request_no text not null unique,
  category text not null check (category in ('mess','transport','office','facility','pantry','other')),
  description text not null,
  location text,
  needed_by date,
  department_id uuid references public.departments(id),
  requested_by uuid not null references public.profiles(id) default auth.uid(),
  status text not null default 'open' check (status in ('open','in_progress','done','rejected','cancelled')),
  handled_by uuid references public.profiles(id),
  resolution text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

do $$
declare t text;
begin
  foreach t in array array['employees','competencies','trainings','ga_requests'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['employees','competencies','competency_requirements','employee_competencies','trainings','training_attendees',
                           'roster_entries','ga_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
  end loop;
  foreach t in array array['employees','competencies','competency_requirements','employee_competencies','trainings','training_attendees','roster_entries'] loop
    execute format('create policy %I_read on public.%I for select to authenticated using (app.is_active_user())', t, t);
  end loop;
end $$;
-- Permintaan GA: peminta melihat miliknya, petugas GA melihat semua
create policy ga_requests_read on public.ga_requests for select to authenticated
  using (app.is_active_user() and (requested_by = auth.uid() or app.has_permission('ga.handle', (select id from public.departments where code = 'HRGA'))));
revoke insert, update, delete on public.employees, public.competencies, public.competency_requirements, public.employee_competencies,
  public.trainings, public.training_attendees, public.roster_entries, public.ga_requests from authenticated;

-- Master awal: kompetensi & jabatan yang lazim di kontraktor hauling (bisa ditambah dari menu HRGA)
insert into public.competencies(code, name, category, validity_months, unit_type) values
  ('INDUKSI','Induksi keselamatan site','induction',12,null),
  ('MCU','Medical check up','medical',12,null),
  ('SIMPER-DT','SIMPER dump truck','authorization',12,'DT'),
  ('SIMPER-LV','SIMPER light vehicle','authorization',12,'LV'),
  ('SIMPER-EXC','SIMPER excavator','authorization',12,'EXC'),
  ('POP','Pengawas Operasional Pertama','certificate',null,null),
  ('POM','Pengawas Operasional Madya','certificate',null,null),
  ('AK3U','Ahli K3 Umum','certificate',36,null),
  ('P3K','Pertolongan pertama','training',24,null),
  ('DDT','Defensive driving','training',24,null);

insert into public.positions(department_id, code, name, level)
select d.id, x.code, x.name, x.level from (values
  ('PRD','OPR-DT','Operator dump truck','OPR'), ('PRD','OPR-EXC','Operator excavator','OPR'),
  ('PRD','PGW-PRD','Pengawas produksi','SPV'), ('PLT','MEK','Mekanik','STAFF'), ('HSE','SO','Safety officer','STAFF')
) x(dept, code, name, level) join public.departments d on d.code = x.dept
on conflict (department_id, code) do nothing;

insert into public.competency_requirements(position_id, competency_id)
select p.id, c.id from (values
  ('OPR-DT','INDUKSI'), ('OPR-DT','MCU'), ('OPR-DT','SIMPER-DT'), ('OPR-DT','DDT'),
  ('OPR-EXC','INDUKSI'), ('OPR-EXC','MCU'), ('OPR-EXC','SIMPER-EXC'),
  ('PGW-PRD','INDUKSI'), ('PGW-PRD','MCU'), ('PGW-PRD','POP'), ('PGW-PRD','SIMPER-LV'),
  ('MEK','INDUKSI'), ('MEK','MCU'), ('SO','INDUKSI'), ('SO','MCU'), ('SO','AK3U'), ('SO','P3K')
) x(pos, comp) join public.positions p on p.code = x.pos join public.competencies c on c.code = x.comp;

-- ---------------------------------------------------------------- pembantu
create or replace function app.hrga_dept() returns uuid language sql stable security definer set search_path = public as $$
  select id from public.departments where code = 'HRGA'
$$;

create or replace function app.require_hr(p_perm text) returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not app.has_permission(p_perm, app.hrga_dept()) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
end $$;

-- Kompetensi berlaku pada tanggal tertentu
create or replace function app.competency_valid(p_employee uuid, p_competency uuid, p_on date default null) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.employee_competencies
                 where employee_id = p_employee and competency_id = p_competency and status = 'valid'
                   and issued_on <= coalesce(p_on, app.site_today()) and (valid_until is null or valid_until >= coalesce(p_on, app.site_today())))
$$;

create or replace function app.category_valid(p_employee uuid, p_category text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.competencies c where c.category = p_category and app.competency_valid(p_employee, c.id))
$$;

-- Mencatat kompetensi; otorisasi (SIMPER) mensyaratkan induksi dan MCU yang masih berlaku.
create or replace function app.grant_competency(p_employee uuid, p_competency uuid, p_issued date, p_valid_until date, p_cert text,
  p_issuer text, p_training uuid) returns public.employee_competencies
language plpgsql security definer set search_path = public as $$
declare
  c public.competencies;
  v public.employee_competencies;
begin
  select * into c from public.competencies where id = p_competency and active;
  if not found then raise exception 'Kompetensi tidak ditemukan' using errcode = '22023'; end if;
  if not exists(select 1 from public.employees where id = p_employee and status = 'active') then
    raise exception 'Karyawan tidak aktif' using errcode = '22023';
  end if;
  if p_issued is null or p_issued > app.site_today() then raise exception 'Tanggal terbit tidak valid' using errcode = '22023'; end if;
  if c.category = 'authorization' and not (app.category_valid(p_employee, 'induction') and app.category_valid(p_employee, 'medical')) then
    raise exception 'Otorisasi % mensyaratkan induksi dan MCU yang masih berlaku', c.code using errcode = '22023';
  end if;
  insert into public.employee_competencies(employee_id, competency_id, cert_no, issuer, issued_on, valid_until, training_id)
  values (p_employee, p_competency, p_cert, p_issuer, p_issued,
          coalesce(p_valid_until, case when c.validity_months is not null then (p_issued + make_interval(months => c.validity_months))::date - 1 end),
          p_training)
  returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------- master & karyawan
create or replace function public.position_save(p_department uuid, p_code text, p_name text, p_level text)
returns public.positions language plpgsql security definer set search_path = public as $$
declare v public.positions;
begin
  perform app.require_hr('hr.manage');
  insert into public.positions(department_id, code, name, level)
  values (p_department, upper(app.require_text(p_code, 'Kode jabatan')), app.require_text(p_name, 'Nama jabatan'), p_level)
  on conflict (department_id, code) do update set name = excluded.name, level = excluded.level, active = true
  returning * into v;
  return v;
end $$;

create or replace function public.competency_save(p_code text, p_name text, p_category text, p_validity_months int default null,
  p_unit_type text default null, p_active boolean default true)
returns public.competencies language plpgsql security definer set search_path = public as $$
declare v public.competencies;
begin
  perform app.require_hr('hr.manage');
  insert into public.competencies(code, name, category, validity_months, unit_type, active)
  values (upper(app.require_text(p_code, 'Kode kompetensi')), app.require_text(p_name, 'Nama kompetensi'), p_category, p_validity_months,
          nullif(upper(btrim(coalesce(p_unit_type, ''))), ''), p_active)
  on conflict (code) do update set name = excluded.name, category = excluded.category, validity_months = excluded.validity_months,
    unit_type = excluded.unit_type, active = excluded.active
  returning * into v;
  return v;
end $$;

create or replace function public.competency_requirement_set(p_position uuid, p_competency uuid, p_required boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform app.require_hr('hr.manage');
  if p_required then
    insert into public.competency_requirements(position_id, competency_id) values (p_position, p_competency) on conflict do nothing;
  else
    delete from public.competency_requirements where position_id = p_position and competency_id = p_competency;
  end if;
end $$;

-- Simpan karyawan (NRP sama = perbarui). p_email menautkan karyawan ke akun aplikasi.
create or replace function public.employee_save(p_nrp text, p_full_name text, p_department uuid, p_position uuid default null,
  p_employment_type text default 'permanent', p_company text default null, p_join_date date default null, p_email text default null,
  p_section uuid default null)
returns public.employees language plpgsql security definer set search_path = public as $$
declare
  v public.employees;
  v_profile uuid;
begin
  perform app.require_hr('hr.manage');
  if p_position is not null and not exists(select 1 from public.positions where id = p_position and (department_id is null or department_id = p_department)) then
    raise exception 'Jabatan tidak sesuai departemen' using errcode = '22023';
  end if;
  if coalesce(btrim(p_email), '') <> '' then
    select id into v_profile from public.profiles where lower(email) = lower(btrim(p_email));
    if v_profile is null then raise exception 'Akun dengan email % belum pernah login', p_email using errcode = '22023'; end if;
  end if;
  insert into public.employees(nrp, full_name, department_id, section_id, position_id, employment_type, company, join_date, profile_id)
  values (upper(app.require_text(p_nrp, 'NRP')), app.require_text(p_full_name, 'Nama'), p_department, p_section, p_position,
          coalesce(p_employment_type, 'permanent'), nullif(btrim(coalesce(p_company, '')), ''), p_join_date, v_profile)
  on conflict (nrp) do update set full_name = excluded.full_name, department_id = excluded.department_id, section_id = excluded.section_id,
    position_id = excluded.position_id, employment_type = excluded.employment_type, company = excluded.company,
    join_date = excluded.join_date, profile_id = coalesce(excluded.profile_id, employees.profile_id)
  returning * into v;
  if v.status <> 'active' then raise exception 'Karyawan % sudah keluar', v.nrp using errcode = '22023'; end if;
  return v;
end $$;

create or replace function public.employee_competency_add(p_employee uuid, p_competency uuid, p_issued date, p_valid_until date default null,
  p_cert_no text default null, p_issuer text default null)
returns public.employee_competencies language plpgsql security definer set search_path = public as $$
begin
  perform app.require_hr('hr.manage');
  return app.grant_competency(p_employee, p_competency, p_issued, p_valid_until, p_cert_no, p_issuer, null);
end $$;

-- Pencabutan (mis. pelanggaran berat) oleh HR atau atasan departemen karyawan
create or replace function public.employee_competency_revoke(p_id uuid, p_reason text)
returns public.employee_competencies language plpgsql security definer set search_path = public as $$
declare v public.employee_competencies;
begin
  select ec.* into v from public.employee_competencies ec where ec.id = p_id for update;
  if not found then raise exception 'Data tidak ditemukan' using errcode = 'P0002'; end if;
  if not (app.has_permission('hr.manage', app.hrga_dept())
          or app.has_permission('hr.roster', (select department_id from public.employees where id = v.employee_id))) then
    raise exception 'Tidak berwenang' using errcode = '42501';
  end if;
  update public.employee_competencies set status = 'revoked', revoke_reason = app.require_text(p_reason, 'Alasan pencabutan')
   where id = p_id returning * into v;
  return v;
end $$;

-- Karyawan keluar: status keluar, akun aplikasi dinonaktifkan dan seluruh perannya diakhiri.
create or replace function public.employee_exit(p_employee uuid, p_date date, p_reason text)
returns public.employees language plpgsql security definer set search_path = public as $$
declare v public.employees;
begin
  perform app.require_hr('hr.exit');
  select * into v from public.employees where id = p_employee for update;
  if not found then raise exception 'Karyawan tidak ditemukan' using errcode = 'P0002'; end if;
  if v.status <> 'active' then raise exception 'Karyawan sudah keluar' using errcode = '22023'; end if;
  if v.profile_id = auth.uid() then raise exception 'Tidak bisa memproses keluarnya diri sendiri' using errcode = '42501'; end if;
  if p_date is null or p_date > app.site_today() then raise exception 'Tanggal keluar tidak boleh di masa depan' using errcode = '22023'; end if;
  update public.employees set status = 'exited', exit_date = p_date, exit_reason = app.require_text(p_reason, 'Alasan keluar')
   where id = p_employee returning * into v;
  if v.profile_id is not null then
    update public.profiles set status = 'exited' where id = v.profile_id;
    update public.user_roles set valid_until = greatest(valid_from, p_date)
     where user_id = v.profile_id and (valid_until is null or valid_until > p_date);
    perform app.log_event('user.exit', 'profiles', v.profile_id::text, jsonb_build_object('employee', v.nrp, 'date', p_date));
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------- pelatihan
create or replace function public.training_save(p_title text, p_held_on date, p_hours numeric, p_trainer text, p_competency uuid default null,
  p_location text default null, p_employees uuid[] default '{}')
returns public.trainings language plpgsql security definer set search_path = public as $$
declare v public.trainings;
begin
  perform app.require_hr('hr.manage');
  insert into public.trainings(title, competency_id, held_on, hours, trainer, location)
  values (app.require_text(p_title, 'Judul pelatihan'), p_competency, p_held_on, p_hours, app.require_text(p_trainer, 'Pemateri'), p_location)
  returning * into v;
  insert into public.training_attendees(training_id, employee_id)
  select v.id, e from unnest(coalesce(p_employees, '{}')) e on conflict do nothing;
  return v;
end $$;

create or replace function public.training_add_attendees(p_training uuid, p_employees uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  perform app.require_hr('hr.manage');
  if not exists(select 1 from public.trainings where id = p_training and status = 'planned') then
    raise exception 'Pelatihan sudah selesai / dibatalkan' using errcode = '22023';
  end if;
  insert into public.training_attendees(training_id, employee_id) select p_training, e from unnest(p_employees) e on conflict do nothing;
end $$;

-- Selesaikan pelatihan. p_results: [{"employee": uuid, "passed": bool, "score": n}]. Peserta lulus otomatis mendapat kompetensinya.
create or replace function public.training_complete(p_training uuid, p_results jsonb)
returns public.trainings language plpgsql security definer set search_path = public as $$
declare
  v public.trainings;
  r jsonb;
begin
  perform app.require_hr('hr.manage');
  select * into v from public.trainings where id = p_training for update;
  if not found then raise exception 'Pelatihan tidak ditemukan' using errcode = 'P0002'; end if;
  if v.status <> 'planned' then raise exception 'Pelatihan sudah ditutup' using errcode = '22023'; end if;
  if v.held_on > app.site_today() then raise exception 'Pelatihan belum dilaksanakan' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_results, '[]')) loop
    update public.training_attendees set passed = (r->>'passed')::boolean, score = (r->>'score')::numeric
     where training_id = p_training and employee_id = (r->>'employee')::uuid;
  end loop;
  if exists(select 1 from public.training_attendees where training_id = p_training and passed is null) then
    raise exception 'Isi hasil (lulus/tidak) untuk semua peserta' using errcode = '22023';
  end if;
  if v.competency_id is not null then
    perform app.grant_competency(a.employee_id, v.competency_id, v.held_on, null, null, v.trainer, v.id)
       from public.training_attendees a where a.training_id = p_training and a.passed;
  end if;
  update public.trainings set status = 'done' where id = p_training returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------- roster
create or replace function public.roster_set(p_employees uuid[], p_from date, p_to date, p_code text)
returns int language plpgsql security definer set search_path = public as $$
declare
  e public.employees;
  n int := 0;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Rentang tanggal tidak valid (maksimal 63 hari)' using errcode = '22023';
  end if;
  for e in select * from public.employees where id = any(p_employees) loop
    if not (app.has_permission('hr.manage', app.hrga_dept()) or app.has_permission('hr.roster', e.department_id)) then
      raise exception 'Tidak berwenang menyusun roster %', e.full_name using errcode = '42501';
    end if;
    if e.status <> 'active' then raise exception 'Karyawan % sudah keluar', e.full_name using errcode = '22023'; end if;
    insert into public.roster_entries(employee_id, work_date, code)
    select e.id, d::date, p_code from generate_series(p_from, p_to, interval '1 day') d
    on conflict (employee_id, work_date) do update set code = excluded.code, set_by = auth.uid(), updated_at = now();
    n := n + (p_to - p_from + 1);
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- General Affairs
create or replace function public.ga_request_create(p_category text, p_description text, p_location text default null,
  p_needed_by date default null, p_idempotency_key text default null)
returns public.ga_requests language plpgsql security definer set search_path = public as $$
declare
  v public.ga_requests;
  v_reg public.registrations;
begin
  if not app.is_active_user() then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if p_idempotency_key is not null then
    select g.* into v from public.registrations r join public.ga_requests g on g.request_no = r.number where r.idempotency_key = p_idempotency_key;
    if found then return v; end if;
  end if;
  v_reg := app.allocate_number('GA', '{}', p_idempotency_key);
  insert into public.ga_requests(request_no, category, description, location, needed_by, department_id)
  values (v_reg.number, p_category, app.require_text(p_description, 'Uraian permintaan'), p_location, p_needed_by,
          (select department_id from public.profiles where id = auth.uid()))
  returning * into v;
  update public.registrations set ref_table = 'ga_requests', ref_id = v.id where id = v_reg.id;
  perform app.notify_users(app.users_with_permission('ga.handle', app.hrga_dept()), 'ga.request', 'Permintaan GA ' || v.request_no,
    left(v.description, 140), '/hrga/ga');
  return v;
end $$;

-- p_action: start | done | reject. Selesai/tolak wajib keterangan.
create or replace function public.ga_request_process(p_id uuid, p_action text, p_note text default null)
returns public.ga_requests language plpgsql security definer set search_path = public as $$
declare v public.ga_requests;
begin
  perform app.require_hr('ga.handle');
  select * into v from public.ga_requests where id = p_id for update;
  if not found then raise exception 'Permintaan tidak ditemukan' using errcode = 'P0002'; end if;
  if v.status not in ('open','in_progress') then raise exception 'Permintaan sudah ditutup' using errcode = '22023'; end if;
  if p_action = 'start' then
    update public.ga_requests set status = 'in_progress', handled_by = auth.uid() where id = p_id returning * into v;
  elsif p_action in ('done','reject') then
    update public.ga_requests set status = case p_action when 'done' then 'done' else 'rejected' end, handled_by = auth.uid(),
      resolution = app.require_text(p_note, 'Keterangan penyelesaian'), closed_at = now()
     where id = p_id returning * into v;
    perform app.notify_users(array[v.requested_by], 'ga.request', 'Permintaan ' || v.request_no ||
      case p_action when 'done' then ' selesai' else ' ditolak' end, p_note, '/hrga/ga');
  else
    raise exception 'Aksi tidak dikenal' using errcode = '22023';
  end if;
  return v;
end $$;

create or replace function public.ga_request_cancel(p_id uuid)
returns public.ga_requests language plpgsql security definer set search_path = public as $$
declare v public.ga_requests;
begin
  update public.ga_requests set status = 'cancelled', closed_at = now()
   where id = p_id and requested_by = auth.uid() and status = 'open' returning * into v;
  if not found then raise exception 'Hanya permintaan sendiri yang belum diproses yang bisa dibatalkan' using errcode = '22023'; end if;
  return v;
end $$;

-- ---------------------------------------------------------------- tampilan
create view public.employee_competency_view with (security_invoker = true) as
select ec.id, ec.employee_id, e.nrp, e.full_name, e.department_id, d.code as department_code, ec.competency_id, c.code as competency_code,
       c.name as competency_name, c.category, c.unit_type, ec.cert_no, ec.issuer, ec.issued_on, ec.valid_until, ec.status, ec.revoke_reason,
       ec.training_id,
       case when ec.status = 'revoked' then 'revoked'
            when ec.valid_until is not null and ec.valid_until < app.site_today() then 'expired'
            when ec.valid_until is not null and ec.valid_until - app.site_today()
                 <= coalesce((select value::text::int from public.app_settings where key = 'competency_warning_days'), 30) then 'expiring'
            else 'valid' end as validity,
       ec.valid_until - app.site_today() as days_left
  from public.employee_competencies ec
  join public.employees e on e.id = ec.employee_id
  join public.departments d on d.id = e.department_id
  join public.competencies c on c.id = ec.competency_id;

-- Matriks kompetensi: tiap karyawan aktif × kompetensi wajib jabatannya, dengan status terbaik yang dimiliki.
create view public.competency_matrix with (security_invoker = true) as
select e.id as employee_id, e.nrp, e.full_name, e.department_id, d.code as department_code, e.position_id, p.name as position_name,
       c.id as competency_id, c.code as competency_code, c.name as competency_name,
       coalesce((select v.validity from public.employee_competency_view v where v.employee_id = e.id and v.competency_id = c.id
                  order by case v.validity when 'valid' then 1 when 'expiring' then 2 when 'expired' then 3 else 4 end,
                           v.valid_until desc nulls first limit 1), 'missing') as status,
       (select max(v.valid_until) from public.employee_competency_view v where v.employee_id = e.id and v.competency_id = c.id
          and v.validity in ('valid','expiring')) as valid_until
  from public.employees e
  join public.departments d on d.id = e.department_id
  join public.positions p on p.id = e.position_id
  join public.competency_requirements r on r.position_id = e.position_id
  join public.competencies c on c.id = r.competency_id
 where e.status = 'active';

create view public.employee_register with (security_invoker = true) as
select e.id, e.nrp, e.full_name, e.department_id, d.code as department_code, e.position_id, p.name as position_name, e.employment_type,
       e.company, e.join_date, e.status, e.exit_date, e.profile_id, pr.email,
       coalesce(m.required, 0) as required, coalesce(m.compliant, 0) as compliant, coalesce(m.expiring, 0) as expiring,
       case when coalesce(m.required, 0) = 0 then null else round(100.0 * m.compliant / m.required, 0) end as compliance_pct
  from public.employees e
  join public.departments d on d.id = e.department_id
  left join public.positions p on p.id = e.position_id
  left join public.profiles pr on pr.id = e.profile_id
  left join (select employee_id, count(*)::int required, count(*) filter (where status in ('valid','expiring'))::int compliant,
                    count(*) filter (where status = 'expiring')::int expiring
               from public.competency_matrix group by employee_id) m on m.employee_id = e.id;

-- Register otorisasi (SIMPER) yang berlaku hari ini, dipakai pengawas saat penugasan operator.
create view public.authorization_register with (security_invoker = true) as
select v.id, v.employee_id, v.nrp, v.full_name, v.department_code, v.competency_code, v.competency_name, v.unit_type, v.cert_no,
       v.issued_on, v.valid_until, v.validity, v.days_left
  from public.employee_competency_view v
  join public.employees e on e.id = v.employee_id
 where v.category = 'authorization' and v.validity in ('valid','expiring') and e.status = 'active';

create view public.ga_register with (security_invoker = true) as
select g.id, g.request_no, g.category, g.description, g.location, g.needed_by, g.status, g.resolution, g.created_at, g.closed_at,
       g.requested_by, p.full_name as requester_name, d.code as department_code, h.full_name as handler_name
  from public.ga_requests g
  join public.profiles p on p.id = g.requested_by
  left join public.departments d on d.id = g.department_id
  left join public.profiles h on h.id = g.handled_by;

do $$
declare v text;
begin
  foreach v in array array['employee_competency_view','competency_matrix','employee_register','authorization_register','ga_register'] loop
    execute format('grant select on public.%I to authenticated', v);
    execute format('revoke all on public.%I from anon', v);
  end loop;
end $$;

revoke all on function app.hrga_dept(), app.require_hr(text), app.competency_valid(uuid, uuid, date), app.category_valid(uuid, text),
  app.grant_competency(uuid, uuid, date, date, text, text, uuid) from public, anon, authenticated;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and p.proname <> 'verify_document' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
