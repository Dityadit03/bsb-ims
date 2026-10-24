-- BSB IMS · M4 · SHE: risk register (IBPR), hazard report, observasi PTO, inspeksi, P2H, fit to work, insiden, SAP
-- Formulir mengikuti Portal SHE lama. Nomor inspeksi dan P2H memakai skema INS, insiden memakai INC (sudah ada di M0). Semua perubahan status lewat fungsi; tabel hanya bisa dibaca langsung.
-- Rekaman SHE menjadi bukti SMKP: risk register → 2.2, inspeksi/P2H → 5.2, insiden → 5.4.

insert into public.permissions(code, module, description) values
  ('she.report','she','Mengisi hazard report, observasi, inspeksi, P2H, fit to work dan laporan insiden'),
  ('she.followup','she','Menutup temuan hazard/inspeksi dan memeriksa fit to work'),
  ('she.investigate','she','Menginvestigasi dan menutup insiden'),
  ('risk.manage','she','Menyusun risk register / IBPR departemen'),
  ('risk.approve','she','Menyetujui risk register'),
  ('sap.manage','she','Mengatur target Safety Accountability Program');

insert into public.role_permissions(role_code, permission_code)
select r, p from (values
  ('STAFF','she.report'),
  ('SUPERVISOR','she.report'), ('SUPERVISOR','she.followup'), ('SUPERVISOR','risk.manage'),
  ('SUPERINTENDENT','she.report'), ('SUPERINTENDENT','she.followup'), ('SUPERINTENDENT','risk.manage'),
  ('DEPT_HEAD','she.report'), ('DEPT_HEAD','she.followup'), ('DEPT_HEAD','risk.manage'),
  ('HSE_MANAGER','she.report'), ('HSE_MANAGER','she.followup'), ('HSE_MANAGER','she.investigate'),
  ('HSE_MANAGER','risk.manage'), ('HSE_MANAGER','risk.approve'), ('HSE_MANAGER','sap.manage'),
  ('PJO','she.report'), ('PJO','she.followup'), ('PJO','she.investigate'), ('PJO','risk.approve'),
  ('INTERNAL_AUDITOR','she.report')
) as x(r, p);

insert into public.numbering_schemes(code, name, pattern, module) values
  ('RSK','Risk register / IBPR','RSK-BSB-{D}-{N4}','she'),
  ('HZD','Hazard report','HZD-BSB-{YYYY}-{N5}','she'),
  ('OBS','Observasi PTO','OBS-BSB-{YYYY}-{N5}','she');

insert into public.app_settings(key, value, description) values
  ('incident_report_hours', '24', 'Batas jam pelaporan awal insiden sejak kejadian'),
  ('risk_review_months', '12', 'Interval tinjauan ulang risk register (bulan)');

-- Lokasi kerja dari Portal SHE lama
insert into public.work_areas(site_id, code, name, area_type)
select s.id, w.code, w.name, w.t from public.sites s, (values
  ('CAMP','Camp/Mess','mess'), ('GDG','Gudang Logistik','area'), ('FUEL','Fuel Storage','area'),
  ('HAUL','Main road / Hauling','hauling_road'), ('FRONT','Front Mining','pit'), ('OFC','Office','office'),
  ('PLV','Parking LV','area'), ('PDT','Parkir Unit DT','area'), ('WS','Workshop Plant','workshop'),
  ('GEN','Genset','area'), ('TPS','TPS LB3','area'), ('OTH','Lainnya','area')) w(code, name, t)
 where s.code = 'BDA';

-- ---------------------------------------------------------------- pembantu
-- Matriks risiko 5x5: 1–4 rendah, 5–9 sedang, 10–16 tinggi, 20–25 ekstrem
create or replace function app.risk_level(p_score int) returns text
language sql immutable set search_path = public as $$
  select case when p_score >= 20 then 'extreme' when p_score >= 10 then 'high' when p_score >= 5 then 'medium' else 'low' end
$$;

create or replace function app.default_site() returns uuid
language sql stable set search_path = public as $$ select id from public.sites order by created_at limit 1 $$;

create or replace function app.users_with_permission(p_perm text, p_department uuid default null) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct ur.user_id), '{}') from public.user_roles ur
    join public.role_permissions rp on rp.role_code = ur.role_code
    join public.profiles p on p.id = ur.user_id
   where rp.permission_code = p_perm and p.status = 'active'
     and (p_department is null or ur.department_id is null or ur.department_id = p_department)
     and current_date >= ur.valid_from and (ur.valid_until is null or current_date <= ur.valid_until)
$$;

-- Lampiran milik pemanggil yang belum terikat ke rekaman lain diikat ke rekaman SHE.
create or replace function app.claim_attachments(p_ids uuid[], p_table text, p_owner uuid) returns void
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if coalesce(cardinality(p_ids), 0) = 0 then return; end if;
  update public.attachments set owner_table = p_table, owner_id = p_owner
   where id = any(p_ids) and uploaded_by = auth.uid() and owner_id is null;
  get diagnostics n = row_count;
  if n <> cardinality(p_ids) then raise exception 'Lampiran tidak valid atau bukan milik Anda' using errcode = '22023'; end if;
end $$;

create or replace function app.require_text(p_val text, p_label text) returns text
language plpgsql immutable set search_path = public as $$
begin
  if coalesce(btrim(p_val), '') = '' then raise exception '% wajib diisi', p_label using errcode = '22023'; end if;
  return btrim(p_val);
end $$;

-- ---------------------------------------------------------------- risk register / IBPR
create table public.risk_register(
  id uuid primary key default gen_random_uuid(),
  risk_no text not null unique,
  revision int not null default 0,
  site_id uuid references public.sites(id),
  department_id uuid not null references public.departments(id),
  work_area_id uuid references public.work_areas(id),
  activity text not null,
  condition text not null default 'routine' check (condition in ('routine','non_routine','emergency')),
  category text not null default 'safety' check (category in ('safety','health','environment')),
  hazard text not null,
  risk text not null,
  existing_controls text,
  initial_likelihood smallint not null check (initial_likelihood between 1 and 5),
  initial_severity smallint not null check (initial_severity between 1 and 5),
  initial_score smallint generated always as (initial_likelihood * initial_severity) stored,
  additional_controls text,
  control_hierarchy text check (control_hierarchy in ('elimination','substitution','engineering','administrative','ppe')),
  residual_likelihood smallint not null check (residual_likelihood between 1 and 5),
  residual_severity smallint not null check (residual_severity between 1 and 5),
  residual_score smallint generated always as (residual_likelihood * residual_severity) stored,
  legal_requirement_id uuid references public.legal_requirements(id),
  clause_id uuid references public.compliance_clauses(id),
  owner_id uuid not null references public.profiles(id),
  status text not null default 'draft' check (status in ('draft','approved','retired')),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  review_due date,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (residual_likelihood * residual_severity <= initial_likelihood * initial_severity)
);
create index risk_register_dept_idx on public.risk_register(department_id, status);

-- ---------------------------------------------------------------- hazard report (KTA/TTA)
create table public.hazard_reports(
  id uuid primary key default gen_random_uuid(),
  hazard_no text not null unique,
  reported_on date not null,
  reporter_id uuid not null references public.profiles(id) default auth.uid(),
  department_id uuid not null references public.departments(id),
  site_id uuid references public.sites(id),
  work_area_id uuid references public.work_areas(id),
  location_note text,
  hazard_type text not null check (hazard_type in ('KTA','TTA')),
  description text not null,
  recommendation text,
  risk_level text not null default 'medium' check (risk_level in ('low','medium','high','extreme')),
  pic_department_id uuid not null references public.departments(id),
  due_date date not null,
  status text not null default 'open' check (status in ('open','closed','cancelled')),
  close_note text,
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (due_date >= reported_on)
);
create index hazard_reports_status_idx on public.hazard_reports(status, due_date);

-- ---------------------------------------------------------------- observasi perilaku (PTO)
create table public.observations(
  id uuid primary key default gen_random_uuid(),
  obs_no text not null unique,
  observed_on date not null,
  observer_id uuid not null references public.profiles(id) default auth.uid(),
  department_id uuid not null references public.departments(id),
  site_id uuid references public.sites(id),
  work_area_id uuid references public.work_areas(id),
  activity text not null,
  worker_name text,
  worker_count int check (worker_count is null or worker_count > 0),
  result text not null check (result in ('safe','unsafe')),
  unsafe_behaviour text,
  coaching text,
  status text not null check (status in ('open','closed')),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (result = 'safe' or coalesce(btrim(unsafe_behaviour), '') <> ''),
  check (status = 'open' or result = 'safe' or coalesce(btrim(coaching), '') <> '')
);

-- ---------------------------------------------------------------- inspeksi terencana
create table public.inspections(
  id uuid primary key default gen_random_uuid(),
  inspection_no text not null unique,
  inspected_on date not null,
  inspector_id uuid not null references public.profiles(id) default auth.uid(),
  department_id uuid not null references public.departments(id),
  site_id uuid references public.sites(id),
  inspection_type text not null check (inspection_type in
    ('work_area','equipment','workshop','housekeeping','ppe','emergency_equipment','facility','electrical','fuel_storage','other')),
  work_area_id uuid references public.work_areas(id),
  object text not null,
  note text,
  created_at timestamptz not null default now()
);

create table public.inspection_findings(
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections(id),
  seq smallint not null,
  description text not null,
  risk_level text not null default 'medium' check (risk_level in ('low','medium','high','extreme')),
  recommendation text,
  pic_department_id uuid not null references public.departments(id),
  due_date date not null,
  status text not null default 'open' check (status in ('open','closed')),
  close_note text,
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (inspection_id, seq)
);
create index inspection_findings_status_idx on public.inspection_findings(status, due_date);

-- ---------------------------------------------------------------- P2H unit
create table public.p2h_items(
  code text primary key check (code ~ '^[a-z_]{2,30}$'),
  label text not null,
  is_critical boolean not null default false,
  sort_order int not null default 0,
  active boolean not null default true
);
insert into public.p2h_items(code, label, is_critical, sort_order) values
  ('brake','Rem',true,1), ('lights','Lampu & sein',false,2), ('horn','Klakson',true,3), ('seatbelt','Sabuk pengaman',true,4),
  ('extinguisher','APAR',false,5), ('wheel_chock','Wheel chock',false,6), ('tyre','Ban & baut roda',true,7),
  ('glass_wiper','Kaca & wiper',false,8), ('cone','Safety cone',false,9), ('radio','Radio komunikasi',false,10),
  ('leak','Kebocoran oli/air',false,11), ('reverse_alarm','Alarm mundur',true,12);

create table public.p2h_checks(
  id uuid primary key default gen_random_uuid(),
  p2h_no text not null unique,
  check_date date not null,
  shift smallint not null check (shift in (1, 2)),
  operator_id uuid not null references public.profiles(id) default auth.uid(),
  department_id uuid not null references public.departments(id),
  site_id uuid references public.sites(id),
  unit_no text not null,
  unit_type text not null check (unit_type in ('DT','LV','ST','FT','WT','BUS','EXC','OTHER')),
  hour_meter numeric check (hour_meter is null or hour_meter >= 0),
  items jsonb not null,
  notes text,
  conclusion text not null check (conclusion in ('fit','fit_with_notes','unfit')),
  created_at timestamptz not null default now(),
  unique (unit_no, check_date, shift)
);

-- ---------------------------------------------------------------- fit to work
create table public.fit_to_work(
  id uuid primary key default gen_random_uuid(),
  check_date date not null,
  shift smallint not null check (shift in (1, 2)),
  worker_id uuid not null references public.profiles(id) default auth.uid(),
  department_id uuid not null references public.departments(id),
  sleep_hours numeric not null check (sleep_hours between 0 and 24),
  drowsy_medication boolean not null default false,
  complaint text,
  blood_pressure text,
  conclusion text not null check (conclusion in ('fit','fit_with_notes','unfit')),
  checker_note text,
  checked_by uuid references public.profiles(id),
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (worker_id, check_date, shift),
  check (conclusion <> 'fit' or (sleep_hours >= 6 and not drowsy_medication))
);

-- ---------------------------------------------------------------- insiden
create table public.incidents(
  id uuid primary key default gen_random_uuid(),
  incident_no text not null unique,
  occurred_at timestamptz not null,
  reported_at timestamptz not null default now(),
  reporter_id uuid not null references public.profiles(id) default auth.uid(),
  site_id uuid references public.sites(id),
  department_id uuid not null references public.departments(id),
  work_area_id uuid references public.work_areas(id),
  location_note text,
  classification text not null check (classification in
    ('nearmiss','property_damage','first_aid','mti','lti','fatality','environmental')),
  unit_no text,
  involved_names text,
  chronology text not null,
  immediate_action text,
  late_report boolean not null default false,
  late_reason text,
  status text not null default 'reported' check (status in ('reported','investigating','investigated','closed')),
  investigator_id uuid references public.profiles(id),
  root_cause text,
  investigation_summary text,
  investigated_at timestamptz,
  regulator_notified_at timestamptz,
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  close_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (occurred_at <= reported_at),
  check (not late_report or coalesce(btrim(late_reason), '') <> '')
);
create index incidents_status_idx on public.incidents(status, occurred_at desc);

-- ---------------------------------------------------------------- SAP (Safety Accountability Program)
-- Target mingguan per pengawas. Act dihitung dari observasi, inspeksi dan hazard report yang dibuat orang tersebut.
create table public.sap_targets(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  valid_from date not null,
  obs_target smallint not null default 0 check (obs_target >= 0),
  insp_target smallint not null default 0 check (insp_target >= 0),
  hazard_target smallint not null default 0 check (hazard_target >= 0),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (user_id, valid_from)
);

create table public.sap_leave(
  user_id uuid not null references public.profiles(id),
  week_start date not null check (extract(isodow from week_start) = 2),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  primary key (user_id, week_start)
);

-- ---------------------------------------------------------------- trigger, RLS, hak tabel
do $$
declare t text;
begin
  foreach t in array array['risk_register','hazard_reports','observations','inspection_findings','fit_to_work','incidents'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['risk_register','hazard_reports','observations','inspections','inspection_findings','p2h_items',
                           'p2h_checks','fit_to_work','incidents','sap_targets','sap_leave'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
    if t <> 'fit_to_work' then
      execute format('create policy %I_read on public.%I for select to authenticated using (app.is_active_user())', t, t);
    end if;
  end loop;
end $$;
-- Data kesehatan fit to work hanya untuk pekerja sendiri dan pemeriksa
create policy fit_to_work_read on public.fit_to_work for select to authenticated
  using (app.is_active_user() and (worker_id = auth.uid() or app.has_permission('she.followup', department_id)));
create policy p2h_items_write on public.p2h_items for all to authenticated
  using (app.has_permission_anywhere('compliance.configure')) with check (app.has_permission_anywhere('compliance.configure'));
revoke insert, update, delete on public.risk_register, public.hazard_reports, public.observations, public.inspections,
  public.inspection_findings, public.p2h_checks, public.fit_to_work, public.incidents, public.sap_targets, public.sap_leave
  from authenticated;

-- ---------------------------------------------------------------- fungsi: risk register
create or replace function public.risk_save(
  p_id uuid, p_department uuid, p_activity text, p_hazard text, p_risk text,
  p_initial_l int, p_initial_s int, p_residual_l int, p_residual_s int,
  p_existing_controls text default null, p_additional_controls text default null, p_control_hierarchy text default null,
  p_work_area uuid default null, p_condition text default 'routine', p_category text default 'safety',
  p_owner uuid default null, p_legal uuid default null, p_idempotency_key text default null)
returns public.risk_register language plpgsql security definer set search_path = public as $$
declare
  v public.risk_register;
  v_reg public.registrations;
begin
  if not app.has_permission('risk.manage', p_department) then
    raise exception 'Tidak berwenang menyusun risk register departemen ini' using errcode = '42501';
  end if;
  if p_residual_l * p_residual_s >= 10 and coalesce(btrim(p_additional_controls), '') = '' then
    raise exception 'Risiko residual tinggi/ekstrem wajib punya pengendalian tambahan' using errcode = '22023';
  end if;
  if p_id is null then
    if p_idempotency_key is not null then
      select k.* into v from public.registrations r join public.risk_register k on k.risk_no = r.number
       where r.idempotency_key = p_idempotency_key;
      if found then return v; end if;
    end if;
    v_reg := app.allocate_number('RSK', jsonb_build_object('D', (select code from public.departments where id = p_department)),
                                 p_idempotency_key);
    insert into public.risk_register(risk_no, site_id, department_id, work_area_id, activity, condition, category, hazard, risk,
      existing_controls, initial_likelihood, initial_severity, additional_controls, control_hierarchy,
      residual_likelihood, residual_severity, legal_requirement_id, clause_id, owner_id)
    values (v_reg.number, app.default_site(), p_department, p_work_area, app.require_text(p_activity, 'Aktivitas'), p_condition, p_category,
      app.require_text(p_hazard, 'Bahaya'), app.require_text(p_risk, 'Risiko'), p_existing_controls, p_initial_l, p_initial_s,
      p_additional_controls, p_control_hierarchy, p_residual_l, p_residual_s, p_legal,
      (select id from public.compliance_clauses where framework_code = 'SMKP' and code = '2.2'), coalesce(p_owner, auth.uid()))
    returning * into v;
    update public.registrations set ref_table = 'risk_register', ref_id = v.id where id = v_reg.id;
  else
    select * into v from public.risk_register where id = p_id for update;
    if not found then raise exception 'Risiko tidak ditemukan' using errcode = 'P0002'; end if;
    if v.department_id <> p_department then raise exception 'Departemen risiko tidak bisa dipindah' using errcode = '22023'; end if;
    if v.status = 'retired' then raise exception 'Risiko sudah tidak berlaku' using errcode = '22023'; end if;
    -- mengubah risiko yang sudah disetujui membuka revisi baru yang perlu disetujui ulang
    update public.risk_register set
      revision = revision + case when status = 'approved' then 1 else 0 end, status = 'draft', approved_by = null, approved_at = null,
      work_area_id = p_work_area, activity = app.require_text(p_activity, 'Aktivitas'), condition = p_condition, category = p_category,
      hazard = app.require_text(p_hazard, 'Bahaya'), risk = app.require_text(p_risk, 'Risiko'), existing_controls = p_existing_controls,
      initial_likelihood = p_initial_l, initial_severity = p_initial_s, additional_controls = p_additional_controls,
      control_hierarchy = p_control_hierarchy, residual_likelihood = p_residual_l, residual_severity = p_residual_s,
      legal_requirement_id = p_legal, owner_id = coalesce(p_owner, owner_id)
     where id = p_id returning * into v;
  end if;
  return v;
end $$;

-- Persetujuan oleh orang lain; residual ekstrem tidak boleh disetujui (pekerjaan tidak boleh berjalan).
create or replace function public.risk_approve(p_id uuid)
returns public.risk_register language plpgsql security definer set search_path = public as $$
declare v public.risk_register;
begin
  select * into v from public.risk_register where id = p_id for update;
  if not found then raise exception 'Risiko tidak ditemukan' using errcode = 'P0002'; end if;
  if not app.has_permission('risk.approve', v.department_id) then
    raise exception 'Tidak berwenang menyetujui risk register' using errcode = '42501';
  end if;
  if v.status <> 'draft' then raise exception 'Hanya draft yang bisa disetujui' using errcode = '22023'; end if;
  if v.updated_by = auth.uid() or (v.updated_by is null and v.created_by = auth.uid()) then
    raise exception 'Penyusun tidak boleh menyetujui risikonya sendiri' using errcode = '42501';
  end if;
  if app.risk_level(v.residual_score) = 'extreme' then
    raise exception 'Risiko residual ekstrem tidak bisa disetujui; tambahkan pengendalian' using errcode = '22023';
  end if;
  update public.risk_register set status = 'approved', approved_by = auth.uid(), approved_at = now(),
         review_due = current_date + make_interval(months => coalesce((select value::text::int from public.app_settings where key = 'risk_review_months'), 12))
   where id = p_id returning * into v;
  return v;
end $$;

create or replace function public.risk_retire(p_id uuid, p_reason text)
returns public.risk_register language plpgsql security definer set search_path = public as $$
declare v public.risk_register;
begin
  select * into v from public.risk_register where id = p_id for update;
  if not found or not app.has_permission('risk.approve', v.department_id) then
    raise exception 'Tidak berwenang' using errcode = '42501';
  end if;
  perform app.require_text(p_reason, 'Alasan');
  update public.risk_register set status = 'retired' where id = p_id returning * into v;
  perform app.log_event('risk.retire', 'risk_register', v.id::text, jsonb_build_object('reason', p_reason));
  return v;
end $$;

-- ---------------------------------------------------------------- fungsi: hazard report
create or replace function public.hazard_report(
  p_reported_on date, p_department uuid, p_hazard_type text, p_description text, p_pic_department uuid, p_due date,
  p_work_area uuid default null, p_location_note text default null, p_recommendation text default null,
  p_risk text default 'medium', p_attachments uuid[] default '{}', p_idempotency_key text default null)
returns public.hazard_reports language plpgsql security definer set search_path = public as $$
declare
  v public.hazard_reports;
  v_reg public.registrations;
begin
  if not app.has_permission('she.report', p_department) then raise exception 'Tidak berwenang melapor' using errcode = '42501'; end if;
  if p_reported_on > app.site_today() then raise exception 'Tanggal laporan tidak boleh di masa depan' using errcode = '22023'; end if;
  if p_idempotency_key is not null then
    select h.* into v from public.registrations r join public.hazard_reports h on h.hazard_no = r.number
     where r.idempotency_key = p_idempotency_key;
    if found then return v; end if;
  end if;
  v_reg := app.allocate_number('HZD', jsonb_build_object('date', p_reported_on), p_idempotency_key);
  insert into public.hazard_reports(hazard_no, reported_on, department_id, site_id, work_area_id, location_note, hazard_type,
    description, recommendation, risk_level, pic_department_id, due_date)
  values (v_reg.number, p_reported_on, p_department, app.default_site(), p_work_area, p_location_note, p_hazard_type,
    app.require_text(p_description, 'Uraian temuan'), p_recommendation, p_risk, p_pic_department, p_due)
  returning * into v;
  update public.registrations set ref_table = 'hazard_reports', ref_id = v.id where id = v_reg.id;
  perform app.claim_attachments(p_attachments, 'hazard_reports', v.id);
  perform app.notify_users(app.users_with_permission('she.followup', p_pic_department), 'she.hazard',
    'Hazard report baru: ' || v.hazard_no, left(v.description, 140), '/she/hazard/' || v.id);
  return v;
end $$;

create or replace function public.hazard_close(p_id uuid, p_note text, p_attachments uuid[] default '{}')
returns public.hazard_reports language plpgsql security definer set search_path = public as $$
declare v public.hazard_reports;
begin
  select * into v from public.hazard_reports where id = p_id for update;
  if not found then raise exception 'Hazard report tidak ditemukan' using errcode = 'P0002'; end if;
  if not app.has_permission('she.followup', v.pic_department_id) then
    raise exception 'Hanya pengawas departemen PIC yang bisa menutup' using errcode = '42501';
  end if;
  if v.status <> 'open' then raise exception 'Hazard report tidak berstatus open' using errcode = '22023'; end if;
  if v.risk_level in ('high','extreme') and coalesce(cardinality(p_attachments), 0) = 0 then
    raise exception 'Temuan risiko tinggi/ekstrem wajib dilampiri bukti perbaikan' using errcode = '22023';
  end if;
  perform app.claim_attachments(p_attachments, 'hazard_reports', v.id);
  update public.hazard_reports set status = 'closed', close_note = app.require_text(p_note, 'Tindakan perbaikan'),
         closed_by = auth.uid(), closed_at = now()
   where id = p_id returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------- fungsi: observasi PTO
create or replace function public.observation_record(
  p_observed_on date, p_department uuid, p_activity text, p_result text,
  p_work_area uuid default null, p_worker_name text default null, p_worker_count int default null,
  p_unsafe_behaviour text default null, p_coaching text default null, p_attachments uuid[] default '{}',
  p_idempotency_key text default null)
returns public.observations language plpgsql security definer set search_path = public as $$
declare
  v public.observations;
  v_reg public.registrations;
begin
  if not app.has_permission('she.report', p_department) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if p_observed_on > app.site_today() then raise exception 'Tanggal tidak boleh di masa depan' using errcode = '22023'; end if;
  if p_idempotency_key is not null then
    select o.* into v from public.registrations r join public.observations o on o.obs_no = r.number where r.idempotency_key = p_idempotency_key;
    if found then return v; end if;
  end if;
  v_reg := app.allocate_number('OBS', jsonb_build_object('date', p_observed_on), p_idempotency_key);
  insert into public.observations(obs_no, observed_on, department_id, site_id, work_area_id, activity, worker_name, worker_count,
    result, unsafe_behaviour, coaching, status, closed_at)
  values (v_reg.number, p_observed_on, p_department, app.default_site(), p_work_area, app.require_text(p_activity, 'Aktivitas'),
    p_worker_name, p_worker_count, p_result, p_unsafe_behaviour, nullif(btrim(p_coaching), ''),
    case when p_result = 'safe' or coalesce(btrim(p_coaching), '') <> '' then 'closed' else 'open' end,
    case when p_result = 'safe' or coalesce(btrim(p_coaching), '') <> '' then now() end)
  returning * into v;
  update public.registrations set ref_table = 'observations', ref_id = v.id where id = v_reg.id;
  perform app.claim_attachments(p_attachments, 'observations', v.id);
  return v;
end $$;

create or replace function public.observation_close(p_id uuid, p_coaching text)
returns public.observations language plpgsql security definer set search_path = public as $$
declare v public.observations;
begin
  select * into v from public.observations where id = p_id for update;
  if not found then raise exception 'Observasi tidak ditemukan' using errcode = 'P0002'; end if;
  if v.observer_id <> auth.uid() and not app.has_permission('she.followup', v.department_id) then
    raise exception 'Tidak berwenang' using errcode = '42501';
  end if;
  if v.status <> 'open' then raise exception 'Observasi sudah ditutup' using errcode = '22023'; end if;
  update public.observations set coaching = app.require_text(p_coaching, 'Coaching'), status = 'closed', closed_at = now()
   where id = p_id returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------- fungsi: inspeksi
-- p_findings: [{"description","risk_level","recommendation","pic_department_id","due_date"}]
create or replace function public.inspection_record(
  p_inspected_on date, p_department uuid, p_type text, p_object text, p_findings jsonb default '[]',
  p_work_area uuid default null, p_note text default null, p_attachments uuid[] default '{}', p_idempotency_key text default null)
returns public.inspections language plpgsql security definer set search_path = public as $$
declare
  v public.inspections;
  v_reg public.registrations;
  f jsonb;
  i int := 0;
begin
  if not app.has_permission('she.report', p_department) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if p_inspected_on > app.site_today() then raise exception 'Tanggal tidak boleh di masa depan' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_findings, '[]')) <> 'array' then raise exception 'Format temuan tidak valid' using errcode = '22023'; end if;
  if p_idempotency_key is not null then
    select x.* into v from public.registrations r join public.inspections x on x.inspection_no = r.number where r.idempotency_key = p_idempotency_key;
    if found then return v; end if;
  end if;
  v_reg := app.allocate_number('INS', jsonb_build_object('date', p_inspected_on), p_idempotency_key);
  insert into public.inspections(inspection_no, inspected_on, department_id, site_id, inspection_type, work_area_id, object, note)
  values (v_reg.number, p_inspected_on, p_department, app.default_site(), p_type, p_work_area, app.require_text(p_object, 'Objek inspeksi'), p_note)
  returning * into v;
  update public.registrations set ref_table = 'inspections', ref_id = v.id where id = v_reg.id;
  for f in select * from jsonb_array_elements(coalesce(p_findings, '[]')) loop
    i := i + 1;
    if (f->>'due_date')::date < p_inspected_on then raise exception 'Due date temuan % sebelum tanggal inspeksi', i using errcode = '22023'; end if;
    insert into public.inspection_findings(inspection_id, seq, description, risk_level, recommendation, pic_department_id, due_date)
    values (v.id, i, app.require_text(f->>'description', 'Uraian temuan ' || i), coalesce(f->>'risk_level', 'medium'),
            f->>'recommendation', (f->>'pic_department_id')::uuid, (f->>'due_date')::date);
    perform app.notify_users(app.users_with_permission('she.followup', (f->>'pic_department_id')::uuid), 'she.finding',
      'Temuan inspeksi ' || v.inspection_no || '-' || i, left(f->>'description', 140), '/she/inspeksi/' || v.id);
  end loop;
  perform app.claim_attachments(p_attachments, 'inspections', v.id);
  return v;
end $$;

create or replace function public.finding_close(p_id uuid, p_note text, p_attachments uuid[] default '{}')
returns public.inspection_findings language plpgsql security definer set search_path = public as $$
declare v public.inspection_findings;
begin
  select * into v from public.inspection_findings where id = p_id for update;
  if not found then raise exception 'Temuan tidak ditemukan' using errcode = 'P0002'; end if;
  if not app.has_permission('she.followup', v.pic_department_id) then
    raise exception 'Hanya pengawas departemen PIC yang bisa menutup' using errcode = '42501';
  end if;
  if v.status <> 'open' then raise exception 'Temuan sudah ditutup' using errcode = '22023'; end if;
  if v.risk_level in ('high','extreme') and coalesce(cardinality(p_attachments), 0) = 0 then
    raise exception 'Temuan risiko tinggi/ekstrem wajib dilampiri bukti perbaikan' using errcode = '22023';
  end if;
  perform app.claim_attachments(p_attachments, 'inspection_findings', v.id);
  update public.inspection_findings set status = 'closed', close_note = app.require_text(p_note, 'Tindakan perbaikan'),
         closed_by = auth.uid(), closed_at = now()
   where id = p_id returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------- fungsi: P2H
-- p_items: {"brake":"ok","horn":"not_ok",...}. Item kritis tidak OK → kesimpulan dipaksa "tidak layak".
create or replace function public.p2h_submit(
  p_check_date date, p_shift int, p_department uuid, p_unit_no text, p_unit_type text, p_items jsonb,
  p_conclusion text, p_hour_meter numeric default null, p_notes text default null, p_attachments uuid[] default '{}')
returns public.p2h_checks language plpgsql security definer set search_path = public as $$
declare
  v public.p2h_checks;
  v_reg public.registrations;
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
  v_reg := app.allocate_number('INS', jsonb_build_object('date', p_check_date), null);
  insert into public.p2h_checks(p2h_no, check_date, shift, department_id, site_id, unit_no, unit_type, hour_meter, items, notes, conclusion)
  values (v_reg.number, p_check_date, p_shift, p_department, app.default_site(), upper(app.require_text(p_unit_no, 'No. lambung')),
          p_unit_type, p_hour_meter, p_items, p_notes, v_concl)
  returning * into v;
  update public.registrations set ref_table = 'p2h_checks', ref_id = v.id where id = v_reg.id;
  perform app.claim_attachments(p_attachments, 'p2h_checks', v.id);
  if v_concl = 'unfit' then
    perform app.notify_users(app.users_with_permission('she.followup', p_department) || app.users_with_permission('she.followup',
      (select id from public.departments where code = 'PLT')), 'she.p2h_unfit', 'Unit tidak layak: ' || v.unit_no, v.notes, '/she/p2h/' || v.id);
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------- fungsi: fit to work
create or replace function public.ftw_submit(
  p_check_date date, p_shift int, p_department uuid, p_sleep_hours numeric, p_drowsy_medication boolean,
  p_conclusion text, p_complaint text default null, p_blood_pressure text default null)
returns public.fit_to_work language plpgsql security definer set search_path = public as $$
declare v public.fit_to_work;
begin
  if not app.has_permission('she.report', p_department) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if p_check_date <> app.site_today() then raise exception 'Fit to work hanya untuk hari ini' using errcode = '22023'; end if;
  if p_conclusion = 'fit' and (p_sleep_hours < 6 or p_drowsy_medication) then
    raise exception 'Tidur kurang dari 6 jam atau minum obat penyebab kantuk tidak bisa dinyatakan fit' using errcode = '22023';
  end if;
  insert into public.fit_to_work(check_date, shift, department_id, sleep_hours, drowsy_medication, complaint, blood_pressure, conclusion)
  values (p_check_date, p_shift, p_department, p_sleep_hours, p_drowsy_medication, p_complaint, p_blood_pressure, p_conclusion)
  returning * into v;
  if p_conclusion <> 'fit' then
    perform app.notify_users(app.users_with_permission('she.followup', p_department), 'she.ftw',
      'Fit to work perlu pemeriksaan', coalesce(p_complaint, 'Tidur ' || p_sleep_hours || ' jam'), '/she/ftw');
  end if;
  return v;
end $$;

create or replace function public.ftw_check(p_id uuid, p_conclusion text, p_note text)
returns public.fit_to_work language plpgsql security definer set search_path = public as $$
declare v public.fit_to_work;
begin
  select * into v from public.fit_to_work where id = p_id for update;
  if not found then raise exception 'Data tidak ditemukan' using errcode = 'P0002'; end if;
  if v.worker_id = auth.uid() or not app.has_permission('she.followup', v.department_id) then
    raise exception 'Pemeriksaan harus oleh pengawas lain' using errcode = '42501';
  end if;
  update public.fit_to_work set conclusion = p_conclusion, checker_note = app.require_text(p_note, 'Catatan pemeriksa'),
         checked_by = auth.uid(), checked_at = now()
   where id = p_id returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------- fungsi: insiden
create or replace function public.incident_report(
  p_occurred_at timestamptz, p_department uuid, p_classification text, p_chronology text,
  p_work_area uuid default null, p_location_note text default null, p_unit_no text default null, p_involved_names text default null,
  p_immediate_action text default null, p_late_reason text default null, p_attachments uuid[] default '{}',
  p_idempotency_key text default null)
returns public.incidents language plpgsql security definer set search_path = public as $$
declare
  v public.incidents;
  v_reg public.registrations;
  v_late boolean;
begin
  if not app.has_permission('she.report', p_department) then raise exception 'Tidak berwenang melapor' using errcode = '42501'; end if;
  if p_occurred_at > now() then raise exception 'Waktu kejadian tidak boleh di masa depan' using errcode = '22023'; end if;
  if p_idempotency_key is not null then
    select x.* into v from public.registrations r join public.incidents x on x.incident_no = r.number where r.idempotency_key = p_idempotency_key;
    if found then return v; end if;
  end if;
  v_late := now() - p_occurred_at > make_interval(hours => coalesce((select value::text::int from public.app_settings where key = 'incident_report_hours'), 24));
  if v_late and coalesce(btrim(p_late_reason), '') = '' then
    raise exception 'Laporan melewati batas waktu; isi alasan keterlambatan' using errcode = '22023';
  end if;
  v_reg := app.allocate_number('INC', jsonb_build_object('date', (p_occurred_at at time zone 'Asia/Makassar')::date), p_idempotency_key);
  insert into public.incidents(incident_no, occurred_at, site_id, department_id, work_area_id, location_note, classification, unit_no,
    involved_names, chronology, immediate_action, late_report, late_reason)
  values (v_reg.number, p_occurred_at, app.default_site(), p_department, p_work_area, p_location_note, p_classification, p_unit_no,
    p_involved_names, app.require_text(p_chronology, 'Kronologi'), p_immediate_action, v_late, case when v_late then p_late_reason end)
  returning * into v;
  update public.registrations set ref_table = 'incidents', ref_id = v.id where id = v_reg.id;
  perform app.claim_attachments(p_attachments, 'incidents', v.id);
  perform app.notify_users(app.users_with_permission('she.investigate'), 'she.incident',
    'Insiden ' || v.classification || ': ' || v.incident_no, left(v.chronology, 140), '/she/insiden/' || v.id);
  return v;
end $$;

create or replace function public.incident_assign(p_id uuid, p_investigator uuid)
returns public.incidents language plpgsql security definer set search_path = public as $$
declare v public.incidents;
begin
  select * into v from public.incidents where id = p_id for update;
  if not found then raise exception 'Insiden tidak ditemukan' using errcode = 'P0002'; end if;
  if not app.has_permission('she.investigate', v.department_id) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if v.status not in ('reported','investigating') then raise exception 'Investigasi sudah selesai' using errcode = '22023'; end if;
  if not exists(select 1 from public.profiles where id = p_investigator and status = 'active') then
    raise exception 'Investigator harus pengguna aktif' using errcode = '22023';
  end if;
  update public.incidents set status = 'investigating', investigator_id = p_investigator where id = p_id returning * into v;
  perform app.notify_users(array[p_investigator], 'she.investigate', 'Investigasi insiden ' || v.incident_no, left(v.chronology, 140),
    '/she/insiden/' || v.id);
  return v;
end $$;

-- Investigator melaporkan akar masalah. Klasifikasi boleh dikoreksi berdasarkan hasil investigasi.
create or replace function public.incident_investigate(p_id uuid, p_root_cause text, p_summary text, p_classification text default null)
returns public.incidents language plpgsql security definer set search_path = public as $$
declare v public.incidents;
begin
  select * into v from public.incidents where id = p_id for update;
  if not found then raise exception 'Insiden tidak ditemukan' using errcode = 'P0002'; end if;
  if v.investigator_id is distinct from auth.uid() then raise exception 'Hanya investigator yang ditunjuk' using errcode = '42501'; end if;
  if v.status <> 'investigating' then raise exception 'Insiden tidak sedang diinvestigasi' using errcode = '22023'; end if;
  update public.incidents set root_cause = app.require_text(p_root_cause, 'Akar masalah'),
         investigation_summary = app.require_text(p_summary, 'Ringkasan investigasi'),
         classification = coalesce(p_classification, classification), status = 'investigated', investigated_at = now()
   where id = p_id returning * into v;
  return v;
end $$;

-- Penutupan: selain nearmiss wajib ada action plan; LTI/fatality wajib tercatat sudah dilaporkan ke KaIT.
create or replace function public.incident_close(p_id uuid, p_note text, p_regulator_notified_at timestamptz default null)
returns public.incidents language plpgsql security definer set search_path = public as $$
declare v public.incidents;
begin
  select * into v from public.incidents where id = p_id for update;
  if not found then raise exception 'Insiden tidak ditemukan' using errcode = 'P0002'; end if;
  if not app.has_permission('she.investigate', v.department_id) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if v.status <> 'investigated' then raise exception 'Investigasi belum selesai' using errcode = '22023'; end if;
  if v.investigator_id = auth.uid() then raise exception 'Investigator tidak boleh menutup investigasinya sendiri' using errcode = '42501'; end if;
  if v.classification <> 'nearmiss' and not exists(
       select 1 from public.corrective_actions a where a.source_table = 'incidents' and a.source_id = v.id and a.status <> 'cancelled') then
    raise exception 'Buat minimal satu action plan dari hasil investigasi' using errcode = '22023';
  end if;
  if v.classification in ('lti','fatality') and coalesce(p_regulator_notified_at, v.regulator_notified_at) is null then
    raise exception 'Catat waktu pelaporan ke KaIT untuk LTI/fatality' using errcode = '22023';
  end if;
  update public.incidents set status = 'closed', close_note = app.require_text(p_note, 'Catatan penutupan'), closed_by = auth.uid(),
         closed_at = now(), regulator_notified_at = coalesce(p_regulator_notified_at, regulator_notified_at)
   where id = p_id returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------- fungsi: SAP
create or replace function public.sap_set_target(p_user uuid, p_valid_from date, p_obs int, p_insp int, p_hazard int)
returns public.sap_targets language plpgsql security definer set search_path = public as $$
declare v public.sap_targets;
begin
  if not app.has_permission_anywhere('sap.manage') then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  insert into public.sap_targets(user_id, valid_from, obs_target, insp_target, hazard_target)
  values (p_user, p_valid_from, p_obs, p_insp, p_hazard)
  on conflict (user_id, valid_from) do update set obs_target = excluded.obs_target, insp_target = excluded.insp_target,
    hazard_target = excluded.hazard_target
  returning * into v;
  return v;
end $$;

create or replace function public.sap_set_leave(p_user uuid, p_week_start date, p_on_leave boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not app.has_permission_anywhere('sap.manage') then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if p_on_leave then
    insert into public.sap_leave(user_id, week_start) values (p_user, p_week_start) on conflict do nothing;
  else
    delete from public.sap_leave where user_id = p_user and week_start = p_week_start;
  end if;
end $$;

-- Minggu SAP PT BDA: Selasa–Senin
create or replace function app.sap_week(p_date date) returns date
language sql immutable set search_path = public as $$
  select p_date - ((extract(isodow from p_date)::int + 5) % 7)
$$;

-- ---------------------------------------------------------------- bukti SMKP dari rekaman SHE
alter table public.evidence_links drop constraint evidence_links_source_table_check;
alter table public.evidence_links add constraint evidence_links_source_table_check check (source_table in
  ('documents','attachments','corrective_actions','legal_evaluations','risk_register','inspections','incidents'));

create or replace function app.source_exists(p_table text, p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_table
    when 'documents' then exists(select 1 from public.documents where id = p_id and status in ('effective','under_revision'))
    when 'attachments' then exists(select 1 from public.attachments where id = p_id)
    when 'corrective_actions' then exists(select 1 from public.corrective_actions where id = p_id and status = 'closed')
    when 'legal_evaluations' then exists(select 1 from public.legal_evaluations where id = p_id)
    when 'risk_register' then exists(select 1 from public.risk_register where id = p_id and status = 'approved')
    when 'inspections' then exists(select 1 from public.inspections where id = p_id)
    when 'incidents' then exists(select 1 from public.incidents where id = p_id and status = 'closed')
    else false end
$$;

-- ---------------------------------------------------------------- tampilan
create view public.risk_register_view with (security_invoker = true) as
select r.*, app.risk_level(r.initial_score) as initial_level, app.risk_level(r.residual_score) as residual_level,
       d.code as department_code, w.name as work_area_name, o.full_name as owner_name,
       (r.status = 'approved' and r.review_due < current_date) as review_overdue
  from public.risk_register r
  join public.departments d on d.id = r.department_id
  left join public.work_areas w on w.id = r.work_area_id
  join public.profiles o on o.id = r.owner_id;

create view public.she_hazard_register with (security_invoker = true) as
select h.*, d.code as department_code, pd.code as pic_department_code, w.name as work_area_name, p.full_name as reporter_name,
       (h.status = 'open' and h.due_date < current_date) as is_overdue,
       (select count(*) from public.corrective_actions a where a.source_table = 'hazard_reports' and a.source_id = h.id)::int as capa_count
  from public.hazard_reports h
  join public.departments d on d.id = h.department_id
  join public.departments pd on pd.id = h.pic_department_id
  left join public.work_areas w on w.id = h.work_area_id
  join public.profiles p on p.id = h.reporter_id;

create view public.she_finding_register with (security_invoker = true) as
select f.*, i.inspection_no, i.inspected_on, i.inspection_type, i.object, pd.code as pic_department_code,
       (f.status = 'open' and f.due_date < current_date) as is_overdue
  from public.inspection_findings f
  join public.inspections i on i.id = f.inspection_id
  join public.departments pd on pd.id = f.pic_department_id;

create view public.incident_register with (security_invoker = true) as
select x.*, d.code as department_code, w.name as work_area_name, rp.full_name as reporter_name, iv.full_name as investigator_name,
       (select count(*) from public.corrective_actions a where a.source_table = 'incidents' and a.source_id = x.id and a.status <> 'cancelled')::int as capa_count
  from public.incidents x
  join public.departments d on d.id = x.department_id
  left join public.work_areas w on w.id = x.work_area_id
  join public.profiles rp on rp.id = x.reporter_id
  left join public.profiles iv on iv.id = x.investigator_id;

-- Act SAP per orang per minggu, dengan target yang berlaku (0 bila cuti)
create view public.sap_weekly with (security_invoker = true) as
with act as (
  select observer_id as user_id, app.sap_week(observed_on) as week_start, 1 as obs, 0 as insp, 0 as haz from public.observations
  union all select inspector_id, app.sap_week(inspected_on), 0, 1, 0 from public.inspections
  union all select reporter_id, app.sap_week(reported_on), 0, 0, 1 from public.hazard_reports where status <> 'cancelled'
), agg as (
  select user_id, week_start, sum(obs)::int as obs_act, sum(insp)::int as insp_act, sum(haz)::int as hazard_act
    from act group by user_id, week_start
), people as (
  select distinct t.user_id, w.week_start from public.sap_targets t
   cross join lateral (select week_start from agg union select app.sap_week(current_date)) w
   where w.week_start >= app.sap_week(t.valid_from)
  union select user_id, week_start from agg
)
select p.user_id, p.week_start, pr.full_name, pr.department_id,
       (l.user_id is not null) as on_leave,
       case when l.user_id is null then coalesce(t.obs_target, 0) else 0 end as obs_target,
       case when l.user_id is null then coalesce(t.insp_target, 0) else 0 end as insp_target,
       case when l.user_id is null then coalesce(t.hazard_target, 0) else 0 end as hazard_target,
       coalesce(a.obs_act, 0) as obs_act, coalesce(a.insp_act, 0) as insp_act, coalesce(a.hazard_act, 0) as hazard_act
  from people p
  join public.profiles pr on pr.id = p.user_id
  left join agg a on a.user_id = p.user_id and a.week_start = p.week_start
  left join public.sap_leave l on l.user_id = p.user_id and l.week_start = p.week_start
  left join lateral (select * from public.sap_targets t where t.user_id = p.user_id and t.valid_from <= p.week_start + 6
                      order by t.valid_from desc limit 1) t on true;

do $$
declare v text;
begin
  foreach v in array array['risk_register_view','she_hazard_register','she_finding_register','incident_register','sap_weekly'] loop
    execute format('grant select on public.%I to authenticated', v);
    execute format('revoke all on public.%I from anon', v);
  end loop;
end $$;

-- ---------------------------------------------------------------- hak eksekusi
revoke all on function app.users_with_permission(text, uuid), app.claim_attachments(uuid[], text, uuid) from public, anon, authenticated;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and p.proname <> 'verify_document' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
