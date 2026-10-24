-- BSB IMS · M3 · Data awal kerangka kepatuhan
-- Elemen dan subelemen SMKP disusun dari Lampiran IV Kepmen ESDM 1827 K/30/MEM/2018 (perusahaan jasa pertambangan).
-- source_verified = false: rincian persyaratan, kegiatan dan bobot penilaian wajib divalidasi terhadap Lampiran IV
-- dan Kepdirjen Minerba 185.K/30/DJB/2019 sebelum dipakai untuk penilaian resmi.

insert into public.compliance_frameworks(code, name, version, source_ref, is_core, note) values
  ('SMKP','SMKP Minerba','1827/2018','Kepmen ESDM 1827 K/30/MEM/2018 Lampiran IV; Kepdirjen Minerba 185.K/30/DJB/2019', true,
   'Pantau status berlaku dan pencabutan sebagian di JDIH ESDM'),
  ('ISO45001','ISO 45001 K3','2018','ISO 45001:2018', false, null),
  ('ISO14001','ISO 14001 Lingkungan','2015','ISO 14001:2015', false, null),
  ('ISO9001','ISO 9001 Mutu','2015','ISO 9001:2015', false, null),
  ('SMK3','SMK3','PP 50/2012','PP 50 Tahun 2012', false, null);

with hse as (select id from public.departments where code = 'HSE'),
el(code, title, description, sort) as (values
  ('1','Kebijakan','Kebijakan keselamatan pertambangan, pengesahan pimpinan, komunikasi, partisipasi pekerja dan peninjauan', 1),
  ('2','Perencanaan','Penelaahan awal, manajemen risiko, kewajiban hukum, sasaran dan program, rencana kerja dan anggaran', 2),
  ('3','Organisasi dan Personel','Struktur, tugas dan wewenang, penunjukan PJO, komite, kompetensi, komunikasi dan partisipasi', 3),
  ('4','Implementasi','Pengelolaan operasional, lingkungan kerja, kesehatan kerja, keselamatan operasi, pengadaan dan keadaan darurat', 4),
  ('5','Pemantauan, Evaluasi dan Tindak Lanjut','Pengukuran kinerja, inspeksi, evaluasi kepatuhan, investigasi, audit internal dan tindakan perbaikan', 5),
  ('6','Dokumentasi','Manual SMKP, pengendalian dokumen, pengendalian rekaman, jenis dokumen dan rekaman', 6),
  ('7','Tinjauan Manajemen dan Peningkatan Kinerja','Tinjauan manajemen, keputusan, perubahan program dan peningkatan berkelanjutan', 7))
insert into public.compliance_clauses(framework_code, code, level, title, description, owner_department_id, sort_order)
select 'SMKP', code, 'element', title, description, (select id from hse), sort from el;

with sub(parent, code, title, dept, sort) as (values
  ('1','1.1','Penyusunan kebijakan dengan konsultasi pekerja','HSE',1),
  ('1','1.2','Isi kebijakan keselamatan pertambangan','HSE',2),
  ('1','1.3','Penetapan dan pengesahan oleh pimpinan','MGT',3),
  ('1','1.4','Komunikasi kebijakan','HSE',4),
  ('1','1.5','Tinjauan ulang kebijakan','MGT',5),
  ('2','2.1','Penelaahan awal (baseline)','HSE',1),
  ('2','2.2','Manajemen risiko (identifikasi bahaya, penilaian dan pengendalian)','HSE',2),
  ('2','2.3','Identifikasi dan kepatuhan peraturan perundang-undangan serta persyaratan lain','HSE',3),
  ('2','2.4','Penetapan tujuan, sasaran dan program','HSE',4),
  ('2','2.5','Rencana kerja dan anggaran biaya keselamatan pertambangan','MGT',5),
  ('3','3.1','Struktur organisasi','HRGA',1),
  ('3','3.2','Tugas, tanggung jawab dan wewenang','HRGA',2),
  ('3','3.3','Penunjukan PJO dan pengawas operasional/teknis','MGT',3),
  ('3','3.4','Komite / bagian keselamatan pertambangan','HSE',4),
  ('3','3.5','Kompetensi, pendidikan dan pelatihan','HRGA',5),
  ('3','3.6','Komunikasi','HSE',6),
  ('3','3.7','Partisipasi, konsultasi, motivasi dan kesadaran','HSE',7),
  ('4','4.1','Pengelolaan operasional','PRD',1),
  ('4','4.2','Pengelolaan lingkungan kerja','HSE',2),
  ('4','4.3','Pengelolaan kesehatan kerja','HSE',3),
  ('4','4.4','Keselamatan operasi pertambangan (sarana, prasarana, instalasi dan peralatan)','PLT',4),
  ('4','4.5','Sistem perancangan dan rekayasa','PLT',5),
  ('4','4.6','Sistem pembelian','LOG',6),
  ('4','4.7','Pengelolaan subkontraktor jasa pertambangan','LOG',7),
  ('4','4.8','Pengelolaan keadaan darurat','HSE',8),
  ('4','4.9','Pertolongan pertama pada kecelakaan','HSE',9),
  ('4','4.10','Keselamatan di luar pekerjaan','HSE',10),
  ('4','4.11','Pengelolaan bahan peledak dan peledakan','HSE',11),
  ('5','5.1','Pemeriksaan, pengukuran dan pemantauan kinerja','HSE',1),
  ('5','5.2','Inspeksi keselamatan','HSE',2),
  ('5','5.3','Evaluasi kepatuhan peraturan','HSE',3),
  ('5','5.4','Penyelidikan kecelakaan dan kejadian berbahaya','HSE',4),
  ('5','5.5','Evaluasi administrasi keselamatan','HSE',5),
  ('5','5.6','Audit internal','HSE',6),
  ('5','5.7','Tindak lanjut dan rencana perbaikan','HSE',7),
  ('6','6.1','Manual SMKP','MGT',1),
  ('6','6.2','Pengendalian dokumen','MGT',2),
  ('6','6.3','Pengendalian rekaman','MGT',3),
  ('6','6.4','Penetapan jenis dokumen dan rekaman','MGT',4),
  ('7','7.1','Tinjauan manajemen','MGT',1),
  ('7','7.2','Tindak lanjut tinjauan dan peningkatan kinerja berkelanjutan','MGT',2))
-- Bahan peledak (4.11): BSB jasa hauling, penerapan ditetapkan setelah lingkup aktual dikonfirmasi.
insert into public.compliance_clauses(framework_code, parent_id, code, level, title, owner_department_id, sort_order,
                                      applicability, applicability_note)
select 'SMKP', p.id, s.code, 'subelement', s.title, d.id, s.sort,
       case when s.code = '4.11' then 'to_confirm' else 'applicable' end,
       case when s.code = '4.11' then 'Hauling batubara; konfirmasi apakah BSB menangani bahan peledak' end
  from sub s
  join public.compliance_clauses p on p.framework_code = 'SMKP' and p.code = s.parent
  join public.departments d on d.code = s.dept;


-- Struktur tingkat atas ISO (Annex SL) dan SMK3 untuk pemetaan silang.
insert into public.compliance_clauses(framework_code, code, level, title, sort_order, source_verified)
select f, c, 'element', t, s, true
  from unnest(array['ISO45001','ISO14001','ISO9001']) f,
       (values ('4','Konteks organisasi',4), ('5','Kepemimpinan',5), ('6','Perencanaan',6), ('7','Dukungan',7),
               ('8','Operasi',8), ('9','Evaluasi kinerja',9), ('10','Peningkatan',10)) x(c, t, s);
insert into public.compliance_clauses(framework_code, code, level, title, sort_order, source_verified) values
  ('SMK3','1','element','Penetapan kebijakan K3',1,true), ('SMK3','2','element','Perencanaan K3',2,true), ('SMK3','3','element','Pelaksanaan rencana K3',3,true),
  ('SMK3','4','element','Pemantauan dan evaluasi kinerja K3',4,true), ('SMK3','5','element','Peninjauan dan peningkatan kinerja SMK3',5,true);

-- Pemetaan elemen SMKP → klausul ISO/SMK3 (indikatif, bisa dirinci per subelemen oleh pengelola kepatuhan).
insert into public.clause_mappings(clause_id, mapped_clause_id)
select s.id, t.id
  from (values ('1','ISO','5'), ('2','ISO','6'), ('3','ISO','7'), ('3','ISO','5'), ('4','ISO','8'), ('5','ISO','9'), ('5','ISO','10'),
               ('6','ISO','7'), ('7','ISO','9'), ('7','ISO','10'),
               ('1','SMK3','1'), ('2','SMK3','2'), ('3','SMK3','3'), ('4','SMK3','3'), ('5','SMK3','4'), ('6','SMK3','3'), ('7','SMK3','5')) m(smkp, fw, iso)
  join public.compliance_clauses s on s.framework_code = 'SMKP' and s.code = m.smkp
  join public.compliance_clauses t on t.code = m.iso and t.level = 'element'
   and (t.framework_code = m.fw or (m.fw = 'ISO' and t.framework_code in ('ISO45001','ISO14001','ISO9001')));

-- Kontrol awal yang langsung dipenuhi modul yang sudah ada.
insert into public.compliance_controls(clause_id, title, control_type, frequency, document_type_code, owner_department_id)
select c.id, k.title, k.ctype, k.freq, k.dtype, c.owner_department_id
  from (values
    ('1.3','Kebijakan keselamatan pertambangan ditandatangani pimpinan','document','annual','KBJ'),
    ('2.2','Register IBPR / risk register per area kerja','record','quarterly',null),
    ('2.3','Legal register dan evaluasi kepatuhan','record','semiannual',null),
    ('2.4','Program keselamatan tahunan','program','annual','PRG'),
    ('3.3','SK penunjukan PJO dan pengawas','document','event','SKP'),
    ('5.2','Inspeksi terencana dan P2H','inspection','daily',null),
    ('5.4','Laporan investigasi insiden','record','event',null),
    ('5.7','Action plan dengan verifikasi independen','record','event',null),
    ('6.1','Manual SMKP berlaku','document','annual','MAN'),
    ('6.2','Register dokumen terkendali','document','event','SOP'),
    ('7.1','Notulen tinjauan manajemen','meeting','annual','REK')
  ) k(code, title, ctype, freq, dtype)
  join public.compliance_clauses c on c.framework_code = 'SMKP' and c.code = k.code;
