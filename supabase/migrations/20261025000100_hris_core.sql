-- BSB IMS · HRIS 1 · Core HR (mengacu fitur HRIS Talenta, disesuaikan untuk kontraktor hauling):
-- data pribadi terbatas (HR & karyawan ybs), kontrak kerja, riwayat mutasi otomatis, atasan langsung & struktur organisasi,
-- manpower planning (MPP), status kelayakan MCU, kelas SIMPER, ID card & akses area site, checklist mobilisasi/demobilisasi,
-- dan kesiapan tenaga kerja + ketersediaan operator per jenis unit.

insert into public.app_settings(key, value, description) values
  ('site_access_areas', '["OFFICE","MESS","WORKSHOP","PIT","HAULING","PORT","FUEL"]', 'Area site yang bisa diberikan pada ID card'),
  ('contract_warning_days', '30', 'Kontrak dianggap segera habis bila sisa hari ≤ angka ini'),
  ('mob_checklist', '[{"key":"kontrak","label":"Kontrak / PKWT ditandatangani"},{"key":"apd","label":"APD diserahkan"},{"key":"mess","label":"Mess & transport disiapkan"},{"key":"akun","label":"Akun aplikasi & email"},{"key":"briefing","label":"Briefing atasan / pengenalan area kerja"}]',
   'Checklist mobilisasi (selain induksi, MCU fit dan ID card yang dicek otomatis)'),
  ('demob_checklist', '[{"key":"apd","label":"APD & aset dikembalikan"},{"key":"logistik","label":"Clearance logistik / gudang"},{"key":"keuangan","label":"Clearance keuangan (kasbon, pinjaman)"},{"key":"mess","label":"Kamar mess dikosongkan"},{"key":"exit_interview","label":"Exit interview"}]',
   'Checklist demobilisasi (selain ID card dikembalikan yang dicek otomatis)');

-- ---------------------------------------------------------------- karyawan: data organisasi
alter table public.employees
  add column supervisor_id uuid references public.employees(id),
  add column site_id uuid references public.sites(id),
  add column grade text,
  add column roster_pattern text,
  add column point_of_hire text,
  add constraint employees_supervisor_not_self check (supervisor_id is null or supervisor_id <> id);

-- Data pribadi: hanya HRGA (hr.manage) dan karyawan yang bersangkutan.
create table public.employee_private(
  employee_id uuid primary key references public.employees(id) on delete cascade,
  nik text check (nik is null or nik ~ '^[0-9]{16}$'),
  kk_no text,
  birth_place text,
  birth_date date,
  gender text check (gender in ('L','P')),
  religion text,
  marital_status text check (marital_status in ('single','married','divorced','widowed')),
  ptkp_status text check (ptkp_status in ('TK/0','TK/1','TK/2','TK/3','K/0','K/1','K/2','K/3')),
  blood_type text check (blood_type in ('A','B','AB','O','A+','A-','B+','B-','AB+','AB-','O+','O-')),
  address_ktp text,
  address_domicile text,
  phone text,
  personal_email text,
  emergency_name text,
  emergency_relation text,
  emergency_phone text,
  education_level text check (education_level in ('SD','SMP','SMA','D1','D2','D3','D4','S1','S2','S3')),
  education_major text,
  npwp text,
  bpjs_tk_no text,
  bpjs_kes_no text,
  bank_name text,
  bank_account text,
  bank_holder text,
  uniform_size text,
  shoe_size text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.employee_contracts(
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  contract_type text not null check (contract_type in ('probation','pkwt','pkwtt','subcon')),
  contract_no text,
  start_date date not null,
  end_date date,
  note text,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  check (contract_type = 'pkwtt' or end_date is not null)
);
create index on public.employee_contracts(employee_id, start_date desc);

-- Riwayat perubahan organisasi karyawan; diisi otomatis oleh trigger pada employees.
create table public.employee_movements(
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  effective_date date not null,
  kind text not null check (kind in ('join','promotion','demotion','transfer','position_change','status_change','supervisor_change','exit','correction')),
  from_department_id uuid references public.departments(id),
  to_department_id uuid references public.departments(id),
  from_section_id uuid references public.sections(id),
  to_section_id uuid references public.sections(id),
  from_position_id uuid references public.positions(id),
  to_position_id uuid references public.positions(id),
  from_type text,
  to_type text,
  from_supervisor_id uuid references public.employees(id),
  to_supervisor_id uuid references public.employees(id),
  reason text,
  reference_no text,
  recorded_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.employee_movements(employee_id, effective_date desc);

create table public.manpower_plans(
  id uuid primary key default gen_random_uuid(),
  year int not null check (year between 2020 and 2100),
  position_id uuid not null references public.positions(id),
  planned int not null check (planned >= 0),
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (year, position_id)
);

-- MCU: hasil kelayakan kerja; SIMPER: kelas lisensi
alter table public.employee_competencies
  add column fitness text check (fitness in ('fit','fit_restriction','temporary_unfit','unfit')),
  add column fitness_note text,
  add column license_class text;

create table public.id_cards(
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  card_no text not null unique check (card_no ~ '^[A-Z0-9][A-Z0-9./-]*$'),
  access_areas text[] not null default '{}',
  issued_on date not null,
  valid_until date,
  status text not null default 'active' check (status in ('active','suspended','returned','lost')),
  status_note text,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (valid_until is null or valid_until >= issued_on)
);
create unique index id_cards_one_active on public.id_cards(employee_id) where status = 'active';

create table public.mobilizations(
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  kind text not null check (kind in ('mob','demob')),
  planned_date date not null,
  status text not null default 'open' check (status in ('open','done','cancelled')),
  items jsonb not null default '[]',
  note text,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  completed_at timestamptz,
  completed_by uuid references public.profiles(id)
);
create unique index mobilizations_one_open on public.mobilizations(employee_id, kind) where status = 'open';

do $$
declare t text;
begin
  foreach t in array array['employee_private','manpower_plans','id_cards','mobilizations'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['employee_private','employee_contracts','employee_movements','manpower_plans','id_cards','mobilizations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------- akses
create or replace function app.is_hr() returns boolean language sql stable security definer set search_path = public as $$
  select app.has_permission('hr.manage', app.hrga_dept())
$$;

create or replace function app.my_employee() returns uuid language sql stable security definer set search_path = public as $$
  select id from public.employees where profile_id = auth.uid()
$$;

-- HR, karyawan sendiri, atau atasan departemennya (hr.roster) / atasan langsungnya
create or replace function app.can_view_employee(p_employee uuid) returns boolean language sql stable security definer set search_path = public as $$
  select app.is_active_user() and (
    app.is_hr()
    or exists(select 1 from public.employees e where e.id = p_employee and (e.profile_id = auth.uid()
              or app.has_permission('hr.roster', e.department_id)
              or e.supervisor_id = app.my_employee())))
$$;

create policy employee_private_read on public.employee_private for select to authenticated
  using (app.is_active_user() and (app.is_hr() or employee_id = app.my_employee()));
create policy employee_contracts_read on public.employee_contracts for select to authenticated
  using (app.is_active_user() and (app.is_hr() or employee_id = app.my_employee()));
create policy employee_movements_read on public.employee_movements for select to authenticated using (app.can_view_employee(employee_id));
create policy mobilizations_read on public.mobilizations for select to authenticated using (app.can_view_employee(employee_id));
create policy manpower_plans_read on public.manpower_plans for select to authenticated using (app.is_active_user());
create policy id_cards_read on public.id_cards for select to authenticated using (app.is_active_user());

-- ---------------------------------------------------------------- riwayat mutasi otomatis
create or replace function app.employee_movement_log() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_kind text := nullif(current_setting('app.move_kind', true), '');
  v_date date := coalesce(nullif(current_setting('app.move_date', true), '')::date, app.site_today());
begin
  if tg_op = 'INSERT' then
    insert into public.employee_movements(employee_id, effective_date, kind, to_department_id, to_section_id, to_position_id, to_type, to_supervisor_id, reason)
    values (new.id, coalesce(new.join_date, app.site_today()), 'join', new.department_id, new.section_id, new.position_id, new.employment_type,
            new.supervisor_id, 'Data karyawan dibuat');
    return new;
  end if;
  if (new.department_id, new.section_id, new.position_id, new.employment_type, new.supervisor_id, new.status)
     is not distinct from (old.department_id, old.section_id, old.position_id, old.employment_type, old.supervisor_id, old.status) then
    return new;
  end if;
  v_kind := coalesce(v_kind,
    case when new.status <> old.status and new.status = 'exited' then 'exit'
         when new.department_id <> old.department_id then 'transfer'
         when new.position_id is distinct from old.position_id then 'position_change'
         when new.employment_type <> old.employment_type then 'status_change'
         when new.supervisor_id is distinct from old.supervisor_id then 'supervisor_change'
         else 'correction' end);
  insert into public.employee_movements(employee_id, effective_date, kind, from_department_id, to_department_id, from_section_id, to_section_id,
    from_position_id, to_position_id, from_type, to_type, from_supervisor_id, to_supervisor_id, reason, reference_no)
  values (new.id, case when v_kind = 'exit' then coalesce(new.exit_date, v_date) else v_date end, v_kind,
          old.department_id, new.department_id, old.section_id, new.section_id, old.position_id, new.position_id,
          old.employment_type, new.employment_type, old.supervisor_id, new.supervisor_id,
          coalesce(nullif(current_setting('app.move_reason', true), ''), case when v_kind = 'exit' then new.exit_reason end),
          nullif(current_setting('app.move_ref', true), ''));
  -- Karyawan keluar: ID card aktif ditangguhkan sampai dikembalikan
  if v_kind = 'exit' then
    update public.id_cards set status = 'suspended', status_note = 'Karyawan keluar; kartu belum dikembalikan'
     where employee_id = new.id and status = 'active';
  end if;
  return new;
end $$;
create trigger employees_movement after insert or update on public.employees for each row execute function app.employee_movement_log();

-- Riwayat awal untuk karyawan yang sudah ada
insert into public.employee_movements(employee_id, effective_date, kind, to_department_id, to_section_id, to_position_id, to_type, reason, recorded_by)
select id, coalesce(join_date, created_at::date), 'join', department_id, section_id, position_id, employment_type, 'Data awal', null
  from public.employees;

-- ---------------------------------------------------------------- RPC Core HR
-- Mutasi / promosi / perubahan status kerja dengan tanggal efektif dan dasar (SK)
create or replace function public.employee_move(p_employee uuid, p_effective date, p_kind text, p_department uuid, p_section uuid,
  p_position uuid, p_employment_type text, p_reason text, p_reference text default null)
returns public.employees language plpgsql security definer set search_path = public as $$
declare v public.employees;
begin
  perform app.require_hr('hr.manage');
  if p_kind not in ('promotion','demotion','transfer','position_change','status_change','correction') then
    raise exception 'Jenis perubahan tidak dikenal' using errcode = '22023';
  end if;
  if p_effective is null or p_effective > app.site_today() + 31 then raise exception 'Tanggal efektif tidak valid' using errcode = '22023'; end if;
  if p_position is not null and not exists(select 1 from public.positions where id = p_position and (department_id is null or department_id = p_department)) then
    raise exception 'Jabatan tidak sesuai departemen' using errcode = '22023';
  end if;
  if p_section is not null and not exists(select 1 from public.sections where id = p_section and department_id = p_department) then
    raise exception 'Seksi tidak sesuai departemen' using errcode = '22023';
  end if;
  perform set_config('app.move_kind', p_kind, true);
  perform set_config('app.move_date', p_effective::text, true);
  perform set_config('app.move_reason', app.require_text(p_reason, 'Alasan / keterangan'), true);
  perform set_config('app.move_ref', coalesce(p_reference, ''), true);
  update public.employees set department_id = p_department, section_id = p_section, position_id = p_position,
    employment_type = coalesce(p_employment_type, employment_type)
   where id = p_employee and status = 'active' returning * into v;
  if not found then raise exception 'Karyawan tidak ditemukan / sudah keluar' using errcode = 'P0002'; end if;
  perform set_config('app.move_kind', '', true);
  perform set_config('app.move_date', '', true);
  perform set_config('app.move_reason', '', true);
  perform set_config('app.move_ref', '', true);
  return v;
end $$;

-- Data organisasi tambahan: atasan langsung, site, golongan, pola roster, POH
create or replace function public.employee_org_save(p_employee uuid, p_supervisor uuid, p_site uuid, p_grade text, p_roster_pattern text,
  p_point_of_hire text)
returns public.employees language plpgsql security definer set search_path = public as $$
declare v public.employees;
begin
  perform app.require_hr('hr.manage');
  if p_supervisor is not null and exists(
    with recursive up as (select id, supervisor_id from public.employees where id = p_supervisor
                          union select e.id, e.supervisor_id from public.employees e join up on e.id = up.supervisor_id)
    select 1 from up where id = p_employee) then
    raise exception 'Atasan membentuk lingkaran (atasan tidak boleh bawahan sendiri)' using errcode = '22023';
  end if;
  if p_supervisor is not null and not exists(select 1 from public.employees where id = p_supervisor and status = 'active') then
    raise exception 'Atasan harus karyawan aktif' using errcode = '22023';
  end if;
  update public.employees set supervisor_id = p_supervisor, site_id = p_site, grade = nullif(btrim(coalesce(p_grade, '')), ''),
    roster_pattern = nullif(btrim(coalesce(p_roster_pattern, '')), ''), point_of_hire = nullif(btrim(coalesce(p_point_of_hire, '')), '')
   where id = p_employee returning * into v;
  if not found then raise exception 'Karyawan tidak ditemukan' using errcode = 'P0002'; end if;
  return v;
end $$;

-- Data pribadi oleh HR (semua kolom; kunci yang tidak dikirim tidak diubah)
create or replace function public.employee_private_save(p_employee uuid, p_data jsonb)
returns public.employee_private language plpgsql security definer set search_path = public as $$
declare
  v public.employee_private;
  k text;
  allowed text[] := array['nik','kk_no','birth_place','birth_date','gender','religion','marital_status','ptkp_status','blood_type','address_ktp',
    'address_domicile','phone','personal_email','emergency_name','emergency_relation','emergency_phone','education_level','education_major',
    'npwp','bpjs_tk_no','bpjs_kes_no','bank_name','bank_account','bank_holder','uniform_size','shoe_size'];
begin
  perform app.require_hr('hr.manage');
  if not exists(select 1 from public.employees where id = p_employee) then raise exception 'Karyawan tidak ditemukan' using errcode = 'P0002'; end if;
  insert into public.employee_private(employee_id) values (p_employee) on conflict do nothing;
  for k in select jsonb_object_keys(coalesce(p_data, '{}')) loop
    if not k = any(allowed) then raise exception 'Kolom % tidak dikenal', k using errcode = '22023'; end if;
    execute format('update public.employee_private set %I = $1::%s where employee_id = $2', k,
      case k when 'birth_date' then 'date' else 'text' end)
      using nullif(btrim(p_data->>k), ''), p_employee;
  end loop;
  select * into v from public.employee_private where employee_id = p_employee;
  return v;
end $$;

-- Karyawan memperbarui sendiri data kontak & ukuran APD (data identitas, pajak dan rekening tetap lewat HR)
create or replace function public.my_private_update(p_data jsonb)
returns public.employee_private language plpgsql security definer set search_path = public as $$
declare
  v public.employee_private;
  v_emp uuid := app.my_employee();
  k text;
  allowed text[] := array['address_domicile','phone','personal_email','emergency_name','emergency_relation','emergency_phone','uniform_size','shoe_size'];
begin
  if v_emp is null or not app.is_active_user() then raise exception 'Akun Anda belum ditautkan ke data karyawan' using errcode = '42501'; end if;
  insert into public.employee_private(employee_id) values (v_emp) on conflict do nothing;
  for k in select jsonb_object_keys(coalesce(p_data, '{}')) loop
    if not k = any(allowed) then raise exception 'Kolom % hanya bisa diubah oleh HRGA', k using errcode = '42501'; end if;
    execute format('update public.employee_private set %I = $1 where employee_id = $2', k) using nullif(btrim(p_data->>k), ''), v_emp;
  end loop;
  select * into v from public.employee_private where employee_id = v_emp;
  return v;
end $$;

create or replace function public.contract_add(p_employee uuid, p_type text, p_no text, p_start date, p_end date, p_note text default null)
returns public.employee_contracts language plpgsql security definer set search_path = public as $$
declare v public.employee_contracts;
begin
  perform app.require_hr('hr.manage');
  if not exists(select 1 from public.employees where id = p_employee and status = 'active') then
    raise exception 'Karyawan tidak aktif' using errcode = '22023';
  end if;
  if exists(select 1 from public.employee_contracts where employee_id = p_employee and start_date = p_start) then
    raise exception 'Kontrak dengan tanggal mulai yang sama sudah ada' using errcode = '23505';
  end if;
  insert into public.employee_contracts(employee_id, contract_type, contract_no, start_date, end_date, note)
  values (p_employee, p_type, nullif(btrim(coalesce(p_no, '')), ''), p_start, case when p_type = 'pkwtt' then null else p_end end, p_note)
  returning * into v;
  -- Status kerja karyawan mengikuti kontrak terbaru
  perform set_config('app.move_kind', 'status_change', true);
  perform set_config('app.move_date', p_start::text, true);
  perform set_config('app.move_reason', 'Kontrak ' || upper(p_type) || coalesce(' ' || v.contract_no, ''), true);
  update public.employees set employment_type = case p_type when 'pkwtt' then 'permanent' when 'subcon' then 'subcon' else 'contract' end
   where id = p_employee and employment_type <> case p_type when 'pkwtt' then 'permanent' when 'subcon' then 'subcon' else 'contract' end;
  perform set_config('app.move_kind', '', true);
  perform set_config('app.move_date', '', true);
  perform set_config('app.move_reason', '', true);
  perform set_config('app.move_ref', '', true);
  return v;
end $$;

create or replace function public.mpp_set(p_year int, p_position uuid, p_planned int, p_note text default null)
returns public.manpower_plans language plpgsql security definer set search_path = public as $$
declare v public.manpower_plans;
begin
  perform app.require_hr('hr.manage');
  insert into public.manpower_plans(year, position_id, planned, note) values (p_year, p_position, p_planned, p_note)
  on conflict (year, position_id) do update set planned = excluded.planned, note = excluded.note
  returning * into v;
  return v;
end $$;

-- Kelayakan MCU & kelas SIMPER pada sertifikat yang sudah tercatat
create or replace function public.employee_competency_detail(p_id uuid, p_fitness text, p_fitness_note text, p_license_class text)
returns public.employee_competencies language plpgsql security definer set search_path = public as $$
declare
  v public.employee_competencies;
  c text;
begin
  perform app.require_hr('hr.manage');
  select * into v from public.employee_competencies where id = p_id;
  if not found then raise exception 'Data tidak ditemukan' using errcode = 'P0002'; end if;
  select category into c from public.competencies where id = v.competency_id;
  if p_fitness is not null and c <> 'medical' then raise exception 'Status kelayakan hanya untuk MCU' using errcode = '22023'; end if;
  if p_fitness in ('fit_restriction','temporary_unfit','unfit') and coalesce(btrim(p_fitness_note), '') = '' then
    raise exception 'Isi catatan / batasan dari dokter' using errcode = '22023';
  end if;
  update public.employee_competencies set fitness = coalesce(p_fitness, fitness), fitness_note = coalesce(p_fitness_note, fitness_note),
    license_class = coalesce(nullif(btrim(coalesce(p_license_class, '')), ''), license_class)
   where id = p_id returning * into v;
  return v;
end $$;

-- MCU tidak layak (unfit / unfit sementara) tidak dihitung berlaku
create or replace function app.competency_valid(p_employee uuid, p_competency uuid, p_on date default null) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.employee_competencies
                 where employee_id = p_employee and competency_id = p_competency and status = 'valid'
                   and coalesce(fitness, 'fit') not in ('unfit','temporary_unfit')
                   and issued_on <= coalesce(p_on, app.site_today()) and (valid_until is null or valid_until >= coalesce(p_on, app.site_today())))
$$;

-- ID card: hanya bila induksi & MCU (fit) berlaku; satu kartu aktif per karyawan
create or replace function public.id_card_issue(p_employee uuid, p_card_no text, p_areas text[], p_valid_until date default null)
returns public.id_cards language plpgsql security definer set search_path = public as $$
declare
  v public.id_cards;
  bad text;
begin
  perform app.require_hr('hr.manage');
  if not exists(select 1 from public.employees where id = p_employee and status = 'active') then
    raise exception 'Karyawan tidak aktif' using errcode = '22023';
  end if;
  if not (app.category_valid(p_employee, 'induction') and app.category_valid(p_employee, 'medical')) then
    raise exception 'ID card mensyaratkan induksi dan MCU (fit) yang masih berlaku' using errcode = '22023';
  end if;
  select a into bad from unnest(coalesce(p_areas, '{}')) a
   where a not in (select jsonb_array_elements_text(value) from public.app_settings where key = 'site_access_areas') limit 1;
  if bad is not null then raise exception 'Area % tidak dikenal', bad using errcode = '22023'; end if;
  if exists(select 1 from public.id_cards where employee_id = p_employee and status = 'active') then
    raise exception 'Karyawan masih punya ID card aktif; kembalikan / nyatakan hilang dulu' using errcode = '22023';
  end if;
  insert into public.id_cards(employee_id, card_no, access_areas, issued_on, valid_until)
  values (p_employee, upper(app.require_text(p_card_no, 'Nomor kartu')), coalesce(p_areas, '{}'), app.site_today(), p_valid_until)
  returning * into v;
  return v;
end $$;

create or replace function public.id_card_status(p_id uuid, p_status text, p_note text)
returns public.id_cards language plpgsql security definer set search_path = public as $$
declare v public.id_cards;
begin
  perform app.require_hr('hr.manage');
  if p_status not in ('active','suspended','returned','lost') then raise exception 'Status tidak dikenal' using errcode = '22023'; end if;
  select * into v from public.id_cards where id = p_id for update;
  if not found then raise exception 'Kartu tidak ditemukan' using errcode = 'P0002'; end if;
  if v.status in ('returned','lost') then raise exception 'Kartu sudah ditutup' using errcode = '22023'; end if;
  if p_status = 'active' and not exists(select 1 from public.employees where id = v.employee_id and status = 'active') then
    raise exception 'Karyawan sudah keluar' using errcode = '22023';
  end if;
  update public.id_cards set status = p_status, status_note = app.require_text(p_note, 'Keterangan') where id = p_id returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------- mobilisasi / demobilisasi
create or replace function app.mob_auto(p_employee uuid, p_kind text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case p_kind
    when 'mob' then jsonb_build_object(
      'induksi', app.category_valid(p_employee, 'induction'),
      'mcu', app.category_valid(p_employee, 'medical'),
      'id_card', exists(select 1 from public.id_cards where employee_id = p_employee and status = 'active'))
    else jsonb_build_object(
      'id_card', not exists(select 1 from public.id_cards where employee_id = p_employee and status in ('active','suspended')))
  end
$$;

create or replace function public.mobilization_create(p_employee uuid, p_kind text, p_date date, p_note text default null)
returns public.mobilizations language plpgsql security definer set search_path = public as $$
declare v public.mobilizations;
begin
  perform app.require_hr('hr.manage');
  if p_kind not in ('mob','demob') then raise exception 'Jenis tidak dikenal' using errcode = '22023'; end if;
  if not exists(select 1 from public.employees where id = p_employee and status = 'active') then
    raise exception 'Karyawan tidak aktif' using errcode = '22023';
  end if;
  if exists(select 1 from public.mobilizations where employee_id = p_employee and kind = p_kind and status = 'open') then
    raise exception 'Masih ada % yang terbuka untuk karyawan ini', case p_kind when 'mob' then 'mobilisasi' else 'demobilisasi' end using errcode = '22023';
  end if;
  insert into public.mobilizations(employee_id, kind, planned_date, note, items)
  select p_employee, p_kind, p_date, p_note, coalesce(jsonb_agg(i || '{"done":false}'), '[]')
    from public.app_settings s, jsonb_array_elements(s.value) i where s.key = p_kind || '_checklist'
  returning * into v;
  return v;
end $$;

create or replace function public.mobilization_check(p_id uuid, p_key text, p_done boolean)
returns public.mobilizations language plpgsql security definer set search_path = public as $$
declare v public.mobilizations;
begin
  perform app.require_hr('hr.manage');
  update public.mobilizations m set items = (
      select jsonb_agg(case when i->>'key' = p_key then i || jsonb_build_object('done', p_done, 'by', auth.uid(), 'at', now()) else i end order by n)
        from jsonb_array_elements(m.items) with ordinality x(i, n))
   where id = p_id and status = 'open' and items @> jsonb_build_array(jsonb_build_object('key', p_key))
  returning * into v;
  if not found then raise exception 'Checklist tidak ditemukan / sudah ditutup' using errcode = '22023'; end if;
  return v;
end $$;

create or replace function public.mobilization_complete(p_id uuid)
returns public.mobilizations language plpgsql security definer set search_path = public as $$
declare
  v public.mobilizations;
  pending text;
begin
  perform app.require_hr('hr.manage');
  select * into v from public.mobilizations where id = p_id and status = 'open' for update;
  if not found then raise exception 'Checklist tidak ditemukan / sudah ditutup' using errcode = '22023'; end if;
  select string_agg(i->>'label', ', ') into pending from jsonb_array_elements(v.items) i where not (i->>'done')::boolean;
  select concat_ws(', ', pending, string_agg(case k when 'induksi' then 'induksi' when 'mcu' then 'MCU fit' else 'ID card' end, ', ')) into pending
    from jsonb_each_text(app.mob_auto(v.employee_id, v.kind)) x(k, ok) where not ok::boolean;
  if coalesce(pending, '') <> '' then raise exception 'Belum lengkap: %', pending using errcode = '22023'; end if;
  update public.mobilizations set status = 'done', completed_at = now(), completed_by = auth.uid() where id = p_id returning * into v;
  return v;
end $$;

create or replace function public.mobilization_cancel(p_id uuid, p_reason text)
returns public.mobilizations language plpgsql security definer set search_path = public as $$
declare v public.mobilizations;
begin
  perform app.require_hr('hr.manage');
  update public.mobilizations set status = 'cancelled', note = concat_ws(' · ', note, 'Batal: ' || app.require_text(p_reason, 'Alasan'))
   where id = p_id and status = 'open' returning * into v;
  if not found then raise exception 'Checklist tidak ditemukan / sudah ditutup' using errcode = '22023'; end if;
  return v;
end $$;

-- ---------------------------------------------------------------- tampilan
-- Status sertifikat: MCU unfit dihitung tidak berlaku (kolom baru ditambahkan di akhir)
create or replace view public.employee_competency_view with (security_invoker = true) as
select ec.id, ec.employee_id, e.nrp, e.full_name, e.department_id, d.code as department_code, ec.competency_id, c.code as competency_code,
       c.name as competency_name, c.category, c.unit_type, ec.cert_no, ec.issuer, ec.issued_on, ec.valid_until, ec.status, ec.revoke_reason,
       ec.training_id,
       case when ec.status = 'revoked' then 'revoked'
            when ec.valid_until is not null and ec.valid_until < app.site_today() then 'expired'
            when coalesce(ec.fitness, 'fit') in ('unfit','temporary_unfit') then 'unfit'
            when ec.valid_until is not null and ec.valid_until - app.site_today()
                 <= coalesce((select value::text::int from public.app_settings where key = 'competency_warning_days'), 30) then 'expiring'
            else 'valid' end as validity,
       ec.valid_until - app.site_today() as days_left,
       ec.fitness, ec.fitness_note, ec.license_class
  from public.employee_competencies ec
  join public.employees e on e.id = ec.employee_id
  join public.departments d on d.id = e.department_id
  join public.competencies c on c.id = ec.competency_id;

create view public.contract_register with (security_invoker = true) as
select distinct on (c.employee_id) c.id, c.employee_id, e.nrp, e.full_name, d.code as department_code, c.contract_type, c.contract_no,
       c.start_date, c.end_date, c.end_date - app.site_today() as days_left,
       case when c.end_date is null then 'permanent'
            when c.end_date < app.site_today() then 'expired'
            when c.end_date - app.site_today() <= coalesce((select value::text::int from public.app_settings where key = 'contract_warning_days'), 30) then 'expiring'
            else 'active' end as contract_status
  from public.employee_contracts c
  join public.employees e on e.id = c.employee_id and e.status = 'active'
  join public.departments d on d.id = e.department_id
 order by c.employee_id, c.start_date desc;

create view public.movement_register with (security_invoker = true) as
select m.id, m.employee_id, e.nrp, e.full_name, m.effective_date, m.kind,
       fd.code as from_department, td.code as to_department, fp.name as from_position, tp.name as to_position,
       m.from_type, m.to_type, fs.full_name as from_supervisor, ts.full_name as to_supervisor, m.reason, m.reference_no, pr.full_name as recorded_by_name
  from public.employee_movements m
  join public.employees e on e.id = m.employee_id
  left join public.departments fd on fd.id = m.from_department_id
  left join public.departments td on td.id = m.to_department_id
  left join public.positions fp on fp.id = m.from_position_id
  left join public.positions tp on tp.id = m.to_position_id
  left join public.employees fs on fs.id = m.from_supervisor_id
  left join public.employees ts on ts.id = m.to_supervisor_id
  left join public.profiles pr on pr.id = m.recorded_by;

-- MPP vs aktual per jabatan (aktual = karyawan aktif saat ini)
create view public.manpower_gap with (security_invoker = true) as
with yrs as (select distinct year from public.manpower_plans union select extract(year from app.site_today())::int),
act as (select position_id, count(*)::int as actual from public.employees where status = 'active' and position_id is not null group by position_id)
select y.year, p.id as position_id, p.code as position_code, p.name as position_name, p.level, d.code as department_code,
       coalesce(mp.planned, 0) as planned, coalesce(a.actual, 0) as actual, coalesce(a.actual, 0) - coalesce(mp.planned, 0) as gap, mp.note
  from yrs y cross join public.positions p
  left join public.departments d on d.id = p.department_id
  left join public.manpower_plans mp on mp.year = y.year and mp.position_id = p.id
  left join act a on a.position_id = p.id
 where mp.id is not null or (a.actual is not null and y.year = extract(year from app.site_today())::int);

create view public.id_card_register with (security_invoker = true) as
select c.id, c.employee_id, e.nrp, e.full_name, d.code as department_code, e.employment_type, e.company, c.card_no, c.access_areas,
       c.issued_on, c.valid_until, case when c.status = 'active' and c.valid_until < app.site_today() then 'expired' else c.status end as status,
       c.status_note
  from public.id_cards c
  join public.employees e on e.id = c.employee_id
  join public.departments d on d.id = e.department_id;

create view public.mobilization_register with (security_invoker = true) as
select m.id, m.employee_id, e.nrp, e.full_name, d.code as department_code, m.kind, m.planned_date, m.status, m.items,
       app.mob_auto(m.employee_id, m.kind) as auto, m.note, m.created_at, m.completed_at,
       (select count(*) from jsonb_array_elements(m.items) i where (i->>'done')::boolean)::int as done_items,
       jsonb_array_length(m.items) as total_items
  from public.mobilizations m
  join public.employees e on e.id = m.employee_id
  join public.departments d on d.id = e.department_id;

-- Kesiapan tenaga kerja: induksi, MCU fit, kompetensi wajib, ID card aktif, roster hari ini, SIMPER yang dimiliki
create view public.workforce_readiness with (security_invoker = true) as
select e.id as employee_id, e.nrp, e.full_name, d.code as department_code, p.name as position_name, p.level, e.employment_type, e.company,
       app.category_valid(e.id, 'induction') as induction_ok,
       app.category_valid(e.id, 'medical') as medical_ok,
       (select ec.fitness from public.employee_competencies ec join public.competencies c on c.id = ec.competency_id
         where ec.employee_id = e.id and c.category = 'medical' and ec.status = 'valid' order by ec.issued_on desc limit 1) as fitness,
       r.required, r.compliant, r.compliance_pct,
       exists(select 1 from public.id_cards c where c.employee_id = e.id and c.status = 'active' and (c.valid_until is null or c.valid_until >= app.site_today())) as id_card_ok,
       (select re.code from public.roster_entries re where re.employee_id = e.id and re.work_date = app.site_today()) as roster_today,
       coalesce((select array_agg(distinct a.unit_type order by a.unit_type) from public.authorization_register a where a.employee_id = e.id), '{}') as unit_types,
       app.category_valid(e.id, 'induction') and app.category_valid(e.id, 'medical')
         and exists(select 1 from public.id_cards c where c.employee_id = e.id and c.status = 'active' and (c.valid_until is null or c.valid_until >= app.site_today()))
         and coalesce(r.compliance_pct, 100) >= 100 as ready
  from public.employees e
  join public.departments d on d.id = e.department_id
  left join public.positions p on p.id = e.position_id
  left join public.employee_register r on r.id = e.id
 where e.status = 'active';

-- Ketersediaan operator per jenis unit hari ini dibanding unit siap operasi
create view public.operator_availability with (security_invoker = true) as
with ops as (select unnest(w.unit_types) as unit_type, w.ready, w.roster_today from public.workforce_readiness w),
units as (select unit_type, count(*) filter (where status = 'ready')::int as units_ready, count(*) filter (where status <> 'retired')::int as units_total
            from public.units group by unit_type)
select coalesce(o.unit_type, u.unit_type) as unit_type, coalesce(u.units_total, 0) as units_total, coalesce(u.units_ready, 0) as units_ready,
       coalesce(o.authorized, 0) as authorized, coalesce(o.ready, 0) as operators_ready,
       coalesce(o.on_shift, 0) as on_shift_today
  from (select unit_type, count(*)::int authorized, count(*) filter (where ready)::int ready,
               count(*) filter (where ready and roster_today in ('D','N'))::int on_shift
          from ops group by unit_type) o
  full join units u on u.unit_type = o.unit_type;

do $$
declare v text;
begin
  foreach v in array array['employee_competency_view','contract_register','movement_register','manpower_gap','id_card_register','mobilization_register',
                           'workforce_readiness','operator_availability'] loop
    execute format('grant select on public.%I to authenticated', v);
    execute format('revoke all on public.%I from anon', v);
  end loop;
end $$;


-- ---------------------------------------------------------------- impor satu tombol: jenis data HRIS
create or replace function app.raise_text(p_msg text) returns text language plpgsql as $$
begin
  raise exception '%', p_msg using errcode = 'P0001';
end $$;

-- import_rows memanggil app.import_row_ext untuk jenis data tambahan (tahap HRIS berikutnya cukup mengganti fungsi ini).
create or replace function app.import_row_ext(p_dataset text, r jsonb) returns boolean
language plpgsql set search_path = public as $$
declare
  v_id uuid;
  t text;
begin
  if p_dataset in ('data_pribadi', 'kontrak', 'idcard', 'organisasi') then
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
      'address_ktp', nullif(r->>'alamat', ''), 'phone', nullif(r->>'no_hp', ''), 'education_level', nullif(upper(coalesce(r->>'pendidikan', '')), ''),
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
  else
    return false;
  end case;
  return true;
end $$;
revoke all on function app.import_row_ext(text, jsonb) from public, anon;
grant execute on function app.import_row_ext(text, jsonb) to authenticated;

create or replace function public.import_rows(p_dataset text, p_rows jsonb, p_commit boolean default false) returns jsonb
language plpgsql set search_path = public as $$
declare
  r jsonb;
  i int := 0;
  ok int := 0;
  errs jsonb := '[]';
  v_dept uuid;
  v_id uuid;
  t text;
  d date;
begin
  if not app.is_active_user() then raise exception 'Akun tidak aktif' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Data tidak valid' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'Maksimal 2000 baris sekali impor' using errcode = '22023'; end if;
  begin
    for r in select * from jsonb_array_elements(p_rows) loop
      i := i + 1;
      begin
        case p_dataset
        when 'karyawan' then
          v_dept := app.dept_by_code(upper(r->>'departemen'));
          if v_dept is null then raise exception 'Departemen "%" tidak dikenal', r->>'departemen'; end if;
          v_id := null;
          if coalesce(r->>'jabatan', '') <> '' then
            select id into v_id from public.positions where (department_id = v_dept or department_id is null)
              and (upper(code) = upper(btrim(r->>'jabatan')) or lower(name) = lower(btrim(r->>'jabatan'))) limit 1;
            if v_id is null then raise exception 'Jabatan "%" tidak ada di departemen %', r->>'jabatan', upper(r->>'departemen'); end if;
          end if;
          t := lower(coalesce(r->>'status_kerja', ''));
          perform public.employee_save(r->>'nrp', r->>'nama', v_dept, v_id,
            case when t in ('', 'tetap', 'permanent', 'pkwtt') then 'permanent' when t in ('kontrak', 'contract', 'pkwt') then 'contract'
                 when t in ('subkon', 'subcon', 'subkontraktor') then 'subcon' else t end,
            nullif(r->>'perusahaan', ''), (nullif(r->>'tgl_masuk', ''))::date, nullif(r->>'email', ''),
            (select id from public.sections where department_id = v_dept and code = upper(nullif(r->>'seksi', ''))));
        when 'barang' then
          t := lower(coalesce(r->>'kategori', ''));
          perform public.material_save(r->>'kode', r->>'nama',
            case t when 'suku cadang' then 'spare_part' when 'sparepart' then 'spare_part' when 'ban' then 'tire' when 'bbm' then 'fuel'
                   when 'pelumas' then 'lubricant' when 'oli' then 'lubricant' when 'habis pakai' then 'consumable' when 'apd' then 'ppe'
                   when 'lainnya' then 'other' when '' then 'other' else t end,
            coalesce(nullif(r->>'satuan', ''), 'pcs'), coalesce((nullif(r->>'stok_min', ''))::numeric, 0));
        when 'supplier' then
          perform public.supplier_save(r->>'kode', r->>'nama', nullif(r->>'kategori', ''), nullif(r->>'kontak', ''), nullif(r->>'telepon', ''));
        when 'unit' then
          v_dept := app.dept_by_code(upper(coalesce(nullif(r->>'departemen', ''), 'PRD')));
          if v_dept is null then raise exception 'Departemen "%" tidak dikenal', r->>'departemen'; end if;
          t := lower(coalesce(r->>'kepemilikan', ''));
          perform public.unit_save(r->>'no_unit', upper(coalesce(nullif(r->>'jenis', ''), 'OTHER')), v_dept,
            case when t in ('', 'milik', 'owned', 'sendiri') then 'owned' when t in ('sewa', 'rental') then 'rental' else t end,
            nullif(r->>'vendor', ''), nullif(r->>'merek', ''), nullif(r->>'model', ''), nullif(r->>'serial', ''),
            (nullif(r->>'tahun', ''))::int, (nullif(r->>'hm', ''))::numeric);
        when 'sertifikat' then
          select id into v_id from public.employees where nrp = upper(btrim(r->>'nrp'));
          if v_id is null then raise exception 'NRP "%" tidak ditemukan', r->>'nrp'; end if;
          perform public.employee_competency_add(v_id,
            (select id from public.competencies where upper(code) = upper(btrim(r->>'kompetensi')) or lower(name) = lower(btrim(r->>'kompetensi')) limit 1),
            coalesce((nullif(r->>'tgl_terbit', ''))::date, current_date), (nullif(r->>'berlaku_sampai', ''))::date,
            nullif(r->>'no_sertifikat', ''), nullif(r->>'penerbit', ''));
        when 'spip' then
          t := lower(coalesce(r->>'jenis_objek', ''));
          select id into v_id from public.commissioning_records where ref_code = upper(btrim(r->>'kode'))
            and coalesce(reg_no, '') = coalesce(nullif(btrim(r->>'no_reg'), ''), '');
          perform public.commissioning_save(v_id,
            case when t in ('', 'unit') then 'unit' when t in ('alat', 'tool', 'tools') then 'tool' when t in ('instalasi', 'installation') then 'installation' else t end,
            r->>'kode', r->>'nama', nullif(r->>'kategori', ''), nullif(r->>'no_reg', ''), (nullif(r->>'tgl_komisioning', ''))::date,
            (nullif(r->>'berlaku_sampai', ''))::date, nullif(r->>'penerbit', ''), nullif(r->>'catatan', ''));
        when 'opname' then
          select id into v_id from public.materials where code = upper(btrim(r->>'kode'));
          if v_id is null then raise exception 'Kode barang "%" tidak ditemukan', r->>'kode'; end if;
          perform public.stock_opname(v_id, (r->>'stok_fisik')::numeric, coalesce(nullif(r->>'keterangan', ''), 'Impor stok opname'));
        else
          if not app.import_row_ext(p_dataset, r) then
            raise exception 'Jenis data "%" tidak dikenal', p_dataset using errcode = '22023';
          end if;
        end case;
        ok := ok + 1;
      exception
        when sqlstate '22023' then
          if sqlerrm like 'Jenis data%' then raise; end if;
          errs := errs || jsonb_build_object('row', i, 'error', sqlerrm);
        when others then
          errs := errs || jsonb_build_object('row', i, 'error', sqlerrm);
      end;
    end loop;
    if not p_commit then raise exception 'periksa-saja' using errcode = 'P0099'; end if;
  exception when sqlstate 'P0099' then
    null; -- mode periksa: semua perubahan dibatalkan, hasil validasi tetap dikembalikan
  end;
  return jsonb_build_object('ok', ok, 'errors', errs, 'committed', p_commit);
end $$;

revoke all on function app.is_hr(), app.my_employee(), app.can_view_employee(uuid), app.employee_movement_log(), app.mob_auto(uuid, text)
  from public, anon;
grant execute on function app.is_hr(), app.my_employee(), app.can_view_employee(uuid), app.mob_auto(uuid, text) to authenticated;
-- dipakai tampilan kesiapan (security invoker)
grant execute on function app.category_valid(uuid, text), app.competency_valid(uuid, uuid, date) to authenticated;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and p.proname not in ('verify_document', 'feed_rows') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
