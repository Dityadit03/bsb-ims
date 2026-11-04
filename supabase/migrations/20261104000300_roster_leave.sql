-- BSB IMS · Paket B hasil UAT (HRGA): roster dan cuti.
--  1) Pengaturan roster (siklus kerja / cuti periodik, pengajuan paling lambat, batas cuti bersamaan) yang bisa diubah Dept Head dan HRGA:
--     nilai awal (default) -> per departemen -> per karyawan.
--  2) Cuti periodik (CPR) mengikuti pengaturan roster; cuti tahunan (CT) dan periodik disetujui atasan (satu tahap).
--  3) Satu pengajuan boleh memuat beberapa jenis cuti (checklist), masing-masing dengan tanggalnya.
--  4) Pemberitahuan jadwal cuti: saat roster CUTI diatur atasan dan daftar cuti yang akan datang (dipakai lonceng).

-- ---------------------------------------------------------------- 1) pengaturan roster
create table public.roster_policies(
  id uuid primary key default gen_random_uuid(),
  department_id uuid references public.departments(id),
  employee_id uuid references public.employees(id),
  work_days int not null check (work_days between 1 and 365),
  off_days int not null check (off_days between 1 and 90),
  notice_days int not null default 14 check (notice_days between 0 and 90),
  max_concurrent_pct int not null default 20 check (max_concurrent_pct between 0 and 100),
  cycle_anchor date,
  note text,
  set_by uuid references public.profiles(id) default auth.uid(),
  updated_at timestamptz not null default now(),
  check (not (department_id is not null and employee_id is not null))
);
create unique index roster_policies_default_uq on public.roster_policies((1)) where department_id is null and employee_id is null;
create unique index roster_policies_dept_uq on public.roster_policies(department_id) where department_id is not null;
create unique index roster_policies_emp_uq on public.roster_policies(employee_id) where employee_id is not null;
insert into public.roster_policies(work_days, off_days, notice_days, max_concurrent_pct, note)
values (56, 14, 14, 20, 'Nilai awal (8 minggu kerja, 2 minggu cuti). Sesuaikan dengan kesepakatan Dept Head dan HRGA.');

alter table public.roster_policies enable row level security;
revoke all on public.roster_policies from anon;
revoke insert, update, delete on public.roster_policies from authenticated;
create policy roster_policies_read on public.roster_policies for select to authenticated using (app.is_active_user());
create trigger roster_policies_audit after insert or update or delete on public.roster_policies for each row execute function app.audit_row();

-- Pengaturan yang berlaku: karyawan > departemen > default
create or replace function public.roster_policy_for(p_employee uuid)
returns public.roster_policies language sql stable security definer set search_path = public as $$
  select p.* from public.roster_policies p join public.employees e on e.id = p_employee
   where p.employee_id = e.id or (p.employee_id is null and p.department_id = e.department_id) or (p.employee_id is null and p.department_id is null)
   order by (p.employee_id is not null) desc, (p.department_id is not null) desc limit 1
$$;

create or replace function app.roster_policy_auth(p_department uuid, p_employee uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare v_dept uuid := p_department;
begin
  if p_employee is not null then select department_id into v_dept from public.employees where id = p_employee; end if;
  if v_dept is null then
    if not app.is_hr() then raise exception 'Pengaturan umum hanya oleh HRGA' using errcode = '42501'; end if;
  elsif not (app.is_hr() or app.has_permission('hr.roster', v_dept)) then
    raise exception 'Tidak berwenang mengatur roster departemen ini' using errcode = '42501';
  end if;
end $$;

create or replace function public.roster_policy_set(p_department uuid, p_employee uuid, p_work_days int, p_off_days int,
  p_notice_days int default 14, p_max_pct int default 20, p_anchor date default null, p_note text default null)
returns public.roster_policies language plpgsql security definer set search_path = public as $$
declare v public.roster_policies;
begin
  if p_department is not null and p_employee is not null then raise exception 'Pilih departemen atau karyawan, bukan keduanya' using errcode = '22023'; end if;
  perform app.roster_policy_auth(p_department, p_employee);
  if p_work_days is null or p_off_days is null then raise exception 'Hari kerja dan hari cuti wajib diisi' using errcode = '22023'; end if;
  update public.roster_policies set work_days = p_work_days, off_days = p_off_days, notice_days = coalesce(p_notice_days, 14),
    max_concurrent_pct = coalesce(p_max_pct, 20), cycle_anchor = p_anchor, note = nullif(btrim(p_note), ''), set_by = auth.uid(), updated_at = now()
   where department_id is not distinct from p_department and employee_id is not distinct from p_employee returning * into v;
  if not found then
    insert into public.roster_policies(department_id, employee_id, work_days, off_days, notice_days, max_concurrent_pct, cycle_anchor, note)
    values (p_department, p_employee, p_work_days, p_off_days, coalesce(p_notice_days, 14), coalesce(p_max_pct, 20), p_anchor, nullif(btrim(p_note), ''))
    returning * into v;
  end if;
  return v;
end $$;

create or replace function public.roster_policy_delete(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare v public.roster_policies;
begin
  select * into v from public.roster_policies where id = p_id;
  if not found then raise exception 'Pengaturan tidak ditemukan' using errcode = 'P0002'; end if;
  if v.department_id is null and v.employee_id is null then raise exception 'Pengaturan umum tidak bisa dihapus, ubah nilainya' using errcode = '22023'; end if;
  perform app.roster_policy_auth(v.department_id, v.employee_id);
  delete from public.roster_policies where id = p_id;
end $$;

create view public.roster_policy_view with (security_invoker = true) as
select p.*, d.code as department_code, e.nrp, e.full_name,
       case when p.employee_id is not null then 'Karyawan' when p.department_id is not null then 'Departemen' else 'Umum' end as scope
  from public.roster_policies p left join public.departments d on d.id = p.department_id left join public.employees e on e.id = p.employee_id;

-- ---------------------------------------------------------------- 2) jenis cuti: periodik, persetujuan satu tahap
alter table public.leave_types add column stages smallint not null default 2 check (stages in (1, 2));
update public.leave_types set stages = 1 where code = 'CT';
insert into public.leave_types(code, name, paid, quota_days, max_days, count_mode, roster_code, requires_attachment, gender, sort_order, stages)
values ('CPR', 'Cuti periodik (roster)', true, null, null, 'calendar', 'CUTI', false, null, 2, 1);

alter table public.leave_requests add column group_id uuid;

create or replace function app.leave_policy_check(p_employee uuid, p_type text, p_start date, p_end date) returns void
language plpgsql security definer set search_path = public as $$
declare pol public.roster_policies; e public.employees; v_last date; v_base date; v_earliest date; v_n int; v_worst int;
begin
  if p_type <> 'CPR' then return; end if;
  select * into pol from public.roster_policy_for(p_employee);
  select * into e from public.employees where id = p_employee;
  if (p_end - p_start + 1) > pol.off_days then
    raise exception 'Cuti periodik maksimal % hari menurut pengaturan roster', pol.off_days using errcode = '22023';
  end if;
  select max(end_date) into v_last from public.leave_requests where employee_id = p_employee and leave_type = 'CPR' and status in ('submitted','approved_1','approved');
  v_base := coalesce(v_last + 1, pol.cycle_anchor, e.join_date);
  if v_base is not null then
    v_earliest := v_base + pol.work_days;
    if p_start < v_earliest then
      raise exception 'Cuti periodik berikutnya baru boleh mulai % (% hari kerja sejak %). Dept Head atau HRGA dapat menyesuaikan pengaturan roster.',
        to_char(v_earliest, 'DD-MM-YYYY'), pol.work_days, to_char(v_base, 'DD-MM-YYYY') using errcode = '22023';
    end if;
  end if;
  if pol.notice_days > 0 and p_start - app.site_today() < pol.notice_days and not app.is_hr() then
    raise exception 'Cuti periodik diajukan paling lambat % hari sebelum mulai', pol.notice_days using errcode = '22023';
  end if;
  if pol.max_concurrent_pct > 0 and e.department_id is not null then
    select count(*) into v_n from public.employees where department_id = e.department_id and status = 'active';
    select coalesce(max(c), 0) into v_worst from (
      select count(distinct r.employee_id) c
        from generate_series(p_start, p_end, interval '1 day') d
        join public.leave_requests r on r.employee_id <> p_employee and r.status in ('submitted','approved_1','approved') and d::date between r.start_date and r.end_date
        join public.leave_types t on t.code = r.leave_type and t.roster_code = 'CUTI'
        join public.employees x on x.id = r.employee_id and x.department_id = e.department_id
       group by d) q;
    if v_worst >= 1 and (v_worst + 1) * 100 > pol.max_concurrent_pct * v_n then
      raise exception 'Batas cuti bersamaan departemen (% persen) terlampaui pada rentang tanggal ini', pol.max_concurrent_pct using errcode = '22023';
    end if;
  end if;
end $$;

do $$
declare d text; n text;
begin
  select pg_get_functiondef('public.leave_request_create(uuid,text,date,date,text,uuid[],text)'::regprocedure) into d;
  n := replace(d, E'  v_reg := app.allocate_number(''CUTI''', E'  perform app.leave_policy_check(v_emp, p_type, p_start, p_end);\n  v_reg := app.allocate_number(''CUTI''');
  if n = d then raise exception 'leave_request_create tidak berubah'; end if;
  execute n;
end $$;

-- Persetujuan: jenis dengan stages = 1 selesai di atasan; stages = 2 (jenis lain) tetap atasan lalu HRGA.
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
  if v.status = 'submitted' and t.stages >= 2 then
    update public.leave_requests set status = 'approved_1', approver1_id = auth.uid(), approved1_at = now(), decision_note = p_note
     where id = p_id returning * into v;
    perform app.notify_users(app.users_with_permission('hr.manage', app.hrga_dept()), 'hr.leave', 'Cuti ' || v.request_no || ' menunggu verifikasi HRGA',
      (select full_name from public.employees where id = v.employee_id), '/tugas');
    return v;
  end if;
  v_avail := app.leave_available(v.employee_id, v.leave_type, extract(year from v.start_date)::int, v.id);
  if v_avail is not null and v.days > v_avail then raise exception 'Saldo tidak cukup: sisa % hari', v_avail using errcode = '22023'; end if;
  update public.leave_requests set status = 'approved',
      approver1_id = case when status = 'submitted' then auth.uid() else approver1_id end,
      approved1_at = case when status = 'submitted' then now() else approved1_at end,
      approver2_id = case when status = 'approved_1' then auth.uid() else approver2_id end,
      approved2_at = case when status = 'approved_1' then now() else approved2_at end,
      decision_note = coalesce(p_note, decision_note)
   where id = p_id returning * into v;
  -- Roster: hari kerja (atau semua hari untuk jenis kalender) diisi kode cuti
  insert into public.roster_entries(employee_id, work_date, code, set_by)
  select v.employee_id, d::date, t.roster_code, auth.uid() from generate_series(v.start_date, v.end_date, interval '1 day') d
   where t.count_mode = 'calendar' or app.day_type(v.employee_id, d::date) = 'workday'
  on conflict (employee_id, work_date) do update set code = excluded.code, set_by = excluded.set_by, updated_at = now();
  perform app.notify_users(array[v.created_by, (select profile_id from public.employees where id = v.employee_id)], 'hr.leave',
    'Cuti ' || v.request_no || ' disetujui', t.name || ' · ' || v.days || ' hari · ' || to_char(v.start_date, 'DD-MM-YYYY') || ' s/d ' || to_char(v.end_date, 'DD-MM-YYYY'), '/saya?tab=cuti');
  return v;
end $$;

-- ---------------------------------------------------------------- 3) satu pengajuan, beberapa jenis cuti
create or replace function public.leave_request_multi(p_employee uuid, p_parts jsonb, p_reason text,
  p_attachments uuid[] default '{}', p_idempotency_key text default null)
returns setof public.leave_requests language plpgsql security definer set search_path = public as $$
declare part jsonb; v public.leave_requests; g uuid := gen_random_uuid(); i int := 0; v_att int;
begin
  if jsonb_typeof(p_parts) is distinct from 'array' or jsonb_array_length(p_parts) = 0 then
    raise exception 'Pilih minimal satu jenis cuti' using errcode = '22023';
  end if;
  if jsonb_array_length(p_parts) > 6 then raise exception 'Maksimal 6 jenis cuti dalam satu pengajuan' using errcode = '22023'; end if;
  select coalesce(min(x.ord) - 1, 0) into v_att from jsonb_array_elements(p_parts) with ordinality as x(el, ord)
    join public.leave_types t on t.code = x.el->>'type' where t.requires_attachment;
  for part in select * from jsonb_array_elements(p_parts) loop
    v := public.leave_request_create(p_employee, part->>'type', (part->>'start')::date, (part->>'end')::date,
           coalesce(nullif(btrim(part->>'reason'), ''), p_reason), case when i = v_att then p_attachments else '{}'::uuid[] end,
           case when p_idempotency_key is null then null else p_idempotency_key || ':' || i end);
    update public.leave_requests set group_id = case when jsonb_array_length(p_parts) > 1 then g end where id = v.id returning * into v;
    i := i + 1;
    return next v;
  end loop;
end $$;

-- ---------------------------------------------------------------- 4) pemberitahuan jadwal cuti
do $$
declare d text; n text;
begin
  select pg_get_functiondef('public.roster_set(uuid[],date,date,text)'::regprocedure) into d;
  n := replace(d, E'    n := n + (p_to - p_from + 1);',
E'    n := n + (p_to - p_from + 1);\n  if p_code = ''CUTI'' and e.profile_id is not null and e.profile_id is distinct from auth.uid() then\n    perform app.notify_users(array[e.profile_id], ''hr.roster'', ''Jadwal cuti Anda: '' || to_char(p_from, ''DD-MM-YYYY'') || '' s/d '' || to_char(p_to, ''DD-MM-YYYY''), ''Diatur oleh atasan / HRGA di roster'', ''/saya?tab=cuti'');\n  end if;');
  if n = d then raise exception 'roster_set tidak berubah'; end if;
  execute n;
end $$;

-- Cuti roster yang akan datang (blok tanggal berurutan) untuk karyawan yang boleh dilihat pemanggil
create or replace function public.upcoming_leave(p_days int default 14)
returns table(employee_id uuid, nrp text, full_name text, department_code text, start_date date, end_date date, days int, starts_in int, mine boolean)
language sql stable set search_path = public as $$
  with d as (
    select r.employee_id, r.work_date, r.work_date - (row_number() over (partition by r.employee_id order by r.work_date))::int as g
      from public.roster_entries r
     where r.code = 'CUTI' and r.work_date between app.site_today() and app.site_today() + greatest(coalesce(p_days, 14), 1))
  select e.id, e.nrp, e.full_name, dp.code, min(d.work_date), max(d.work_date), count(*)::int, (min(d.work_date) - app.site_today())::int,
         coalesce(e.profile_id = auth.uid(), false)
    from d join public.employees e on e.id = d.employee_id left join public.departments dp on dp.id = e.department_id
   group by e.id, e.nrp, e.full_name, dp.code, e.profile_id, d.g
   order by min(d.work_date), e.full_name
$$;

-- Status siklus cuti periodik per karyawan aktif
create view public.leave_cycle with (security_invoker = true) as
select e.id as employee_id, e.nrp, e.full_name, d.code as department_code, pol.work_days, pol.off_days, pol.notice_days, pol.max_concurrent_pct,
       lr.last_end, coalesce(lr.last_end + 1, pol.cycle_anchor, e.join_date) + pol.work_days as next_eligible
  from public.employees e left join public.departments d on d.id = e.department_id
  cross join lateral (select * from public.roster_policy_for(e.id)) pol
  left join lateral (select max(end_date) as last_end from public.leave_requests r
                      where r.employee_id = e.id and r.leave_type = 'CPR' and r.status in ('submitted','approved_1','approved')) lr on true
 where e.status = 'active';

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('roster_policy_for','roster_policy_set','roster_policy_delete','leave_request_multi','upcoming_leave') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
revoke all on public.roster_policy_view, public.leave_cycle from anon;
grant select on public.roster_policy_view, public.leave_cycle to authenticated;

-- batal: roster dibersihkan bila cuti sudah berstatus disetujui (termasuk jenis satu tahap)
create or replace function public.leave_request_cancel(p_id uuid)
returns public.leave_requests language plpgsql security definer set search_path = public as $$
declare v public.leave_requests; v_was text;
begin
  select * into v from public.leave_requests where id = p_id for update;
  if not found then raise exception 'Pengajuan tidak ditemukan' using errcode = 'P0002'; end if;
  if not (v.created_by = auth.uid() or v.employee_id = app.my_employee() or app.is_hr()) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if v.status in ('rejected','cancelled') then raise exception 'Pengajuan sudah ditutup' using errcode = '22023'; end if;
  if v.status = 'approved' and not app.is_hr() then raise exception 'Cuti yang sudah disetujui hanya bisa dibatalkan HRGA' using errcode = '42501'; end if;
  if v.status = 'approved' and v.start_date <= app.site_today() then raise exception 'Cuti sudah berjalan; buat koreksi roster' using errcode = '22023'; end if;
  v_was := v.status;
  update public.leave_requests set status = 'cancelled' where id = p_id returning * into v;
  if v_was = 'approved' then
    delete from public.roster_entries where employee_id = v.employee_id and work_date between v.start_date and v.end_date
       and code = (select roster_code from public.leave_types where code = v.leave_type);
  end if;
  return v;
end $$;
