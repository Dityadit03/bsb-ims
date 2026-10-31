// Alur persetujuan per dokumen. Setiap langkah menyebut peran yang berwenang; nama pejabatnya diambil dari
// penunjukan (tabel approver_designations) sehingga mengikuti data manpower. Tampilan saja: aturan sebenarnya ada di database.
export type Step = { label: string; role?: string; dept?: 'own' | 'LOG' | 'HRGA' | 'HSE' | 'PLT'; note?: string };
export type Flow = { name: string; steps: Step[] };

export const FLOWS: Flow[] = [
  { name: 'Permintaan Material (MR)', steps: [
    { label: 'Peminta mengajukan' },
    { label: 'Supervisor departemen menyetujui', role: 'SUPERVISOR', dept: 'own' },
    { label: 'Logistik memproses & menerbitkan barang', role: 'DEPT_HEAD', dept: 'LOG', note: 'petugas gudang' },
  ] },
  { name: 'PR dari kekurangan stok & PO', steps: [
    { label: 'Admin / Logistik membuat PR' },
    { label: 'Kepala Departemen peminta menyetujui', role: 'DEPT_HEAD', dept: 'own' },
    { label: 'Purchasing membuat PO', role: 'DEPT_HEAD', dept: 'LOG' },
    { label: 'PJO menyetujui akhir', role: 'PJO' },
  ] },
  { name: 'Pembelian langsung departemen (di luar stok)', steps: [
    { label: 'Departemen mengajukan permintaan pembelian' },
    { label: 'Kepala Departemen pemohon menyetujui', role: 'DEPT_HEAD', dept: 'own' },
    { label: 'Logistik menyetujui PR dan mencari penawaran', role: 'DEPT_HEAD', dept: 'LOG' },
    { label: 'PJO menyetujui PO di atas batas nilai', role: 'PJO' },
    { label: 'Gudang menerima dan menyerahkan ke pemohon', note: 'tidak masuk stok' },
  ] },
  { name: 'Work Order (WO)', steps: [
    { label: 'Pelapor / mekanik' },
    { label: 'Pengawas Teknis Plant', role: 'SUPERVISOR', dept: 'PLT' },
    { label: 'Head Plant', role: 'DEPT_HEAD', dept: 'PLT' },
  ] },
  { name: 'Hazard & CAPA', steps: [
    { label: 'Pelapor' },
    { label: 'Supervisor departemen', role: 'SUPERVISOR', dept: 'own' },
    { label: 'Suptend HSE menutup', role: 'DEPT_HEAD', dept: 'HSE' },
  ] },
  { name: 'Dokumen Document Control', steps: [
    { label: 'Penyusun' },
    { label: 'Kepala Departemen meninjau', role: 'DEPT_HEAD', dept: 'own' },
    { label: 'Document Controller menerbitkan', role: 'DOC_CONTROLLER' },
    { label: 'PJO / Management menyetujui kebijakan', role: 'MGMT_APPROVER' },
  ] },
  { name: 'Cuti & lembur', steps: [
    { label: 'Karyawan mengajukan' },
    { label: 'Atasan langsung menyetujui', note: 'dari data atasan langsung karyawan' },
    { label: 'HRGA tahap 2', role: 'DEPT_HEAD', dept: 'HRGA' },
  ] },
  { name: 'FPTK (permintaan tenaga kerja)', steps: [
    { label: 'Departemen mengajukan' },
    { label: 'Kepala Departemen', role: 'DEPT_HEAD', dept: 'own' },
    { label: 'HRGA memeriksa', role: 'DEPT_HEAD', dept: 'HRGA' },
    { label: 'PJO menyetujui akhir', role: 'PJO' },
  ] },
];

export const ROLE_LABEL: Record<string, string> = {
  DEPT_HEAD: 'Kepala Departemen', SUPERVISOR: 'Supervisor', SUPERINTENDENT: 'Superintendent', PJO: 'PJO',
  MGMT_APPROVER: 'Management', HSE_MANAGER: 'HSE Manager', DOC_CONTROLLER: 'Document Controller',
};
