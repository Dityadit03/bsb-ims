-- BSB IMS · Login dengan NIK (NRP) + sandi, dengan persetujuan administrator sistem.
-- Pendaftar memilih NRP + tanggal lahir + sandi. Akun lahir berstatus "pending". Administrator melihat apakah NRP ada di data
-- karyawan, apakah tanggal lahir cocok (tanpa melihat tanggal lahir aslinya) dan apakah NRP sudah dipakai akun lain, lalu mengaktifkan
-- akun sekaligus menautkannya ke karyawan. Akun email NIK memakai alamat sintetis <nrp>@nrp.bsb.local (tidak pernah dikirimi email).

create table public.nik_registrations(
  user_id uuid primary key references public.profiles(id) on delete cascade,
  nrp text not null,
  birth_date date,
  created_at timestamptz not null default now()
);
alter table public.nik_registrations enable row level security;
revoke all on public.nik_registrations from anon, authenticated;
create trigger nik_registrations_audit after insert or update or delete on public.nik_registrations for each row execute function app.audit_row();

-- trigger akun baru: tambahkan pencatatan klaim NRP (isian pendaftar hanyalah klaim; kebenarannya diperiksa administrator)
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(new.email);
  v_domain text := split_part(lower(new.email), '@', 2);
  v_allow public.allowed_emails;
  v_active boolean;
  v_nrp text := upper(nullif(btrim(new.raw_user_meta_data->>'nrp'), ''));
  v_birth date;
begin
  select * into v_allow from public.allowed_emails where email = v_email;
  v_active := v_allow.email is not null
              or exists(select 1 from public.allowed_domains where domain = v_domain);
  insert into public.profiles(id, email, full_name, status)
  values (new.id, v_email,
          coalesce(nullif(new.raw_user_meta_data->>'full_name',''), nullif(new.raw_user_meta_data->>'name',''), split_part(v_email,'@',1)),
          case when v_active then 'active' else 'pending' end)
  on conflict (id) do nothing;
  if v_allow.initial_role is not null then
    insert into public.user_roles(user_id, role_code, basis)
    values (new.id, v_allow.initial_role, 'allowlist awal')
    on conflict do nothing;
  end if;
  if v_nrp is not null and v_domain = 'nrp.bsb.local' and not v_active then
    begin v_birth := (new.raw_user_meta_data->>'birth_date')::date; exception when others then v_birth := null; end;
    insert into public.nik_registrations(user_id, nrp, birth_date) values (new.id, v_nrp, v_birth) on conflict do nothing;
    -- tanggal lahir hanya disimpan di nik_registrations (tidak terbaca pengguna lain); buang dari metadata akun
    update auth.users set raw_user_meta_data = raw_user_meta_data - 'birth_date' where id = new.id;
  end if;
  return new;
end $$;

-- Daftar pendaftar NIK + hasil pemeriksaan untuk administrator
create function public.nik_pending() returns table(
  user_id uuid, nrp text, typed_name text, registered_at timestamptz,
  employee_id uuid, employee_name text, department text, employee_status text, already_linked boolean, birth_match boolean, birth_known boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not app.has_permission('user.manage') then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  return query
  select r.user_id, r.nrp, p.full_name, r.created_at, e.id, e.full_name, d.code, e.status,
         coalesce(e.profile_id is not null, false),
         coalesce(ep.birth_date = r.birth_date, false),
         ep.birth_date is not null
    from public.nik_registrations r
    join public.profiles p on p.id = r.user_id and p.status = 'pending'
    left join public.employees e on upper(e.nrp) = r.nrp
    left join public.departments d on d.id = e.department_id
    left join public.employee_private ep on ep.employee_id = e.id
   order by r.created_at;
end $$;

create function public.activate_nik_user(p_user uuid, p_role text, p_department uuid default null, p_basis text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.nik_registrations;
  e public.employees;
  v_birth date;
begin
  if not app.has_permission('user.manage') then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'Tidak bisa mengaktifkan akun sendiri' using errcode = '42501'; end if;
  select * into r from public.nik_registrations where user_id = p_user;
  if not found then raise exception 'Bukan pendaftaran NIK; gunakan aktivasi biasa' using errcode = '22023'; end if;
  select * into e from public.employees where upper(nrp) = r.nrp;
  if not found then raise exception 'NRP % tidak ada di data karyawan; minta HRGA mendaftarkannya dulu', r.nrp using errcode = '22023'; end if;
  if e.status <> 'active' then raise exception 'Karyawan % tidak aktif', r.nrp using errcode = '22023'; end if;
  if e.profile_id is not null then raise exception 'NRP % sudah tertaut ke akun lain', r.nrp using errcode = '23505'; end if;
  select birth_date into v_birth from public.employee_private where employee_id = e.id;
  if v_birth is null then raise exception 'Tanggal lahir karyawan belum diisi HRGA; lengkapi dulu agar identitas bisa dicocokkan' using errcode = '22023'; end if;
  if r.birth_date is distinct from v_birth then raise exception 'Tanggal lahir yang didaftarkan tidak cocok dengan data karyawan; tolak atau konfirmasi langsung ke yang bersangkutan' using errcode = '22023'; end if;
  update public.employees set profile_id = p_user where id = e.id;
  update public.profiles set status = 'active', full_name = e.full_name, department_id = coalesce(e.department_id, department_id) where id = p_user;
  if p_role is not null then
    insert into public.user_roles(user_id, role_code, department_id, basis, granted_by)
    values (p_user, p_role, p_department, p_basis, auth.uid()) on conflict do nothing;
  end if;
  delete from public.nik_registrations where user_id = p_user; -- tanggal lahir tidak perlu disimpan setelah verifikasi
  perform app.log_event('user.activate_nik', 'profiles', p_user::text, jsonb_build_object('nrp', r.nrp, 'role', p_role));
end $$;

-- Tolak pendaftar: akun ditangguhkan (tidak dihapus agar jejak tetap ada)
create function public.reject_nik_user(p_user uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not app.has_permission('user.manage') then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'Tidak bisa menolak akun sendiri' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Alasan penolakan wajib diisi' using errcode = '22023'; end if;
  update public.profiles set status = 'suspended' where id = p_user and status = 'pending';
  delete from public.nik_registrations where user_id = p_user;
  perform app.log_event('user.reject_nik', 'profiles', p_user::text, jsonb_build_object('reason', p_reason));
end $$;

-- Dipanggil Edge Function reset sandi (dengan JWT administrator). Hanya akun NIK, bukan diri sendiri; tercatat di audit log.
create function public.password_reset_authorize(p_user uuid) returns text language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if not app.has_permission('user.manage') then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'Ubah sandi sendiri lewat menu akun' using errcode = '42501'; end if;
  select email into v_email from public.profiles where id = p_user and status = 'active';
  if v_email is null or v_email not like '%@nrp.bsb.local' then raise exception 'Hanya akun login NIK yang aktif yang bisa direset' using errcode = '22023'; end if;
  perform app.log_event('user.password_reset', 'profiles', p_user::text, null);
  return v_email;
end $$;

-- aktivasi biasa tidak boleh dipakai untuk pendaftar NIK (harus lewat activate_nik_user agar tertaut ke karyawan & identitas dicocokkan)
create or replace function public.activate_user(p_user uuid, p_role text, p_department uuid default null, p_basis text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not app.has_permission('user.manage') then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'Tidak bisa mengaktifkan akun sendiri' using errcode = '42501'; end if;
  if exists(select 1 from public.nik_registrations where user_id = p_user) then
    raise exception 'Pendaftar NIK harus diaktifkan lewat panel "Pendaftar NIK" agar tertaut ke data karyawan' using errcode = '22023';
  end if;
  update public.profiles set status = 'active' where id = p_user;
  if p_role is not null then
    insert into public.user_roles(user_id, role_code, department_id, basis, granted_by)
    values (p_user, p_role, p_department, p_basis, auth.uid())
    on conflict do nothing;
  end if;
  perform app.log_event('user.activate', 'profiles', p_user::text, jsonb_build_object('role', p_role));
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and p.proname not in ('verify_document','feed_rows') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
