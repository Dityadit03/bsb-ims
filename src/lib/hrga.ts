// Label M8: HRGA & kompetensi.
type Tone = 'ok' | 'warn' | 'crit' | 'muted' | 'accent';

export const COMP_CATEGORY: Record<string, string> = {
  induction: 'Induksi', medical: 'Medis (MCU)', authorization: 'Otorisasi / SIMPER', certificate: 'Sertifikat', training: 'Pelatihan',
};
export const VALIDITY: Record<string, [Tone, string]> = {
  valid: ['ok', 'Berlaku'], expiring: ['warn', 'Segera habis'], expired: ['crit', 'Kedaluwarsa'], revoked: ['crit', 'Dicabut'], missing: ['crit', 'Belum ada'],
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
