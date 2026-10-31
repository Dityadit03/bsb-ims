// Label M7: Logistik.
type Tone = 'ok' | 'warn' | 'crit' | 'muted' | 'accent';

export const CATEGORY: Record<string, string> = {
  spare_part: 'Suku cadang', tire: 'Ban', fuel: 'BBM', lubricant: 'Pelumas', consumable: 'Habis pakai', ppe: 'APD', other: 'Lainnya',
};
export const MR_STATUS: Record<string, [Tone, string]> = {
  submitted: ['warn', 'Menunggu persetujuan'], pending: ['warn', 'Ditunda'], approved: ['accent', 'Disetujui'], partial: ['accent', 'Keluar sebagian'],
  issued: ['ok', 'Selesai dikeluarkan'], rejected: ['crit', 'Ditolak'], cancelled: ['muted', 'Dibatalkan'],
};
export const MOVE: Record<string, [Tone, string]> = {
  receipt: ['ok', 'Terima'], issue: ['accent', 'Keluar'], fuel: ['warn', 'BBM/oli unit'], adjust: ['muted', 'Opname'],
};
export const GRADE: Record<string, Tone> = { A: 'ok', B: 'warn', C: 'crit' };
export const rp = (n: number | string | null) => `Rp ${Number(n ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
export const qty = (n: number | string | null) => Number(n ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
export const STAGE: Record<string, [Tone, string]> = {
  awaiting_approval: ['warn', 'Menunggu approval'], ready: ['accent', 'Siap diambil'], short: ['crit', 'Stok kurang'],
  in_pr: ['warn', 'Dalam PR'], po_approval: ['warn', 'PO menunggu approval'], on_order: ['accent', 'Dipesan ke supplier'],
  issued: ['ok', 'Sudah dikeluarkan'], line_rejected: ['muted', 'Baris ditolak'], rejected: ['crit', 'Ditolak'], cancelled: ['muted', 'Dibatalkan'],
};
export const PR_STATUS: Record<string, [Tone, string]> = {
  submitted: ['warn', 'Menunggu persetujuan'], approved: ['accent', 'Cari penawaran'], ordered: ['accent', 'Sudah PO'],
  closed: ['ok', 'Barang diterima'], rejected: ['crit', 'Ditolak'], cancelled: ['muted', 'Dibatalkan'],
};
export const PO_STATUS: Record<string, [Tone, string]> = {
  awaiting_approval: ['warn', 'Menunggu approval'], issued: ['accent', 'Terkirim ke supplier'], partial: ['accent', 'Diterima sebagian'],
  received: ['ok', 'Diterima penuh'], cancelled: ['muted', 'Dibatalkan'],
};
