-- BSB IMS · Adaptasi Portal SHE: pelanggaran GR/SPDK, induksi, izin masuk area, register komisioning (SPIP),
-- Pusat Data (tautan Drive per elemen SMKP), dan SAP per karyawan (bukan per akun) lengkap dengan level, section dan riwayat Excel.

insert into public.permissions(code, module, description) values
  ('she.discipline','she','Mencatat pelanggaran Golden Rules/SPDK, sanksi dan konseling'),
  ('she.induction','she','Mencatat induksi dan reinduksi karyawan/tamu'),
  ('she.permit','she','Menyetujui izin masuk area'),
  ('spip.manage','plant','Mengelola register komisioning (SPIP) unit, alat dan instalasi'),
  ('library.manage','core','Mengelola tautan Pusat Data SHE');

insert into public.role_permissions(role_code, permission_code)
select r, p from (values
  ('STAFF','she.discipline'), ('SUPERVISOR','she.discipline'), ('SUPERINTENDENT','she.discipline'), ('DEPT_HEAD','she.discipline'),
  ('HSE_MANAGER','she.discipline'), ('PJO','she.discipline'),
  ('STAFF','she.induction'), ('SUPERVISOR','she.induction'), ('SUPERINTENDENT','she.induction'), ('DEPT_HEAD','she.induction'), ('HSE_MANAGER','she.induction'),
  ('SUPERVISOR','she.permit'), ('SUPERINTENDENT','she.permit'), ('DEPT_HEAD','she.permit'), ('HSE_MANAGER','she.permit'), ('PJO','she.permit'),
  ('STAFF','spip.manage'), ('SUPERVISOR','spip.manage'), ('SUPERINTENDENT','spip.manage'), ('DEPT_HEAD','spip.manage'),
  ('HSE_MANAGER','library.manage'), ('DOC_CONTROLLER','library.manage'), ('DEPT_HEAD','library.manage'),
  ('HSE_MANAGER','records.read_restricted')
) as x(r, p)
on conflict do nothing;

insert into public.numbering_schemes(code, name, pattern, module) values
  ('PLG','Pelanggaran Golden Rules / SPDK','PLG-BSB-{YYYY}-{N4}','she'),
  ('IMA','Izin masuk area','IMA-BSB-{YYYY}-{N4}','she');

insert into public.app_settings(key, value, description) values
  ('induction_pass_score', '70', 'Nilai minimal lulus induksi'),
  ('violation_repeat_months', '12', 'Pelanggaran berulang dihitung dalam rentang bulan ini'),
  ('spip_warning_days', '30', 'Komisioning dianggap segera habis bila sisa masa berlaku ≤ jumlah hari ini'),
  ('sap_anchor', '{"week":41,"start":"2026-10-13"}', 'Patokan nomor minggu SAP (minggu Selasa–Senin)');

create or replace function app.dept_by_code(p_code text) returns uuid language sql stable security definer set search_path = public as $$
  select id from public.departments where code = p_code
$$;

-- ---------------------------------------------------------------- pelanggaran GR / SPDK
create table public.violations(
  id uuid primary key default gen_random_uuid(),
  violation_no text not null unique,
  occurred_on date not null,
  employee_id uuid references public.employees(id),
  offender_name text not null,
  company text,
  department_id uuid not null references public.departments(id),
  violation_type text not null check (violation_type in
    ('GR1','GR2','GR3','GR4','GR5','GR6','GR7','GR8','SPDK_OVERSPEED','SPDK_PROSEDUR','APD','SAFETY_BELT','FATIGUE','OTHER')),
  work_area_id uuid references public.work_areas(id),
  location_note text,
  source text,
  chronology text not null,
  sanction text check (sanction in ('verbal','coaching','sp1','sp2','sp3','suspension','termination')),
  sp_no text,
  sp_date date,
  counseling_on date,
  counselor text,
  counseling_result text,
  refresh_training text,
  status text not null default 'open' check (status in ('open','closed')),
  close_note text,
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (sanction not in ('sp1','sp2','sp3','suspension','termination') or sp_no is null or sp_date is not null)
);
create index violations_employee_idx on public.violations(employee_id, occurred_on);

-- ---------------------------------------------------------------- induksi & reinduksi
create table public.inductions(
  id uuid primary key default gen_random_uuid(),
  held_on date not null,
  induction_type text not null check (induction_type in ('new_hire','reinduction','transfer','visitor')),
  employee_id uuid references public.employees(id),
  participant_name text not null,
  company text,
  position_note text,
  department_id uuid references public.departments(id),
  presenter text not null,
  score numeric check (score between 0 and 100),
  result text not null check (result in ('pass','fail')),
  note text,
  employee_competency_id uuid references public.employee_competencies(id),
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index inductions_held_idx on public.inductions(held_on desc);

-- ---------------------------------------------------------------- izin masuk area
create table public.area_permits(
  id uuid primary key default gen_random_uuid(),
  permit_no text not null unique,
  visitor_name text not null,
  company text not null,
  people_count int not null default 1 check (people_count > 0),
  work_area_id uuid references public.work_areas(id),
  area_note text,
  purpose text not null,
  start_on date not null,
  end_on date not null,
  escort_employee_id uuid references public.employees(id),
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','closed')),
  requested_by uuid not null references public.profiles(id) default auth.uid(),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (end_on >= start_on)
);

-- ---------------------------------------------------------------- register komisioning / SPIP
create table public.commissioning_records(
  id uuid primary key default gen_random_uuid(),
  object_type text not null check (object_type in ('unit','tool','installation')),
  ref_code text not null,
  unit_id uuid references public.units(id),
  name text not null,
  category text,
  reg_no text,
  commissioned_on date,
  valid_until date,
  issuer text,
  note text,
  source text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (valid_until is null or commissioned_on is null or valid_until > commissioned_on)
);
create unique index commissioning_ref_reg_uq on public.commissioning_records(ref_code, coalesce(reg_no, ''));

-- ---------------------------------------------------------------- Pusat Data: tautan folder/database Drive
create table public.resource_links(
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  page text not null,
  section text not null,
  kind text not null default 'folder' check (kind in ('folder','sheet','doc','form','file','link')),
  title text not null,
  description text,
  url text check (url is null or url ~ '^https://'),
  clause_id uuid references public.compliance_clauses(id),
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- ---------------------------------------------------------------- SAP per karyawan
-- Versi M4 mengikat target ke akun aplikasi; di site banyak pengawas belum punya akun, jadi target, cuti dan
-- act diikat ke data karyawan. Formulir observasi/inspeksi/hazard mencatat karyawan yang dikreditkan.
drop view public.sap_weekly;
drop function public.sap_set_target(uuid, date, int, int, int);
drop function public.sap_set_leave(uuid, date, boolean);
drop table public.sap_targets;
drop table public.sap_leave;

create table public.sap_participants(
  employee_id uuid primary key references public.employees(id),
  level text not null check (level in ('PJO','DH','SH','FOR')),
  sap_section text not null check (sap_section in ('PJO','HSE','PRO','PLANT','LOG','HRGA','ENG')),
  sort_order int not null default 0,
  aliases text[] not null default '{}',
  active_from date not null,
  active_until date,
  history jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (active_until is null or active_until >= active_from)
);

create table public.sap_targets(
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  valid_from date not null,
  obs_target smallint not null default 0 check (obs_target >= 0),
  insp_target smallint not null default 0 check (insp_target >= 0),
  hazard_target smallint not null default 0 check (hazard_target >= 0),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (employee_id, valid_from)
);

create table public.sap_leave(
  employee_id uuid not null references public.employees(id),
  week_start date not null check (extract(isodow from week_start) = 2),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  primary key (employee_id, week_start)
);

-- Minggu yang sudah dikunci atau berasal dari Excel SAP lama: angka plan/act dibekukan.
create table public.sap_history(
  employee_id uuid not null references public.employees(id),
  week_start date not null check (extract(isodow from week_start) = 2),
  obs_plan smallint not null default 0, obs_act smallint not null default 0,
  insp_plan smallint not null default 0, insp_act smallint not null default 0,
  hazard_plan smallint not null default 0, hazard_act smallint not null default 0,
  on_leave boolean not null default false,
  source text not null default 'locked' check (source in ('excel','locked')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  primary key (employee_id, week_start)
);

alter table public.observations add column employee_id uuid references public.employees(id);
alter table public.inspections add column employee_id uuid references public.employees(id);
alter table public.hazard_reports add column employee_id uuid references public.employees(id);

-- Default: karyawan yang tertaut ke akun pembuat rekaman
create or replace function app.she_default_employee() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.employee_id is null then
    select id into new.employee_id from public.employees where profile_id = auth.uid() and status = 'active';
  end if;
  return new;
end $$;
create trigger observations_employee before insert on public.observations for each row execute function app.she_default_employee();
create trigger inspections_employee before insert on public.inspections for each row execute function app.she_default_employee();
create trigger hazard_reports_employee before insert on public.hazard_reports for each row execute function app.she_default_employee();

-- ---------------------------------------------------------------- trigger, RLS, hak tabel
do $$
declare t text;
begin
  foreach t in array array['violations','area_permits','commissioning_records','resource_links','sap_participants'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['violations','inductions','area_permits','commissioning_records','resource_links',
                           'sap_participants','sap_targets','sap_leave','sap_history'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    if t <> 'violations' then
      execute format('create policy %I_read on public.%I for select to authenticated using (app.is_active_user())', t, t);
    end if;
  end loop;
end $$;
-- Data pelanggaran bersifat pribadi: HSE, atasan departemen pelanggar, PJO, dan pelanggar sendiri.
create policy violations_read on public.violations for select to authenticated using (
  app.is_active_user() and (
    app.has_permission('she.discipline', app.dept_by_code('HSE'))
    or app.has_permission('hr.roster', department_id)
    or exists(select 1 from public.employees e where e.id = employee_id and e.profile_id = auth.uid())));

-- ---------------------------------------------------------------- fungsi: pelanggaran
create or replace function public.violation_record(
  p_occurred_on date, p_department uuid, p_type text, p_chronology text, p_employee uuid default null, p_offender_name text default null,
  p_company text default null, p_work_area uuid default null, p_location_note text default null, p_source text default null,
  p_sanction text default null, p_attachments uuid[] default '{}', p_idempotency_key text default null)
returns public.violations language plpgsql security definer set search_path = public as $$
declare
  v public.violations;
  e public.employees;
  v_reg public.registrations;
begin
  if not app.has_permission('she.discipline', app.dept_by_code('HSE')) then
    raise exception 'Pelanggaran dicatat oleh personel HSE' using errcode = '42501';
  end if;
  if p_occurred_on > app.site_today() then raise exception 'Tanggal tidak boleh di masa depan' using errcode = '22023'; end if;
  if p_employee is not null then
    select * into e from public.employees where id = p_employee;
    if not found then raise exception 'Karyawan tidak ditemukan' using errcode = '22023'; end if;
  elsif coalesce(btrim(p_offender_name), '') = '' then
    raise exception 'Pilih karyawan atau isi nama pelanggar' using errcode = '22023';
  end if;
  if p_idempotency_key is not null then
    select x.* into v from public.registrations r join public.violations x on x.violation_no = r.number where r.idempotency_key = p_idempotency_key;
    if found then return v; end if;
  end if;
  v_reg := app.allocate_number('PLG', jsonb_build_object('date', p_occurred_on), p_idempotency_key);
  insert into public.violations(violation_no, occurred_on, employee_id, offender_name, company, department_id, violation_type,
    work_area_id, location_note, source, chronology, sanction)
  values (v_reg.number, p_occurred_on, p_employee, coalesce(e.full_name, btrim(p_offender_name)),
    coalesce(nullif(btrim(p_company), ''), e.company), coalesce(e.department_id, p_department), p_type, p_work_area, p_location_note,
    p_source, app.require_text(p_chronology, 'Kronologi'), p_sanction)
  returning * into v;
  update public.registrations set ref_table = 'violations', ref_id = v.id where id = v_reg.id;
  perform app.claim_attachments(p_attachments, 'violations', v.id);
  update public.attachments set classification = 'restricted' where owner_table = 'violations' and owner_id = v.id;
  return v;
end $$;

-- Sanksi, SP dan konseling bisa dilengkapi bertahap
create or replace function public.violation_followup(p_id uuid, p_sanction text, p_sp_no text default null, p_sp_date date default null,
  p_counseling_on date default null, p_counselor text default null, p_counseling_result text default null,
  p_refresh_training text default null, p_attachments uuid[] default '{}')
returns public.violations language plpgsql security definer set search_path = public as $$
declare v public.violations;
begin
  if not app.has_permission('she.discipline', app.dept_by_code('HSE')) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  select * into v from public.violations where id = p_id for update;
  if not found then raise exception 'Data pelanggaran tidak ditemukan' using errcode = 'P0002'; end if;
  if v.status <> 'open' then raise exception 'Pelanggaran sudah ditutup' using errcode = '22023'; end if;
  if p_counseling_on is not null and p_counseling_on < v.occurred_on then
    raise exception 'Tanggal konseling sebelum tanggal pelanggaran' using errcode = '22023';
  end if;
  update public.violations set sanction = p_sanction, sp_no = nullif(btrim(p_sp_no), ''), sp_date = p_sp_date,
    counseling_on = p_counseling_on, counselor = nullif(btrim(p_counselor), ''), counseling_result = nullif(btrim(p_counseling_result), ''),
    refresh_training = nullif(btrim(p_refresh_training), '')
   where id = p_id returning * into v;
  perform app.claim_attachments(p_attachments, 'violations', v.id);
  update public.attachments set classification = 'restricted' where owner_table = 'violations' and owner_id = v.id;
  return v;
end $$;

-- Closed hanya bila sanksi ditetapkan, konseling tercatat, dan SP bernomor untuk sanksi SP ke atas.
create or replace function public.violation_close(p_id uuid, p_note text)
returns public.violations language plpgsql security definer set search_path = public as $$
declare v public.violations;
begin
  if not app.has_permission('she.discipline', app.dept_by_code('HSE')) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  select * into v from public.violations where id = p_id for update;
  if not found then raise exception 'Data pelanggaran tidak ditemukan' using errcode = 'P0002'; end if;
  if v.status <> 'open' then raise exception 'Pelanggaran sudah ditutup' using errcode = '22023'; end if;
  if v.sanction is null then raise exception 'Tetapkan sanksi sebelum menutup' using errcode = '22023'; end if;
  if v.counseling_on is null or v.counseling_result is null then raise exception 'Catat konseling sebelum menutup' using errcode = '22023'; end if;
  if v.sanction in ('sp1','sp2','sp3','suspension','termination') and (v.sp_no is null or v.sp_date is null) then
    raise exception 'Sanksi SP/skorsing/PHK wajib bernomor dan bertanggal' using errcode = '22023';
  end if;
  update public.violations set status = 'closed', close_note = nullif(btrim(p_note), ''), closed_by = auth.uid(), closed_at = now()
   where id = p_id returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------- fungsi: induksi
-- Induksi lulus untuk karyawan memperbarui kompetensi INDUKSI (masa berlaku dari master kompetensi).
create or replace function public.induction_record(p_held_on date, p_type text, p_presenter text, p_result text,
  p_employee uuid default null, p_participant_name text default null, p_company text default null, p_position_note text default null,
  p_department uuid default null, p_score numeric default null, p_note text default null, p_attachments uuid[] default '{}')
returns public.inductions language plpgsql security definer set search_path = public as $$
declare
  v public.inductions;
  e public.employees;
  v_min numeric := coalesce((select value::text::numeric from public.app_settings where key = 'induction_pass_score'), 70);
  ec public.employee_competencies;
begin
  if not app.has_permission('she.induction', app.dept_by_code('HSE')) then
    raise exception 'Induksi dicatat oleh personel HSE' using errcode = '42501';
  end if;
  if p_held_on > app.site_today() then raise exception 'Tanggal tidak boleh di masa depan' using errcode = '22023'; end if;
  if p_employee is not null then
    select * into e from public.employees where id = p_employee and status = 'active';
    if not found then raise exception 'Karyawan tidak aktif atau tidak ditemukan' using errcode = '22023'; end if;
  elsif p_type <> 'visitor' then
    raise exception 'Induksi karyawan wajib memilih data karyawan' using errcode = '22023';
  end if;
  if p_result = 'pass' and p_score is not null and p_score < v_min then
    raise exception 'Nilai % di bawah batas lulus %', p_score, v_min using errcode = '22023';
  end if;
  insert into public.inductions(held_on, induction_type, employee_id, participant_name, company, position_note, department_id,
    presenter, score, result, note)
  values (p_held_on, p_type, p_employee, coalesce(e.full_name, app.require_text(p_participant_name, 'Nama peserta')),
    coalesce(nullif(btrim(p_company), ''), e.company), p_position_note, coalesce(e.department_id, p_department),
    app.require_text(p_presenter, 'Pemateri'), p_score, p_result, p_note)
  returning * into v;
  if p_result = 'pass' and p_employee is not null then
    ec := app.grant_competency(p_employee, (select id from public.competencies where code = 'INDUKSI'), p_held_on, null, null, 'Induksi HSE BSB', null);
    update public.inductions set employee_competency_id = ec.id where id = v.id returning * into v;
  end if;
  perform app.claim_attachments(p_attachments, 'inductions', v.id);
  return v;
end $$;

-- ---------------------------------------------------------------- fungsi: izin masuk area
create or replace function public.area_permit_request(p_visitor_name text, p_company text, p_purpose text, p_start date, p_end date,
  p_people int default 1, p_work_area uuid default null, p_area_note text default null, p_escort uuid default null,
  p_attachments uuid[] default '{}', p_idempotency_key text default null)
returns public.area_permits language plpgsql security definer set search_path = public as $$
declare
  v public.area_permits;
  v_reg public.registrations;
begin
  if not app.is_active_user() then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if p_start < app.site_today() then raise exception 'Tanggal mulai sudah lewat' using errcode = '22023'; end if;
  if p_idempotency_key is not null then
    select x.* into v from public.registrations r join public.area_permits x on x.permit_no = r.number where r.idempotency_key = p_idempotency_key;
    if found then return v; end if;
  end if;
  v_reg := app.allocate_number('IMA', jsonb_build_object('date', p_start), p_idempotency_key);
  insert into public.area_permits(permit_no, visitor_name, company, people_count, work_area_id, area_note, purpose, start_on, end_on, escort_employee_id)
  values (v_reg.number, app.require_text(p_visitor_name, 'Nama tamu'), app.require_text(p_company, 'Perusahaan'), coalesce(p_people, 1),
    p_work_area, p_area_note, app.require_text(p_purpose, 'Tujuan'), p_start, p_end, p_escort)
  returning * into v;
  update public.registrations set ref_table = 'area_permits', ref_id = v.id where id = v_reg.id;
  perform app.claim_attachments(p_attachments, 'area_permits', v.id);
  perform app.notify_users(app.users_with_permission('she.permit', app.dept_by_code('HSE')), 'she.permit',
    'Izin masuk area: ' || v.permit_no, v.visitor_name || ' · ' || v.company, '/she/izin');
  return v;
end $$;

create or replace function public.area_permit_decide(p_id uuid, p_approve boolean, p_note text default null, p_escort uuid default null)
returns public.area_permits language plpgsql security definer set search_path = public as $$
declare v public.area_permits;
begin
  if not app.has_permission('she.permit', app.dept_by_code('HSE')) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  select * into v from public.area_permits where id = p_id for update;
  if not found then raise exception 'Izin tidak ditemukan' using errcode = 'P0002'; end if;
  if v.status <> 'submitted' then raise exception 'Izin sudah diputuskan' using errcode = '22023'; end if;
  if v.requested_by = auth.uid() then raise exception 'Pemohon tidak boleh menyetujui izinnya sendiri' using errcode = '42501'; end if;
  if p_approve and coalesce(p_escort, v.escort_employee_id) is null then
    raise exception 'Tentukan pendamping sebelum menyetujui' using errcode = '22023';
  end if;
  if not p_approve and coalesce(btrim(p_note), '') = '' then raise exception 'Isi alasan penolakan' using errcode = '22023'; end if;
  update public.area_permits set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(),
    decision_note = nullif(btrim(p_note), ''), escort_employee_id = coalesce(p_escort, escort_employee_id)
   where id = p_id returning * into v;
  perform app.notify_users(array[v.requested_by], 'she.permit', 'Izin ' || v.permit_no || case when p_approve then ' disetujui' else ' ditolak' end,
    coalesce(v.decision_note, v.visitor_name), '/she/izin');
  return v;
end $$;

create or replace function public.area_permit_close(p_id uuid)
returns public.area_permits language plpgsql security definer set search_path = public as $$
declare v public.area_permits;
begin
  select * into v from public.area_permits where id = p_id for update;
  if not found then raise exception 'Izin tidak ditemukan' using errcode = 'P0002'; end if;
  if v.requested_by <> auth.uid() and not app.has_permission('she.permit', app.dept_by_code('HSE')) then
    raise exception 'Tidak berwenang' using errcode = '42501';
  end if;
  if v.status <> 'approved' then raise exception 'Hanya izin yang disetujui bisa ditutup' using errcode = '22023'; end if;
  update public.area_permits set status = 'closed' where id = p_id returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------- fungsi: komisioning / SPIP
create or replace function public.commissioning_save(p_id uuid, p_object_type text, p_ref_code text, p_name text,
  p_category text default null, p_reg_no text default null, p_commissioned_on date default null, p_valid_until date default null,
  p_issuer text default null, p_note text default null, p_attachments uuid[] default '{}')
returns public.commissioning_records language plpgsql security definer set search_path = public as $$
declare v public.commissioning_records;
begin
  if not (app.has_permission('spip.manage', app.dept_by_code('PLT')) or app.has_permission('spip.manage', app.dept_by_code('HSE'))) then
    raise exception 'Register komisioning dikelola Plant atau HSE' using errcode = '42501';
  end if;
  if p_id is null then
    insert into public.commissioning_records(object_type, ref_code, unit_id, name, category, reg_no, commissioned_on, valid_until, issuer, note)
    values (p_object_type, upper(app.require_text(p_ref_code, 'Kode / no. lambung')),
      (select id from public.units where unit_no = upper(btrim(p_ref_code))), app.require_text(p_name, 'Nama'), p_category,
      nullif(btrim(p_reg_no), ''), p_commissioned_on, p_valid_until, p_issuer, p_note)
    returning * into v;
  else
    update public.commissioning_records set object_type = p_object_type, ref_code = upper(app.require_text(p_ref_code, 'Kode / no. lambung')),
      unit_id = (select id from public.units where unit_no = upper(btrim(p_ref_code))), name = app.require_text(p_name, 'Nama'),
      category = p_category, reg_no = nullif(btrim(p_reg_no), ''), commissioned_on = p_commissioned_on, valid_until = p_valid_until,
      issuer = p_issuer, note = p_note
     where id = p_id returning * into v;
    if not found then raise exception 'Data tidak ditemukan' using errcode = 'P0002'; end if;
  end if;
  perform app.claim_attachments(p_attachments, 'commissioning_records', v.id);
  return v;
end $$;

-- ---------------------------------------------------------------- fungsi: Pusat Data
create or replace function public.resource_link_save(p_code text, p_page text, p_section text, p_title text, p_url text,
  p_kind text default 'folder', p_description text default null, p_clause uuid default null, p_sort int default 0, p_active boolean default true)
returns public.resource_links language plpgsql security definer set search_path = public as $$
declare v public.resource_links;
begin
  if not app.has_permission_anywhere('library.manage') then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  insert into public.resource_links(code, page, section, kind, title, description, url, clause_id, sort_order, active)
  values (lower(app.require_text(p_code, 'Kode')), app.require_text(p_page, 'Halaman'), app.require_text(p_section, 'Kelompok'),
    p_kind, app.require_text(p_title, 'Judul'), p_description, nullif(btrim(p_url), ''), p_clause, coalesce(p_sort, 0), p_active)
  on conflict (code) do update set page = excluded.page, section = excluded.section, kind = excluded.kind, title = excluded.title,
    description = excluded.description, url = excluded.url, clause_id = excluded.clause_id, sort_order = excluded.sort_order, active = excluded.active
  returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------- fungsi: SAP
create or replace function app.require_sap() returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not app.has_permission_anywhere('sap.manage') then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
end $$;

-- Nomor minggu SAP dari patokan (W41 = 13 Okt 2026), berputar 1–52
create or replace function app.sap_week_no(p_week_start date) returns int
language sql stable security definer set search_path = public as $$
  select (((((p_week_start - (a->>'start')::date) / 7) + (a->>'week')::int - 1) % 52) + 52) % 52 + 1
    from (select value as a from public.app_settings where key = 'sap_anchor') s
$$;

create or replace function public.sap_participant_save(p_employee uuid, p_level text, p_section text, p_active_from date,
  p_sort int default 0, p_aliases text[] default '{}', p_reason text default null)
returns public.sap_participants language plpgsql security definer set search_path = public as $$
declare v public.sap_participants;
begin
  perform app.require_sap();
  if not exists(select 1 from public.employees where id = p_employee and status = 'active') then
    raise exception 'Karyawan tidak aktif' using errcode = '22023';
  end if;
  insert into public.sap_participants(employee_id, level, sap_section, sort_order, aliases, active_from, history)
  values (p_employee, p_level, p_section, coalesce(p_sort, 0), coalesce(p_aliases, '{}'), p_active_from,
    jsonb_build_array(jsonb_build_object('on', p_active_from, 'event', 'masuk', 'level', p_level, 'note', p_reason)))
  on conflict (employee_id) do update set level = excluded.level, sap_section = excluded.sap_section, sort_order = excluded.sort_order,
    aliases = excluded.aliases, active_until = null,
    active_from = case when sap_participants.active_until is not null then excluded.active_from else sap_participants.active_from end,
    history = sap_participants.history || jsonb_build_array(jsonb_build_object('on', p_active_from, 'event', 'ubah', 'level', p_level, 'note', p_reason))
  returning * into v;
  return v;
end $$;

-- Keluar dari SAP (resign, mutasi, PHK): minggu sebelum tanggal efektif tidak berubah
create or replace function public.sap_participant_end(p_employee uuid, p_until date, p_reason text)
returns public.sap_participants language plpgsql security definer set search_path = public as $$
declare v public.sap_participants;
begin
  perform app.require_sap();
  update public.sap_participants set active_until = p_until,
    history = history || jsonb_build_array(jsonb_build_object('on', p_until, 'event', 'keluar', 'note', app.require_text(p_reason, 'Alasan')))
   where employee_id = p_employee and active_until is null returning * into v;
  if not found then raise exception 'Peserta SAP aktif tidak ditemukan' using errcode = 'P0002'; end if;
  return v;
end $$;

create or replace function public.sap_set_target(p_employee uuid, p_valid_from date, p_obs int, p_insp int, p_hazard int)
returns public.sap_targets language plpgsql security definer set search_path = public as $$
declare v public.sap_targets;
begin
  perform app.require_sap();
  insert into public.sap_targets(employee_id, valid_from, obs_target, insp_target, hazard_target)
  values (p_employee, p_valid_from, p_obs, p_insp, p_hazard)
  on conflict (employee_id, valid_from) do update set obs_target = excluded.obs_target, insp_target = excluded.insp_target,
    hazard_target = excluded.hazard_target
  returning * into v;
  return v;
end $$;

create or replace function public.sap_set_leave(p_employee uuid, p_week_start date, p_on_leave boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform app.require_sap();
  if exists(select 1 from public.sap_history where employee_id = p_employee and week_start = p_week_start) then
    raise exception 'Minggu ini sudah dikunci' using errcode = '22023';
  end if;
  if p_on_leave then
    insert into public.sap_leave(employee_id, week_start) values (p_employee, p_week_start) on conflict do nothing;
  else
    delete from public.sap_leave where employee_id = p_employee and week_start = p_week_start;
  end if;
end $$;

-- Status cuti mengikuti minggu sebelumnya: salin daftar cuti minggu lalu ke minggu ini
create or replace function public.sap_copy_leave(p_week_start date) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform app.require_sap();
  insert into public.sap_leave(employee_id, week_start)
  select l.employee_id, p_week_start from public.sap_leave l
   where l.week_start = p_week_start - 7
     and not exists(select 1 from public.sap_history h where h.employee_id = l.employee_id and h.week_start = p_week_start)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Kreditkan rekaman observasi/inspeksi/hazard ke karyawan lain (formulir diisi atas nama pengawas tanpa akun,
-- atau koreksi nama oleh admin SAP).
create or replace function public.she_credit(p_table text, p_id uuid, p_employee uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_date date;
begin
  if not exists(select 1 from public.employees where id = p_employee and status = 'active') then
    raise exception 'Karyawan tidak aktif' using errcode = '22023';
  end if;
  case p_table
    when 'observations' then select observer_id, observed_on into v_owner, v_date from public.observations where id = p_id;
    when 'inspections' then select inspector_id, inspected_on into v_owner, v_date from public.inspections where id = p_id;
    when 'hazard_reports' then select reporter_id, reported_on into v_owner, v_date from public.hazard_reports where id = p_id;
    else raise exception 'Tabel tidak valid' using errcode = '22023';
  end case;
  if v_owner is null then raise exception 'Rekaman tidak ditemukan' using errcode = 'P0002'; end if;
  if v_owner <> auth.uid() and not app.has_permission_anywhere('sap.manage') then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if exists(select 1 from public.sap_history where employee_id = p_employee and week_start = app.sap_week(v_date)) then
    raise exception 'Minggu SAP rekaman ini sudah dikunci' using errcode = '22023';
  end if;
  execute format('update public.%I set employee_id = $1 where id = $2', p_table) using p_employee, p_id;
end $$;

-- ---------------------------------------------------------------- tampilan
create view public.violation_register with (security_invoker = true) as
select v.*, d.code as department_code, e.nrp,
       (select count(*) from public.violations o
         where o.employee_id = v.employee_id and o.occurred_on <= v.occurred_on
           and o.occurred_on > v.occurred_on - make_interval(months => coalesce((select value::text::int from public.app_settings where key = 'violation_repeat_months'), 12))
       )::int as repeat_no,
       array_remove(array[
         case when v.sanction is null then 'Sanksi' end,
         case when v.sanction in ('sp1','sp2','sp3','suspension','termination') and v.sp_no is null then 'SP' end,
         case when v.counseling_on is null then 'Konseling' end], null) as missing
  from public.violations v
  join public.departments d on d.id = v.department_id
  left join public.employees e on e.id = v.employee_id;

create view public.commissioning_register with (security_invoker = true) as
select c.*, u.status as unit_status,
       case when c.valid_until is null then 'none'
            when c.valid_until < app.site_today() then 'expired'
            when c.valid_until <= app.site_today() + coalesce((select value::text::int from public.app_settings where key = 'spip_warning_days'), 30) then 'expiring'
            else 'valid' end as validity
  from public.commissioning_records c
  left join public.units u on u.id = c.unit_id;

create view public.area_permit_register with (security_invoker = true) as
select p.*, w.name as work_area_name, e.full_name as escort_name, r.full_name as requester_name,
       (p.status = 'approved' and app.site_today() between p.start_on and p.end_on) as on_site_today
  from public.area_permits p
  left join public.work_areas w on w.id = p.work_area_id
  left join public.employees e on e.id = p.escort_employee_id
  join public.profiles r on r.id = p.requested_by;

-- Plan/act SAP per karyawan per minggu. Minggu terkunci/Excel diambil dari sap_history; minggu berjalan dihitung langsung.
create view public.sap_weekly with (security_invoker = true) as
with act as (
  select employee_id, app.sap_week(observed_on) as week_start, 1 as obs, 0 as insp, 0 as haz from public.observations where employee_id is not null
  union all select employee_id, app.sap_week(inspected_on), 0, 1, 0 from public.inspections where employee_id is not null
  union all select employee_id, app.sap_week(reported_on), 0, 0, 1 from public.hazard_reports where employee_id is not null and status <> 'cancelled'
), agg as (
  select employee_id, week_start, sum(obs)::int as obs_act, sum(insp)::int as insp_act, sum(haz)::int as hazard_act
    from act group by employee_id, week_start
), weeks as (
  select generate_series(app.sap_week(min(active_from)), app.sap_week(app.site_today()), interval '7 days')::date as week_start
    from public.sap_participants
  union select week_start from agg union select week_start from public.sap_history
), people as (
  select p.employee_id, w.week_start from public.sap_participants p join weeks w
      on w.week_start + 6 >= p.active_from and (p.active_until is null or w.week_start <= p.active_until)
  union select employee_id, week_start from public.sap_history
)
select x.employee_id, x.week_start, app.sap_week_no(x.week_start) as week_no, e.nrp, e.full_name, e.department_id,
       sp.level, sp.sap_section, coalesce(sp.sort_order, 0) as sort_order,
       (h.employee_id is not null) as locked,
       coalesce(h.on_leave, l.employee_id is not null) as on_leave,
       case when h.employee_id is not null then h.obs_plan when l.employee_id is not null then 0 else coalesce(t.obs_target, 0) end as obs_target,
       case when h.employee_id is not null then h.insp_plan when l.employee_id is not null then 0 else coalesce(t.insp_target, 0) end as insp_target,
       case when h.employee_id is not null then h.hazard_plan when l.employee_id is not null then 0 else coalesce(t.hazard_target, 0) end as hazard_target,
       coalesce(h.obs_act, a.obs_act, 0) as obs_act, coalesce(h.insp_act, a.insp_act, 0) as insp_act, coalesce(h.hazard_act, a.hazard_act, 0) as hazard_act
  from people x
  join public.employees e on e.id = x.employee_id
  left join public.sap_participants sp on sp.employee_id = x.employee_id
  left join public.sap_history h on h.employee_id = x.employee_id and h.week_start = x.week_start
  left join agg a on a.employee_id = x.employee_id and a.week_start = x.week_start
  left join public.sap_leave l on l.employee_id = x.employee_id and l.week_start = x.week_start
  left join lateral (select * from public.sap_targets t where t.employee_id = x.employee_id and t.valid_from <= x.week_start + 6
                      order by t.valid_from desc limit 1) t on true;

-- Kunci minggu yang sudah lewat agar laporan tidak berubah oleh input terlambat
create or replace function public.sap_lock_week(p_week_start date) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform app.require_sap();
  if p_week_start + 6 >= app.site_today() then raise exception 'Minggu berjalan belum bisa dikunci' using errcode = '22023'; end if;
  insert into public.sap_history(employee_id, week_start, obs_plan, obs_act, insp_plan, insp_act, hazard_plan, hazard_act, on_leave, source)
  select employee_id, week_start, obs_target, obs_act, insp_target, insp_act, hazard_target, hazard_act, on_leave, 'locked'
    from public.sap_weekly where week_start = p_week_start and not locked and level is not null
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

do $$
declare v text;
begin
  foreach v in array array['violation_register','commissioning_register','area_permit_register','sap_weekly'] loop
    execute format('grant select on public.%I to authenticated', v);
    execute format('revoke all on public.%I from anon', v);
  end loop;
end $$;

-- ---------------------------------------------------------------- hak eksekusi
revoke all on function app.dept_by_code(text), app.require_sap(), app.she_default_employee() from public, anon, authenticated;
grant execute on function app.dept_by_code(text) to authenticated;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and p.proname <> 'verify_document' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
