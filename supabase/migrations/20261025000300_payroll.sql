-- BSB IMS · HRIS tahap C · Payroll: komponen & struktur gaji, proses gaji bulanan dan THR dari absensi/lembur,
-- BPJS Ketenagakerjaan & Kesehatan, PPh 21 TER (PP 58/2023, PMK 168/2023) dengan perhitungan setahun di masa pajak
-- terakhir (Pasal 17 UU HPP), slip gaji di ESS, rekap biaya per departemen, dan uji paralel dengan sistem lama.
-- Data gaji hanya terbaca pemegang izin payroll (dan slip milik sendiri setelah diterbitkan).

insert into public.permissions(code, module, description) values
  ('payroll.read','hrga','Melihat data gaji, slip dan rekap biaya gaji'),
  ('payroll.manage','hrga','Mengelola struktur gaji dan memproses penggajian'),
  ('payroll.approve','hrga','Menyetujui hasil proses gaji sebelum diterbitkan');
insert into public.roles(code, name, description, is_system) values
  ('PAYROLL_OFFICER','Payroll officer','Mengelola struktur gaji, menghitung dan menerbitkan gaji', true),
  ('PAYROLL_APPROVER','Penyetuju payroll','Memeriksa dan menyetujui hasil proses gaji (bukan pembuatnya)', true);
insert into public.role_permissions(role_code, permission_code) values
  ('PAYROLL_OFFICER','payroll.read'), ('PAYROLL_OFFICER','payroll.manage'),
  ('PAYROLL_APPROVER','payroll.read'), ('PAYROLL_APPROVER','payroll.approve');

insert into public.numbering_schemes(code, name, pattern, module) values
  ('PAY','Proses penggajian','PAY-BSB-{YYYY}-{N4}','hrga');

insert into public.app_settings(key, value, description) values
  ('payroll_cutoff_day', '20', 'Tanggal tutup absensi: periode gaji bulan M memakai absensi tgl (cutoff+1) bulan M-1 s.d. tgl cutoff bulan M; 0 = bulan kalender'),
  ('payroll_daily_divisor', '25', 'Pembagi upah harian untuk potongan alpa / izin tidak dibayar'),
  ('payroll_overtime_week_days', '6', 'Pola hari kerja per minggu untuk tarif lembur hari istirahat (6 atau 5; PP 35/2021 Pasal 31)'),
  ('payroll_overtime_excluded_levels', '["PJO","DH"]', 'Level jabatan yang tidak mendapat upah lembur (manajerial)'),
  ('bpjs_jht_er', '3.7', 'JHT ditanggung perusahaan (%)'),
  ('bpjs_jht_ee', '2', 'JHT dipotong dari karyawan (%)'),
  ('bpjs_jp_er', '2', 'Jaminan Pensiun perusahaan (%)'),
  ('bpjs_jp_ee', '1', 'Jaminan Pensiun karyawan (%)'),
  ('bpjs_jp_cap', '11086300', 'Batas upah tertinggi iuran JP (berlaku Maret 2026; diperbarui BPJS tiap Maret)'),
  ('bpjs_jkk_er', '1.27', 'JKK perusahaan (%): 0,24 / 0,54 / 0,89 / 1,27 / 1,74 sesuai kelompok risiko terdaftar'),
  ('bpjs_jkm_er', '0.3', 'JKM perusahaan (%)'),
  ('bpjs_kes_er', '4', 'BPJS Kesehatan perusahaan (%)'),
  ('bpjs_kes_ee', '1', 'BPJS Kesehatan karyawan (%)'),
  ('bpjs_kes_cap', '12000000', 'Batas upah tertinggi iuran BPJS Kesehatan');

-- ---------------------------------------------------------------- tabel TER bulanan (Lampiran PP 58/2023): batas atas inklusif
create table public.pph21_ter(
  category text not null check (category in ('A','B','C')),
  upper_limit numeric(15,0),
  rate numeric(5,2) not null,
  primary key (category, rate)
);
insert into public.pph21_ter(category, upper_limit, rate)
select 'A', u, r from (values (5400000,0),(5650000,0.25),(5950000,0.5),(6300000,0.75),(6750000,1),(7500000,1.25),(8550000,1.5),(9650000,1.75),
  (10050000,2),(10350000,2.25),(10700000,2.5),(11050000,3),(11600000,3.5),(12500000,4),(13750000,5),(15100000,6),(16950000,7),(19750000,8),
  (24150000,9),(26450000,10),(28000000,11),(30050000,12),(32400000,13),(35400000,14),(39100000,15),(43850000,16),(47800000,17),(51400000,18),
  (56300000,19),(62200000,20),(68600000,21),(77500000,22),(89000000,23),(103000000,24),(125000000,25),(157000000,26),(206000000,27),
  (337000000,28),(454000000,29),(550000000,30),(695000000,31),(910000000,32),(1400000000,33),(null,34)) v(u, r)
union all
select 'B', u, r from (values (6200000,0),(6500000,0.25),(6850000,0.5),(7300000,0.75),(9200000,1),(10750000,1.5),(11250000,2),(11600000,2.5),
  (12600000,3),(13600000,4),(14950000,5),(16400000,6),(18450000,7),(21850000,8),(26000000,9),(27700000,10),(29350000,11),(31450000,12),
  (33950000,13),(37100000,14),(41100000,15),(45800000,16),(49500000,17),(53800000,18),(58500000,19),(64000000,20),(71000000,21),(80000000,22),
  (93000000,23),(109000000,24),(129000000,25),(163000000,26),(211000000,27),(374000000,28),(459000000,29),(555000000,30),(704000000,31),
  (957000000,32),(1405000000,33),(null,34)) v(u, r)
union all
select 'C', u, r from (values (6600000,0),(6950000,0.25),(7350000,0.5),(7800000,0.75),(8850000,1),(9800000,1.25),(10950000,1.5),(11200000,1.75),
  (12050000,2),(12950000,3),(14150000,4),(15550000,5),(17050000,6),(19500000,7),(22700000,8),(26600000,9),(28100000,10),(30100000,11),
  (32600000,12),(35400000,13),(38900000,14),(43000000,15),(47400000,16),(51200000,17),(55800000,18),(60400000,19),(66700000,20),(74500000,21),
  (83200000,22),(95600000,23),(110000000,24),(134000000,25),(169000000,26),(221000000,27),(390000000,28),(463000000,29),(561000000,30),
  (709000000,31),(965000000,32),(1419000000,33),(null,34)) v(u, r);

-- ---------------------------------------------------------------- komponen & struktur gaji
create table public.pay_components(
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]{1,15}$'),
  name text not null,
  kind text not null check (kind in ('earning','deduction')),
  -- basic & fixed_allowance = upah tetap (dasar lembur, THR, BPJS, potongan alpa)
  category text not null check (category in ('basic','fixed_allowance','variable_allowance','bonus','deduction')),
  calc text not null check (calc in ('fixed','per_present_day','per_night_shift','manual')),
  taxable boolean not null default true,
  active boolean not null default true,
  sort_order int not null default 0,
  check ((kind = 'deduction') = (category = 'deduction')),
  check (category not in ('basic','fixed_allowance') or calc = 'fixed')
);
insert into public.pay_components(code, name, kind, category, calc, sort_order) values
  ('GP','Gaji pokok','earning','basic','fixed',1),
  ('TJAB','Tunjangan jabatan','earning','fixed_allowance','fixed',2),
  ('TSITE','Tunjangan site','earning','fixed_allowance','fixed',3),
  ('TMAKAN','Uang makan (per hari hadir)','earning','variable_allowance','per_present_day',10),
  ('TTRANS','Uang transport (per hari hadir)','earning','variable_allowance','per_present_day',11),
  ('TSHIFT','Tunjangan shift malam (per malam)','earning','variable_allowance','per_night_shift',12),
  ('INSENTIF','Insentif / premi produksi','earning','bonus','manual',20),
  ('RAPEL','Rapel / koreksi gaji','earning','bonus','manual',21),
  ('KASBON','Potongan kasbon','deduction','deduction','manual',50),
  ('POTLAIN','Potongan lain-lain','deduction','deduction','manual',51);

create table public.employee_pay(
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  component_code text not null references public.pay_components(code),
  amount numeric(14,0) not null check (amount >= 0),
  effective_from date not null,
  note text,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (employee_id, component_code, effective_from)
);

-- Saldo awal pajak tahun berjalan (sebelum aplikasi dipakai) untuk perhitungan PPh 21 setahun
create table public.payroll_ytd_opening(
  employee_id uuid not null references public.employees(id),
  year int not null,
  gross numeric(15,0) not null default 0,
  pph21 numeric(15,0) not null default 0,
  pension_ee numeric(15,0) not null default 0,
  months int not null default 0 check (months between 0 and 11),
  note text,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (employee_id, year)
);

-- ---------------------------------------------------------------- proses gaji
create table public.payroll_runs(
  id uuid primary key default gen_random_uuid(),
  run_no text not null unique,
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  kind text not null check (kind in ('regular','thr')),
  att_from date not null,
  att_to date not null,
  pay_date date not null,
  parallel boolean not null default false,
  status text not null default 'draft' check (status in ('draft','calculated','approved','published','cancelled')),
  note text,
  calculated_by uuid references public.profiles(id),
  calculated_at timestamptz,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  published_by uuid references public.profiles(id),
  published_at timestamptz,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (att_to >= att_from)
);
create unique index payroll_runs_one_live on public.payroll_runs(period, kind, parallel) where status <> 'cancelled';

create table public.payroll_inputs(
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  component_code text not null references public.pay_components(code),
  amount numeric(14,0) not null check (amount > 0),
  note text,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.payroll_inputs(run_id, employee_id);

create table public.payroll_slips(
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  nrp text not null,
  full_name text not null,
  department_id uuid not null references public.departments(id),
  position_name text,
  ptkp_status text not null,
  ter_category text not null,
  bank_name text,
  bank_account text,
  bank_holder text,
  npwp text,
  days_period int not null,
  days_employed int not null,
  days_present int not null default 0,
  days_absent int not null default 0,
  days_unpaid int not null default 0,
  nights int not null default 0,
  late_minutes int not null default 0,
  overtime_hours numeric(6,2) not null default 0,
  fixed_wage numeric(14,0) not null default 0,
  earnings numeric(15,0) not null default 0,
  deductions numeric(15,0) not null default 0,
  bpjs_ee numeric(14,0) not null default 0,
  bpjs_er numeric(14,0) not null default 0,
  pension_ee numeric(14,0) not null default 0,
  gross_tax numeric(15,0) not null default 0,
  ter_rate numeric(5,2),
  pph21 numeric(15,0) not null default 0,
  annualized boolean not null default false,
  net numeric(15,0) not null default 0,
  warnings text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (run_id, employee_id)
);
create index on public.payroll_slips(employee_id);

create table public.payroll_lines(
  id uuid primary key default gen_random_uuid(),
  slip_id uuid not null references public.payroll_slips(id) on delete cascade,
  section text not null check (section in ('earning','deduction','employer','info')),
  code text not null,
  label text not null,
  qty numeric(10,2),
  rate numeric(15,2),
  amount numeric(15,0) not null,
  sort_order int not null default 0
);
create index on public.payroll_lines(slip_id);

-- Hasil sistem lama untuk uji paralel
create table public.payroll_legacy(
  run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  gross numeric(15,0),
  pph21 numeric(15,0),
  net numeric(15,0) not null,
  note text,
  primary key (run_id, employee_id)
);

create or replace function app.is_payroll() returns boolean language sql stable security definer set search_path = public as $$
  select app.has_permission_anywhere('payroll.read') or app.has_permission_anywhere('payroll.manage')
$$;

do $$
declare t text;
begin
  foreach t in array array['employee_pay','payroll_ytd_opening','payroll_runs'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['pph21_ter','pay_components','employee_pay','payroll_ytd_opening','payroll_runs','payroll_inputs','payroll_slips','payroll_lines','payroll_legacy'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
  -- slip & baris dibuat ulang tiap hitung: audit di tingkat proses (payroll_runs), bukan per baris
  foreach t in array array['pay_components','employee_pay','payroll_ytd_opening','payroll_runs','payroll_inputs','payroll_legacy'] loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
  end loop;
end $$;

create policy pph21_ter_read on public.pph21_ter for select to authenticated using (app.is_active_user());
create policy pay_components_read on public.pay_components for select to authenticated using (app.is_active_user());
create policy employee_pay_read on public.employee_pay for select to authenticated using (app.is_payroll());
create policy payroll_ytd_read on public.payroll_ytd_opening for select to authenticated using (app.is_payroll());
create policy payroll_runs_read on public.payroll_runs for select to authenticated using (app.is_payroll() or (status = 'published' and not parallel));
create policy payroll_inputs_read on public.payroll_inputs for select to authenticated using (app.is_payroll());
create policy payroll_legacy_read on public.payroll_legacy for select to authenticated using (app.is_payroll());
create policy payroll_slips_read on public.payroll_slips for select to authenticated using (
  app.is_payroll() or (employee_id = app.my_employee()
    and exists(select 1 from public.payroll_runs r where r.id = run_id and r.status = 'published' and not r.parallel)));
create policy payroll_lines_read on public.payroll_lines for select to authenticated using (
  exists(select 1 from public.payroll_slips s where s.id = slip_id));

-- ---------------------------------------------------------------- pembantu perhitungan
create or replace function app.require_payroll(p_perm text) returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not app.has_permission_anywhere(p_perm) then raise exception 'Tidak berwenang (perlu izin %)', p_perm using errcode = '42501'; end if;
end $$;

create or replace function app.ter_category(p_ptkp text) returns text language sql immutable as $$
  select case when p_ptkp in ('TK/0','TK/1','K/0') then 'A' when p_ptkp in ('TK/2','TK/3','K/1','K/2') then 'B' when p_ptkp = 'K/3' then 'C' else 'A' end
$$;

create or replace function app.ter_rate(p_category text, p_gross numeric) returns numeric language sql stable set search_path = public as $$
  select rate from public.pph21_ter where category = p_category and (upper_limit is null or p_gross <= upper_limit) order by upper_limit nulls last limit 1
$$;

-- PTKP setahun (UU HPP): 54 jt + 4,5 jt kawin + 4,5 jt per tanggungan (maks 3)
create or replace function app.ptkp_amount(p_ptkp text) returns numeric language sql immutable as $$
  select 54000000 + case when p_ptkp like 'K/%' then 4500000 else 0 end
       + 4500000 * least(3, coalesce(nullif(split_part(coalesce(p_ptkp, 'TK/0'), '/', 2), '')::int, 0))
$$;

-- Tarif Pasal 17 ayat (1) huruf a UU HPP
create or replace function app.pph17(p_pkp numeric) returns numeric language sql immutable as $$
  select floor(0.05 * least(p_pkp, 60000000)
       + 0.15 * greatest(0, least(p_pkp, 250000000) - 60000000)
       + 0.25 * greatest(0, least(p_pkp, 500000000) - 250000000)
       + 0.30 * greatest(0, least(p_pkp, 5000000000) - 500000000)
       + 0.35 * greatest(0, p_pkp - 5000000000))
$$;

-- Jam lembur setara (PP 35/2021 Pasal 31): hari kerja jam-1 x1,5 berikutnya x2; hari istirahat/libur
-- pola 6 hari: jam 1-7 x2, jam 8 x3, jam 9-11 x4; pola 5 hari: jam 1-8 x2, jam 9 x3, jam 10-11 x4
create or replace function app.ot_equivalent(p_hours numeric, p_day_type text, p_week_days int) returns numeric language sql immutable as $$
  select case when p_day_type = 'workday' then 1.5 * least(p_hours, 1) + 2 * greatest(0, p_hours - 1)
    else 2 * least(p_hours, case when p_week_days = 5 then 8 else 7 end)
       + 3 * greatest(0, least(p_hours, case when p_week_days = 5 then 9 else 8 end) - case when p_week_days = 5 then 8 else 7 end)
       + 4 * greatest(0, p_hours - case when p_week_days = 5 then 9 else 8 end) end
$$;

create or replace function app.pay_amount(p_employee uuid, p_component text, p_date date) returns numeric
language sql stable security definer set search_path = public as $$
  select amount from public.employee_pay where employee_id = p_employee and component_code = p_component and effective_from <= p_date
   order by effective_from desc limit 1
$$;

-- ---------------------------------------------------------------- struktur gaji
create or replace function public.pay_component_save(p_code text, p_name text, p_kind text, p_category text, p_calc text,
  p_taxable boolean default true, p_active boolean default true, p_sort int default 0)
returns public.pay_components language plpgsql security definer set search_path = public as $$
declare v public.pay_components;
begin
  perform app.require_payroll('payroll.manage');
  insert into public.pay_components(code, name, kind, category, calc, taxable, active, sort_order)
  values (upper(btrim(p_code)), app.require_text(p_name, 'Nama komponen'), p_kind, p_category, p_calc, coalesce(p_taxable, true), coalesce(p_active, true), coalesce(p_sort, 0))
  on conflict (code) do update set name = excluded.name, kind = excluded.kind, category = excluded.category, calc = excluded.calc,
    taxable = excluded.taxable, active = excluded.active, sort_order = excluded.sort_order
  returning * into v;
  return v;
end $$;

create or replace function public.employee_pay_set(p_employee uuid, p_component text, p_amount numeric, p_effective date, p_note text default null)
returns public.employee_pay language plpgsql security definer set search_path = public as $$
declare v public.employee_pay;
begin
  perform app.require_payroll('payroll.manage');
  if p_effective is null then raise exception 'Tanggal berlaku wajib diisi' using errcode = '22023'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Nilai tidak valid' using errcode = '22023'; end if;
  if not exists(select 1 from public.pay_components where code = p_component and calc <> 'manual') then
    raise exception 'Komponen % tidak dikenal atau diisi per proses gaji', p_component using errcode = '22023';
  end if;
  if (select employment_type from public.employees where id = p_employee) = 'subcon' then
    raise exception 'Karyawan subkontraktor digaji oleh perusahaannya' using errcode = '22023';
  end if;
  insert into public.employee_pay(employee_id, component_code, amount, effective_from, note)
  values (p_employee, p_component, round(p_amount), p_effective, p_note)
  on conflict (employee_id, component_code, effective_from) do update set amount = excluded.amount, note = excluded.note
  returning * into v;
  return v;
end $$;

create or replace function public.payroll_ytd_set(p_employee uuid, p_year int, p_gross numeric, p_pph21 numeric, p_pension numeric, p_months int, p_note text default null)
returns public.payroll_ytd_opening language plpgsql security definer set search_path = public as $$
declare v public.payroll_ytd_opening;
begin
  perform app.require_payroll('payroll.manage');
  insert into public.payroll_ytd_opening(employee_id, year, gross, pph21, pension_ee, months, note)
  values (p_employee, p_year, coalesce(p_gross, 0), coalesce(p_pph21, 0), coalesce(p_pension, 0), coalesce(p_months, 0), p_note)
  on conflict (employee_id, year) do update set gross = excluded.gross, pph21 = excluded.pph21, pension_ee = excluded.pension_ee,
    months = excluded.months, note = excluded.note, updated_by = auth.uid()
  returning * into v;
  return v;
end $$;

-- Pengaturan payroll & BPJS (tarif berubah karena regulasi, mis. batas upah JP tiap Maret)
create or replace function public.payroll_setting_set(p_key text, p_value numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require_payroll('payroll.manage');
  if p_key not in ('payroll_cutoff_day','payroll_daily_divisor','payroll_overtime_week_days','bpjs_jht_er','bpjs_jht_ee','bpjs_jp_er','bpjs_jp_ee',
                   'bpjs_jp_cap','bpjs_jkk_er','bpjs_jkm_er','bpjs_kes_er','bpjs_kes_ee','bpjs_kes_cap') then
    raise exception 'Pengaturan % tidak bisa diubah di sini', p_key using errcode = '22023';
  end if;
  if p_value is null or p_value < 0 then raise exception 'Nilai tidak valid' using errcode = '22023'; end if;
  if p_key = 'payroll_cutoff_day' and p_value > 28 then raise exception 'Tanggal tutup maksimal 28 (0 = bulan kalender)' using errcode = '22023'; end if;
  if p_key = 'payroll_overtime_week_days' and p_value not in (5, 6) then raise exception 'Pola hari kerja 5 atau 6' using errcode = '22023'; end if;
  update public.app_settings set value = to_jsonb(p_value) where key = p_key;
end $$;

-- ---------------------------------------------------------------- proses gaji
create or replace function public.payroll_run_create(p_period text, p_kind text, p_pay_date date, p_parallel boolean default false, p_note text default null)
returns public.payroll_runs language plpgsql security definer set search_path = public as $$
declare
  v public.payroll_runs;
  v_cut int := app.setting_num('payroll_cutoff_day', 20)::int;
  v_month date;
  v_reg public.registrations;
begin
  perform app.require_payroll('payroll.manage');
  if p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Periode harus YYYY-MM' using errcode = '22023'; end if;
  if p_kind not in ('regular','thr') then raise exception 'Jenis proses tidak dikenal' using errcode = '22023'; end if;
  if exists(select 1 from public.payroll_runs where period = p_period and kind = p_kind and parallel = coalesce(p_parallel, false) and status <> 'cancelled') then
    raise exception 'Proses % periode % sudah ada', case p_kind when 'thr' then 'THR' else 'gaji' end, p_period using errcode = '22023';
  end if;
  v_month := (p_period || '-01')::date;
  v_reg := app.allocate_number('PAY', jsonb_build_object('date', v_month), null);
  insert into public.payroll_runs(run_no, period, kind, att_from, att_to, pay_date, parallel, note)
  values (v_reg.number, p_period, p_kind,
          case when v_cut between 1 and 28 then (v_month - interval '1 month')::date + v_cut else v_month end,
          case when v_cut between 1 and 28 then v_month + v_cut - 1 else (v_month + interval '1 month')::date - 1 end,
          coalesce(p_pay_date, (v_month + interval '1 month')::date - 1), coalesce(p_parallel, false), p_note)
  returning * into v;
  update public.registrations set ref_table = 'payroll_runs', ref_id = v.id where id = v_reg.id;
  return v;
end $$;

create or replace function public.payroll_input_add(p_run uuid, p_employee uuid, p_component text, p_amount numeric, p_note text default null)
returns public.payroll_inputs language plpgsql security definer set search_path = public as $$
declare v public.payroll_inputs;
begin
  perform app.require_payroll('payroll.manage');
  if not exists(select 1 from public.payroll_runs where id = p_run and status in ('draft','calculated')) then
    raise exception 'Input hanya untuk proses yang belum disetujui' using errcode = '22023';
  end if;
  if not exists(select 1 from public.pay_components where code = p_component and calc = 'manual' and active) then
    raise exception 'Komponen % bukan komponen input per proses', p_component using errcode = '22023';
  end if;
  insert into public.payroll_inputs(run_id, employee_id, component_code, amount, note)
  values (p_run, p_employee, p_component, round(p_amount), p_note) returning * into v;
  update public.payroll_runs set status = 'draft' where id = p_run and status = 'calculated';
  return v;
end $$;

create or replace function public.payroll_input_delete(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_run uuid;
begin
  perform app.require_payroll('payroll.manage');
  delete from public.payroll_inputs i using public.payroll_runs r
   where i.id = p_id and r.id = i.run_id and r.status in ('draft','calculated') returning i.run_id into v_run;
  if v_run is null then raise exception 'Input tidak ditemukan atau proses sudah disetujui' using errcode = '22023'; end if;
  update public.payroll_runs set status = 'draft' where id = v_run and status = 'calculated';
end $$;

-- Hitung satu karyawan (dipanggil payroll_calculate)
create or replace function app.payroll_calc_employee(p_run public.payroll_runs, p_emp uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  e record;
  pv record;
  c record;
  v_slip uuid;
  v_ptkp text;
  v_cat text;
  v_warn text[] := '{}';
  v_days int := p_run.att_to - p_run.att_from + 1;
  v_from date;
  v_to date;
  v_employed int;
  v_factor numeric;
  v_fixed_full numeric := 0;
  v_fixed numeric := 0;
  v_present int := 0;
  v_absent int := 0;
  v_unpaid int := 0;
  v_nights int := 0;
  v_late int := 0;
  v_has_att boolean;
  v_amt numeric;
  v_earn numeric := 0;
  v_taxable numeric := 0;
  v_ded numeric := 0;
  v_ot_hours numeric := 0;
  v_ot_eq numeric := 0;
  v_week int := app.setting_num('payroll_overtime_week_days', 6)::int;
  v_base numeric;
  v_jht_ee numeric := 0; v_jp_ee numeric := 0; v_kes_ee numeric := 0;
  v_jht_er numeric := 0; v_jp_er numeric := 0; v_jkk numeric := 0; v_jkm numeric := 0; v_kes_er numeric := 0;
  v_gross numeric;
  v_rate numeric;
  v_pph numeric := 0;
  v_year int := left(p_run.period, 4)::int;
  v_final boolean;
  v_y_gross numeric; v_y_pph numeric; v_y_pension numeric; v_y_months int;
  v_bj numeric; v_neto numeric; v_pkp numeric;
  v_months int;
  v_sort int := 0;
begin
  select em.*, p.level as position_level, p.name as position_name_ from public.employees em left join public.positions p on p.id = em.position_id
   where em.id = p_emp into e;
  select ptkp_status, bank_name, bank_account, bank_holder, npwp into pv from public.employee_private where employee_id = p_emp;
  v_ptkp := coalesce(pv.ptkp_status, 'TK/0');
  if pv.ptkp_status is null then v_warn := array_append(v_warn, 'Status PTKP kosong, dipakai TK/0'); end if;
  if pv.bank_account is null and p_run.kind = 'regular' then v_warn := array_append(v_warn, 'No. rekening kosong'); end if;
  v_cat := app.ter_category(v_ptkp);
  v_from := greatest(p_run.att_from, coalesce(e.join_date, p_run.att_from));
  v_to := least(p_run.att_to, coalesce(e.exit_date, p_run.att_to));
  v_employed := greatest(0, v_to - v_from + 1);
  v_factor := v_employed::numeric / v_days;
  -- akhir masa kerja dalam periode = masa pajak terakhir karyawan itu
  v_final := right(p_run.period, 2) = '12' or (e.exit_date is not null and e.exit_date <= p_run.att_to);

  insert into public.payroll_slips(run_id, employee_id, nrp, full_name, department_id, position_name, ptkp_status, ter_category,
    bank_name, bank_account, bank_holder, npwp, days_period, days_employed)
  values (p_run.id, p_emp, e.nrp, e.full_name, e.department_id, e.position_name_, v_ptkp, v_cat,
    pv.bank_name, pv.bank_account, pv.bank_holder, pv.npwp, v_days, v_employed)
  returning id into v_slip;

  -- upah tetap (gaji pokok + tunjangan tetap) per tanggal akhir periode
  select coalesce(sum(app.pay_amount(p_emp, pc.code, p_run.att_to)), 0) into v_fixed_full
    from public.pay_components pc where pc.category in ('basic','fixed_allowance') and pc.active;
  if v_fixed_full = 0 then v_warn := array_append(v_warn, 'Struktur gaji belum diisi'); end if;

  if p_run.kind = 'regular' then
    select count(*) filter (where status in ('hadir','terlambat','masuk_off')), count(*) filter (where status = 'alpa'),
           count(*) filter (where status = 'izin'),
           count(*) filter (where roster_code = 'N' and status in ('hadir','terlambat')), coalesce(sum(late_minutes), 0), count(*) > 0
      into v_present, v_absent, v_unpaid, v_nights, v_late, v_has_att
      from public.attendance_daily where employee_id = p_emp and work_date between v_from and v_to;
    if not v_has_att then v_warn := array_append(v_warn, 'Tidak ada roster/absensi pada periode ini'); end if;

    for c in select * from public.pay_components where active and kind = 'earning' and calc <> 'manual' order by sort_order loop
      v_amt := app.pay_amount(p_emp, c.code, p_run.att_to);
      continue when v_amt is null or v_amt = 0;
      v_sort := v_sort + 1;
      if c.calc = 'fixed' then
        insert into public.payroll_lines(slip_id, section, code, label, qty, rate, amount, sort_order)
        values (v_slip, 'earning', c.code, c.name || case when v_factor < 1 then ' (proporsional)' else '' end,
                case when v_factor < 1 then v_employed end, case when v_factor < 1 then v_amt end, round(v_amt * v_factor), v_sort);
        v_amt := round(v_amt * v_factor);
        v_fixed := v_fixed + v_amt;
      elsif c.calc = 'per_present_day' then
        continue when v_present = 0;
        insert into public.payroll_lines(slip_id, section, code, label, qty, rate, amount, sort_order)
        values (v_slip, 'earning', c.code, c.name, v_present, v_amt, v_amt * v_present, v_sort);
        v_amt := v_amt * v_present;
      else
        continue when v_nights = 0;
        insert into public.payroll_lines(slip_id, section, code, label, qty, rate, amount, sort_order)
        values (v_slip, 'earning', c.code, c.name, v_nights, v_amt, v_amt * v_nights, v_sort);
        v_amt := v_amt * v_nights;
      end if;
      v_earn := v_earn + v_amt;
      if c.taxable then v_taxable := v_taxable + v_amt; end if;
    end loop;

    -- lembur dari SPL yang disetujui: jam = jam SPL, dibatasi jam aktual bila ada absensi
    if e.position_level is not null and coalesce((select value from public.app_settings where key = 'payroll_overtime_excluded_levels'), '[]'::jsonb) ? e.position_level then
      if exists(select 1 from public.overtime_requests where employee_id = p_emp and status = 'approved' and work_date between v_from and v_to) then
        v_warn := array_append(v_warn, 'SPL tidak dibayar: jabatan manajerial tidak mendapat upah lembur');
      end if;
    else
      select coalesce(sum(h), 0), coalesce(sum(app.ot_equivalent(h, day_type, v_week)), 0) into v_ot_hours, v_ot_eq
        from (select o.day_type, least(o.hours, coalesce(r.actual_hours, o.hours)) h
                from public.overtime_requests o left join public.overtime_register r on r.id = o.id
               where o.employee_id = p_emp and o.status = 'approved' and o.work_date between v_from and v_to) x;
      if v_ot_hours > 0 and v_fixed_full > 0 then
        v_amt := round(v_ot_eq * v_fixed_full / 173);
        v_sort := v_sort + 1;
        insert into public.payroll_lines(slip_id, section, code, label, qty, rate, amount, sort_order)
        values (v_slip, 'earning', 'LEMBUR', 'Upah lembur (' || v_ot_hours || ' jam = ' || v_ot_eq || ' jam setara)', v_ot_eq, round(v_fixed_full / 173, 2), v_amt, v_sort);
        v_earn := v_earn + v_amt; v_taxable := v_taxable + v_amt;
      end if;
    end if;

    -- potongan alpa & izin tidak dibayar mengurangi upah (dan penghasilan bruto)
    if v_absent + v_unpaid > 0 and v_fixed > 0 then
      v_amt := least(v_fixed, round(v_fixed_full / app.setting_num('payroll_daily_divisor', 25) * (v_absent + v_unpaid)));
      v_sort := v_sort + 1;
      insert into public.payroll_lines(slip_id, section, code, label, qty, rate, amount, sort_order)
      values (v_slip, 'earning', 'POTABS', 'Potongan alpa / izin tidak dibayar', v_absent + v_unpaid,
              round(v_fixed_full / app.setting_num('payroll_daily_divisor', 25)), -v_amt, v_sort);
      v_earn := v_earn - v_amt; v_taxable := v_taxable - v_amt;
    end if;
  else
    -- THR (Permenaker 6/2016): masa kerja >= 12 bulan 1 bulan upah; >= 1 bulan proporsional
    v_months := case when e.join_date is null then 12
                     else (extract(year from age(p_run.pay_date, e.join_date)) * 12 + extract(month from age(p_run.pay_date, e.join_date)))::int end;
    if v_months >= 1 and v_fixed_full > 0 then
      v_amt := case when v_months >= 12 then v_fixed_full else round(v_fixed_full * v_months / 12) end;
      v_sort := v_sort + 1;
      insert into public.payroll_lines(slip_id, section, code, label, qty, rate, amount, sort_order)
      values (v_slip, 'earning', 'THR', 'Tunjangan hari raya' || case when v_months < 12 then ' (' || v_months || '/12 bulan)' else '' end,
              least(v_months, 12), v_fixed_full, v_amt, v_sort);
      v_earn := v_earn + v_amt; v_taxable := v_taxable + v_amt;
    else
      v_warn := array_append(v_warn, 'Masa kerja kurang dari 1 bulan: tidak berhak THR');
    end if;
  end if;

  -- input per proses (insentif, rapel, kasbon, potongan lain)
  for c in select pc.code, pc.name, pc.kind, pc.taxable, sum(i.amount) amount, string_agg(i.note, '; ') note
             from public.payroll_inputs i join public.pay_components pc on pc.code = i.component_code
            where i.run_id = p_run.id and i.employee_id = p_emp group by pc.code, pc.name, pc.kind, pc.taxable, pc.sort_order order by pc.sort_order loop
    v_sort := v_sort + 1;
    insert into public.payroll_lines(slip_id, section, code, label, amount, sort_order)
    values (v_slip, case when c.kind = 'earning' then 'earning' else 'deduction' end, c.code, c.name || coalesce(' · ' || c.note, ''), c.amount, v_sort);
    if c.kind = 'earning' then
      v_earn := v_earn + c.amount;
      if c.taxable then v_taxable := v_taxable + c.amount; end if;
    else v_ded := v_ded + c.amount; end if;
  end loop;

  -- BPJS dari upah tetap sebulan (bukan THR)
  if p_run.kind = 'regular' and v_fixed_full > 0 then
    v_base := v_fixed_full;
    v_jht_ee := round(v_base * app.setting_num('bpjs_jht_ee', 2) / 100);
    v_jp_ee := round(least(v_base, app.setting_num('bpjs_jp_cap', 11086300)) * app.setting_num('bpjs_jp_ee', 1) / 100);
    v_kes_ee := round(least(v_base, app.setting_num('bpjs_kes_cap', 12000000)) * app.setting_num('bpjs_kes_ee', 1) / 100);
    v_jht_er := round(v_base * app.setting_num('bpjs_jht_er', 3.7) / 100);
    v_jp_er := round(least(v_base, app.setting_num('bpjs_jp_cap', 11086300)) * app.setting_num('bpjs_jp_er', 2) / 100);
    v_jkk := round(v_base * app.setting_num('bpjs_jkk_er', 1.27) / 100);
    v_jkm := round(v_base * app.setting_num('bpjs_jkm_er', 0.3) / 100);
    v_kes_er := round(least(v_base, app.setting_num('bpjs_kes_cap', 12000000)) * app.setting_num('bpjs_kes_er', 4) / 100);
    insert into public.payroll_lines(slip_id, section, code, label, rate, amount, sort_order) values
      (v_slip, 'deduction', 'JHT_EE', 'BPJS TK · JHT 2%', v_base, v_jht_ee, 80),
      (v_slip, 'deduction', 'JP_EE', 'BPJS TK · Jaminan Pensiun 1%', least(v_base, app.setting_num('bpjs_jp_cap', 11086300)), v_jp_ee, 81),
      (v_slip, 'deduction', 'KES_EE', 'BPJS Kesehatan 1%', least(v_base, app.setting_num('bpjs_kes_cap', 12000000)), v_kes_ee, 82),
      (v_slip, 'employer', 'JHT_ER', 'JHT ditanggung perusahaan', v_base, v_jht_er, 90),
      (v_slip, 'employer', 'JP_ER', 'JP ditanggung perusahaan', null, v_jp_er, 91),
      (v_slip, 'employer', 'JKK_ER', 'JKK ditanggung perusahaan', null, v_jkk, 92),
      (v_slip, 'employer', 'JKM_ER', 'JKM ditanggung perusahaan', null, v_jkm, 93),
      (v_slip, 'employer', 'KES_ER', 'BPJS Kesehatan ditanggung perusahaan', null, v_kes_er, 94);
  end if;

  -- PPh 21: penghasilan bruto = penghasilan kena pajak + premi JKK, JKM, BPJS Kesehatan dari perusahaan
  v_gross := greatest(0, v_taxable) + v_jkk + v_jkm + v_kes_er;
  if v_final then
    select coalesce(sum(s.gross_tax), 0) + coalesce(max(o.gross), 0), coalesce(sum(s.pph21), 0) + coalesce(max(o.pph21), 0),
           coalesce(sum(s.pension_ee), 0) + coalesce(max(o.pension_ee), 0),
           count(distinct r.period) filter (where r.kind = 'regular') + coalesce(max(o.months), 0)
      into v_y_gross, v_y_pph, v_y_pension, v_y_months
      from (select 1) d
      left join public.payroll_slips s on s.employee_id = p_emp and s.run_id <> p_run.id
        and s.run_id in (select id from public.payroll_runs where left(period, 4)::int = v_year and status in ('calculated','approved','published') and not parallel)
      left join public.payroll_runs r on r.id = s.run_id
      left join public.payroll_ytd_opening o on o.employee_id = p_emp and o.year = v_year;
    if p_run.parallel then
      -- uji paralel: riwayat tahun berjalan dari saldo awal saja (proses paralel lain tidak dihitung)
      select coalesce(max(gross), 0), coalesce(max(pph21), 0), coalesce(max(pension_ee), 0), coalesce(max(months), 0)
        into v_y_gross, v_y_pph, v_y_pension, v_y_months from public.payroll_ytd_opening where employee_id = p_emp and year = v_year;
    end if;
    v_y_gross := v_y_gross + v_gross;
    v_y_pension := v_y_pension + v_jht_ee + v_jp_ee;
    v_y_months := v_y_months + case when p_run.kind = 'regular' then 1 else 0 end;
    v_bj := least(round(v_y_gross * 0.05), 500000 * greatest(1, v_y_months));
    v_neto := v_y_gross - v_bj - v_y_pension;
    v_pkp := floor(greatest(0, v_neto - app.ptkp_amount(v_ptkp)) / 1000) * 1000;
    v_pph := app.pph17(v_pkp) - v_y_pph;
    v_rate := null;
    insert into public.payroll_lines(slip_id, section, code, label, amount, sort_order) values
      (v_slip, 'info', 'Y_GROSS', 'Bruto setahun', v_y_gross, 100),
      (v_slip, 'info', 'Y_BJ', 'Biaya jabatan', v_bj, 101),
      (v_slip, 'info', 'Y_PENSION', 'Iuran JHT + JP karyawan setahun', v_y_pension, 102),
      (v_slip, 'info', 'Y_PTKP', 'PTKP ' || v_ptkp, app.ptkp_amount(v_ptkp), 103),
      (v_slip, 'info', 'Y_PKP', 'Penghasilan kena pajak', v_pkp, 104),
      (v_slip, 'info', 'Y_PPH', 'PPh 21 setahun (Pasal 17)', app.pph17(v_pkp), 105),
      (v_slip, 'info', 'Y_PAID', 'PPh 21 sudah dipotong Jan–Nov', v_y_pph, 106);
  else
    -- TER atas seluruh bruto bulan ini (gabungan dengan proses lain di periode yang sama, mis. gaji + THR)
    select coalesce(sum(s.gross_tax), 0), coalesce(sum(s.pph21), 0) into v_y_gross, v_y_pph
      from public.payroll_slips s join public.payroll_runs r on r.id = s.run_id
     where s.employee_id = p_emp and r.period = p_run.period and r.id <> p_run.id and r.parallel = p_run.parallel
       and r.status in ('calculated','approved','published');
    v_rate := app.ter_rate(v_cat, v_gross + v_y_gross);
    v_pph := floor((v_gross + v_y_gross) * v_rate / 100) - v_y_pph;
  end if;
  if v_pph <> 0 then
    insert into public.payroll_lines(slip_id, section, code, label, rate, amount, sort_order)
    values (v_slip, 'deduction', 'PPH21', case when v_pph < 0 then 'Pengembalian kelebihan PPh 21' when v_final then 'PPh 21 (perhitungan setahun)'
                                              else 'PPh 21 · TER ' || v_cat || ' ' || v_rate || '%' end, v_rate, v_pph, 85);
  end if;

  update public.payroll_slips set days_present = v_present, days_absent = v_absent, days_unpaid = v_unpaid, nights = v_nights, late_minutes = v_late,
    overtime_hours = v_ot_hours, fixed_wage = v_fixed_full, earnings = v_earn, deductions = v_ded + v_jht_ee + v_jp_ee + v_kes_ee + v_pph,
    bpjs_ee = v_jht_ee + v_jp_ee + v_kes_ee, bpjs_er = v_jht_er + v_jp_er + v_jkk + v_jkm + v_kes_er, pension_ee = v_jht_ee + v_jp_ee,
    gross_tax = v_gross, ter_rate = v_rate, pph21 = v_pph, annualized = v_final,
    net = v_earn - v_ded - v_jht_ee - v_jp_ee - v_kes_ee - v_pph,
    warnings = v_warn || case when v_earn - v_ded - v_jht_ee - v_jp_ee - v_kes_ee - v_pph < 0 then array['Gaji bersih minus'] else '{}' end
   where id = v_slip;
end $$;
revoke all on function app.payroll_calc_employee(public.payroll_runs, uuid) from public, anon, authenticated;

create or replace function public.payroll_calculate(p_run uuid) returns public.payroll_runs
language plpgsql security definer set search_path = public as $$
declare
  v public.payroll_runs;
  e record;
begin
  perform app.require_payroll('payroll.manage');
  select * into v from public.payroll_runs where id = p_run for update;
  if not found then raise exception 'Proses gaji tidak ditemukan' using errcode = 'P0002'; end if;
  if v.status not in ('draft','calculated') then raise exception 'Proses yang sudah disetujui tidak bisa dihitung ulang; buka kembali dulu' using errcode = '22023'; end if;
  delete from public.payroll_slips where run_id = p_run;
  -- karyawan BSB (bukan subkon) yang bekerja di periode ini dan punya struktur gaji atau input
  for e in select em.id from public.employees em
            where em.employment_type <> 'subcon'
              and coalesce(em.join_date, v.att_from) <= v.att_to
              and (em.exit_date is null or em.exit_date >= v.att_from)
              and (exists(select 1 from public.employee_pay p where p.employee_id = em.id and p.effective_from <= v.att_to)
                   or exists(select 1 from public.payroll_inputs i where i.run_id = p_run and i.employee_id = em.id))
            order by em.nrp loop
    perform app.payroll_calc_employee(v, e.id);
  end loop;
  update public.payroll_runs set status = 'calculated', calculated_by = auth.uid(), calculated_at = now(), approved_by = null, approved_at = null
   where id = p_run returning * into v;
  return v;
end $$;

create or replace function public.payroll_approve(p_run uuid, p_note text default null) returns public.payroll_runs
language plpgsql security definer set search_path = public as $$
declare v public.payroll_runs;
begin
  perform app.require_payroll('payroll.approve');
  select * into v from public.payroll_runs where id = p_run for update;
  if not found then raise exception 'Proses gaji tidak ditemukan' using errcode = 'P0002'; end if;
  if v.status <> 'calculated' then raise exception 'Hanya proses yang sudah dihitung yang bisa disetujui' using errcode = '22023'; end if;
  if v.calculated_by = auth.uid() then raise exception 'Penghitung gaji tidak boleh menyetujui hasilnya sendiri' using errcode = '42501'; end if;
  update public.payroll_runs set status = 'approved', approved_by = auth.uid(), approved_at = now(), note = coalesce(p_note, note)
   where id = p_run returning * into v;
  perform app.notify_users(array[v.calculated_by], 'payroll', 'Gaji ' || v.run_no || ' disetujui', 'Siap diterbitkan', '/hrga/payroll/' || v.id);
  return v;
end $$;

create or replace function public.payroll_reopen(p_run uuid, p_reason text) returns public.payroll_runs
language plpgsql security definer set search_path = public as $$
declare v public.payroll_runs;
begin
  perform app.require_payroll('payroll.manage');
  update public.payroll_runs set status = 'draft', approved_by = null, approved_at = null,
    note = concat_ws(' · ', note, 'Dibuka ulang: ' || app.require_text(p_reason, 'Alasan'))
   where id = p_run and status in ('calculated','approved') returning * into v;
  if not found then raise exception 'Hanya proses yang belum diterbitkan yang bisa dibuka ulang' using errcode = '22023'; end if;
  return v;
end $$;

create or replace function public.payroll_publish(p_run uuid) returns public.payroll_runs
language plpgsql security definer set search_path = public as $$
declare v public.payroll_runs;
begin
  perform app.require_payroll('payroll.manage');
  select * into v from public.payroll_runs where id = p_run for update;
  if not found then raise exception 'Proses gaji tidak ditemukan' using errcode = 'P0002'; end if;
  if v.status <> 'approved' then raise exception 'Terbitkan setelah disetujui' using errcode = '22023'; end if;
  if v.parallel then raise exception 'Proses uji paralel tidak diterbitkan ke karyawan' using errcode = '22023'; end if;
  update public.payroll_runs set status = 'published', published_by = auth.uid(), published_at = now() where id = p_run returning * into v;
  perform app.notify_users(array(select em.profile_id from public.payroll_slips s join public.employees em on em.id = s.employee_id where s.run_id = p_run),
    'payroll', case v.kind when 'thr' then 'Slip THR ' else 'Slip gaji ' end || v.period || ' tersedia', 'Lihat di menu Saya → Slip gaji', '/saya?tab=slip');
  return v;
end $$;

create or replace function public.payroll_cancel(p_run uuid, p_reason text) returns public.payroll_runs
language plpgsql security definer set search_path = public as $$
declare v public.payroll_runs;
begin
  perform app.require_payroll('payroll.manage');
  update public.payroll_runs set status = 'cancelled', note = concat_ws(' · ', note, 'Dibatalkan: ' || app.require_text(p_reason, 'Alasan'))
   where id = p_run and status in ('draft','calculated') returning * into v;
  if not found then raise exception 'Hanya proses yang belum disetujui yang bisa dibatalkan' using errcode = '22023'; end if;
  return v;
end $$;

-- ---------------------------------------------------------------- tampilan
create view public.payroll_slip_register with (security_invoker = true) as
select s.id, s.run_id, r.run_no, r.period, r.kind, r.status as run_status, r.parallel, r.pay_date, s.employee_id, s.nrp, s.full_name,
       d.code as department_code, s.position_name, s.ptkp_status, s.ter_category, s.days_present, s.days_absent, s.days_unpaid, s.nights,
       s.overtime_hours, s.fixed_wage, s.earnings, s.deductions, s.bpjs_ee, s.bpjs_er, s.gross_tax, s.ter_rate, s.pph21, s.annualized, s.net,
       s.earnings + s.bpjs_er as employer_cost, s.bank_name, s.bank_account, s.bank_holder, s.warnings,
       l.net as legacy_net, l.pph21 as legacy_pph21, s.net - l.net as diff_net, s.pph21 - l.pph21 as diff_pph21
  from public.payroll_slips s
  join public.payroll_runs r on r.id = s.run_id
  join public.departments d on d.id = s.department_id
  left join public.payroll_legacy l on l.run_id = s.run_id and l.employee_id = s.employee_id;

create view public.payroll_cost_recap with (security_invoker = true) as
select r.id as run_id, r.run_no, r.period, r.kind, d.code as department_code, d.name as department_name, count(*)::int as headcount,
       sum(s.earnings) as earnings, sum(s.bpjs_er) as bpjs_er, sum(s.bpjs_ee) as bpjs_ee, sum(s.pph21) as pph21, sum(s.net) as net,
       sum(s.earnings + s.bpjs_er) as employer_cost, sum(s.overtime_hours) as overtime_hours
  from public.payroll_slips s
  join public.payroll_runs r on r.id = s.run_id
  join public.departments d on d.id = s.department_id
 group by r.id, r.run_no, r.period, r.kind, d.code, d.name;

create view public.employee_pay_current with (security_invoker = true) as
select e.id as employee_id, e.nrp, e.full_name, d.code as department_code, e.employment_type,
       jsonb_object_agg(p.component_code, p.amount) filter (where p.component_code is not null) as amounts,
       coalesce(sum(p.amount) filter (where c.category in ('basic','fixed_allowance')), 0) as fixed_wage,
       max(p.effective_from) as last_change
  from public.employees e
  join public.departments d on d.id = e.department_id
  left join lateral (select distinct on (component_code) component_code, amount, effective_from from public.employee_pay
                      where employee_id = e.id and effective_from <= app.site_today() order by component_code, effective_from desc) p on true
  left join public.pay_components c on c.code = p.component_code
 where e.status = 'active' and e.employment_type <> 'subcon' and app.is_payroll()
 group by e.id, e.nrp, e.full_name, d.code, e.employment_type;

do $$
declare v text;
begin
  foreach v in array array['payroll_slip_register','payroll_cost_recap','employee_pay_current'] loop
    execute format('grant select on public.%I to authenticated', v);
    execute format('revoke all on public.%I from anon', v);
  end loop;
end $$;

-- ---------------------------------------------------------------- impor: struktur gaji, input per proses, saldo pajak, hasil sistem lama
create or replace function app.payroll_run_for(p_period text, p_parallel boolean default null) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.payroll_runs where period = btrim(p_period) and kind = 'regular' and status in ('draft','calculated')
     and (p_parallel is null or parallel = p_parallel) order by parallel limit 1
$$;

create or replace function app.payroll_legacy_set(p_period text, p_employee uuid, p_gross numeric, p_pph numeric, p_net numeric, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_run uuid;
begin
  perform app.require_payroll('payroll.manage');
  select id into v_run from public.payroll_runs where period = btrim(p_period) and kind = 'regular' and status <> 'cancelled' order by parallel desc limit 1;
  if v_run is null then raise exception 'Belum ada proses gaji periode %', p_period using errcode = '22023'; end if;
  if p_net is null then raise exception 'Gaji bersih wajib diisi' using errcode = '22023'; end if;
  insert into public.payroll_legacy(run_id, employee_id, gross, pph21, net, note) values (v_run, p_employee, p_gross, p_pph, p_net, p_note)
  on conflict (run_id, employee_id) do update set gross = excluded.gross, pph21 = excluded.pph21, net = excluded.net, note = excluded.note;
end $$;
revoke all on function app.payroll_run_for(text, boolean), app.payroll_legacy_set(text, uuid, numeric, numeric, numeric, text) from public, anon;
grant execute on function app.payroll_run_for(text, boolean), app.payroll_legacy_set(text, uuid, numeric, numeric, numeric, text) to authenticated;

create or replace function app.import_row_ext(p_dataset text, r jsonb) returns boolean
language plpgsql set search_path = public as $$
declare
  v_id uuid;
  t text;
  v_run uuid;
  num numeric;
begin
  if p_dataset in ('data_pribadi', 'kontrak', 'idcard', 'organisasi', 'absensi', 'saldo_cuti', 'gaji', 'input_gaji', 'saldo_pajak', 'gaji_lama') then
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
  else
    return false;
  end case;
  return true;
end $$;
revoke all on function app.import_row_ext(text, jsonb) from public, anon;
grant execute on function app.import_row_ext(text, jsonb) to authenticated;

revoke all on function app.ter_category(text), app.ter_rate(text, numeric), app.ptkp_amount(text), app.pph17(numeric),
  app.ot_equivalent(numeric, text, int), app.pay_amount(uuid, text, date), app.require_payroll(text), app.is_payroll() from public, anon;
grant execute on function app.ter_category(text), app.ter_rate(text, numeric), app.ptkp_amount(text), app.pph17(numeric),
  app.ot_equivalent(numeric, text, int), app.require_payroll(text), app.is_payroll() to authenticated;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and p.proname not in ('verify_document', 'feed_rows') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
