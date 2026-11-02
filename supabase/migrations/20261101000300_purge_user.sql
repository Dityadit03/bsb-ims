-- Penghapusan akun. Hapus user di dashboard Supabase gagal ("Database error deleting user") karena lebih dari 120 kolom
-- (pembuat, pelapor, approver, pelaku audit, dst.) menunjuk ke profil tanpa aturan hapus: riwayat tidak boleh yatim.
-- Cara yang benar untuk akun yang pernah dipakai: NONAKTIFKAN (Pengguna & peran), riwayat tetap utuh.
-- Untuk akun uji / salah daftar yang belum punya riwayat bisnis: public.admin_purge_user(user_id) di SQL Editor.
-- Hanya kolom opsional (audit, pemberi peran, penghubung karyawan, dst.) yang dikosongkan; bila ada kolom wajib
-- yang masih menunjuk ke akun itu, penghapusan ditolak dan tabel penghalangnya disebutkan.

create function app.user_refs(p_user uuid)
returns table(tbl text, col text, nullable boolean, n bigint) language plpgsql security definer set search_path = public as $$
declare r record; cnt bigint;
begin
  for r in
    select c.conrelid::regclass::text as t, a.attname::text as a, not a.attnotnull as nl
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass and c.confdeltype in ('a', 'r') and array_length(c.conkey, 1) = 1
  loop
    execute format('select count(*) from %s where %I = $1', r.t, r.a) into cnt using p_user;
    if cnt > 0 then tbl := r.t; col := r.a; nullable := r.nl; n := cnt; return next; end if;
  end loop;
end $$;

create function public.admin_purge_user(p_user uuid) returns text language plpgsql security definer set search_path = public as $$
declare r record; v_block text; v_emp int;
begin
  if not (app.has_permission_anywhere('user.manage') or (auth.uid() is null and session_user in ('postgres', 'supabase_admin'))) then
    raise exception 'Tidak berwenang' using errcode = '42501';
  end if;
  if p_user is not distinct from auth.uid() then raise exception 'Tidak bisa menghapus akun sendiri' using errcode = '42501'; end if;
  if not exists(select 1 from auth.users where id = p_user) then raise exception 'Akun tidak ditemukan' using errcode = 'P0002'; end if;
  select string_agg(x.tbl || '.' || x.col || ' (' || x.n || ')', ', ') into v_block from app.user_refs(p_user) x where not x.nullable;
  if v_block is not null then
    raise exception 'Akun punya riwayat bisnis, tidak bisa dihapus tanpa merusak catatan: %. Nonaktifkan akun ini saja.', v_block using errcode = '23503';
  end if;
  for r in select * from app.user_refs(p_user) where nullable loop
    execute format('update %s set %I = null where %I = $1', r.tbl, r.col, r.col) using p_user;
  end loop;
  select count(*) into v_emp from public.employees where profile_id is null;  -- (penghubung karyawan sudah dikosongkan di atas)
  delete from auth.users where id = p_user;
  return 'Akun dihapus; data karyawan (bila ada) tetap, hanya tautan akunnya dilepas';
end $$;

revoke all on function app.user_refs(uuid), public.admin_purge_user(uuid) from public, anon, authenticated;
