-- Atas permintaan Ad: selama masa uji, HO_UAT juga boleh melihat dan mencoba gaji/payroll.
-- Tetap tanpa kelola pengguna (user.manage) dan konfigurasi sistem (system.configure). Cabut HO_UAT sebelum go-live.
insert into public.role_permissions(role_code, permission_code)
select 'HO_UAT', p.code from public.permissions p where p.code in ('payroll.manage', 'payroll.approve', 'payroll.read')
on conflict do nothing;
update public.roles set description = 'Akun HO dapat melihat dan mencoba semua modul selama UAT, termasuk gaji/payroll. Tanpa kelola pengguna dan konfigurasi sistem. Cabut sebelum go-live.'
 where code = 'HO_UAT';
