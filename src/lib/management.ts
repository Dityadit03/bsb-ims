// Label M9: audit internal & tinjauan manajemen.
type Tone = 'ok' | 'warn' | 'crit' | 'muted' | 'accent';

export const AUDIT_STATUS: Record<string, [Tone, string]> = {
  planned: ['muted', 'Terjadwal'], in_progress: ['accent', 'Berlangsung'], reported: ['warn', 'Laporan terbit'], closed: ['ok', 'Ditutup'], cancelled: ['muted', 'Batal'],
};
export const FINDING: Record<string, [Tone, string]> = {
  major: ['crit', 'Mayor'], minor: ['warn', 'Minor'], observation: ['muted', 'Observasi'], ofi: ['accent', 'Peluang perbaikan'],
};
export const REVIEW_STATUS: Record<string, [Tone, string]> = { draft: ['muted', 'Persiapan'], held: ['warn', 'Dilaksanakan'], closed: ['ok', 'Ditutup'] };
