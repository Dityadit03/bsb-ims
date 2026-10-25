-- BSB IMS · HRIS 2 · Time management: absensi aplikasi (lokasi + selfie) dan mesin fingerprint (impor), shift & hari libur,
-- rekap harian (terlambat, alpa, pulang cepat), cuti dengan saldo & persetujuan 2 tingkat (atasan → HRGA) yang otomatis
-- mengisi roster, dan lembur (SPL) dengan batas PP 35/2021 serta jam aktual dari absensi.

insert into public.numbering_schemes(code, name, pattern, module) values
  ('CUTI','Pengajuan cuti / izin','CUTI-BSB-{YYYY}-{N5}','hrga'),
  ('LBR','Surat perintah lembur','LBR-BSB-{YYYY}-{N5}','hrga');

insert into public.app_settings(key, value, description) values
  ('attendance_require_photo', 'true', 'Absen dari aplikasi wajib selfie'),
  ('attendance_geofence_mode', '"flag"', 'flag = absen di luar radius tetap diterima tapi ditandai; reject = ditolak'),
  ('overtime_max_workday_hours', '4', 'Batas lembur per hari kerja (PP 35/2021)'),
  ('overtime_max_week_hours', '18', 'Batas lembur hari kerja per minggu (PP 35/2021)'),
  ('overtime_max_restday_hours', '11', 'Batas lembur di hari istirahat / libur');

-- ---------------------------------------------------------------- master
create table public.work_shifts(
  code text primary key check (code in ('D','N')),
  name text not null,
  start_time time not null,
  end_time time not null,
  grace_minutes int not null default 15 check (grace_minutes between 0 and 120),
  break_minutes int not null default 60 check (break_minutes between 0 and 240),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.work_shifts(code, name, start_time, end_time) values ('D','Shift siang','06:00','18:00'), ('N','Shift malam','18:00','06:00');

create table public.holidays(
  holiday_date date primary key,
  name text not null,
  kind text not null default 'national' check (kind in ('national','collective','company')),
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
insert into public.holidays(holiday_date, name) values
  ('2026-12-25','Hari Raya Natal'), ('2027-01-01','Tahun Baru Masehi'), ('2027-05-01','Hari Buruh Internasional'),
  ('2027-06-01','Hari Lahir Pancasila'), ('2027-08-17','Hari Kemerdekaan RI'), ('2027-12-25','Hari Raya Natal');

create table public.attendance_locations(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lat numeric(9,6) not null check (lat between -90 and 90),
  lng numeric(9,6) not null check (lng between -180 and 180),
  radius_m int not null default 300 check (radius_m between 20 and 20000),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.attendance_logs(
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  at timestamptz not null,
  kind text not null check (kind in ('in','out','punch')),
  source text not null check (source in ('app','fingerprint','manual')),
  lat numeric(9,6),
  lng numeric(9,6),
  accuracy_m numeric,
  location_id uuid references public.attendance_locations(id),
  distance_m int,
  in_geofence boolean,
  photo_id uuid references public.attachments(id),
  device text,
  note text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.attendance_logs(employee_id, at);
create unique index attendance_logs_fp_once on public.attendance_logs(employee_id, at) where source = 'fingerprint';

create table public.leave_types(
  code text primary key check (code ~ '^[A-Z]{2,4}$'),
  name text not null,
  paid boolean not null default true,
  quota_days int check (quota_days is null or quota_days > 0),
  max_days int check (max_days is null or max_days > 0),
  count_mode text not null default 'workday' check (count_mode in ('workday','calendar')),
  roster_code text not null check (roster_code in ('CUTI','SAKIT','IZIN')),
  requires_attachment boolean not null default false,
  gender text check (gender in ('L','P')),
  active boolean not null default true,
  sort_order int not null default 0
);
insert into public.leave_types(code, name, paid, quota_days, max_days, count_mode, roster_code, requires_attachment, gender, sort_order) values
  ('CT','Cuti tahunan',true,12,null,'workday','CUTI',false,null,1),
  ('SKT','Sakit dengan surat dokter',true,null,null,'calendar','SAKIT',true,null,2),
  ('IZN','Izin tidak dibayar',false,null,null,'workday','IZIN',false,null,3),
  ('NKH','Karyawan menikah',true,null,3,'workday','CUTI',false,null,10),
  ('NKA','Menikahkan anak',true,null,2,'workday','CUTI',false,null,11),
  ('KHT','Khitanan / baptis anak',true,null,2,'workday','CUTI',false,null,12),
  ('IML','Istri melahirkan / keguguran',true,null,2,'workday','CUTI',false,'L',13),
  ('DKL','Duka: suami/istri, orang tua/mertua, anak/menantu',true,null,2,'workday','CUTI',false,null,14),
  ('DSR','Duka: anggota keluarga serumah',true,null,1,'workday','CUTI',false,null,15),
  ('CMH','Cuti melahirkan',true,null,90,'calendar','CUTI',true,'P',16),
  ('CKG','Cuti keguguran',true,null,45,'calendar','CUTI',true,'P',17),
  ('CHD','Cuti haid hari 1-2',true,null,2,'calendar','SAKIT',false,'P',18);

create table public.leave_adjustments(
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  year int not null,
  leave_type text not null references public.leave_types(code),
  days numeric(5,1) not null check (days <> 0),
  reason text not null,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.leave_requests(
  id uuid primary key default gen_random_uuid(),
  request_no text not null unique,
  employee_id uuid not null references public.employees(id),
  leave_type text not null references public.leave_types(code),
  start_date date not null,
  end_date date not null,
  days numeric(5,1) not null check (days > 0),
  reason text not null,
  status text not null default 'submitted' check (status in ('submitted','approved_1','approved','rejected','cancelled')),
  approver1_id uuid references public.profiles(id),
  approved1_at timestamptz,
  approver2_id uuid references public.profiles(id),
  approved2_at timestamptz,
  decision_note text,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (end_date >= start_date)
);
create index on public.leave_requests(employee_id, start_date);

create table public.overtime_requests(
  id uuid primary key default gen_random_uuid(),
  request_no text not null unique,
  employee_id uuid not null references public.employees(id),
  work_date date not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  hours numeric(4,2) not null check (hours > 0 and hours <= 24),
  day_type text not null check (day_type in ('workday','restday','holiday')),
  reason text not null,
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','cancelled')),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  decision_note text,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (end_at > start_at)
);
create index on public.overtime_requests(employee_id, work_date);

do $$
declare t text;
begin
  foreach t in array array['work_shifts','attendance_locations','leave_requests','overtime_requests'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['work_shifts','holidays','attendance_locations','attendance_logs','leave_types','leave_adjustments','leave_requests','overtime_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
  end loop;
  foreach t in array array['work_shifts','holidays','attendance_locations','leave_types'] loop
    execute format('create policy %I_read on public.%I for select to authenticated using (app.is_active_user())', t, t);
  end loop;
end $$;
create policy attendance_logs_read on public.attendance_logs for select to authenticated using (app.can_view_employee(employee_id));
create policy leave_requests_read on public.leave_requests for select to authenticated using (app.can_view_employee(employee_id));
create policy leave_adjustments_read on public.leave_adjustments for select to authenticated using (app.can_view_employee(employee_id));
create policy overtime_requests_read on public.overtime_requests for select to authenticated using (app.can_view_employee(employee_id));

-- ---------------------------------------------------------------- pembantu
create or replace function app.site_tz() returns text language sql stable set search_path = public as $$
  select coalesce((select value #>> '{}' from public.app_settings where key = 'timezone'), 'Asia/Makassar')
$$;

create or replace function app.setting_num(p_key text, p_default numeric) returns numeric language sql stable set search_path = public as $$
  select coalesce((select (value #>> '{}')::numeric from public.app_settings where key = p_key), p_default)
$$;

-- Atasan yang berwenang menyetujui untuk karyawan: atasan langsung, atasan departemen (hr.roster), atau HRGA. Tidak untuk dirinya sendiri.
create or replace function app.can_approve_employee(p_employee uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.employees e where e.id = p_employee and e.profile_id is distinct from auth.uid()
                  and (e.supervisor_id = app.my_employee() or app.has_permission('hr.roster', e.department_id) or app.is_hr()))
$$;

create or replace function app.approvers_of(p_employee uuid) returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct u), '{}') from (
    select s.profile_id u from public.employees e join public.employees s on s.id = e.supervisor_id where e.id = p_employee
    union select unnest(app.users_with_permission('hr.roster', (select department_id from public.employees where id = p_employee)))
  ) x where u is not null and u is distinct from (select profile_id from public.employees where id = p_employee)
$$;

create or replace function app.day_type(p_employee uuid, p_date date) returns text language sql stable security definer set search_path = public as $$
  select case when exists(select 1 from public.holidays where holiday_date = p_date) then 'holiday'
              when (select code from public.roster_entries where employee_id = p_employee and work_date = p_date) in ('OFF') then 'restday'
              when not exists(select 1 from public.roster_entries where employee_id = p_employee and work_date = p_date)
                   and extract(isodow from p_date) = 7 then 'restday'
              else 'workday' end
$$;

-- Jumlah hari cuti: kalender, atau hari kerja (tanpa hari libur dan hari OFF roster; tanpa roster: tanpa hari Minggu)
create or replace function app.leave_days(p_employee uuid, p_type text, p_start date, p_end date) returns numeric
language sql stable security definer set search_path = public as $$
  select case (select count_mode from public.leave_types where code = p_type)
    when 'calendar' then (p_end - p_start + 1)::numeric
    else (select count(*) from generate_series(p_start, p_end, interval '1 day') d where app.day_type(p_employee, d::date) = 'workday')::numeric
  end
$$;

create or replace function app.leave_available(p_employee uuid, p_type text, p_year int, p_exclude uuid default null) returns numeric
language sql stable security definer set search_path = public as $$
  select case when t.quota_days is null then null else
    (case when e.join_date is null or (e.join_date + interval '12 months')::date <= make_date(p_year, 12, 31) then t.quota_days else 0 end)
    + coalesce((select sum(days) from public.leave_adjustments a where a.employee_id = p_employee and a.leave_type = p_type and a.year = p_year), 0)
    - coalesce((select sum(days) from public.leave_requests r where r.employee_id = p_employee and r.leave_type = p_type
                  and extract(year from r.start_date) = p_year and r.status in ('submitted','approved_1','approved')
                  and r.id is distinct from p_exclude), 0) end
    from public.leave_types t, public.employees e where t.code = p_type and e.id = p_employee
$$;

-- ---------------------------------------------------------------- master oleh HRGA
create or replace function public.shift_save(p_code text, p_name text, p_start time, p_end time, p_grace int, p_break int)
returns public.work_shifts language plpgsql security definer set search_path = public as $$
declare v public.work_shifts;
begin
  perform app.require_hr('hr.manage');
  update public.work_shifts set name = app.require_text(p_name, 'Nama shift'), start_time = p_start, end_time = p_end,
    grace_minutes = coalesce(p_grace, grace_minutes), break_minutes = coalesce(p_break, break_minutes)
   where code = p_code returning * into v;
  if not found then raise exception 'Shift tidak dikenal' using errcode = 'P0002'; end if;
  return v;
end $$;

create or replace function public.holiday_set(p_date date, p_name text, p_kind text default 'national')
returns void language plpgsql security definer set search_path = public as $$
begin
  perform app.require_hr('hr.manage');
  if coalesce(btrim(p_name), '') = '' then
    delete from public.holidays where holiday_date = p_date;
  else
    insert into public.holidays(holiday_date, name, kind) values (p_date, btrim(p_name), coalesce(p_kind, 'national'))
    on conflict (holiday_date) do update set name = excluded.name, kind = excluded.kind;
  end if;
end $$;

create or replace function public.attendance_location_save(p_id uuid, p_name text, p_lat numeric, p_lng numeric, p_radius int, p_active boolean default true)
returns public.attendance_locations language plpgsql security definer set search_path = public as $$
declare v public.attendance_locations;
begin
  perform app.require_hr('hr.manage');
  if p_id is null then
    insert into public.attendance_locations(name, lat, lng, radius_m, active) values (app.require_text(p_name, 'Nama lokasi'), p_lat, p_lng, coalesce(p_radius, 300), coalesce(p_active, true))
    returning * into v;
  else
    update public.attendance_locations set name = app.require_text(p_name, 'Nama lokasi'), lat = p_lat, lng = p_lng, radius_m = coalesce(p_radius, radius_m),
      active = coalesce(p_active, active) where id = p_id returning * into v;
    if not found then raise exception 'Lokasi tidak ditemukan' using errcode = 'P0002'; end if;
  end if;
  return v;
end $$;

create or replace function public.leave_adjust(p_employee uuid, p_year int, p_type text, p_days numeric, p_reason text)
returns public.leave_adjustments language plpgsql security definer set search_path = public as $$
declare v public.leave_adjustments;
begin
  perform app.require_hr('hr.manage');
  if (select quota_days from public.leave_types where code = p_type) is null then
    raise exception 'Penyesuaian saldo hanya untuk jenis cuti yang berkuota' using errcode = '22023';
  end if;
  insert into public.leave_adjustments(employee_id, year, leave_type, days, reason)
  values (p_employee, p_year, p_type, p_days, app.require_text(p_reason, 'Alasan penyesuaian')) returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------- absensi
-- Absen dari aplikasi oleh karyawan sendiri: lokasi GPS dibandingkan radius lokasi absen terdekat, selfie wajib (pengaturan).
create or replace function public.attendance_clock(p_kind text, p_lat numeric, p_lng numeric, p_accuracy numeric, p_photo uuid, p_device text default null)
returns public.attendance_logs language plpgsql security definer set search_path = public as $$
declare
  v public.attendance_logs;
  v_emp uuid := app.my_employee();
  loc record;
begin
  if v_emp is null or not app.is_active_user() then raise exception 'Akun Anda belum ditautkan ke data karyawan; hubungi HRGA' using errcode = '42501'; end if;
  if not exists(select 1 from public.employees where id = v_emp and status = 'active') then raise exception 'Karyawan tidak aktif' using errcode = '42501'; end if;
  if p_kind not in ('in','out') then raise exception 'Jenis absen tidak dikenal' using errcode = '22023'; end if;
  if p_lat is null or p_lng is null then raise exception 'Lokasi belum terbaca; aktifkan GPS lalu coba lagi' using errcode = '22023'; end if;
  if p_photo is null and coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'attendance_require_photo'), true) then
    raise exception 'Ambil selfie terlebih dahulu' using errcode = '22023';
  end if;
  if p_photo is not null then perform app.claim_attachments(array[p_photo], 'attendance_logs', v_emp); end if;
  if exists(select 1 from public.attendance_logs where employee_id = v_emp and kind = p_kind and at > now() - interval '2 minutes') then
    raise exception 'Absen % sudah tercatat barusan', case p_kind when 'in' then 'masuk' else 'pulang' end using errcode = '22023';
  end if;
  select l.id, l.radius_m, round(2 * 6371000 * asin(sqrt(power(sin(radians(l.lat - p_lat) / 2), 2)
           + cos(radians(p_lat)) * cos(radians(l.lat)) * power(sin(radians(l.lng - p_lng) / 2), 2))))::int as dist
    into loc from public.attendance_locations l where l.active order by 3 limit 1;
  if loc.id is not null and loc.dist > loc.radius_m + least(coalesce(p_accuracy, 0), 100)
     and coalesce((select value #>> '{}' from public.app_settings where key = 'attendance_geofence_mode'), 'flag') = 'reject' then
    raise exception 'Anda berada % m dari lokasi absen terdekat (radius % m)', loc.dist, loc.radius_m using errcode = '22023';
  end if;
  insert into public.attendance_logs(employee_id, at, kind, source, lat, lng, accuracy_m, location_id, distance_m, in_geofence, photo_id, device)
  values (v_emp, now(), p_kind, 'app', p_lat, p_lng, p_accuracy, loc.id, loc.dist,
          case when loc.id is null then null else loc.dist <= loc.radius_m + least(coalesce(p_accuracy, 0), 100) end, p_photo, left(p_device, 200))
  returning * into v;
  return v;
end $$;

-- Koreksi absen oleh HRGA / atasan departemen (lupa absen, mesin rusak); wajib keterangan
create or replace function public.attendance_manual(p_employee uuid, p_at timestamptz, p_kind text, p_note text)
returns public.attendance_logs language plpgsql security definer set search_path = public as $$
declare v public.attendance_logs;
begin
  if not app.can_approve_employee(p_employee) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if p_kind not in ('in','out') then raise exception 'Jenis absen tidak dikenal' using errcode = '22023'; end if;
  if p_at > now() + interval '5 minutes' then raise exception 'Waktu absen tidak boleh di masa depan' using errcode = '22023'; end if;
  insert into public.attendance_logs(employee_id, at, kind, source, note)
  values (p_employee, p_at, p_kind, 'manual', app.require_text(p_note, 'Keterangan koreksi')) returning * into v;
  return v;
end $$;

-- Rekap harian: jadwal dari roster + shift, jam masuk/pulang dari log (D: 02.00–24.00; N: 14.00–12.00 esok), status kehadiran
create view public.attendance_daily with (security_invoker = true) as
with days as (
  select r.employee_id, r.work_date, r.code from public.roster_entries r
  union
  select l.employee_id, (l.at at time zone app.site_tz())::date, null from public.attendance_logs l
   where not exists(select 1 from public.roster_entries r where r.employee_id = l.employee_id and r.work_date = (l.at at time zone app.site_tz())::date)
     and not exists(select 1 from public.roster_entries r where r.employee_id = l.employee_id and r.code = 'N'
                     and r.work_date = (l.at at time zone app.site_tz())::date - 1 and (l.at at time zone app.site_tz())::time < '12:00')
)
select d.employee_id, e.nrp, e.full_name, e.department_id, dp.code as department_code, d.work_date, d.code as roster_code,
       h.name as holiday_name, s.start_at, s.end_at, w.clock_in, w.clock_out, w.punches, coalesce(w.outside, false) as outside_geofence,
       case when w.clock_in is not null and s.start_at is not null and w.clock_in > s.start_at + make_interval(mins => sh.grace_minutes)
            then floor(extract(epoch from w.clock_in - s.start_at) / 60)::int else 0 end as late_minutes,
       case when w.clock_out is not null and s.end_at is not null and w.clock_out < s.end_at
            then floor(extract(epoch from s.end_at - w.clock_out) / 60)::int else 0 end as early_minutes,
       case when w.clock_out is not null then round((extract(epoch from w.clock_out - w.clock_in) / 3600)::numeric, 2) end as worked_hours,
       (w.clock_in is not null and w.clock_out is null and s.end_at is not null and now() > s.end_at + interval '2 hours') as missing_out,
       case when d.code in ('CUTI','SAKIT','IZIN') then lower(d.code)
            when d.code = 'OFF' then case when w.clock_in is not null then 'masuk_off' else 'off' end
            when d.code is null then case when w.clock_in is not null then 'hadir' when h.name is not null then 'libur' else 'tanpa_jadwal' end
            when w.clock_in is null then case when now() < s.start_at + make_interval(mins => sh.grace_minutes) then 'belum' else 'alpa' end
            when w.clock_in > s.start_at + make_interval(mins => sh.grace_minutes) then 'terlambat'
            else 'hadir' end as status
  from days d
  join public.employees e on e.id = d.employee_id
  join public.departments dp on dp.id = e.department_id
  left join public.work_shifts sh on sh.code = d.code
  left join public.holidays h on h.holiday_date = d.work_date
  cross join lateral (select (d.work_date + sh.start_time) at time zone app.site_tz() as start_at,
                             (d.work_date + sh.end_time + case when sh.end_time <= sh.start_time then interval '1 day' else interval '0' end) at time zone app.site_tz() as end_at) s
  cross join lateral (select coalesce(s.start_at - interval '4 hours', d.work_date::timestamp at time zone app.site_tz()) as w_from,
                             coalesce(s.end_at + interval '6 hours', (d.work_date + 1)::timestamp at time zone app.site_tz()) as w_to) win
  left join lateral (select min(l.at) filter (where l.kind in ('in','punch')) as clock_in,
                            nullif(max(l.at) filter (where l.kind in ('out','punch')), min(l.at) filter (where l.kind in ('in','punch'))) as clock_out,
                            bool_or(not coalesce(l.in_geofence, true)) as outside, count(*)::int as punches
                       from public.attendance_logs l where l.employee_id = d.employee_id and l.at >= win.w_from and l.at < win.w_to) w on true;

-- ---------------------------------------------------------------- cuti
create or replace function public.leave_request_create(p_employee uuid, p_type text, p_start date, p_end date, p_reason text,
  p_attachments uuid[] default '{}', p_idempotency_key text default null)
returns public.leave_requests language plpgsql security definer set search_path = public as $$
declare
  v public.leave_requests;
  t public.leave_types;
  v_emp uuid := coalesce(p_employee, app.my_employee());
  v_days numeric;
  v_avail numeric;
  v_gender text;
  v_reg public.registrations;
begin
  if v_emp is null then raise exception 'Akun Anda belum ditautkan ke data karyawan; hubungi HRGA' using errcode = '42501'; end if;
  if v_emp <> coalesce(app.my_employee(), '00000000-0000-0000-0000-000000000000') and not app.can_approve_employee(v_emp) then
    raise exception 'Tidak berwenang mengajukan cuti untuk karyawan ini' using errcode = '42501';
  end if;
  if p_idempotency_key is not null then
    select l.* into v from public.registrations r join public.leave_requests l on l.request_no = r.number where r.idempotency_key = p_idempotency_key;
    if found then return v; end if;
  end if;
  select * into t from public.leave_types where code = p_type and active;
  if not found then raise exception 'Jenis cuti tidak dikenal' using errcode = '22023'; end if;
  if not exists(select 1 from public.employees where id = v_emp and status = 'active') then raise exception 'Karyawan tidak aktif' using errcode = '22023'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'Tanggal cuti tidak valid' using errcode = '22023'; end if;
  if extract(year from p_start) <> extract(year from p_end) then raise exception 'Pisahkan pengajuan yang melewati pergantian tahun' using errcode = '22023'; end if;
  if p_end - p_start > 120 then raise exception 'Rentang cuti terlalu panjang' using errcode = '22023'; end if;
  select gender into v_gender from public.employee_private where employee_id = v_emp;
  if t.gender is not null and v_gender is not null and v_gender <> t.gender then
    raise exception '% hanya untuk karyawan %', t.name, case t.gender when 'P' then 'perempuan' else 'laki-laki' end using errcode = '22023';
  end if;
  if t.requires_attachment and coalesce(cardinality(p_attachments), 0) = 0 then
    raise exception '% wajib melampirkan dokumen (mis. surat dokter)', t.name using errcode = '22023';
  end if;
  if exists(select 1 from public.leave_requests where employee_id = v_emp and status in ('submitted','approved_1','approved')
              and daterange(start_date, end_date, '[]') && daterange(p_start, p_end, '[]')) then
    raise exception 'Tanggal bertabrakan dengan pengajuan cuti lain' using errcode = '22023';
  end if;
  v_days := app.leave_days(v_emp, p_type, p_start, p_end);
  if v_days <= 0 then raise exception 'Rentang tanggal tidak berisi hari kerja' using errcode = '22023'; end if;
  if t.max_days is not null and v_days > t.max_days then raise exception '% maksimal % hari', t.name, t.max_days using errcode = '22023'; end if;
  v_avail := app.leave_available(v_emp, p_type, extract(year from p_start)::int);
  if v_avail is not null and v_days > v_avail then
    raise exception 'Saldo % tidak cukup: sisa % hari, diajukan % hari', t.name, v_avail, v_days using errcode = '22023';
  end if;
  v_reg := app.allocate_number('CUTI', jsonb_build_object('date', p_start), p_idempotency_key);
  insert into public.leave_requests(request_no, employee_id, leave_type, start_date, end_date, days, reason)
  values (v_reg.number, v_emp, p_type, p_start, p_end, v_days, app.require_text(p_reason, 'Keterangan')) returning * into v;
  update public.registrations set ref_table = 'leave_requests', ref_id = v.id where id = v_reg.id;
  perform app.claim_attachments(p_attachments, 'leave_requests', v.id);
  perform app.notify_users(app.approvers_of(v_emp), 'hr.leave', 'Pengajuan ' || t.name || ' ' || v.request_no,
    (select full_name from public.employees where id = v_emp) || ' · ' || v.days || ' hari', '/tugas');
  return v;
end $$;

-- p_approve: true = setujui (tahap 1 atasan, tahap 2 HRGA), false = tolak (wajib alasan). Persetujuan akhir mengisi roster.
create or replace function public.leave_request_decide(p_id uuid, p_approve boolean, p_note text default null)
returns public.leave_requests language plpgsql security definer set search_path = public as $$
declare
  v public.leave_requests;
  t public.leave_types;
  v_avail numeric;
begin
  select * into v from public.leave_requests where id = p_id for update;
  if not found then raise exception 'Pengajuan tidak ditemukan' using errcode = 'P0002'; end if;
  if v.status not in ('submitted','approved_1') then raise exception 'Pengajuan sudah diputuskan' using errcode = '22023'; end if;
  if v.created_by = auth.uid() then raise exception 'Pengaju tidak bisa memutuskan pengajuannya sendiri' using errcode = '42501'; end if;
  select * into t from public.leave_types where code = v.leave_type;
  if v.status = 'submitted' then
    if not app.can_approve_employee(v.employee_id) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  else
    if not app.is_hr() then raise exception 'Persetujuan tahap 2 oleh HRGA' using errcode = '42501'; end if;
    if v.approver1_id = auth.uid() then raise exception 'Tahap 2 harus orang berbeda dari tahap 1' using errcode = '42501'; end if;
    if (select profile_id from public.employees where id = v.employee_id) = auth.uid() then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  end if;
  if not p_approve then
    update public.leave_requests set status = 'rejected', decision_note = app.require_text(p_note, 'Alasan penolakan'),
      approver1_id = case when status = 'submitted' then auth.uid() else approver1_id end,
      approved1_at = case when status = 'submitted' then now() else approved1_at end,
      approver2_id = case when status = 'approved_1' then auth.uid() else approver2_id end,
      approved2_at = case when status = 'approved_1' then now() else approved2_at end
     where id = p_id returning * into v;
    perform app.notify_users(array[v.created_by, (select profile_id from public.employees where id = v.employee_id)], 'hr.leave',
      'Cuti ' || v.request_no || ' ditolak', p_note, '/saya?tab=cuti');
    return v;
  end if;
  if v.status = 'submitted' then
    update public.leave_requests set status = 'approved_1', approver1_id = auth.uid(), approved1_at = now(), decision_note = p_note
     where id = p_id returning * into v;
    perform app.notify_users(app.users_with_permission('hr.manage', app.hrga_dept()), 'hr.leave', 'Cuti ' || v.request_no || ' menunggu verifikasi HRGA',
      (select full_name from public.employees where id = v.employee_id), '/tugas');
    return v;
  end if;
  v_avail := app.leave_available(v.employee_id, v.leave_type, extract(year from v.start_date)::int, v.id);
  if v_avail is not null and v.days > v_avail then raise exception 'Saldo tidak cukup: sisa % hari', v_avail using errcode = '22023'; end if;
  update public.leave_requests set status = 'approved', approver2_id = auth.uid(), approved2_at = now(), decision_note = coalesce(p_note, decision_note)
   where id = p_id returning * into v;
  -- Roster: hari kerja (atau semua hari untuk jenis kalender) diisi kode cuti
  insert into public.roster_entries(employee_id, work_date, code, set_by)
  select v.employee_id, d::date, t.roster_code, auth.uid() from generate_series(v.start_date, v.end_date, interval '1 day') d
   where t.count_mode = 'calendar' or app.day_type(v.employee_id, d::date) = 'workday'
  on conflict (employee_id, work_date) do update set code = excluded.code, set_by = excluded.set_by, updated_at = now();
  perform app.notify_users(array[v.created_by, (select profile_id from public.employees where id = v.employee_id)], 'hr.leave',
    'Cuti ' || v.request_no || ' disetujui', t.name || ' · ' || v.days || ' hari', '/saya?tab=cuti');
  return v;
end $$;

-- Batal oleh pengaju / karyawan ybs sebelum mulai; cuti yang sudah disetujui dikembalikan ke roster D oleh atasan bila perlu
create or replace function public.leave_request_cancel(p_id uuid)
returns public.leave_requests language plpgsql security definer set search_path = public as $$
declare v public.leave_requests;
begin
  select * into v from public.leave_requests where id = p_id for update;
  if not found then raise exception 'Pengajuan tidak ditemukan' using errcode = 'P0002'; end if;
  if not (v.created_by = auth.uid() or v.employee_id = app.my_employee() or app.is_hr()) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if v.status in ('rejected','cancelled') then raise exception 'Pengajuan sudah ditutup' using errcode = '22023'; end if;
  if v.status = 'approved' and not app.is_hr() then raise exception 'Cuti yang sudah disetujui hanya bisa dibatalkan HRGA' using errcode = '42501'; end if;
  if v.status = 'approved' and v.start_date <= app.site_today() then raise exception 'Cuti sudah berjalan; buat koreksi roster' using errcode = '22023'; end if;
  update public.leave_requests set status = 'cancelled' where id = p_id returning * into v;
  if exists(select 1 from public.leave_requests where id = p_id and approved2_at is not null) then
    delete from public.roster_entries where employee_id = v.employee_id and work_date between v.start_date and v.end_date
       and code = (select roster_code from public.leave_types where code = v.leave_type);
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------- lembur
create or replace function public.overtime_request_create(p_employee uuid, p_date date, p_start time, p_end time, p_reason text,
  p_idempotency_key text default null)
returns public.overtime_requests language plpgsql security definer set search_path = public as $$
declare
  v public.overtime_requests;
  v_emp uuid := coalesce(p_employee, app.my_employee());
  v_start timestamptz;
  v_end timestamptz;
  v_hours numeric;
  v_type text;
  v_week numeric;
  v_reg public.registrations;
begin
  if v_emp is null then raise exception 'Akun Anda belum ditautkan ke data karyawan; hubungi HRGA' using errcode = '42501'; end if;
  if v_emp <> coalesce(app.my_employee(), '00000000-0000-0000-0000-000000000000') and not app.can_approve_employee(v_emp) then
    raise exception 'Tidak berwenang membuat SPL untuk karyawan ini' using errcode = '42501';
  end if;
  if p_idempotency_key is not null then
    select o.* into v from public.registrations r join public.overtime_requests o on o.request_no = r.number where r.idempotency_key = p_idempotency_key;
    if found then return v; end if;
  end if;
  if not exists(select 1 from public.employees where id = v_emp and status = 'active') then raise exception 'Karyawan tidak aktif' using errcode = '22023'; end if;
  if p_date is null or p_start is null or p_end is null then raise exception 'Tanggal dan jam lembur wajib diisi' using errcode = '22023'; end if;
  if p_date < app.site_today() - 7 then raise exception 'Lembur lebih dari 7 hari lalu diajukan lewat koreksi HRGA' using errcode = '22023'; end if;
  v_start := (p_date + p_start) at time zone app.site_tz();
  v_end := (p_date + p_end + case when p_end <= p_start then interval '1 day' else interval '0' end) at time zone app.site_tz();
  v_hours := round((extract(epoch from v_end - v_start) / 3600)::numeric, 2);
  v_type := app.day_type(v_emp, p_date);
  if v_type = 'workday' and v_hours > app.setting_num('overtime_max_workday_hours', 4) then
    raise exception 'Lembur hari kerja maksimal % jam per hari', app.setting_num('overtime_max_workday_hours', 4) using errcode = '22023';
  end if;
  if v_type <> 'workday' and v_hours > app.setting_num('overtime_max_restday_hours', 11) then
    raise exception 'Lembur hari istirahat/libur maksimal % jam', app.setting_num('overtime_max_restday_hours', 11) using errcode = '22023';
  end if;
  if v_type = 'workday' then
    select coalesce(sum(hours), 0) into v_week from public.overtime_requests
     where employee_id = v_emp and day_type = 'workday' and status in ('submitted','approved')
       and date_trunc('week', work_date) = date_trunc('week', p_date);
    if v_week + v_hours > app.setting_num('overtime_max_week_hours', 18) then
      raise exception 'Melebihi batas lembur % jam/minggu (sudah % jam)', app.setting_num('overtime_max_week_hours', 18), v_week using errcode = '22023';
    end if;
  end if;
  if exists(select 1 from public.overtime_requests where employee_id = v_emp and status in ('submitted','approved')
              and tstzrange(start_at, end_at) && tstzrange(v_start, v_end)) then
    raise exception 'Jam lembur bertabrakan dengan SPL lain' using errcode = '22023';
  end if;
  v_reg := app.allocate_number('LBR', jsonb_build_object('date', p_date), p_idempotency_key);
  insert into public.overtime_requests(request_no, employee_id, work_date, start_at, end_at, hours, day_type, reason)
  values (v_reg.number, v_emp, p_date, v_start, v_end, v_hours, v_type, app.require_text(p_reason, 'Pekerjaan / alasan lembur')) returning * into v;
  update public.registrations set ref_table = 'overtime_requests', ref_id = v.id where id = v_reg.id;
  perform app.notify_users(app.approvers_of(v_emp), 'hr.overtime', 'SPL ' || v.request_no,
    (select full_name from public.employees where id = v_emp) || ' · ' || v.hours || ' jam', '/tugas');
  return v;
end $$;

create or replace function public.overtime_request_decide(p_id uuid, p_approve boolean, p_note text default null)
returns public.overtime_requests language plpgsql security definer set search_path = public as $$
declare v public.overtime_requests;
begin
  select * into v from public.overtime_requests where id = p_id for update;
  if not found then raise exception 'SPL tidak ditemukan' using errcode = 'P0002'; end if;
  if v.status <> 'submitted' then raise exception 'SPL sudah diputuskan' using errcode = '22023'; end if;
  if v.created_by = auth.uid() then raise exception 'Pembuat SPL tidak bisa menyetujuinya sendiri' using errcode = '42501'; end if;
  if not app.can_approve_employee(v.employee_id) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  update public.overtime_requests set status = case when p_approve then 'approved' else 'rejected' end, approved_by = auth.uid(), approved_at = now(),
    decision_note = case when p_approve then p_note else app.require_text(p_note, 'Alasan penolakan') end
   where id = p_id returning * into v;
  perform app.notify_users(array[v.created_by, (select profile_id from public.employees where id = v.employee_id)], 'hr.overtime',
    'SPL ' || v.request_no || case when p_approve then ' disetujui' else ' ditolak' end, p_note, '/saya?tab=lembur');
  return v;
end $$;

create or replace function public.overtime_request_cancel(p_id uuid)
returns public.overtime_requests language plpgsql security definer set search_path = public as $$
declare v public.overtime_requests;
begin
  update public.overtime_requests set status = 'cancelled'
   where id = p_id and status = 'submitted' and (created_by = auth.uid() or employee_id = app.my_employee() or app.is_hr())
  returning * into v;
  if not found then raise exception 'Hanya SPL yang belum diputuskan yang bisa dibatalkan' using errcode = '22023'; end if;
  return v;
end $$;

-- ---------------------------------------------------------------- tampilan
create view public.leave_register with (security_invoker = true) as
select r.id, r.request_no, r.employee_id, e.nrp, e.full_name, d.code as department_code, r.leave_type, t.name as leave_name, t.paid,
       r.start_date, r.end_date, r.days, r.reason, r.status, r.decision_note, r.created_at, r.created_by,
       p1.full_name as approver1_name, r.approved1_at, p2.full_name as approver2_name, r.approved2_at,
       (r.status = 'submitted' and app.can_approve_employee(r.employee_id) and r.created_by <> auth.uid())
       or (r.status = 'approved_1' and app.is_hr() and r.approver1_id is distinct from auth.uid() and r.created_by <> auth.uid()
           and e.profile_id is distinct from auth.uid()) as can_decide
  from public.leave_requests r
  join public.employees e on e.id = r.employee_id
  join public.departments d on d.id = e.department_id
  join public.leave_types t on t.code = r.leave_type
  left join public.profiles p1 on p1.id = r.approver1_id
  left join public.profiles p2 on p2.id = r.approver2_id;

create view public.leave_balance with (security_invoker = true) as
select e.id as employee_id, e.nrp, e.full_name, d.code as department_code, t.code as leave_type, t.name as leave_name,
       extract(year from app.site_today())::int as year,
       case when e.join_date is null or (e.join_date + interval '12 months')::date <= make_date(extract(year from app.site_today())::int, 12, 31)
            then t.quota_days else 0 end as quota,
       coalesce((select sum(a.days) from public.leave_adjustments a where a.employee_id = e.id and a.leave_type = t.code
                   and a.year = extract(year from app.site_today())), 0) as adjustment,
       coalesce((select sum(r.days) from public.leave_requests r where r.employee_id = e.id and r.leave_type = t.code and r.status = 'approved'
                   and extract(year from r.start_date) = extract(year from app.site_today())), 0) as used,
       coalesce((select sum(r.days) from public.leave_requests r where r.employee_id = e.id and r.leave_type = t.code and r.status in ('submitted','approved_1')
                   and extract(year from r.start_date) = extract(year from app.site_today())), 0) as pending,
       app.leave_available(e.id, t.code, extract(year from app.site_today())::int) as available
  from public.employees e
  join public.departments d on d.id = e.department_id
  cross join public.leave_types t
 where e.status = 'active' and t.quota_days is not null and t.active and app.can_view_employee(e.id);

create view public.overtime_register with (security_invoker = true) as
select o.id, o.request_no, o.employee_id, e.nrp, e.full_name, d.code as department_code, o.work_date, o.start_at, o.end_at, o.hours, o.day_type,
       o.reason, o.status, o.decision_note, o.created_at, o.created_by, pa.full_name as approver_name, o.approved_at,
       -- jam aktual = irisan jam SPL dengan jam masuk–pulang di absensi
       (select round(greatest(0, extract(epoch from least(o.end_at, a.clock_out) - greatest(o.start_at, a.clock_in)) / 3600)::numeric, 2)
          from public.attendance_daily a where a.employee_id = o.employee_id and a.work_date = o.work_date and a.clock_out is not null limit 1) as actual_hours,
       (o.status = 'submitted' and app.can_approve_employee(o.employee_id) and o.created_by <> auth.uid()) as can_decide
  from public.overtime_requests o
  join public.employees e on e.id = o.employee_id
  join public.departments d on d.id = e.department_id
  left join public.profiles pa on pa.id = o.approved_by;

do $$
declare v text;
begin
  foreach v in array array['attendance_daily','leave_register','leave_balance','overtime_register'] loop
    execute format('grant select on public.%I to authenticated', v);
    execute format('revoke all on public.%I from anon', v);
  end loop;
end $$;

-- ---------------------------------------------------------------- impor: absensi mesin fingerprint & saldo awal cuti
-- Satu sentuhan mesin fingerprint (oleh HRGA); jenis kosong = ditentukan otomatis (pertama masuk, terakhir pulang)
create or replace function app.attendance_import(p_employee uuid, p_at timestamptz, p_kind text, p_device text) returns void
language plpgsql security definer set search_path = public as $$
declare t text := lower(btrim(coalesce(p_kind, '')));
begin
  if not app.is_hr() then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if p_at is null then raise exception 'Waktu wajib diisi' using errcode = '22023'; end if;
  insert into public.attendance_logs(employee_id, at, kind, source, device)
  values (p_employee, p_at, case when t in ('in', 'masuk', 'c/in', 'checkin', 'check in') then 'in'
                                 when t in ('out', 'pulang', 'keluar', 'c/out', 'checkout', 'check out') then 'out' else 'punch' end,
          'fingerprint', left(p_device, 200))
  on conflict (employee_id, at) where source = 'fingerprint' do nothing;
end $$;
revoke all on function app.attendance_import(uuid, timestamptz, text, text) from public, anon;
grant execute on function app.attendance_import(uuid, timestamptz, text, text) to authenticated;
create or replace function app.import_row_ext(p_dataset text, r jsonb) returns boolean
language plpgsql set search_path = public as $$
declare
  v_id uuid;
  t text;
begin
  if p_dataset in ('data_pribadi', 'kontrak', 'idcard', 'organisasi', 'absensi', 'saldo_cuti') then
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
  when 'absensi' then
    -- Mesin fingerprint: satu baris = satu sentuhan. Jenis kosong = ditentukan otomatis (pertama masuk, terakhir pulang).
    -- waktu lengkap, atau kolom tanggal + jam terpisah (format umum ekspor mesin)
    perform app.attendance_import(v_id, (coalesce(nullif(r->>'waktu', ''), nullif(btrim(coalesce(r->>'tanggal', '') || ' ' || coalesce(r->>'jam', '')), ''))::timestamp)
      at time zone app.site_tz(), r->>'jenis', nullif(r->>'mesin', ''));
  when 'saldo_cuti' then
    perform public.leave_adjust(v_id, coalesce((nullif(r->>'tahun', ''))::int, extract(year from app.site_today())::int),
      coalesce(upper(nullif(r->>'jenis', '')), 'CT'), (r->>'hari')::numeric, coalesce(nullif(r->>'keterangan', ''), 'Saldo awal dari sistem lama'));
  else
    return false;
  end case;
  return true;
end $$;
revoke all on function app.import_row_ext(text, jsonb) from public, anon;
grant execute on function app.import_row_ext(text, jsonb) to authenticated;

revoke all on function app.can_approve_employee(uuid), app.approvers_of(uuid), app.day_type(uuid, date), app.leave_days(uuid, text, date, date),
  app.leave_available(uuid, text, int, uuid) from public, anon;
grant execute on function app.can_approve_employee(uuid), app.leave_available(uuid, text, int, uuid), app.site_tz(), app.setting_num(text, numeric)
  to authenticated;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and p.proname not in ('verify_document', 'feed_rows') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
