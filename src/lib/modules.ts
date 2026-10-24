// Peta menu mengikuti urutan modul pada rencana build. `ready` menandai modul yang sudah dibangun.
export type NavItem = { href: string; label: string; perm?: string };
export type NavGroup = { code: string; label: string; ready: boolean; items: NavItem[] };

export const NAV: NavGroup[] = [
  { code: 'M0', label: 'Beranda', ready: true, items: [{ href: '/', label: 'Ringkasan' }, { href: '/tugas', label: 'Kotak tugas' }] },
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
  ] },
  { code: 'M5', label: 'Plant', ready: false, items: [{ href: '/plant', label: 'Unit & work order' }] },
  { code: 'M6', label: 'Produksi', ready: false, items: [{ href: '/produksi', label: 'Hauling' }] },
  { code: 'M7', label: 'Logistik', ready: false, items: [{ href: '/logistik', label: 'Stok & permintaan' }] },
  { code: 'M8', label: 'HRGA', ready: false, items: [{ href: '/hrga', label: 'Karyawan & kompetensi' }] },
  { code: 'M9', label: 'PJO & Manajemen', ready: false, items: [{ href: '/manajemen', label: 'Tinjauan manajemen' }] },
  { code: 'ADM', label: 'Administrasi', ready: true, items: [
    { href: '/master/organisasi', label: 'Organisasi' },
    { href: '/admin/penomoran', label: 'Penomoran' },
    { href: '/admin/pengguna', label: 'Pengguna & peran', perm: 'user.manage' },
    { href: '/audit', label: 'Audit trail', perm: 'audit.read' },
  ] },
];
