// Label M3: action plan (CAPA), kepatuhan SMKP dan legal register.
type Tone = 'ok' | 'warn' | 'crit' | 'muted' | 'accent';

export const CAPA_STATUS: Record<string, [Tone, string]> = {
  open: ['warn', 'Terbuka'],
  in_progress: ['accent', 'Dikerjakan'],
  submitted: ['warn', 'Menunggu verifikasi'],
  closed: ['ok', 'Ditutup'],
  cancelled: ['muted', 'Dibatalkan'],
};

export const RISK: Record<string, [Tone, string]> = {
  extreme: ['crit', 'Ekstrem'], high: ['crit', 'Tinggi'], medium: ['warn', 'Sedang'], low: ['muted', 'Rendah'],
};

export const SOURCE_TYPE: Record<string, string> = {
  inspection: 'Inspeksi', incident: 'Insiden', audit: 'Audit', legal: 'Evaluasi kepatuhan', assessment: 'Self-assessment',
  management_review: 'Tinjauan manajemen', hazard_report: 'Laporan bahaya', effectiveness: 'Cek efektivitas', other: 'Lainnya',
};

export const ACTION_TYPE: Record<string, string> = {
  correction: 'Koreksi', corrective: 'Tindakan perbaikan', preventive: 'Tindakan pencegahan', improvement: 'Peningkatan',
};

export const HIERARCHY: Record<string, string> = {
  elimination: 'Eliminasi', substitution: 'Substitusi', engineering: 'Rekayasa', administrative: 'Administratif', ppe: 'APD',
};

export const CAPA_EVENT: Record<string, string> = {
  created: 'Dibuat', started: 'Mulai dikerjakan', submitted: 'Penyelesaian dilaporkan', returned: 'Dikembalikan verifikator',
  verified: 'Diverifikasi dan ditutup', extended: 'Target diperpanjang', cancelled: 'Dibatalkan',
  effective: 'Dinilai efektif', not_effective: 'Dinilai tidak efektif',
};

export const LEGAL_STATUS: Record<string, [Tone, string]> = {
  in_force: ['ok', 'Berlaku'], partially_revoked: ['warn', 'Dicabut sebagian'], revoked: ['crit', 'Dicabut'], replaced: ['muted', 'Diganti'],
};

export const COMPLIANCE: Record<string, [Tone, string]> = {
  not_evaluated: ['muted', 'Belum dievaluasi'], compliant: ['ok', 'Patuh'], partial: ['warn', 'Sebagian'],
  non_compliant: ['crit', 'Tidak patuh'], not_applicable: ['muted', 'Tidak berlaku'],
};

export const REG_TYPES = ['UU', 'PP', 'PERPRES', 'PERMEN', 'KEPMEN', 'KEPDIRJEN', 'PERDA', 'SNI', 'ISO', 'CLIENT', 'OTHER'] as const;
export const FREQUENCY: Record<string, string> = {
  once: 'Sekali', daily: 'Harian', weekly: 'Mingguan', monthly: 'Bulanan', quarterly: 'Triwulan', semiannual: 'Semester', annual: 'Tahunan', event: 'Saat kejadian',
};

// Status pemenuhan ringkas per persyaratan: ada bukti diterima dan tanpa action plan lewat target.
export function clauseHealth(c: { applicability: string; evidence_accepted: number; capa_overdue: number; capa_open: number }): [Tone, string] {
  if (c.applicability === 'not_applicable') return ['muted', 'Tidak berlaku'];
  if (c.applicability === 'to_confirm') return ['muted', 'Perlu konfirmasi'];
  if (c.capa_overdue > 0) return ['crit', 'Action plan lewat target'];
  if (c.evidence_accepted === 0) return ['crit', 'Belum ada bukti'];
  if (c.capa_open > 0) return ['warn', 'Ada tindak lanjut'];
  return ['ok', 'Terpenuhi'];
}

// Urutan kode bertingkat (1.2 sebelum 1.10), dipakai di daftar pilihan persyaratan.
export const byCode = <T extends { framework_code?: string; code: string }>(a: T, b: T) =>
  (a.framework_code ?? '').localeCompare(b.framework_code ?? '') || a.code.localeCompare(b.code, undefined, { numeric: true });
