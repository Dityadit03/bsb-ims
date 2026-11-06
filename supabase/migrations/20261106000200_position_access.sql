-- Pemberian akses berdasarkan JABATAN (bukan memilih peran satu per satu).
--  1) positions.access_role: peran yang menyertai jabatan (kosong = ditentukan dari level jabatan)
--  2) position_access(): peran + lingkup departemen untuk jabatan; hanya administrator pengguna
--  3) Peran HO_UAT: akses luas SEMENTARA untuk akun HO selama masa uji (tanpa kelola pengguna, konfigurasi sistem, dan gaji/payroll)
--  4) Jabatan HO (tanpa departemen) agar akun HO diberi akses sesuai jabatannya
-- HO_UAT harus dicabut/diganti peran jabatan sebenarnya sebelum go-live.

alter table public.positions add column if not exists access_role text references public.roles(code);

insert into public.roles(code, name, description, is_system) values
  ('HO_UAT', 'HO, akses penuh sementara (masa uji)', 'Akun HO dapat melihat dan mencoba semua modul selama UAT. Tanpa kelola pengguna, konfigurasi sistem, dan gaji/payroll. Cabut sebelum go-live.', true)
on conflict (code) do nothing;
insert into public.role_permissions(role_code, permission_code)
select 'HO_UAT', p.code from public.permissions p
 where p.code not in ('user.manage', 'system.configure', 'payroll.manage', 'payroll.approve', 'payroll.read')
on conflict do nothing;

insert into public.positions(department_id, code, name, level, access_role) values
  (null, 'HO-FIN',  'Finance (HO)',          'STAFF', 'HO_UAT'),
  (null, 'HO-ACC',  'Accounting (HO)',       'STAFF', 'HO_UAT'),
  (null, 'HO-HRGA', 'HRGA (HO)',             'STAFF', 'HO_UAT'),
  (null, 'HO-OPS',  'Manager Operasi (HO)',  'DH',    'HO_UAT'),
  (null, 'HO-PROC', 'Pengadaan / Plant (HO)','STAFF', 'HO_UAT')
on conflict (department_id, code) do nothing;
-- unique (department_id, code) tidak menolak duplikat bila department_id null; cegah ganda dengan indeks khusus
create unique index if not exists positions_ho_code_uq on public.positions(code) where department_id is null;

create or replace function public.position_access(p_position uuid default null)
returns table(position_id uuid, role_code text, role_name text, department_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app.has_permission('user.manage') then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  return query
  select p.id,
         coalesce(p.access_role, case p.level when 'PJO' then 'PJO' when 'DH' then 'DEPT_HEAD' when 'SH' then 'SUPERINTENDENT'
                                              when 'SPV' then 'SUPERVISOR' when 'FOR' then 'SUPERVISOR' else 'STAFF' end),
         r.name, p.department_id
    from public.positions p
    join public.roles r on r.code = coalesce(p.access_role, case p.level when 'PJO' then 'PJO' when 'DH' then 'DEPT_HEAD' when 'SH' then 'SUPERINTENDENT'
                                              when 'SPV' then 'SUPERVISOR' when 'FOR' then 'SUPERVISOR' else 'STAFF' end)
   where p.active and (p_position is null or p.id = p_position);
end $$;
revoke execute on function public.position_access(uuid) from public, anon;
grant execute on function public.position_access(uuid) to authenticated;
