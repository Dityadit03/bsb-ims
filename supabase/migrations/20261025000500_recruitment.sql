-- HRIS tahap E: rekrutmen.
-- FPTK (permintaan tenaga kerja) dari departemen → verifikasi HRGA terhadap MPP → persetujuan PJO/manajemen.
-- Pelamar ditautkan ke FPTK dan melewati tahap seleksi; diterima → otomatis jadi karyawan + kontrak + checklist mobilisasi.

insert into public.permissions(code, module, description) values
  ('recruit.approve','hrga','Menyetujui permintaan tenaga kerja (FPTK)');
insert into public.role_permissions(role_code, permission_code) values ('PJO','recruit.approve'), ('MGMT_APPROVER','recruit.approve');

insert into public.numbering_schemes(code, name, pattern, module) values
  ('FPTK','Formulir permintaan tenaga kerja','FPTK-BSB-{YYYY}-{N4}','hrga');

insert into public.app_settings(key, value, description) values
  ('probation_months', '3', 'Masa percobaan karyawan tetap baru (bulan)'),
  ('pkwt_months', '12', 'Lama kontrak PKWT pertama karyawan baru (bulan)');

create table public.job_requisitions(
  id uuid primary key default gen_random_uuid(),
  req_no text not null unique,
  department_id uuid not null references public.departments(id),
  position_id uuid not null references public.positions(id),
  headcount int not null check (headcount between 1 and 200),
  employment_type text not null check (employment_type in ('permanent','contract')),
  reason text not null check (reason in ('replacement','additional','new_position')),
  replaced_employee_id uuid references public.employees(id),
  needed_by date not null,
  requirements text not null,
  justification text,
  status text not null default 'submitted' check (status in ('submitted','verified','open','filled','closed','rejected','cancelled')),
  mpp_planned int,
  mpp_actual int,
  verifier_id uuid references public.profiles(id),
  verified_at timestamptz,
  approver_id uuid references public.profiles(id),
  approved_at timestamptz,
  decision_note text,
  closed_at timestamptz,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (reason <> 'replacement' or replaced_employee_id is not null)
);

create table public.candidates(
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  nik text check (nik is null or nik ~ '^[0-9]{16}$'),
  phone text,
  email text,
  birth_date date,
  gender text check (gender in ('L','P')),
  domicile text,
  education_level text check (education_level in ('SD','SMP','SMA','D1','D2','D3','D4','S1','S2','S3')),
  education_major text,
  experience_years numeric(4,1),
  last_employer text,
  source text not null default 'walk_in' check (source in ('walk_in','referral','job_portal','disnaker','internal','social_media','other')),
  is_local boolean not null default false,
  note text,
  employee_id uuid references public.employees(id),
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create unique index candidates_nik on public.candidates(nik) where nik is not null;

create table public.applications(
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.job_requisitions(id),
  candidate_id uuid not null references public.candidates(id),
  stage text not null default 'screening' check (stage in ('screening','psikotes','interview','mcu','offering','hired','rejected','withdrawn')),
  stage_at timestamptz not null default now(),
  close_reason text,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (requisition_id, candidate_id)
);

create table public.application_events(
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  stage text not null,
  result text not null check (result in ('pass','fail','note','withdrawn')),
  score numeric(5,1) check (score between 0 and 100),
  note text,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.application_events(application_id);

-- penawaran kerja: nominal gaji hanya terbaca HRGA & payroll
create table public.job_offers(
  application_id uuid primary key references public.applications(id) on delete cascade,
  basic_wage numeric(14,0) not null check (basic_wage > 0),
  allowances text,
  start_date date not null,
  status text not null default 'sent' check (status in ('sent','accepted','declined')),
  decided_at timestamptz,
  note text,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

do $$
declare t text;
begin
  foreach t in array array['job_requisitions','candidates','applications','job_offers'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['job_requisitions','candidates','applications','application_events','job_offers'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
  end loop;
end $$;

-- departemen pemohon (atasan departemen) ikut melihat FPTK & pelamarnya untuk wawancara
create or replace function app.can_see_req(p_dept uuid) returns boolean language sql stable security definer set search_path = public as $$
  select app.is_hr() or app.has_permission('hr.roster', p_dept) or app.has_permission_anywhere('recruit.approve')
$$;

create policy job_requisitions_read on public.job_requisitions for select to authenticated using (app.can_see_req(department_id));
create policy applications_read on public.applications for select to authenticated using (
  exists(select 1 from public.job_requisitions r where r.id = requisition_id and app.can_see_req(r.department_id)));
create policy application_events_read on public.application_events for select to authenticated using (
  exists(select 1 from public.applications a where a.id = application_id));
create policy candidates_read on public.candidates for select to authenticated using (
  app.is_hr() or exists(select 1 from public.applications a join public.job_requisitions r on r.id = a.requisition_id
                         where a.candidate_id = candidates.id and app.has_permission('hr.roster', r.department_id)));
create policy job_offers_read on public.job_offers for select to authenticated using (app.is_hr() or app.is_payroll());

-- ---------------------------------------------------------------- FPTK
create or replace function public.requisition_create(p_department uuid, p_position uuid, p_headcount int, p_type text, p_reason text,
  p_replaced uuid, p_needed_by date, p_requirements text, p_justification text default null, p_idempotency_key text default null)
returns public.job_requisitions language plpgsql security definer set search_path = public as $$
declare
  v public.job_requisitions;
  v_reg public.registrations;
  v_year int := extract(year from coalesce(p_needed_by, app.site_today()))::int;
begin
  if not (app.is_hr() or app.has_permission('hr.roster', p_department)) then
    raise exception 'FPTK diajukan atasan departemen atau HRGA' using errcode = '42501';
  end if;
  if p_idempotency_key is not null then
    select q.* into v from public.registrations r join public.job_requisitions q on q.req_no = r.number where r.idempotency_key = p_idempotency_key;
    if found then return v; end if;
  end if;
  if not exists(select 1 from public.positions where id = p_position and active and (department_id is null or department_id = p_department)) then
    raise exception 'Jabatan tidak sesuai departemen' using errcode = '22023';
  end if;
  if p_reason = 'replacement' and not exists(select 1 from public.employees where id = p_replaced and department_id = p_department) then
    raise exception 'Pilih karyawan yang digantikan (dari departemen yang sama)' using errcode = '22023';
  end if;
  if p_needed_by is null or p_needed_by < app.site_today() then raise exception 'Tanggal dibutuhkan tidak valid' using errcode = '22023'; end if;
  v_reg := app.allocate_number('FPTK', jsonb_build_object('date', app.site_today()), p_idempotency_key);
  insert into public.job_requisitions(req_no, department_id, position_id, headcount, employment_type, reason, replaced_employee_id, needed_by,
    requirements, justification, mpp_planned, mpp_actual)
  select v_reg.number, p_department, p_position, p_headcount, p_type, p_reason, case when p_reason = 'replacement' then p_replaced end, p_needed_by,
    app.require_text(p_requirements, 'Kualifikasi'), p_justification,
    (select planned from public.manpower_plans where year = v_year and position_id = p_position),
    (select count(*)::int from public.employees where status = 'active' and position_id = p_position)
  returning * into v;
  update public.registrations set ref_table = 'job_requisitions', ref_id = v.id where id = v_reg.id;
  perform app.notify_users(app.users_with_permission('hr.manage', app.hrga_dept()), 'hr.recruit', 'FPTK ' || v.req_no || ' menunggu verifikasi HRGA',
    (select name from public.positions where id = p_position) || ' · ' || p_headcount || ' orang', '/hrga/rekrutmen/' || v.id);
  return v;
end $$;

-- p_approve: verifikasi HRGA (submitted → verified), lalu persetujuan PJO/manajemen (verified → open). Penolakan wajib alasan.
create or replace function public.requisition_decide(p_id uuid, p_approve boolean, p_note text default null)
returns public.job_requisitions language plpgsql security definer set search_path = public as $$
declare v public.job_requisitions;
begin
  select * into v from public.job_requisitions where id = p_id for update;
  if not found then raise exception 'FPTK tidak ditemukan' using errcode = 'P0002'; end if;
  if v.created_by = auth.uid() then raise exception 'Pengaju tidak bisa memutuskan FPTK-nya sendiri' using errcode = '42501'; end if;
  if v.status = 'submitted' then
    if not app.is_hr() then raise exception 'Verifikasi oleh HRGA' using errcode = '42501'; end if;
  elsif v.status = 'verified' then
    if not app.has_permission_anywhere('recruit.approve') then raise exception 'Persetujuan oleh PJO / manajemen' using errcode = '42501'; end if;
    if v.verifier_id = auth.uid() then raise exception 'Penyetuju harus berbeda dari verifikator' using errcode = '42501'; end if;
  else
    raise exception 'FPTK sudah diputuskan' using errcode = '22023';
  end if;
  if not p_approve then
    update public.job_requisitions set status = 'rejected', decision_note = app.require_text(p_note, 'Alasan penolakan'), closed_at = now(),
      verifier_id = case when status = 'submitted' then auth.uid() else verifier_id end,
      verified_at = case when status = 'submitted' then now() else verified_at end,
      approver_id = case when status = 'verified' then auth.uid() else approver_id end,
      approved_at = case when status = 'verified' then now() else approved_at end
     where id = p_id returning * into v;
    perform app.notify_users(array[v.created_by], 'hr.recruit', 'FPTK ' || v.req_no || ' ditolak', p_note, '/hrga/rekrutmen/' || v.id);
  elsif v.status = 'submitted' then
    update public.job_requisitions set status = 'verified', verifier_id = auth.uid(), verified_at = now(), decision_note = p_note
     where id = p_id returning * into v;
    perform app.notify_users(app.users_with_permission('recruit.approve'), 'hr.recruit', 'FPTK ' || v.req_no || ' menunggu persetujuan',
      (select name from public.positions where id = v.position_id) || ' · ' || v.headcount || ' orang', '/hrga/rekrutmen/' || v.id);
  else
    update public.job_requisitions set status = 'open', approver_id = auth.uid(), approved_at = now(), decision_note = coalesce(p_note, decision_note)
     where id = p_id returning * into v;
    perform app.notify_users(array[v.created_by] || app.users_with_permission('hr.manage', app.hrga_dept()), 'hr.recruit',
      'FPTK ' || v.req_no || ' disetujui, rekrutmen dibuka', null, '/hrga/rekrutmen/' || v.id);
  end if;
  return v;
end $$;

create or replace function public.requisition_close(p_id uuid, p_cancel boolean, p_reason text) returns public.job_requisitions
language plpgsql security definer set search_path = public as $$
declare v public.job_requisitions;
begin
  select * into v from public.job_requisitions where id = p_id for update;
  if not found then raise exception 'FPTK tidak ditemukan' using errcode = 'P0002'; end if;
  if not (app.is_hr() or (v.created_by = auth.uid() and v.status = 'submitted')) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if v.status not in ('submitted','verified','open') then raise exception 'FPTK sudah ditutup' using errcode = '22023'; end if;
  update public.job_requisitions set status = case when p_cancel then 'cancelled' else 'closed' end, closed_at = now(),
    decision_note = app.require_text(p_reason, 'Alasan') where id = p_id returning * into v;
  update public.applications set stage = 'rejected', stage_at = now(), close_reason = 'FPTK ditutup: ' || p_reason
   where requisition_id = p_id and stage not in ('hired','rejected','withdrawn');
  return v;
end $$;

-- ---------------------------------------------------------------- kandidat & lamaran
create or replace function public.candidate_save(p_id uuid, p_data jsonb, p_attachments uuid[] default '{}')
returns public.candidates language plpgsql security definer set search_path = public as $$
declare
  v public.candidates;
  v_nik text := nullif(regexp_replace(coalesce(p_data->>'nik', ''), '\D', '', 'g'), '');
begin
  perform app.require_hr('hr.manage');
  if v_nik is not null and exists(select 1 from public.candidates where nik = v_nik and id is distinct from p_id) then
    raise exception 'NIK % sudah ada di bank kandidat', v_nik using errcode = '23505';
  end if;
  if p_id is null then
    insert into public.candidates(full_name) values (app.require_text(p_data->>'full_name', 'Nama')) returning * into v;
  else
    select * into v from public.candidates where id = p_id for update;
    if not found then raise exception 'Kandidat tidak ditemukan' using errcode = 'P0002'; end if;
  end if;
  update public.candidates set
    full_name = coalesce(nullif(btrim(p_data->>'full_name'), ''), full_name), nik = coalesce(v_nik, nik),
    phone = coalesce(nullif(p_data->>'phone', ''), phone), email = coalesce(nullif(lower(btrim(p_data->>'email')), ''), email),
    birth_date = coalesce(nullif(p_data->>'birth_date', '')::date, birth_date), gender = coalesce(nullif(p_data->>'gender', ''), gender),
    domicile = coalesce(nullif(p_data->>'domicile', ''), domicile), education_level = coalesce(nullif(upper(p_data->>'education_level'), ''), education_level),
    education_major = coalesce(nullif(p_data->>'education_major', ''), education_major),
    experience_years = coalesce(nullif(p_data->>'experience_years', '')::numeric, experience_years),
    last_employer = coalesce(nullif(p_data->>'last_employer', ''), last_employer), source = coalesce(nullif(p_data->>'source', ''), source),
    is_local = coalesce((p_data->>'is_local')::boolean, is_local), note = coalesce(nullif(p_data->>'note', ''), note)
   where id = v.id returning * into v;
  perform app.claim_attachments(p_attachments, 'candidates', v.id);
  return v;
end $$;

create or replace function public.application_add(p_requisition uuid, p_candidate uuid) returns public.applications
language plpgsql security definer set search_path = public as $$
declare v public.applications;
begin
  perform app.require_hr('hr.manage');
  if not exists(select 1 from public.job_requisitions where id = p_requisition and status = 'open') then
    raise exception 'Lamaran hanya untuk FPTK yang sudah disetujui dan masih dibuka' using errcode = '22023';
  end if;
  if exists(select 1 from public.candidates where id = p_candidate and employee_id is not null
              and exists(select 1 from public.employees where id = employee_id and status = 'active')) then
    raise exception 'Kandidat sudah menjadi karyawan aktif' using errcode = '22023';
  end if;
  insert into public.applications(requisition_id, candidate_id) values (p_requisition, p_candidate) returning * into v;
  insert into public.application_events(application_id, stage, result, note) values (v.id, 'screening', 'note', 'Lamaran dicatat');
  return v;
exception when unique_violation then
  raise exception 'Kandidat sudah melamar di FPTK ini' using errcode = '23505';
end $$;

-- Hasil tahap seleksi. Lulus → maju ke tahap berikutnya (boleh melompati psikotes/MCU); gagal → ditolak (alasan wajib).
-- Wawancara user boleh dicatat atasan departemen pemohon; tahap lain oleh HRGA.
create or replace function public.application_result(p_id uuid, p_result text, p_score numeric default null, p_note text default null,
  p_next text default null)
returns public.applications language plpgsql security definer set search_path = public as $$
declare
  v public.applications;
  r public.job_requisitions;
  order_ text[] := array['screening','psikotes','interview','mcu','offering'];
  v_next text;
begin
  select * into v from public.applications where id = p_id for update;
  if not found then raise exception 'Lamaran tidak ditemukan' using errcode = 'P0002'; end if;
  select * into r from public.job_requisitions where id = v.requisition_id;
  if not (app.is_hr() or (v.stage = 'interview' and app.has_permission('hr.roster', r.department_id))) then
    raise exception 'Tidak berwenang mencatat hasil tahap ini' using errcode = '42501';
  end if;
  if v.stage not in ('screening','psikotes','interview','mcu') then raise exception 'Lamaran tidak sedang dalam tahap seleksi' using errcode = '22023'; end if;
  if p_result not in ('pass','fail','note','withdrawn') then raise exception 'Hasil tidak dikenal' using errcode = '22023'; end if;
  insert into public.application_events(application_id, stage, result, score, note)
  values (p_id, v.stage, p_result, p_score, case when p_result in ('fail','withdrawn') then app.require_text(p_note, 'Alasan') else p_note end);
  if p_result = 'pass' then
    v_next := coalesce(p_next, order_[array_position(order_, v.stage) + 1]);
    if array_position(order_, v_next) is null or array_position(order_, v_next) <= array_position(order_, v.stage) then
      raise exception 'Tahap berikutnya tidak valid' using errcode = '22023';
    end if;
    if v_next = 'offering' and not exists(select 1 from public.application_events where application_id = p_id and stage = 'interview' and result = 'pass')
       and v.stage <> 'interview' then
      raise exception 'Wawancara user wajib lulus sebelum penawaran kerja' using errcode = '22023';
    end if;
    update public.applications set stage = v_next, stage_at = now() where id = p_id returning * into v;
    if v_next = 'interview' then
      perform app.notify_users(app.users_with_permission('hr.roster', r.department_id), 'hr.recruit',
        'Jadwalkan wawancara: ' || (select full_name from public.candidates where id = v.candidate_id), r.req_no, '/hrga/rekrutmen/' || r.id);
    end if;
  elsif p_result in ('fail','withdrawn') then
    update public.applications set stage = case p_result when 'fail' then 'rejected' else 'withdrawn' end, stage_at = now(), close_reason = p_note
     where id = p_id returning * into v;
  end if;
  return v;
end $$;

create or replace function public.offer_save(p_application uuid, p_wage numeric, p_allowances text, p_start date, p_note text default null)
returns public.job_offers language plpgsql security definer set search_path = public as $$
declare v public.job_offers;
begin
  perform app.require_hr('hr.manage');
  if not exists(select 1 from public.applications where id = p_application and stage = 'offering') then
    raise exception 'Penawaran hanya untuk pelamar di tahap offering' using errcode = '22023';
  end if;
  if p_wage is null or p_wage <= 0 then raise exception 'Gaji pokok tidak valid' using errcode = '22023'; end if;
  if p_start is null then raise exception 'Tanggal mulai kerja wajib' using errcode = '22023'; end if;
  insert into public.job_offers(application_id, basic_wage, allowances, start_date, note)
  values (p_application, round(p_wage), p_allowances, p_start, p_note)
  on conflict (application_id) do update set basic_wage = excluded.basic_wage, allowances = excluded.allowances, start_date = excluded.start_date,
    note = excluded.note, status = 'sent', decided_at = null
  returning * into v;
  return v;
end $$;

create or replace function public.offer_decide(p_application uuid, p_accepted boolean, p_note text default null)
returns public.job_offers language plpgsql security definer set search_path = public as $$
declare v public.job_offers;
begin
  perform app.require_hr('hr.manage');
  update public.job_offers set status = case when p_accepted then 'accepted' else 'declined' end, decided_at = now(), note = coalesce(p_note, note)
   where application_id = p_application and status = 'sent' returning * into v;
  if not found then raise exception 'Belum ada penawaran yang menunggu jawaban' using errcode = '22023'; end if;
  if not p_accepted then
    insert into public.application_events(application_id, stage, result, note) values (p_application, 'offering', 'withdrawn', coalesce(p_note, 'Penawaran ditolak kandidat'));
    update public.applications set stage = 'withdrawn', stage_at = now(), close_reason = coalesce(p_note, 'Penawaran ditolak kandidat') where id = p_application;
  end if;
  return v;
end $$;

-- Diterima: dibuat data karyawan (+ data pribadi dari kandidat), kontrak percobaan / PKWT, dan checklist mobilisasi.
-- Gaji tidak diisi otomatis: payroll diberi tahu nominal penawaran untuk diisi di struktur gaji.
create or replace function public.application_hire(p_id uuid, p_nrp text, p_email text default null) returns public.employees
language plpgsql security definer set search_path = public as $$
declare
  a public.applications;
  r public.job_requisitions;
  c public.candidates;
  o public.job_offers;
  e public.employees;
  v_months int;
  v_hired int;
begin
  perform app.require_hr('hr.manage');
  select * into a from public.applications where id = p_id for update;
  if not found then raise exception 'Lamaran tidak ditemukan' using errcode = 'P0002'; end if;
  select * into o from public.job_offers where application_id = p_id;
  if a.stage <> 'offering' or o.status is distinct from 'accepted' then
    raise exception 'Kandidat harus menerima penawaran kerja dulu' using errcode = '22023';
  end if;
  select * into r from public.job_requisitions where id = a.requisition_id for update;
  if r.status <> 'open' then raise exception 'FPTK sudah tidak dibuka' using errcode = '22023'; end if;
  select * into c from public.candidates where id = a.candidate_id;
  if exists(select 1 from public.employees where nrp = upper(btrim(p_nrp))) then raise exception 'NRP % sudah dipakai', p_nrp using errcode = '23505'; end if;
  e := public.employee_save(p_nrp, c.full_name, r.department_id, r.position_id, r.employment_type, null, o.start_date, p_email);
  perform public.employee_private_save(e.id, jsonb_strip_nulls(jsonb_build_object('nik', c.nik, 'phone', c.phone, 'personal_email', c.email,
    'birth_date', c.birth_date, 'gender', c.gender, 'address_domicile', c.domicile, 'education_level', c.education_level, 'education_major', c.education_major)));
  if r.employment_type = 'permanent' then
    v_months := app.setting_num('probation_months', 3)::int;
    perform public.contract_add(e.id, 'probation', null, o.start_date, (o.start_date + make_interval(months => v_months))::date - 1, 'Dari ' || r.req_no);
  else
    v_months := app.setting_num('pkwt_months', 12)::int;
    perform public.contract_add(e.id, 'pkwt', null, o.start_date, (o.start_date + make_interval(months => v_months))::date - 1, 'Dari ' || r.req_no);
  end if;
  perform public.mobilization_create(e.id, 'mob', o.start_date, 'Karyawan baru dari ' || r.req_no);
  update public.candidates set employee_id = e.id where id = c.id;
  update public.applications set stage = 'hired', stage_at = now() where id = p_id;
  insert into public.application_events(application_id, stage, result, note) values (p_id, 'offering', 'pass', 'Diterima sebagai ' || e.nrp);
  select count(*) into v_hired from public.applications where requisition_id = r.id and stage = 'hired';
  if v_hired >= r.headcount then
    update public.job_requisitions set status = 'filled', closed_at = now() where id = r.id;
    update public.applications set stage = 'rejected', stage_at = now(), close_reason = 'Formasi sudah terisi'
     where requisition_id = r.id and stage not in ('hired','rejected','withdrawn');
  end if;
  perform app.notify_users(app.users_with_permission('payroll.manage'), 'payroll', 'Karyawan baru ' || e.full_name || ' (' || e.nrp || ')',
    'Gaji pokok sesuai penawaran Rp ' || to_char(o.basic_wage, 'FM999G999G999G999') || '; isi struktur gaji mulai ' || to_char(o.start_date, 'DD-MM-YYYY'),
    '/hrga/payroll?tab=struktur');
  return e;
end $$;

-- ---------------------------------------------------------------- register
create view public.requisition_register with (security_invoker = true) as
select q.id, q.req_no, q.department_id, d.code as department_code, q.position_id, p.name as position_name, p.level, q.headcount, q.employment_type,
       q.reason, re.full_name as replaced_name, q.needed_by, q.requirements, q.justification, q.status, q.mpp_planned, q.mpp_actual,
       q.decision_note, q.created_at, q.created_by, pc.full_name as requester_name, pv.full_name as verifier_name, pa.full_name as approver_name,
       coalesce(s.applicants, 0) as applicants, coalesce(s.in_process, 0) as in_process, coalesce(s.hired, 0) as hired,
       (q.status in ('open','verified','submitted') and q.needed_by < app.site_today()) as overdue,
       (q.created_by <> auth.uid() and ((q.status = 'submitted' and app.is_hr())
         or (q.status = 'verified' and app.has_permission_anywhere('recruit.approve') and q.verifier_id is distinct from auth.uid()))) as can_decide
  from public.job_requisitions q
  join public.departments d on d.id = q.department_id
  join public.positions p on p.id = q.position_id
  left join public.employees re on re.id = q.replaced_employee_id
  left join public.profiles pc on pc.id = q.created_by
  left join public.profiles pv on pv.id = q.verifier_id
  left join public.profiles pa on pa.id = q.approver_id
  left join lateral (select count(*)::int applicants, count(*) filter (where a.stage in ('screening','psikotes','interview','mcu','offering'))::int in_process,
                            count(*) filter (where a.stage = 'hired')::int hired
                       from public.applications a where a.requisition_id = q.id) s on true;

create view public.application_register with (security_invoker = true) as
select a.id, a.requisition_id, q.req_no, q.department_id, d.code as department_code, p.name as position_name, a.candidate_id, c.full_name, c.phone,
       c.education_level, c.experience_years, c.domicile, c.is_local, c.source, a.stage, a.stage_at, a.close_reason, a.created_at,
       (select e.score from public.application_events e where e.application_id = a.id and e.stage = 'psikotes' and e.result = 'pass' order by e.created_at desc limit 1) as psikotes_score,
       (select e.score from public.application_events e where e.application_id = a.id and e.stage = 'interview' and e.result = 'pass' order by e.created_at desc limit 1) as interview_score,
       c.employee_id
  from public.applications a
  join public.job_requisitions q on q.id = a.requisition_id
  join public.departments d on d.id = q.department_id
  join public.positions p on p.id = q.position_id
  join public.candidates c on c.id = a.candidate_id;

do $$
declare v text;
begin
  foreach v in array array['requisition_register','application_register'] loop
    execute format('grant select on public.%I to authenticated', v);
    execute format('revoke all on public.%I from anon', v);
  end loop;
end $$;

revoke all on function app.can_see_req(uuid) from public, anon;
grant execute on function app.can_see_req(uuid) to authenticated;

-- impor: bank kandidat (fungsi lengkap, semua jenis sebelumnya tetap)
create or replace function app.import_row_ext(p_dataset text, r jsonb) returns boolean
language plpgsql set search_path = public as $$
declare
  v_id uuid;
  t text;
  v_run uuid;
  num numeric;
begin
  if p_dataset in ('data_pribadi', 'kontrak', 'idcard', 'organisasi', 'absensi', 'saldo_cuti', 'gaji', 'input_gaji', 'saldo_pajak', 'gaji_lama', 'kasbon_awal') then
    select id into v_id from public.employees where nrp = upper(btrim(r->>'nrp'));
    if v_id is null then raise exception 'NRP "%" tidak ditemukan', r->>'nrp'; end if;
  end if;
  case p_dataset
  when 'data_pribadi' then
    t := upper(left(coalesce(r->>'jenis_kelamin', ''), 1));
    perform public.employee_private_save(v_id, jsonb_strip_nulls(jsonb_build_object(
      'nik', nullif(regexp_replace(coalesce(r->>'nik', ''), '\D', '', 'g'), ''), 'birth_place', nullif(r->>'tempat_lahir', ''),
      'birth_date', nullif(r->>'tgl_lahir', ''), 'gender', case t when 'L' then 'L' when 'P' then 'P' when 'W' then 'P' end,
      'religion', nullif(r->>'agama', ''), 'ptkp_status', nullif(upper(replace(coalesce(r->>'ptkp', ''), ' ', '')), ''),
      'address_ktp', nullif(r->>'alamat', ''), 'phone', nullif(r->>'no_hp', ''), 'education_level', case when upper(coalesce(r->>'pendidikan', '')) in ('SMK','STM','SLTA','MA','SMU') then 'SMA' else nullif(upper(coalesce(r->>'pendidikan', '')), '') end,
      'npwp', nullif(r->>'npwp', ''), 'bpjs_tk_no', nullif(r->>'bpjs_tk', ''), 'bpjs_kes_no', nullif(r->>'bpjs_kes', ''),
      'bank_name', nullif(r->>'bank', ''), 'bank_account', nullif(regexp_replace(coalesce(r->>'no_rekening', ''), '[^0-9]', '', 'g'), ''),
      'bank_holder', nullif(r->>'nama_rekening', ''), 'emergency_name', nullif(r->>'kontak_darurat', ''),
      'emergency_phone', nullif(r->>'hp_darurat', ''))));
  when 'kontrak' then
    t := lower(coalesce(r->>'jenis', ''));
    perform public.contract_add(v_id,
      case when t in ('pkwt', 'kontrak') then 'pkwt' when t in ('pkwtt', 'tetap') then 'pkwtt' when t in ('percobaan', 'probation') then 'probation'
           when t in ('subkon', 'subcon') then 'subcon' else t end,
      nullif(r->>'no_kontrak', ''), (r->>'mulai')::date, (nullif(r->>'berakhir', ''))::date, nullif(r->>'catatan', ''));
  when 'organisasi' then
    perform public.employee_org_save(v_id,
      case when coalesce(r->>'atasan', '') = '' then null
           else coalesce((select id from public.employees where nrp = upper(btrim(r->>'atasan'))),
                         app.raise_text('NRP atasan "' || (r->>'atasan') || '" tidak ditemukan')::uuid) end,
      (select id from public.sites where code = upper(nullif(btrim(r->>'site'), ''))), nullif(r->>'golongan', ''), nullif(r->>'pola_roster', ''),
      nullif(r->>'poh', ''));
  when 'idcard' then
    perform public.id_card_issue(v_id, r->>'no_kartu',
      coalesce(array(select upper(btrim(a)) from unnest(regexp_split_to_array(coalesce(nullif(r->>'area', ''), 'OFFICE,MESS'), '[,;/ ]+')) a where btrim(a) <> ''), '{}'),
      (nullif(r->>'berlaku_sampai', ''))::date);
  when 'absensi' then
    -- Mesin fingerprint: satu baris = satu sentuhan. Jenis kosong = ditentukan otomatis (pertama masuk, terakhir pulang).
    -- waktu lengkap, atau kolom tanggal + jam terpisah (format umum ekspor mesin)
    perform app.attendance_import(v_id, (coalesce(nullif(r->>'waktu', ''), nullif(btrim(coalesce(r->>'tanggal', '') || ' ' || coalesce(r->>'jam', '')), ''))::timestamp)
      at time zone app.site_tz(), r->>'jenis', nullif(r->>'mesin', ''));
  when 'saldo_cuti' then
    perform public.leave_adjust(v_id, coalesce((nullif(r->>'tahun', ''))::int, extract(year from app.site_today())::int),
      coalesce(upper(nullif(r->>'jenis', '')), 'CT'), (r->>'hari')::numeric, coalesce(nullif(r->>'keterangan', ''), 'Saldo awal dari sistem lama'));
  when 'gaji' then
    num := nullif(regexp_replace(coalesce(r->>'nilai', ''), '[^0-9]', '', 'g'), '')::numeric;
    perform public.employee_pay_set(v_id, upper(btrim(r->>'komponen')), num, (r->>'berlaku_mulai')::date, nullif(r->>'keterangan', ''));
  when 'input_gaji' then
    v_run := app.payroll_run_for(r->>'periode');
    if v_run is null then raise exception 'Belum ada proses gaji periode % yang bisa diisi', r->>'periode'; end if;
    perform public.payroll_input_add(v_run, v_id, upper(btrim(r->>'komponen')),
      nullif(regexp_replace(coalesce(r->>'nilai', ''), '[^0-9]', '', 'g'), '')::numeric, nullif(r->>'keterangan', ''));
  when 'saldo_pajak' then
    perform public.payroll_ytd_set(v_id, (r->>'tahun')::int,
      nullif(regexp_replace(coalesce(r->>'bruto', ''), '[^0-9]', '', 'g'), '')::numeric,
      nullif(regexp_replace(coalesce(r->>'pph21', ''), '[^0-9]', '', 'g'), '')::numeric,
      nullif(regexp_replace(coalesce(r->>'iuran_pensiun', ''), '[^0-9]', '', 'g'), '')::numeric,
      nullif(r->>'bulan', '')::int, nullif(r->>'keterangan', ''));
  when 'gaji_lama' then
    perform app.payroll_legacy_set(r->>'periode', v_id,
      nullif(regexp_replace(coalesce(r->>'bruto', ''), '[^0-9]', '', 'g'), '')::numeric,
      nullif(regexp_replace(coalesce(r->>'pph21', ''), '[^0-9]', '', 'g'), '')::numeric,
      nullif(regexp_replace(coalesce(r->>'gaji_bersih', ''), '[^0-9]', '', 'g'), '')::numeric, nullif(r->>'keterangan', ''));
  when 'kasbon_awal' then
    perform app.advance_opening(v_id,
      nullif(regexp_replace(coalesce(r->>'sisa', ''), '[^0-9]', '', 'g'), '')::numeric,
      nullif(regexp_replace(coalesce(r->>'cicilan', ''), '[^0-9]', '', 'g'), '')::numeric, nullif(r->>'keterangan', ''));
  when 'kandidat' then
    -- bank kandidat dari Excel (walk-in / job fair); NIK sama diperbarui
    perform public.candidate_save((select id from public.candidates where nik = nullif(regexp_replace(coalesce(r->>'nik', ''), '\D', '', 'g'), '')),
      jsonb_strip_nulls(jsonb_build_object('full_name', nullif(r->>'nama', ''), 'nik', nullif(r->>'nik', ''), 'phone', nullif(r->>'no_hp', ''),
        'email', nullif(r->>'email', ''), 'birth_date', nullif(r->>'tgl_lahir', ''),
        'gender', case upper(left(coalesce(r->>'jenis_kelamin', ''), 1)) when 'L' then 'L' when 'P' then 'P' when 'W' then 'P' end,
        'domicile', nullif(r->>'domisili', ''), 'education_level', case when upper(coalesce(r->>'pendidikan', '')) in ('SMK','STM','SLTA','MA','SMU') then 'SMA' else nullif(upper(coalesce(r->>'pendidikan', '')), '') end,
        'education_major', nullif(r->>'jurusan', ''), 'experience_years', nullif(regexp_replace(coalesce(r->>'pengalaman', ''), '[^0-9.]', '', 'g'), ''),
        'last_employer', nullif(r->>'perusahaan_terakhir', ''),
        'is_local', case lower(coalesce(r->>'lokal', '')) when 'ya' then 'true' when 'y' then 'true' when 'tidak' then 'false' when 'n' then 'false' end,
        'note', nullif(r->>'keterangan', ''))));
  else
    return false;
  end case;
  return true;
end $$;
revoke all on function app.import_row_ext(text, jsonb) from public, anon;
grant execute on function app.import_row_ext(text, jsonb) to authenticated;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and p.proname not in ('verify_document', 'feed_rows') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
