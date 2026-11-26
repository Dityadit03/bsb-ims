-- Kunci login NIK per akun (keputusan Ad 26 Nov 2026): 5 kali salah -> tunggu 30 menit.
-- Salah lagi setelah terkunci -> langsung terkunci lagi dengan waktu dua kali lipat (60, 120, ... maks 24 jam).
-- Berhasil masuk -> catatan dihapus. Tidak ada kegagalan selama 24 jam -> hitungan kembali dari nol.
-- Batas percobaan bawaan Supabase dihitung per IP, sedangkan semua login NIK lewat IP server aplikasi yang sama,
-- jadi tanpa ini NIK (berpola YY.MM.NNN) bisa ditebak sandinya berulang-ulang.

create table app.nik_login_attempts(
  nrp text primary key,
  failures int not null default 0,
  lock_level int not null default 0,
  locked_until timestamptz,
  last_failed_at timestamptz not null default now()
);
alter table app.nik_login_attempts enable row level security;
revoke all on app.nik_login_attempts from public, anon, authenticated;

-- Hanya NIK karyawan yang tercatat yang dilacak (tabel tidak bisa dibanjiri isian acak). Jawaban sama untuk NIK yang ada/tidak ada.
create or replace function public.nik_login_gate(p_nrp text) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((select greatest(0, ceil(extract(epoch from a.locked_until - now())))::int
                     from app.nik_login_attempts a where a.nrp = upper(btrim(p_nrp)) and a.locked_until > now()), 0)
$$;

create or replace function public.nik_login_failed(p_nrp text) returns integer
language plpgsql volatile security definer set search_path = public as $$
declare
  v_nrp text := upper(btrim(coalesce(p_nrp, '')));
  a app.nik_login_attempts;
  v_min int;
begin
  if length(v_nrp) not between 3 and 20 then return 0; end if;
  if not exists(select 1 from public.employees e where upper(e.nrp) = v_nrp) then return 0; end if;
  insert into app.nik_login_attempts(nrp, failures, last_failed_at) values (v_nrp, 0, now()) on conflict (nrp) do nothing;
  select * into a from app.nik_login_attempts where nrp = v_nrp for update;
  if a.locked_until > now() then
    return ceil(extract(epoch from a.locked_until - now()))::int;
  end if;
  if a.last_failed_at < now() - interval '24 hours' then a.failures := 0; a.lock_level := 0; end if;
  a.failures := a.failures + 1;
  if (a.lock_level = 0 and a.failures >= 5) or a.lock_level > 0 then
    v_min := least(30 * power(2, a.lock_level)::int, 1440);
    a.locked_until := now() + make_interval(mins => v_min);
    a.lock_level := a.lock_level + 1;
    a.failures := 0;
  end if;
  update app.nik_login_attempts set failures = a.failures, lock_level = a.lock_level, locked_until = a.locked_until, last_failed_at = now()
   where nrp = v_nrp;
  return coalesce(greatest(0, ceil(extract(epoch from a.locked_until - now())))::int, 0);
end $$;

-- Dipanggil setelah berhasil masuk (sudah berstatus authenticated): NIK diambil dari akun sendiri, bukan dari isian.
create or replace function public.nik_login_succeeded() returns void
language sql volatile security definer set search_path = public as $$
  delete from app.nik_login_attempts
   where nrp = upper(split_part(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''), '@', 1))
$$;

revoke execute on function public.nik_login_gate(text) from public;
revoke execute on function public.nik_login_failed(text) from public;
revoke execute on function public.nik_login_succeeded() from public, anon;
grant execute on function public.nik_login_gate(text) to anon, authenticated;
grant execute on function public.nik_login_failed(text) to anon, authenticated;
grant execute on function public.nik_login_succeeded() to authenticated;

-- Admin bisa membuka kunci lebih awal (mis. karyawan sudah dikonfirmasi lewat telepon)
create or replace function public.nik_login_unlock(p_nrp text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not app.has_permission('user.manage') then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  delete from app.nik_login_attempts where nrp = upper(btrim(p_nrp));
  perform app.log_event('auth.nik_unlock', 'nik_login_attempts', upper(btrim(p_nrp)), '{}'::jsonb);
end $$;
revoke execute on function public.nik_login_unlock(text) from public, anon;
grant execute on function public.nik_login_unlock(text) to authenticated;
