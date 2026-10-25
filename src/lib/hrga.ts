// Label M8: HRGA & kompetensi.
type Tone = 'ok' | 'warn' | 'crit' | 'muted' | 'accent';

export const COMP_CATEGORY: Record<string, string> = {
  induction: 'Induksi', medical: 'Medis (MCU)', authorization: 'Otorisasi / SIMPER', certificate: 'Sertifikat', training: 'Pelatihan',
};
export const VALIDITY: Record<string, [Tone, string]> = {
  valid: ['ok', 'Berlaku'], expiring: ['warn', 'Segera habis'], expired: ['crit', 'Kedaluwarsa'], revoked: ['crit', 'Dicabut'], unfit: ['crit', 'MCU unfit'], missing: ['crit', 'Belum ada'],
};
export const EMPLOYMENT: Record<string, string> = { permanent: 'Tetap', contract: 'Kontrak', subcon: 'Subkontraktor' };
export const LEVEL: Record<string, string> = { PJO: 'PJO', DH: 'Dept head', SH: 'Section head', SPV: 'Supervisor', FOR: 'Foreman', STAFF: 'Staff', OPR: 'Operator' };
export const ROSTER: Record<string, [Tone, string]> = {
  D: ['accent', 'Siang'], N: ['accent', 'Malam'], OFF: ['muted', 'Off'], CUTI: ['ok', 'Cuti'], SAKIT: ['crit', 'Sakit'], IZIN: ['warn', 'Izin'],
};
export const GA_CATEGORY: Record<string, string> = {
  mess: 'Mess / akomodasi', transport: 'Transportasi', office: 'ATK / kantor', facility: 'Perbaikan fasilitas', pantry: 'Pantry / konsumsi', other: 'Lainnya',
};
export const GA_STATUS: Record<string, [Tone, string]> = {
  open: ['warn', 'Baru'], in_progress: ['accent', 'Diproses'], done: ['ok', 'Selesai'], rejected: ['crit', 'Ditolak'], cancelled: ['muted', 'Dibatalkan'],
};
export const TRAINING_STATUS: Record<string, [Tone, string]> = { planned: ['warn', 'Terjadwal'], done: ['ok', 'Selesai'], cancelled: ['muted', 'Batal'] };
export const pctTone = (p: number | null): Tone => (p == null ? 'muted' : p >= 100 ? 'ok' : p >= 75 ? 'warn' : 'crit');

// HRIS: Core HR
export const CONTRACT: Record<string, string> = { probation: 'Masa percobaan', pkwt: 'PKWT (kontrak)', pkwtt: 'PKWTT (tetap)', subcon: 'Subkon' };
export const CONTRACT_STATUS: Record<string, [Tone, string]> = {
  permanent: ['ok', 'Tetap'], active: ['ok', 'Berlaku'], expiring: ['warn', 'Segera habis'], expired: ['crit', 'Habis'],
};
export const MOVE: Record<string, string> = {
  join: 'Bergabung', promotion: 'Promosi', demotion: 'Demosi', transfer: 'Mutasi departemen', position_change: 'Perubahan jabatan',
  status_change: 'Perubahan status kerja', supervisor_change: 'Ganti atasan', exit: 'Keluar', correction: 'Koreksi data',
};
export const FITNESS: Record<string, [Tone, string]> = {
  fit: ['ok', 'Fit'], fit_restriction: ['warn', 'Fit dengan catatan'], temporary_unfit: ['crit', 'Unfit sementara'], unfit: ['crit', 'Unfit'],
};
export const CARD_STATUS: Record<string, [Tone, string]> = {
  active: ['ok', 'Aktif'], suspended: ['warn', 'Ditangguhkan'], returned: ['muted', 'Dikembalikan'], lost: ['crit', 'Hilang'], expired: ['crit', 'Habis'],
};
export const MOB: Record<string, string> = { mob: 'Mobilisasi', demob: 'Demobilisasi' };
export const MOB_AUTO: Record<string, string> = { induksi: 'Induksi berlaku', mcu: 'MCU berlaku & fit', id_card: 'ID card' };
export const PRIVATE_FIELDS: [string, string, ('date' | 'select' | 'text'), string[]?][] = [
  ['nik', 'NIK (KTP)', 'text'], ['kk_no', 'No. KK', 'text'], ['birth_place', 'Tempat lahir', 'text'], ['birth_date', 'Tanggal lahir', 'date'],
  ['gender', 'Jenis kelamin', 'select', ['L', 'P']], ['religion', 'Agama', 'text'],
  ['marital_status', 'Status nikah', 'select', ['single', 'married', 'divorced', 'widowed']],
  ['ptkp_status', 'Status PTKP', 'select', ['TK/0', 'TK/1', 'TK/2', 'TK/3', 'K/0', 'K/1', 'K/2', 'K/3']],
  ['blood_type', 'Golongan darah', 'select', ['A', 'B', 'AB', 'O']],
  ['education_level', 'Pendidikan', 'select', ['SD', 'SMP', 'SMA', 'D1', 'D2', 'D3', 'D4', 'S1', 'S2', 'S3']], ['education_major', 'Jurusan', 'text'],
  ['address_ktp', 'Alamat KTP', 'text'], ['address_domicile', 'Alamat domisili', 'text'], ['phone', 'No. HP', 'text'], ['personal_email', 'Email pribadi', 'text'],
  ['emergency_name', 'Kontak darurat', 'text'], ['emergency_relation', 'Hubungan', 'text'], ['emergency_phone', 'HP kontak darurat', 'text'],
  ['npwp', 'NPWP', 'text'], ['bpjs_tk_no', 'No. BPJS Ketenagakerjaan', 'text'], ['bpjs_kes_no', 'No. BPJS Kesehatan', 'text'],
  ['bank_name', 'Bank', 'text'], ['bank_account', 'No. rekening', 'text'], ['bank_holder', 'Nama di rekening', 'text'],
  ['uniform_size', 'Ukuran seragam', 'text'], ['shoe_size', 'Ukuran sepatu', 'text'],
];
export const SELF_EDITABLE = ['address_domicile', 'phone', 'personal_email', 'emergency_name', 'emergency_relation', 'emergency_phone', 'uniform_size', 'shoe_size'];
