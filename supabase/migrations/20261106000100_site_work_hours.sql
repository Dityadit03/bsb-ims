-- Jam kerja per site. Sebelumnya hanya ada dua shift global (D siang, N malam) sehingga site seperti HO tidak punya jam kerja sendiri.
-- Sekarang tiap site punya jam kerjanya: D dan N untuk site tambang, K ("Jam kerja kantor", mis. HO 08.30-17.30, hari kerja dapat diatur).
--  - work_shifts: kunci (site_id, code); kode K ditambahkan; kolom work_days (1=Senin ... 7=Minggu)
--  - roster_entries boleh berkode K; keterlambatan dan pulang cepat otomatis memakai jam K site tsb lewat attendance_daily yang sudah ada
--  - shift_save membuat/mengubah jam kerja SITE AKTIF; roster_apply_office mengisi roster K untuk karyawan site pada hari kerja kantor

-- 1) work_shifts per site
alter table public.work_shifts drop constraint if exists work_shifts_pkey;
do $$
declare c text;
begin
  select conname into c from pg_constraint where conrelid = 'public.work_shifts'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%''D''%';
  if c is not null then execute format('alter table public.work_shifts drop constraint %I', c); end if;
end $$;
alter table public.work_shifts add constraint work_shifts_code_check check (code in ('D','N','K'));
alter table public.work_shifts add primary key (site_id, code);
alter table public.work_shifts add column if not exists work_days smallint[] not null default '{1,2,3,4,5}'
  check (work_days <@ array[1,2,3,4,5,6,7]::smallint[] and cardinality(work_days) between 1 and 7);

-- 2) roster boleh berkode K
do $$
declare c text;
begin
  select conname into c from pg_constraint where conrelid = 'public.roster_entries'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%CUTI%';
  if c is not null then execute format('alter table public.roster_entries drop constraint %I', c); end if;
end $$;
alter table public.roster_entries add constraint roster_entries_code_check check (code in ('D','N','K','OFF','CUTI','SAKIT','IZIN'));

-- 3) HO: jam kerja kantor 08.30-17.30
insert into public.work_shifts(site_id, code, name, start_time, end_time, grace_minutes, break_minutes, work_days)
select s.id, 'K', 'Jam kerja HO', '08:30', '17:30', 15, 60, '{1,2,3,4,5}' from public.sites s where s.code = 'HO'
on conflict (site_id, code) do nothing;

-- 4) simpan jam kerja site aktif (buat bila belum ada)
drop function if exists public.shift_save(text, text, time, time, int, int);
create or replace function public.shift_save(p_code text, p_name text, p_start time, p_end time, p_grace int, p_break int, p_days smallint[] default null)
returns public.work_shifts language plpgsql security definer set search_path = public as $$
declare v public.work_shifts; v_site uuid := app.active_site();
begin
  perform app.require_hr('hr.manage');
  if p_code is null or p_code not in ('D','N','K') then raise exception 'Kode jam kerja tidak dikenal' using errcode = '22023'; end if;
  if p_start is null or p_end is null then raise exception 'Jam masuk dan pulang wajib diisi' using errcode = '22023'; end if;
  if p_code in ('D','K') and p_end <= p_start then raise exception 'Jam pulang harus setelah jam masuk' using errcode = '22023'; end if;
  if p_days is not null and (cardinality(p_days) = 0 or not p_days <@ array[1,2,3,4,5,6,7]::smallint[]) then raise exception 'Hari kerja tidak valid' using errcode = '22023'; end if;
  insert into public.work_shifts(site_id, code, name, start_time, end_time, grace_minutes, break_minutes, work_days, updated_by)
  values (v_site, p_code, app.require_text(p_name, 'Nama jam kerja'), p_start, p_end, coalesce(p_grace, 15), coalesce(p_break, 60), coalesce(p_days, '{1,2,3,4,5}'), auth.uid())
  on conflict (site_id, code) do update set name = excluded.name, start_time = excluded.start_time, end_time = excluded.end_time,
    grace_minutes = case when p_grace is null then public.work_shifts.grace_minutes else excluded.grace_minutes end,
    break_minutes = case when p_break is null then public.work_shifts.break_minutes else excluded.break_minutes end,
    work_days = case when p_days is null then public.work_shifts.work_days else excluded.work_days end,
    updated_at = now(), updated_by = auth.uid()
  returning * into v;
  return v;
end $$;
revoke execute on function public.shift_save(text, text, time, time, int, int, smallint[]) from public, anon;
grant execute on function public.shift_save(text, text, time, time, int, int, smallint[]) to authenticated;

-- 5) isi roster K untuk karyawan aktif site ini pada hari kerja kantor (tanpa libur, tidak menimpa roster yang sudah ada)
create or replace function public.roster_apply_office(p_from date, p_to date)
returns int language plpgsql security definer set search_path = public as $$
declare v_site uuid := app.active_site(); sh public.work_shifts; n int;
begin
  perform app.require_hr('hr.manage');
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'Rentang tanggal tidak valid (maksimal 93 hari)' using errcode = '22023';
  end if;
  select * into sh from public.work_shifts where site_id = v_site and code = 'K';
  if not found then raise exception 'Jam kerja kantor (K) belum diatur untuk site ini' using errcode = 'P0002'; end if;
  insert into public.roster_entries(employee_id, work_date, code, set_by)
  select e.id, d::date, 'K', auth.uid()
    from public.employees e cross join generate_series(p_from, p_to, interval '1 day') d
   where e.site_id = v_site and e.status = 'active'
     and extract(isodow from d)::smallint = any(sh.work_days)
     and not exists(select 1 from public.holidays h where h.holiday_date = d::date)
  on conflict (employee_id, work_date) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.roster_apply_office(date, date) from public, anon;
grant execute on function public.roster_apply_office(date, date) to authenticated;
