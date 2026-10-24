// Label M7: Logistik.
type Tone = 'ok' | 'warn' | 'crit' | 'muted' | 'accent';

export const CATEGORY: Record<string, string> = {
  spare_part: 'Suku cadang', tire: 'Ban', fuel: 'BBM', lubricant: 'Pelumas', consumable: 'Habis pakai', ppe: 'APD', other: 'Lainnya',
};
export const MR_STATUS: Record<string, [Tone, string]> = {
  submitted: ['warn', 'Menunggu persetujuan'], approved: ['accent', 'Disetujui'], partial: ['accent', 'Keluar sebagian'],
  issued: ['ok', 'Selesai dikeluarkan'], rejected: ['crit', 'Ditolak'], cancelled: ['muted', 'Dibatalkan'],
};
export const MOVE: Record<string, [Tone, string]> = {
  receipt: ['ok', 'Terima'], issue: ['accent', 'Keluar'], fuel: ['warn', 'BBM/oli unit'], adjust: ['muted', 'Opname'],
};
export const GRADE: Record<string, Tone> = { A: 'ok', B: 'warn', C: 'crit' };
export const rp = (n: number | string | null) => `Rp ${Number(n ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
export const qty = (n: number | string | null) => Number(n ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
