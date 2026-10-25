-- HRIS tahap D: reimbursement (klaim biaya) dan kasbon / uang muka dinas, terhubung ke payroll.
-- Alur klaim & kasbon: diajukan → atasan (tahap 1) → payroll officer (tahap 2, verifikasi nominal & cara bayar).
-- Klaim "lewat gaji" dan cicilan kasbon masuk otomatis ke proses gaji bulanan berikutnya; tercatat lunas saat slip terbit.

insert into public.numbering_schemes(code, name, pattern, module) values
  ('RMB','Klaim reimbursement','RMB-BSB-{YYYY}-{N4}','hrga'),
  ('KSB','Kasbon / uang muka','KSB-BSB-{YYYY}-{N4}','hrga');

insert into public.app_settings(key, value, description) values
  ('loan_max_installments', '12', 'Kasbon pribadi: cicilan potong gaji paling lama (bulan)'),
  ('loan_max_wage_ratio', '1', 'Kasbon pribadi: plafon = rasio x upah tetap sebulan (0 = tanpa plafon)'),
  ('advance_settle_days', '14', 'Uang muka dinas wajib dipertanggungjawabkan paling lambat (hari setelah dicairkan)');

-- komponen otomatis dari klaim (dipisah karena perlakuan pajaknya berbeda)
insert into public.pay_components(code, name, kind, category, calc, taxable, sort_order) values
  ('REIMB','Penggantian biaya (tidak kena pajak)','earning','variable_allowance','manual',false,22),
  ('REIMBT','Penggantian biaya (kena pajak)','earning','variable_allowance','manual',true,23);

create table public.claim_types(
  code text primary key check (code ~ '^[A-Z0-9_]{2,20}$'),
  name text not null,
  taxable boolean not null default false,
  per_claim_limit numeric(14,0) check (per_claim_limit > 0),
  annual_limit numeric(14,0) check (annual_limit > 0),
  requires_attachment boolean not null default true,
  active boolean not null default true,
  sort_order int not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.claim_types(code, name, taxable, requires_attachment, sort_order) values
  ('MEDIS','Pengobatan / rawat jalan', true, true, 10),
  ('DINAS','Perjalanan dinas', false, true, 20),
  ('OPS','Biaya operasional kerja', false, true, 30),
  ('LAIN','Lainnya', true, true, 90);

create table public.cash_advances(
  id uuid primary key default gen_random_uuid(),
  advance_no text not null unique,
  employee_id uuid not null references public.employees(id),
  kind text not null check (kind in ('loan','advance')),
  purpose text not null,
  amount numeric(14,0) not null check (amount > 0),
  installments int not null default 1 check (installments between 1 and 60),
  installment_amount numeric(14,0) not null,
  status text not null default 'submitted' check (status in ('submitted','approved_1','approved','active','settled','rejected','cancelled')),
  approver1_id uuid references public.profiles(id),
  approved1_at timestamptz,
  approver2_id uuid references public.profiles(id),
  approved2_at timestamptz,
  decision_note text,
  disbursed_on date,
  actual_amount numeric(14,0) check (actual_amount >= 0),
  reported_at timestamptz,
  report_note text,
  settled_at timestamptz,
  opening boolean not null default false,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index on public.cash_advances(employee_id, status);

create table public.advance_repayments(
  id uuid primary key default gen_random_uuid(),
  advance_id uuid not null references public.cash_advances(id),
  run_id uuid references public.payroll_runs(id),
  amount numeric(14,0) not null check (amount > 0),
  repaid_on date not null,
  note text,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.advance_repayments(advance_id);

create table public.expense_claims(
  id uuid primary key default gen_random_uuid(),
  claim_no text not null unique,
  employee_id uuid not null references public.employees(id),
  claim_type text not null references public.claim_types(code),
  expense_date date not null,
  amount numeric(14,0) not null check (amount > 0),
  approved_amount numeric(14,0) check (approved_amount >= 0),
  description text not null,
  advance_id uuid references public.cash_advances(id),
  status text not null default 'submitted' check (status in ('submitted','approved_1','approved','paid','rejected','cancelled')),
  pay_method text check (pay_method in ('payroll','transfer')),
  approver1_id uuid references public.profiles(id),
  approved1_at timestamptz,
  approver2_id uuid references public.profiles(id),
  approved2_at timestamptz,
  decision_note text,
  paid_on date,
  paid_run_id uuid references public.payroll_runs(id),
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index on public.expense_claims(employee_id, status);

-- input otomatis di proses gaji (klaim / cicilan kasbon); dibuat ulang tiap hitung
alter table public.payroll_inputs add column source_table text check (source_table in ('expense_claims','cash_advances')), add column source_id uuid;

do $$
declare t text;
begin
  foreach t in array array['claim_types','cash_advances','expense_claims'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['claim_types','cash_advances','advance_repayments','expense_claims'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
  end loop;
end $$;

-- terlihat oleh karyawan ybs, atasan/HRGA yang berwenang, dan bagian payroll
create or replace function app.can_see_claim(p_employee uuid) returns boolean language sql stable security definer set search_path = public as $$
  select p_employee = app.my_employee() or app.can_approve_employee(p_employee) or app.has_permission_anywhere('payroll.manage')
      or app.has_permission_anywhere('payroll.read')
$$;

create policy claim_types_read on public.claim_types for select to authenticated using (app.is_active_user());
create policy cash_advances_read on public.cash_advances for select to authenticated using (app.can_see_claim(employee_id));
create policy advance_repayments_read on public.advance_repayments for select to authenticated using (
  exists(select 1 from public.cash_advances a where a.id = advance_id));
create policy expense_claims_read on public.expense_claims for select to authenticated using (app.can_see_claim(employee_id));

-- ---------------------------------------------------------------- pembantu
create or replace function app.advance_balance(p_id uuid) returns numeric language sql stable security definer set search_path = public as $$
  select a.amount - case when a.kind = 'advance' then coalesce(a.actual_amount, 0) else 0 end
         - coalesce((select sum(r.amount) from public.advance_repayments r where r.advance_id = a.id), 0)
    from public.cash_advances a where a.id = p_id
$$;

-- pengaju: karyawan sendiri, atau atasan/HRGA atas nama bawahannya
create or replace function app.claim_owner(p_employee uuid) returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid := coalesce(p_employee, app.my_employee());
begin
  if v is null then raise exception 'Akun Anda belum ditautkan ke data karyawan; hubungi HRGA' using errcode = '42501'; end if;
  if v <> coalesce(app.my_employee(), '00000000-0000-0000-0000-000000000000') and not app.can_approve_employee(v) then
    raise exception 'Tidak berwenang mengajukan untuk karyawan ini' using errcode = '42501';
  end if;
  if not exists(select 1 from public.employees where id = v and status = 'active' and employment_type <> 'subcon') then
    raise exception 'Hanya untuk karyawan BSB yang aktif' using errcode = '22023';
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------- jenis klaim
create or replace function public.claim_type_save(p_code text, p_name text, p_taxable boolean, p_per_claim numeric, p_annual numeric,
  p_requires_attachment boolean, p_active boolean, p_sort int default 0)
returns public.claim_types language plpgsql security definer set search_path = public as $$
declare v public.claim_types;
begin
  perform app.require_payroll('payroll.manage');
  insert into public.claim_types(code, name, taxable, per_claim_limit, annual_limit, requires_attachment, active, sort_order)
  values (upper(btrim(p_code)), app.require_text(p_name, 'Nama'), coalesce(p_taxable, false), nullif(p_per_claim, 0), nullif(p_annual, 0),
          coalesce(p_requires_attachment, true), coalesce(p_active, true), coalesce(p_sort, 0))
  on conflict (code) do update set name = excluded.name, taxable = excluded.taxable, per_claim_limit = excluded.per_claim_limit,
    annual_limit = excluded.annual_limit, requires_attachment = excluded.requires_attachment, active = excluded.active, sort_order = excluded.sort_order
  returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------- klaim
create or replace function public.expense_claim_create(p_employee uuid, p_type text, p_date date, p_amount numeric, p_description text,
  p_advance uuid default null, p_attachments uuid[] default '{}', p_idempotency_key text default null)
returns public.expense_claims language plpgsql security definer set search_path = public as $$
declare
  v public.expense_claims;
  t public.claim_types;
  v_emp uuid := app.claim_owner(p_employee);
  v_used numeric;
  v_reg public.registrations;
begin
  if p_idempotency_key is not null then
    select c.* into v from public.registrations r join public.expense_claims c on c.claim_no = r.number where r.idempotency_key = p_idempotency_key;
    if found then return v; end if;
  end if;
  select * into t from public.claim_types where code = p_type and active;
  if not found then raise exception 'Jenis klaim tidak dikenal' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Nominal klaim tidak valid' using errcode = '22023'; end if;
  if p_date is null or p_date > app.site_today() then raise exception 'Tanggal biaya tidak valid' using errcode = '22023'; end if;
  if p_date < app.site_today() - 90 then raise exception 'Klaim lebih dari 90 hari setelah tanggal biaya tidak diterima' using errcode = '22023'; end if;
  if t.requires_attachment and coalesce(cardinality(p_attachments), 0) = 0 then
    raise exception 'Klaim % wajib melampirkan kuitansi / bukti', t.name using errcode = '22023';
  end if;
  if t.per_claim_limit is not null and p_amount > t.per_claim_limit then
    raise exception 'Klaim % maksimal Rp % per pengajuan', t.name, to_char(t.per_claim_limit, 'FM999G999G999G999') using errcode = '22023';
  end if;
  if t.annual_limit is not null then
    select coalesce(sum(coalesce(approved_amount, amount)), 0) into v_used from public.expense_claims
     where employee_id = v_emp and claim_type = p_type and extract(year from expense_date) = extract(year from p_date)
       and status not in ('rejected','cancelled');
    if v_used + p_amount > t.annual_limit then
      raise exception 'Plafon % setahun Rp %, sudah terpakai Rp %', t.name, to_char(t.annual_limit, 'FM999G999G999G999'),
        to_char(v_used, 'FM999G999G999G990') using errcode = '22023';
    end if;
  end if;
  if p_advance is not null and not exists(select 1 from public.cash_advances where id = p_advance and employee_id = v_emp and kind = 'advance') then
    raise exception 'Uang muka tidak ditemukan untuk karyawan ini' using errcode = '22023';
  end if;
  v_reg := app.allocate_number('RMB', jsonb_build_object('date', app.site_today()), p_idempotency_key);
  insert into public.expense_claims(claim_no, employee_id, claim_type, expense_date, amount, description, advance_id)
  values (v_reg.number, v_emp, p_type, p_date, round(p_amount), app.require_text(p_description, 'Keterangan'), p_advance) returning * into v;
  update public.registrations set ref_table = 'expense_claims', ref_id = v.id where id = v_reg.id;
  perform app.claim_attachments(p_attachments, 'expense_claims', v.id);
  perform app.notify_users(app.approvers_of(v_emp), 'hr.claim', 'Klaim ' || t.name || ' ' || v.claim_no,
    (select full_name from public.employees where id = v_emp) || ' · Rp ' || to_char(v.amount, 'FM999G999G999G999'), '/tugas');
  return v;
end $$;

-- Tahap 1 atasan; tahap 2 payroll officer (boleh menyesuaikan nominal dan memilih bayar lewat gaji / transfer). Tolak wajib alasan.
create or replace function public.expense_claim_decide(p_id uuid, p_approve boolean, p_note text default null,
  p_amount numeric default null, p_pay_method text default 'payroll')
returns public.expense_claims language plpgsql security definer set search_path = public as $$
declare v public.expense_claims;
begin
  select * into v from public.expense_claims where id = p_id for update;
  if not found then raise exception 'Klaim tidak ditemukan' using errcode = 'P0002'; end if;
  if v.status not in ('submitted','approved_1') then raise exception 'Klaim sudah diputuskan' using errcode = '22023'; end if;
  if v.created_by = auth.uid() or (select profile_id from public.employees where id = v.employee_id) = auth.uid() then
    raise exception 'Pengaju tidak bisa memutuskan klaimnya sendiri' using errcode = '42501';
  end if;
  if v.status = 'submitted' then
    if not app.can_approve_employee(v.employee_id) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  else
    perform app.require_payroll('payroll.manage');
    if v.approver1_id = auth.uid() then raise exception 'Tahap 2 harus orang berbeda dari tahap 1' using errcode = '42501'; end if;
  end if;
  if not p_approve then
    update public.expense_claims set status = 'rejected', decision_note = app.require_text(p_note, 'Alasan penolakan'),
      approver1_id = case when status = 'submitted' then auth.uid() else approver1_id end,
      approved1_at = case when status = 'submitted' then now() else approved1_at end,
      approver2_id = case when status = 'approved_1' then auth.uid() else approver2_id end,
      approved2_at = case when status = 'approved_1' then now() else approved2_at end
     where id = p_id returning * into v;
    perform app.notify_users(array[v.created_by, (select profile_id from public.employees where id = v.employee_id)], 'hr.claim',
      'Klaim ' || v.claim_no || ' ditolak', p_note, '/saya?tab=klaim');
    return v;
  end if;
  if v.status = 'submitted' then
    update public.expense_claims set status = 'approved_1', approver1_id = auth.uid(), approved1_at = now(), decision_note = p_note
     where id = p_id returning * into v;
    perform app.notify_users(app.users_with_permission('payroll.manage'), 'hr.claim', 'Klaim ' || v.claim_no || ' menunggu verifikasi payroll',
      (select full_name from public.employees where id = v.employee_id), '/tugas');
    return v;
  end if;
  if p_amount is not null and (p_amount < 0 or p_amount > v.amount) then
    raise exception 'Nominal disetujui antara 0 dan nominal klaim' using errcode = '22023';
  end if;
  if p_pay_method not in ('payroll','transfer') then raise exception 'Cara bayar: payroll atau transfer' using errcode = '22023'; end if;
  update public.expense_claims set status = 'approved', approver2_id = auth.uid(), approved2_at = now(), approved_amount = round(coalesce(p_amount, amount)),
    pay_method = p_pay_method, decision_note = coalesce(p_note, decision_note)
   where id = p_id returning * into v;
  -- klaim yang dipotong penuh tidak perlu dibayar
  if v.approved_amount = 0 then update public.expense_claims set status = 'paid', paid_on = app.site_today() where id = p_id returning * into v; end if;
  perform app.notify_users(array[v.created_by, (select profile_id from public.employees where id = v.employee_id)], 'hr.claim',
    'Klaim ' || v.claim_no || ' disetujui', 'Rp ' || to_char(v.approved_amount, 'FM999G999G999G990') ||
    case v.pay_method when 'payroll' then ' · dibayar bersama gaji' else ' · ditransfer' end, '/saya?tab=klaim');
  return v;
end $$;

create or replace function public.expense_claim_cancel(p_id uuid) returns public.expense_claims
language plpgsql security definer set search_path = public as $$
declare v public.expense_claims;
begin
  update public.expense_claims set status = 'cancelled'
   where id = p_id and status in ('submitted','approved_1')
     and (created_by = auth.uid() or employee_id = app.my_employee() or app.has_permission_anywhere('payroll.manage'))
  returning * into v;
  if not found then raise exception 'Klaim tidak bisa dibatalkan (sudah disetujui atau bukan milik Anda)' using errcode = '22023'; end if;
  return v;
end $$;

-- klaim "transfer": ditandai dibayar oleh payroll setelah ditransfer
create or replace function public.expense_claim_mark_paid(p_id uuid, p_date date default null) returns public.expense_claims
language plpgsql security definer set search_path = public as $$
declare v public.expense_claims;
begin
  perform app.require_payroll('payroll.manage');
  update public.expense_claims set status = 'paid', paid_on = coalesce(p_date, app.site_today())
   where id = p_id and status = 'approved' and pay_method = 'transfer' returning * into v;
  if not found then raise exception 'Hanya klaim disetujui dengan cara bayar transfer' using errcode = '22023'; end if;
  perform app.notify_users(array[(select profile_id from public.employees where id = v.employee_id)], 'hr.claim',
    'Klaim ' || v.claim_no || ' sudah ditransfer', 'Rp ' || to_char(v.approved_amount, 'FM999G999G999G990'), '/saya?tab=klaim');
  return v;
end $$;

-- ---------------------------------------------------------------- kasbon & uang muka
create or replace function public.cash_advance_create(p_employee uuid, p_kind text, p_purpose text, p_amount numeric, p_installments int default 1,
  p_idempotency_key text default null)
returns public.cash_advances language plpgsql security definer set search_path = public as $$
declare
  v public.cash_advances;
  v_emp uuid := app.claim_owner(p_employee);
  v_max int := app.setting_num('loan_max_installments', 12)::int;
  v_ratio numeric := app.setting_num('loan_max_wage_ratio', 1);
  v_wage numeric;
  v_reg public.registrations;
begin
  if p_idempotency_key is not null then
    select a.* into v from public.registrations r join public.cash_advances a on a.advance_no = r.number where r.idempotency_key = p_idempotency_key;
    if found then return v; end if;
  end if;
  if p_kind not in ('loan','advance') then raise exception 'Jenis: kasbon pribadi atau uang muka dinas' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Nominal tidak valid' using errcode = '22023'; end if;
  if p_kind = 'advance' then p_installments := 1; end if;
  if p_installments is null or p_installments < 1 or p_installments > v_max then
    raise exception 'Cicilan 1 sampai % bulan', v_max using errcode = '22023';
  end if;
  if p_kind = 'loan' then
    if exists(select 1 from public.cash_advances where employee_id = v_emp and kind = 'loan' and status in ('submitted','approved_1','approved','active')) then
      raise exception 'Masih ada kasbon pribadi yang berjalan; lunasi dulu' using errcode = '22023';
    end if;
    select coalesce(sum(p.amount), 0) into v_wage from (
      select distinct on (component_code) component_code, amount from public.employee_pay
       where employee_id = v_emp and effective_from <= app.site_today() order by component_code, effective_from desc) p
      join public.pay_components c on c.code = p.component_code and c.category in ('basic','fixed_allowance');
    if v_ratio > 0 and v_wage > 0 and p_amount > v_wage * v_ratio then
      raise exception 'Kasbon maksimal % x upah tetap sebulan', v_ratio using errcode = '22023';
    end if;
  end if;
  v_reg := app.allocate_number('KSB', jsonb_build_object('date', app.site_today()), p_idempotency_key);
  insert into public.cash_advances(advance_no, employee_id, kind, purpose, amount, installments, installment_amount)
  values (v_reg.number, v_emp, p_kind, app.require_text(p_purpose, 'Keperluan'), round(p_amount), p_installments, ceil(round(p_amount) / p_installments))
  returning * into v;
  update public.registrations set ref_table = 'cash_advances', ref_id = v.id where id = v_reg.id;
  perform app.notify_users(app.approvers_of(v_emp), 'hr.claim',
    case p_kind when 'loan' then 'Kasbon ' else 'Uang muka ' end || v.advance_no,
    (select full_name from public.employees where id = v_emp) || ' · Rp ' || to_char(v.amount, 'FM999G999G999G999'), '/tugas');
  return v;
end $$;

create or replace function public.cash_advance_decide(p_id uuid, p_approve boolean, p_note text default null)
returns public.cash_advances language plpgsql security definer set search_path = public as $$
declare v public.cash_advances;
begin
  select * into v from public.cash_advances where id = p_id for update;
  if not found then raise exception 'Pengajuan tidak ditemukan' using errcode = 'P0002'; end if;
  if v.status not in ('submitted','approved_1') then raise exception 'Pengajuan sudah diputuskan' using errcode = '22023'; end if;
  if v.created_by = auth.uid() or (select profile_id from public.employees where id = v.employee_id) = auth.uid() then
    raise exception 'Pengaju tidak bisa memutuskan pengajuannya sendiri' using errcode = '42501';
  end if;
  if v.status = 'submitted' then
    if not app.can_approve_employee(v.employee_id) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  else
    perform app.require_payroll('payroll.manage');
    if v.approver1_id = auth.uid() then raise exception 'Tahap 2 harus orang berbeda dari tahap 1' using errcode = '42501'; end if;
  end if;
  if not p_approve then
    update public.cash_advances set status = 'rejected', decision_note = app.require_text(p_note, 'Alasan penolakan'),
      approver1_id = case when status = 'submitted' then auth.uid() else approver1_id end,
      approved1_at = case when status = 'submitted' then now() else approved1_at end,
      approver2_id = case when status = 'approved_1' then auth.uid() else approver2_id end,
      approved2_at = case when status = 'approved_1' then now() else approved2_at end
     where id = p_id returning * into v;
  elsif v.status = 'submitted' then
    update public.cash_advances set status = 'approved_1', approver1_id = auth.uid(), approved1_at = now(), decision_note = p_note
     where id = p_id returning * into v;
    perform app.notify_users(app.users_with_permission('payroll.manage'), 'hr.claim', v.advance_no || ' menunggu verifikasi payroll',
      (select full_name from public.employees where id = v.employee_id), '/tugas');
    return v;
  else
    update public.cash_advances set status = 'approved', approver2_id = auth.uid(), approved2_at = now(), decision_note = coalesce(p_note, decision_note)
     where id = p_id returning * into v;
  end if;
  perform app.notify_users(array[v.created_by, (select profile_id from public.employees where id = v.employee_id)], 'hr.claim',
    v.advance_no || case when v.status = 'rejected' then ' ditolak' else ' disetujui, menunggu pencairan' end, p_note, '/saya?tab=klaim');
  return v;
end $$;

create or replace function public.cash_advance_cancel(p_id uuid) returns public.cash_advances
language plpgsql security definer set search_path = public as $$
declare v public.cash_advances;
begin
  update public.cash_advances set status = 'cancelled'
   where id = p_id and status in ('submitted','approved_1')
     and (created_by = auth.uid() or employee_id = app.my_employee() or app.has_permission_anywhere('payroll.manage'))
  returning * into v;
  if not found then raise exception 'Pengajuan tidak bisa dibatalkan (sudah disetujui atau bukan milik Anda)' using errcode = '22023'; end if;
  return v;
end $$;

-- pencairan oleh payroll; cicilan kasbon mulai dipotong di proses gaji yang periode absensinya mencakup / setelah tanggal ini
create or replace function public.cash_advance_disburse(p_id uuid, p_date date default null) returns public.cash_advances
language plpgsql security definer set search_path = public as $$
declare v public.cash_advances;
begin
  perform app.require_payroll('payroll.manage');
  update public.cash_advances set status = 'active', disbursed_on = coalesce(p_date, app.site_today())
   where id = p_id and status = 'approved' returning * into v;
  if not found then raise exception 'Hanya pengajuan yang sudah disetujui yang bisa dicairkan' using errcode = '22023'; end if;
  perform app.notify_users(array[(select profile_id from public.employees where id = v.employee_id)], 'hr.claim', v.advance_no || ' sudah dicairkan',
    case v.kind when 'loan' then 'Dipotong gaji Rp ' || to_char(v.installment_amount, 'FM999G999G999G999') || ' per bulan'
      else 'Pertanggungjawabkan paling lambat ' || to_char(v.disbursed_on + app.setting_num('advance_settle_days', 14)::int, 'DD-MM-YYYY') end,
    '/saya?tab=klaim');
  return v;
end $$;

-- Pertanggungjawaban uang muka dinas: biaya sebenarnya. Sisa uang muka dipotong gaji berikutnya (kecuali dikembalikan);
-- kelebihan biaya diajukan sebagai klaim Perjalanan dinas yang menaut uang muka ini.
create or replace function public.cash_advance_report(p_id uuid, p_actual numeric, p_note text default null, p_attachments uuid[] default '{}')
returns public.cash_advances language plpgsql security definer set search_path = public as $$
declare v public.cash_advances;
begin
  select * into v from public.cash_advances where id = p_id for update;
  if not found or v.kind <> 'advance' or v.status <> 'active' then raise exception 'Hanya uang muka dinas yang sudah dicairkan' using errcode = '22023'; end if;
  if not (v.employee_id = app.my_employee() or v.created_by = auth.uid() or app.has_permission_anywhere('payroll.manage')) then
    raise exception 'Tidak berwenang' using errcode = '42501';
  end if;
  if v.actual_amount is not null then raise exception 'Sudah dipertanggungjawabkan' using errcode = '22023'; end if;
  if p_actual is null or p_actual < 0 then raise exception 'Biaya sebenarnya tidak valid' using errcode = '22023'; end if;
  update public.cash_advances set actual_amount = round(least(p_actual, amount)), reported_at = now(), report_note = p_note
   where id = p_id returning * into v;
  perform app.claim_attachments(p_attachments, 'cash_advances', v.id);
  if app.advance_balance(v.id) <= 0 then
    update public.cash_advances set status = 'settled', settled_at = now() where id = p_id returning * into v;
  end if;
  return v;
end $$;

-- pengembalian tunai / transfer di luar gaji
create or replace function public.advance_repay(p_id uuid, p_amount numeric, p_date date default null, p_note text default null)
returns public.cash_advances language plpgsql security definer set search_path = public as $$
declare v public.cash_advances; v_bal numeric;
begin
  perform app.require_payroll('payroll.manage');
  select * into v from public.cash_advances where id = p_id for update;
  if not found or v.status <> 'active' then raise exception 'Hanya kasbon / uang muka yang berjalan' using errcode = '22023'; end if;
  v_bal := app.advance_balance(p_id);
  if p_amount is null or p_amount <= 0 or p_amount > v_bal then raise exception 'Nominal antara 1 dan sisa Rp %', v_bal using errcode = '22023'; end if;
  insert into public.advance_repayments(advance_id, amount, repaid_on, note) values (p_id, round(p_amount), coalesce(p_date, app.site_today()), p_note);
  if app.advance_balance(p_id) <= 0 then
    update public.cash_advances set status = 'settled', settled_at = now() where id = p_id returning * into v;
  end if;
  return v;
end $$;

-- saldo kasbon dari sistem lama (impor): langsung berjalan, dipotong per bulan
create or replace function app.advance_opening(p_employee uuid, p_balance numeric, p_installment numeric, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare v_reg public.registrations; v uuid;
begin
  perform app.require_payroll('payroll.manage');
  if p_balance is null or p_balance <= 0 then raise exception 'Sisa kasbon tidak valid'; end if;
  if p_installment is null or p_installment <= 0 then p_installment := p_balance; end if;
  if exists(select 1 from public.cash_advances where employee_id = p_employee and opening and status = 'active') then
    raise exception 'Saldo awal kasbon karyawan ini sudah diimpor';
  end if;
  v_reg := app.allocate_number('KSB', jsonb_build_object('date', app.site_today()), null);
  insert into public.cash_advances(advance_no, employee_id, kind, purpose, amount, installments, installment_amount, status,
    approver2_id, approved2_at, disbursed_on, opening, decision_note)
  values (v_reg.number, p_employee, 'loan', coalesce(nullif(btrim(p_note), ''), 'Saldo kasbon dari sistem lama'), round(p_balance),
    greatest(1, ceil(p_balance / p_installment))::int, round(least(p_installment, p_balance)), 'active', auth.uid(), now(), app.site_today(), true,
    'Saldo awal impor') returning id into v;
  update public.registrations set ref_table = 'cash_advances', ref_id = v where id = v_reg.id;
end $$;

-- ---------------------------------------------------------------- payroll: tarik klaim & cicilan, catat saat terbit
create or replace function app.payroll_pull(p_run public.payroll_runs) returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.payroll_inputs where run_id = p_run.id and source_table is not null;
  if p_run.kind <> 'regular' then return; end if;
  insert into public.payroll_inputs(run_id, employee_id, component_code, amount, note, source_table, source_id)
  select p_run.id, c.employee_id, case when t.taxable then 'REIMBT' else 'REIMB' end, c.approved_amount, c.claim_no || ' · ' || t.name,
         'expense_claims', c.id
    from public.expense_claims c join public.claim_types t on t.code = c.claim_type
    join public.employees e on e.id = c.employee_id
   where c.status = 'approved' and c.pay_method = 'payroll' and c.approved_amount > 0 and c.approved2_at::date <= p_run.att_to
     and e.employment_type <> 'subcon';
  insert into public.payroll_inputs(run_id, employee_id, component_code, amount, note, source_table, source_id)
  select p_run.id, a.employee_id, 'KASBON', least(case when a.kind = 'loan' then a.installment_amount else b.bal end, b.bal),
         a.advance_no || case when a.kind = 'loan' then ' · cicilan kasbon' else ' · sisa uang muka' end, 'cash_advances', a.id
    from public.cash_advances a cross join lateral (select app.advance_balance(a.id) bal) b
   where a.status = 'active' and a.disbursed_on <= p_run.att_to and b.bal > 0
     and (a.kind = 'loan' or a.actual_amount is not null);
end $$;

create or replace function app.payroll_post(p_run public.payroll_runs) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.expense_claims c set status = 'paid', paid_on = p_run.pay_date, paid_run_id = p_run.id
    from public.payroll_inputs i where i.run_id = p_run.id and i.source_table = 'expense_claims' and i.source_id = c.id and c.status = 'approved';
  insert into public.advance_repayments(advance_id, run_id, amount, repaid_on, note)
  select i.source_id, p_run.id, i.amount, p_run.pay_date, 'Potong gaji ' || p_run.period
    from public.payroll_inputs i where i.run_id = p_run.id and i.source_table = 'cash_advances';
  update public.cash_advances a set status = 'settled', settled_at = now()
   where a.id in (select source_id from public.payroll_inputs where run_id = p_run.id and source_table = 'cash_advances')
     and app.advance_balance(a.id) <= 0;
end $$;

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
  perform app.payroll_pull(v);
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
  perform app.payroll_post(v);
  perform app.notify_users(array(select em.profile_id from public.payroll_slips s join public.employees em on em.id = s.employee_id where s.run_id = p_run),
    'payroll', case v.kind when 'thr' then 'Slip THR ' else 'Slip gaji ' end || v.period || ' tersedia', 'Lihat di menu Saya → Slip gaji', '/saya?tab=gaji');
  return v;
end $$;

-- input otomatis tidak dihapus manual (akan muncul lagi saat hitung ulang): ubah klaim / kasbonnya
create or replace function public.payroll_input_delete(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_run uuid;
begin
  perform app.require_payroll('payroll.manage');
  if exists(select 1 from public.payroll_inputs where id = p_id and source_table is not null) then
    raise exception 'Input ini diambil otomatis dari klaim / kasbon' using errcode = '22023';
  end if;
  delete from public.payroll_inputs i using public.payroll_runs r
   where i.id = p_id and r.id = i.run_id and r.status in ('draft','calculated') returning i.run_id into v_run;
  if v_run is null then raise exception 'Input tidak ditemukan atau proses sudah disetujui' using errcode = '22023'; end if;
  update public.payroll_runs set status = 'draft' where id = v_run and status = 'calculated';
end $$;

-- ---------------------------------------------------------------- register
create view public.expense_claim_register with (security_invoker = true) as
select c.id, c.claim_no, c.employee_id, e.nrp, e.full_name, d.code as department_code, c.claim_type, t.name as claim_type_name, t.taxable,
       c.expense_date, c.amount, c.approved_amount, c.description, c.status, c.pay_method, c.decision_note, c.paid_on,
       r.run_no as paid_run_no, a.advance_no, c.created_at, c.created_by,
       p1.full_name as approver1_name, p2.full_name as approver2_name,
       (select count(*)::int from public.attachments x where x.owner_table = 'expense_claims' and x.owner_id = c.id) as attachment_count,
       (c.created_by <> auth.uid() and e.profile_id is distinct from auth.uid() and (
         (c.status = 'submitted' and app.can_approve_employee(c.employee_id))
         or (c.status = 'approved_1' and app.has_permission_anywhere('payroll.manage') and c.approver1_id is distinct from auth.uid()))) as can_decide
  from public.expense_claims c
  join public.employees e on e.id = c.employee_id
  join public.departments d on d.id = e.department_id
  join public.claim_types t on t.code = c.claim_type
  left join public.cash_advances a on a.id = c.advance_id
  left join public.payroll_runs r on r.id = c.paid_run_id
  left join public.profiles p1 on p1.id = c.approver1_id
  left join public.profiles p2 on p2.id = c.approver2_id;

create view public.cash_advance_register with (security_invoker = true) as
select a.id, a.advance_no, a.employee_id, e.nrp, e.full_name, d.code as department_code, a.kind, a.purpose, a.amount, a.installments,
       a.installment_amount, a.status, a.decision_note, a.disbursed_on, a.actual_amount, a.reported_at, a.settled_at, a.opening, a.created_at, a.created_by,
       coalesce((select sum(r.amount) from public.advance_repayments r where r.advance_id = a.id), 0) as repaid,
       app.advance_balance(a.id) as balance,
       (a.kind = 'advance' and a.status = 'active' and a.actual_amount is null
         and a.disbursed_on + app.setting_num('advance_settle_days', 14)::int < app.site_today()) as report_overdue,
       p1.full_name as approver1_name, p2.full_name as approver2_name,
       (a.created_by <> auth.uid() and e.profile_id is distinct from auth.uid() and (
         (a.status = 'submitted' and app.can_approve_employee(a.employee_id))
         or (a.status = 'approved_1' and app.has_permission_anywhere('payroll.manage') and a.approver1_id is distinct from auth.uid()))) as can_decide
  from public.cash_advances a
  join public.employees e on e.id = a.employee_id
  join public.departments d on d.id = e.department_id
  left join public.profiles p1 on p1.id = a.approver1_id
  left join public.profiles p2 on p2.id = a.approver2_id;

do $$
declare v text;
begin
  foreach v in array array['expense_claim_register','cash_advance_register'] loop
    execute format('grant select on public.%I to authenticated', v);
    execute format('revoke all on public.%I from anon', v);
  end loop;
end $$;

revoke all on function app.can_see_claim(uuid), app.advance_balance(uuid), app.claim_owner(uuid), app.advance_opening(uuid, numeric, numeric, text),
  app.payroll_pull(public.payroll_runs), app.payroll_post(public.payroll_runs) from public, anon;
grant execute on function app.can_see_claim(uuid), app.advance_balance(uuid), app.claim_owner(uuid), app.advance_opening(uuid, numeric, numeric, text)
  to authenticated;

-- impor: saldo kasbon dari sistem lama (fungsi lengkap, semua jenis sebelumnya tetap)
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
  when 'kasbon_awal' then
    perform app.advance_opening(v_id,
      nullif(regexp_replace(coalesce(r->>'sisa', ''), '[^0-9]', '', 'g'), '')::numeric,
      nullif(regexp_replace(coalesce(r->>'cicilan', ''), '[^0-9]', '', 'g'), '')::numeric, nullif(r->>'keterangan', ''));
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
