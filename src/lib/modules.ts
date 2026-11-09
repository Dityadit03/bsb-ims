// Peta menu mengikuti urutan modul pada rencana build. `ready` menandai modul yang sudah dibangun.
// perm: wajib punya izin ini. any: cukup punya salah satu. Tanpa keduanya = menu bersama untuk semua pengguna aktif.
// Hanya mengatur tampilan menu; pengamanan sebenarnya ada di database (RLS dan fungsi security definer).
export type NavItem = { href: string; label: string; perm?: string; any?: string[] };
export type NavGroup = { code: string; label: string; ready: boolean; items: NavItem[] };

export const NAV: NavGroup[] = [
  { code: 'M0', label: 'Beranda', ready: true, items: [{ href: '/', label: 'Ringkasan' }, { href: '/tugas', label: 'Kotak tugas' }, { href: '/absen', label: 'Absen' }, { href: '/saya', label: 'Saya (ESS)' }, { href: '/belajar', label: 'Belajar' }] },
  { code: 'M2', label: 'Document Control', ready: true, items: [
    { href: '/dokumen', label: 'Register dokumen' },
    { href: '/dokumen/ajukan', label: 'Ajukan / registrasi', any: ['document.request'] },
  ] },
  { code: 'M3', label: 'SMKP & CAPA', ready: true, items: [
    { href: '/smkp', label: 'Matriks 7 elemen' },
    { href: '/capa', label: 'Action plan' },
    { href: '/legal', label: 'Legal register' },
  ] },
  { code: 'M4', label: 'SHE', ready: true, items: [
    { href: '/she', label: 'Ringkasan & formulir' },
    { href: '/she/p2h', label: 'P2H unit' },
    { href: '/she/ftw', label: 'Fit to work' },
    { href: '/she/hazard', label: 'Hazard report' },
    { href: '/she/observasi', label: 'Observasi PTO' },
    { href: '/she/toolbox', label: 'Toolbox talk' },
    { href: '/she/inspeksi', label: 'Inspeksi' },
    { href: '/she/serah-terima', label: 'Serah terima shift' },
    { href: '/she/induksi', label: 'Induksi' },
    { href: '/she/insiden', label: 'Insiden' },
    { href: '/she/risiko', label: 'Risk register', any: ['risk.manage', 'risk.approve', 'she.followup', 'she.investigate', 'compliance.assess', 'audit.read'] },
    { href: '/she/sap', label: 'SAP', any: ['sap.manage', 'she.followup', 'she.investigate', 'compliance.assess', 'audit.read'] },
    { href: '/she/pelanggaran', label: 'Pelanggaran GR/SPDK', any: ['she.discipline'] },
    { href: '/she/izin', label: 'Izin masuk area', any: ['she.permit'] },
    { href: '/pusat-data', label: 'Pusat Data SHE' },
  ] },
  { code: 'M5', label: 'Plant', ready: true, items: [{ href: '/plant', label: 'Register unit' }, { href: '/plant/spip', label: 'Komisioning SPIP', any: ['spip.manage', 'plant.manage', 'she.followup'] }, { href: '/plant/wo', label: 'Work order' }, { href: '/plant/breakdown', label: 'Breakdown lapangan' }, { href: '/plant/keandalan', label: 'Keandalan & biaya', any: ['plant.manage', 'plant.work', 'prod.manage', 'mgmt.review'] }, { href: '/plant/komponen', label: 'Umur komponen', any: ['plant.manage', 'plant.work'] }, { href: '/katalog', label: 'Katalog suku cadang' }] },
  { code: 'M6', label: 'Produksi', ready: true, items: [{ href: '/produksi', label: 'Laporan hauling' }, { href: '/produksi/master', label: 'Rute & target', any: ['prod.manage', 'prod.approve'] }] },
  { code: 'M7', label: 'Logistik', ready: true, items: [{ href: '/logistik', label: 'Stok & gudang' }, { href: '/logistik/mr', label: 'Material request' }, { href: '/logistik/pengadaan', label: 'Pengadaan (PR/PO)', any: ['log.purchase', 'log.approve', 'log.approve_high', 'log.ho', 'log.ho_approve', 'log.manage'] }, { href: '/logistik/bbm', label: 'Stasiun BBM', any: ['log.warehouse', 'log.manage', 'log.approve_fuel_other', 'plant.work'] }, { href: '/logistik/supplier', label: 'Supplier', any: ['log.manage', 'log.purchase', 'log.ho', 'log.ho_approve'] }, { href: '/katalog', label: 'Katalog suku cadang' }] },
  { code: 'M8', label: 'HRGA', ready: true, items: [{ href: '/hrga', label: 'Karyawan', any: ['hr.manage', 'hr.roster', 'hr.exit', 'recruit.approve'] }, { href: '/hrga/kompetensi', label: 'Kompetensi & SIMPER', any: ['hr.manage', 'hr.roster', 'she.followup', 'she.induction', 'plant.work', 'prod.report'] }, { href: '/hrga/pelatihan', label: 'Pelatihan', any: ['hr.manage', 'training.organize', 'she.induction'] }, { href: '/hrga/kesiapan', label: 'Kesiapan kerja', any: ['hr.manage', 'hr.roster', 'she.followup', 'prod.report', 'plant.work'] }, { href: '/hrga/roster', label: 'Roster', any: ['hr.roster', 'hr.manage'] }, { href: '/hrga/absensi', label: 'Absensi', any: ['hr.manage', 'hr.roster'] }, { href: '/hrga/cuti', label: 'Cuti & izin' }, { href: '/hrga/lembur', label: 'Lembur (SPL)' }, { href: '/hrga/klaim', label: 'Klaim & kasbon' }, { href: '/hrga/payroll', label: 'Payroll', perm: 'payroll.read' }, { href: '/hrga/rekrutmen', label: 'Rekrutmen', any: ['hr.manage', 'hr.roster', 'recruit.approve'] }, { href: '/hrga/kinerja', label: 'Penilaian kinerja' }, { href: '/hrga/elearning', label: 'E-learning' }, { href: '/hrga/analitik', label: 'Analitik HR', any: ['hr.manage', 'mgmt.review', 'hr.exit'] }, { href: '/hrga/ga', label: 'Permintaan GA' }] },
  { code: 'M9', label: 'PJO & Manajemen', ready: true, items: [{ href: '/manajemen', label: 'Dashboard eksekutif', any: ['mgmt.review', 'ia.manage', 'prod.approve', 'prod.manage', 'log.approve_high', 'hr.exit', 'audit.read', 'compliance.assess'] }, { href: '/manajemen/audit', label: 'Audit internal', any: ['ia.manage', 'ia.perform', 'audit.read'] }, { href: '/manajemen/tinjauan', label: 'Tinjauan manajemen', any: ['mgmt.review', 'ia.manage'] }] },
  { code: 'ADM', label: 'Administrasi', ready: true, items: [
    { href: '/master/organisasi', label: 'Organisasi', any: ['master.manage', 'hr.manage', 'user.manage'] },
    { href: '/admin/penomoran', label: 'Penomoran', any: ['numbering.configure', 'numbering.issue', 'numbering.void'] },
    { href: '/data', label: 'Laporan & spreadsheet' },
    { href: '/data/impor', label: 'Impor data (Excel)', any: ['hr.manage', 'log.manage', 'catalog.manage', 'master.manage', 'plant.manage', 'prod.manage'] },
    { href: '/admin/pengguna', label: 'Pengguna & peran', perm: 'user.manage' },
    { href: '/admin/site', label: 'Daftar site', perm: 'user.manage' },
    { href: '/admin/alur-persetujuan', label: 'Alur persetujuan', any: ['workflow.configure', 'workflow.delegate', 'user.manage'] },
    { href: '/audit', label: 'Audit trail', perm: 'audit.read' },
  ] },
];
