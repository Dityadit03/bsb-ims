-- Peran lapangan yang lebih sempit untuk jabatan operator/teknisi/petugas, supaya akses sesuai jabatan.
-- Peran STAFF (lebar) tetap untuk jabatan administrasi (Admin HRGA, Admin Logistik, Planner, dst.).
-- Hanya berlaku untuk aktivasi/penambahan akses berikutnya; pengguna yang sudah aktif tidak diubah otomatis.
insert into public.roles(code, name, description, is_system) values
  ('OPERATOR', 'Operator / Driver / Helper', 'Melaporkan hazard, observasi, P2H, insiden dan kerusakan unit.', true),
  ('TEKNISI', 'Teknisi (Mekanik, Welder, Tyreman)', 'Seperti operator, ditambah mengerjakan work order dan meminta suku cadang.', true),
  ('PETUGAS_LAPANGAN', 'Petugas lapangan (Checker, Dumpman, Trafficman)', 'Seperti operator, ditambah menyusun laporan produksi shift.', true),
  ('PETUGAS_BBM', 'Petugas BBM (Fuelman)', 'Seperti operator, ditambah penerimaan/pengeluaran BBM dan barang.', true),
  ('SAFETY_STAFF', 'Staf HSE (Safety Officer, Patrol, Safetyman, Medik)', 'Pelaporan SHE lengkap, menutup temuan, induksi, izin masuk area, pelanggaran dan action plan.', true)
on conflict (code) do nothing;

insert into public.role_permissions(role_code, permission_code) values
  ('OPERATOR','she.report'), ('OPERATOR','plant.report'),
  ('TEKNISI','she.report'), ('TEKNISI','plant.report'), ('TEKNISI','plant.work'), ('TEKNISI','log.request'),
  ('PETUGAS_LAPANGAN','she.report'), ('PETUGAS_LAPANGAN','plant.report'), ('PETUGAS_LAPANGAN','prod.report'),
  ('PETUGAS_BBM','she.report'), ('PETUGAS_BBM','plant.report'), ('PETUGAS_BBM','log.warehouse'),
  ('SAFETY_STAFF','she.report'), ('SAFETY_STAFF','she.followup'), ('SAFETY_STAFF','she.induction'), ('SAFETY_STAFF','she.permit'),
  ('SAFETY_STAFF','she.discipline'), ('SAFETY_STAFF','capa.create'), ('SAFETY_STAFF','document.request')
on conflict do nothing;

update public.positions p set access_role = m.role
  from (values
    ('PLT', 'Helper Mechanic', 'TEKNISI'), ('PLT', 'Junior Mechanic', 'TEKNISI'), ('PLT', 'Senior Mechanic', 'TEKNISI'),
    ('PLT', 'Junior Welder', 'TEKNISI'), ('PLT', 'Senior Welder', 'TEKNISI'), ('PLT', 'Tyreman', 'TEKNISI'),
    ('PLT', 'Tyreman/Driver', 'TEKNISI'), ('PLT', 'Mekanik', 'TEKNISI'),
    ('HRGA', 'Driver ELF', 'OPERATOR'),
    ('PRD', 'Operator dump truck', 'OPERATOR'), ('PRD', 'Operator excavator', 'OPERATOR'),
    ('PRD', 'Checker', 'PETUGAS_LAPANGAN'), ('PRD', 'Checker Pit', 'PETUGAS_LAPANGAN'), ('PRD', 'Dumpman', 'PETUGAS_LAPANGAN'),
    ('PRD', 'Dumpman/Checker', 'PETUGAS_LAPANGAN'), ('PRD', 'Trafficman', 'PETUGAS_LAPANGAN'),
    ('LOG', 'Fuelman', 'PETUGAS_BBM'),
    ('HSE', 'Safety Officer', 'SAFETY_STAFF'), ('HSE', 'Safety officer', 'SAFETY_STAFF'), ('HSE', 'Safety Patrol', 'SAFETY_STAFF'),
    ('HSE', 'Safetyman', 'SAFETY_STAFF'), ('HSE', 'Medik', 'SAFETY_STAFF')
  ) as m(dept, name, role)
  join public.departments d on d.code = m.dept
 where p.department_id = d.id and p.name = m.name and p.access_role is null;
