-- BSB IMS · M0 · Data referensi awal
-- Departemen, seksi dan pola nomor dokumen diambil dari Document Control BSB v4 yang sudah berjalan.

insert into public.app_settings(key, value, description) values
  ('timezone', '"Asia/Makassar"', 'Zona waktu site untuk tanggal penomoran'),
  ('company', '{"code":"BSB","name":"PT Berkarya Sejahtera Bersama"}', 'Identitas perusahaan');

insert into public.sites(code, name, client_company) values ('BDA', 'Site BDA', 'PT BDA');

insert into public.departments(code, name, sort_order) values
  ('HSE','HSE',1), ('PLT','Plant',2), ('PRD','Produksi',3), ('LOG','Logistik',4), ('HRGA','HRGA',5), ('MGT','Manajemen',6);

insert into public.sections(department_id, code, name)
select d.id, s.code, s.name
  from (values
    ('HSE','SFT','Safety'), ('HSE','HLT','Kesehatan (Medik)'), ('HSE','ENV','Lingkungan'),
    ('PLT','MTC','Maintenance'), ('PRD','OPR','Operasi'),
    ('HRGA','HRD','HRD'), ('HRGA','GA','General Affair'),
    ('LOG','PUR','Purchasing'),
    ('MGT','DIR','Direksi/PJO'), ('MGT','DC','Document Control')
  ) as s(dept, code, name)
  join public.departments d on d.code = s.dept;

insert into public.roles(code, name, description, is_system) values
  ('SYS_ADMIN','System Administrator','Konfigurasi teknis dan akun; tidak otomatis berhak menyetujui dokumen bisnis', true),
  ('DOC_CONTROLLER','Document Controller','Registrasi, pemeriksaan format, penerbitan dan distribusi dokumen', true),
  ('STAFF','Staff / Operator','Membuat transaksi dan mengirim bukti sesuai tugas', true),
  ('SUPERVISOR','Supervisor / Foreman','Memeriksa pekerjaan dan mengesahkan transaksi sesuai kewenangan', true),
  ('SUPERINTENDENT','Superintendent','Mengelola kegiatan dan approval sesuai matriks', true),
  ('DEPT_HEAD','Department Head','Persetujuan serta pemantauan departemen', true),
  ('HSE_MANAGER','SHE/HSE Manager','Persetujuan khusus dalam ruang lingkup HSE', true),
  ('PJO','Penanggung Jawab Operasional','Kewenangan sesuai penunjukan dan ketentuan yang berlaku', true),
  ('MGMT_APPROVER','Management / Authorized Approver','Persetujuan kebijakan dan dokumen sesuai delegasi', true),
  ('INTERNAL_AUDITOR','Internal Auditor','Membaca bukti audit dan mencatat temuan tanpa mengubah bukti sumber', true),
  ('VIEWER','Read-only','Akses baca data yang dibagikan', true);

insert into public.permissions(code, module, description) values
  ('system.configure','core','Mengubah pengaturan sistem'),
  ('user.manage','core','Mengaktifkan pengguna dan mengatur peran'),
  ('master.manage','core','Mengelola master organisasi'),
  ('audit.read','core','Membaca audit trail'),
  ('records.read_restricted','core','Membaca lampiran berklasifikasi terbatas'),
  ('numbering.issue','numbering','Menerbitkan nomor langsung'),
  ('numbering.void','numbering','Membatalkan nomor terbit'),
  ('numbering.configure','numbering','Mengatur skema penomoran dan impor nomor lama'),
  ('document.request','document','Mengajukan dokumen baru atau revisi'),
  ('document.review','document','Mereview dokumen'),
  ('document.verify','document','Verifikasi format dan kelengkapan (Document Control)'),
  ('document.approve','document','Menyetujui dokumen'),
  ('document.release','document','Menerbitkan versi terkendali dan distribusi'),
  ('document.read_restricted','document','Membaca dokumen terbatas/rahasia');

insert into public.role_permissions(role_code, permission_code)
select r, p from (values
  ('SYS_ADMIN','system.configure'), ('SYS_ADMIN','user.manage'), ('SYS_ADMIN','master.manage'), ('SYS_ADMIN','audit.read'),
  ('SYS_ADMIN','numbering.configure'),
  ('DOC_CONTROLLER','numbering.issue'), ('DOC_CONTROLLER','numbering.void'), ('DOC_CONTROLLER','numbering.configure'),
  ('DOC_CONTROLLER','document.request'), ('DOC_CONTROLLER','document.verify'), ('DOC_CONTROLLER','document.release'),
  ('DOC_CONTROLLER','document.read_restricted'), ('DOC_CONTROLLER','audit.read'),
  ('STAFF','document.request'),
  ('SUPERVISOR','document.request'), ('SUPERVISOR','document.review'), ('SUPERVISOR','numbering.issue'),
  ('SUPERINTENDENT','document.request'), ('SUPERINTENDENT','document.review'), ('SUPERINTENDENT','document.approve'), ('SUPERINTENDENT','numbering.issue'),
  ('DEPT_HEAD','document.request'), ('DEPT_HEAD','document.review'), ('DEPT_HEAD','document.approve'), ('DEPT_HEAD','numbering.issue'),
  ('DEPT_HEAD','document.read_restricted'),
  ('HSE_MANAGER','document.request'), ('HSE_MANAGER','document.review'), ('HSE_MANAGER','document.approve'), ('HSE_MANAGER','numbering.issue'),
  ('PJO','document.review'), ('PJO','document.approve'), ('PJO','document.read_restricted'), ('PJO','audit.read'),
  ('MGMT_APPROVER','document.approve'), ('MGMT_APPROVER','document.read_restricted'),
  ('INTERNAL_AUDITOR','audit.read'), ('INTERNAL_AUDITOR','records.read_restricted')
) as x(r, p);

insert into public.numbering_schemes(code, name, pattern, module) values
  ('REG_DOC','Registrasi permohonan dokumen','REG-DOC-{YYYY}-{N6}','document'),
  ('KBJ','Kebijakan','KBJ-BSB-{D}-{N3}','document'),
  ('MAN','Manual','MAN-BSB-{D}-{N3}','document'),
  ('SOP','SOP / Prosedur','SOP-BSB-{D}-{S}-{N3}','document'),
  ('STD','Standar','STD-BSB-{D}-{S}-{N3}','document'),
  ('IK','Instruksi Kerja','IK.{N2}/{P}','document'),
  ('F','Formulir','F.{N2}/{P}','document'),
  ('PRG','Program','PRG-BSB-{D}-{S}-{Y}-{N3}','document'),
  ('REK','Rekaman / Laporan','REK-BSB-{D}-{S}-{Y}-{N4}','document'),
  ('IZN','Izin / Sertifikat / Lisensi','IZN-BSB-{D}-{Y}-{N3}','document'),
  ('EXT','Dokumen eksternal','EXT-BSB-{D}-{N3}','document'),
  ('SRM','Surat masuk','SRM-BSB-{Y}-{N4}','correspondence'),
  ('SRK','Surat keluar','SRK-BSB-{D}-{Y}-{N4}','correspondence'),
  ('SKP','Surat keputusan','SKP-BSB-{D}-{Y}-{N3}','correspondence'),
  ('ACT','Action plan / CAPA','ACT-BSB-{YYYY}-{N6}','capa'),
  ('INC','Laporan insiden','INC-BSB-{YYYY}-{N6}','she'),
  ('INS','Inspeksi / P2H','INS-BSB-{YYYYMMDD}-{N4}','she'),
  ('WO','Work order','WO-BSB-{YYYY}-{N6}','plant'),
  ('MR','Material request','MR-BSB-{YYYY}-{N6}','logistics'),
  ('PRD','Laporan produksi','PRD-BSB-{YYYYMMDD}-{SHIFT}-{N2}','production');
