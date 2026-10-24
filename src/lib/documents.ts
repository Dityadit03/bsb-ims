// Label status mengikuti istilah Document Control BSB v4.
type Tone = 'ok' | 'warn' | 'crit' | 'muted' | 'accent';

export const DOC_STATUS: Record<string, [Tone, string]> = {
  draft: ['muted', 'Usulan'],
  in_process: ['warn', 'Menunggu pengesahan'],
  effective: ['ok', 'Berlaku'],
  under_revision: ['accent', 'Dalam revisi'],
  obsolete: ['crit', 'Dicabut'],
  cancelled: ['muted', 'Dibatalkan'],
  expired: ['crit', 'Kedaluwarsa'],
  archived: ['muted', 'Arsip'],
};

export const VERSION_STATUS: Record<string, [Tone, string]> = {
  draft: ['muted', 'Draf'],
  in_review: ['warn', 'Direview'],
  pending_approval: ['warn', 'Menunggu approval'],
  revision_required: ['crit', 'Perlu revisi'],
  approved: ['accent', 'Disetujui, siap terbit'],
  effective: ['ok', 'Berlaku'],
  superseded: ['muted', 'Digantikan'],
  obsolete: ['crit', 'Dicabut'],
  cancelled: ['muted', 'Dibatalkan'],
};

export const ACCESS_LABEL: Record<string, string> = { internal: 'Internal', restricted: 'Terbatas', confidential: 'Rahasia' };

export const SMKP_ELEMENTS = [
  [1, 'Kebijakan'], [2, 'Perencanaan'], [3, 'Organisasi & personel'], [4, 'Implementasi'],
  [5, 'Pemantauan, evaluasi & tindak lanjut'], [6, 'Dokumentasi'], [7, 'Tinjauan manajemen & peningkatan'],
] as const;

export const rev = (n: number | null | undefined) => (n == null ? '–' : `Rev.${String(n).padStart(2, '0')}`);

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Makassar' }) : '–';
export const fmtDateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Makassar' }) : '–';
