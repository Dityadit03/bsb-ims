// Peta menu mengikuti urutan modul pada rencana build. `ready` menandai modul yang sudah dibangun.
export type NavItem = { href: string; label: string; perm?: string };
export type NavGroup = { code: string; label: string; ready: boolean; items: NavItem[] };

export const NAV: NavGroup[] = [
  { code: 'M0', label: 'Beranda', ready: true, items: [{ href: '/', label: 'Ringkasan' }, { href: '/tugas', label: 'Kotak tugas' }, { href: '/absen', label: 'Absen' }, { href: '/saya', label: 'Saya (ESS)' }, { href: '/belajar', label: 'Belajar' }] },
  { code: 'M2', label: 'Document Control', ready: true, items: [
    { href: '/dokumen', label: 'Register dokumen' },
    { href: '/dokumen/ajukan', label: 'Ajukan / registrasi' },
  ] },
  { code: 'M3', label: 'SMKP & CAPA', ready: true, items: [
    { href: '/smkp', label: 'Matriks 7 elemen' },
    { href: '/capa', label: 'Action plan' },
    { href: '/legal', label: 'Legal register' },
  ] },
  { code: 'M4', label: 'SHE', ready: true, items: [
    { href: '/she', label: 'Ringkasan & formulir' },
    { href: '/she/hazard', label: 'Hazard report' },
    { href: '/she/inspeksi', label: 'Inspeksi' },
    { href: '/she/insiden', label: 'Insiden' },
    { href: '/she/risiko', label: 'Risk register' },
    { href: '/she/sap', label: 'SAP' },
    { href: '/she/pelanggaran', label: 'Pelanggaran GR/SPDK' },
    { href: '/she/izin', label: 'Izin masuk area' },
    { href: '/pusat-data', label: 'Pusat Data SHE' },
  ] },
  { code: 'M5', label: 'Plant', ready: true, items: [{ href: '/plant', label: 'Register unit' }, { href: '/plant/spip', label: 'Komisioning SPIP' }, { href: '/plant/wo', label: 'Work order' }, { href: '/plant/keandalan', label: 'Keandalan & biaya' }, { href: '/plant/komponen', label: 'Umur komponen' }, { href: '/katalog', label: 'Katalog suku cadang' }] },
  { code: 'M6', label: 'Produksi', ready: true, items: [{ href: '/produksi', label: 'Laporan hauling' }, { href: '/produksi/master', label: 'Rute & target' }] },
  { code: 'M7', label: 'Logistik', ready: true, items: [{ href: '/logistik', label: 'Stok & gudang' }, { href: '/logistik/mr', label: 'Material request' }, { href: '/logistik/pengadaan', label: 'Pengadaan (PR/PO)' }, { href: '/logistik/bbm', label: 'Stasiun BBM' }, { href: '/logistik/supplier', label: 'Supplier' }, { href: '/katalog', label: 'Katalog suku cadang' }] },
  { code: 'M8', label: 'HRGA', ready: true, items: [{ href: '/hrga', label: 'Karyawan' }, { href: '/hrga/kompetensi', label: 'Kompetensi & SIMPER' }, { href: '/hrga/pelatihan', label: 'Pelatihan' }, { href: '/hrga/kesiapan', label: 'Kesiapan kerja' }, { href: '/hrga/roster', label: 'Roster' }, { href: '/hrga/absensi', label: 'Absensi' }, { href: '/hrga/cuti', label: 'Cuti & izin' }, { href: '/hrga/lembur', label: 'Lembur (SPL)' }, { href: '/hrga/klaim', label: 'Klaim & kasbon' }, { href: '/hrga/payroll', label: 'Payroll', perm: 'payroll.read' }, { href: '/hrga/rekrutmen', label: 'Rekrutmen' }, { href: '/hrga/kinerja', label: 'Penilaian kinerja' }, { href: '/hrga/elearning', label: 'E-learning' }, { href: '/hrga/analitik', label: 'Analitik HR' }, { href: '/hrga/ga', label: 'Permintaan GA' }] },
  { code: 'M9', label: 'PJO & Manajemen', ready: true, items: [{ href: '/manajemen', label: 'Dashboard eksekutif' }, { href: '/manajemen/audit', label: 'Audit internal' }, { href: '/manajemen/tinjauan', label: 'Tinjauan manajemen' }] },
  { code: 'ADM', label: 'Administrasi', ready: true, items: [
    { href: '/master/organisasi', label: 'Organisasi' },
    { href: '/admin/penomoran', label: 'Penomoran' },
    { href: '/data', label: 'Laporan & spreadsheet' },
    { href: '/data/impor', label: 'Impor data (Excel)' },
    { href: '/admin/pengguna', label: 'Pengguna & peran', perm: 'user.manage' },
    { href: '/admin/alur-persetujuan', label: 'Alur persetujuan' },
    { href: '/audit', label: 'Audit trail', perm: 'audit.read' },
  ] },
];
