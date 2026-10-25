// Label M5: Plant (unit, work order).
type Tone = 'ok' | 'warn' | 'crit' | 'muted' | 'accent';

export const UNIT_STATUS: Record<string, [Tone, string]> = {
  ready: ['ok', 'Siap'], breakdown: ['crit', 'Breakdown'], standby: ['muted', 'Standby'], retired: ['muted', 'Tidak aktif'],
};
export const WO_TYPE: Record<string, string> = { breakdown: 'Breakdown', pm: 'Servis berkala (PM)', repair: 'Perbaikan terencana', inspection: 'Inspeksi' };
export const WO_STATUS: Record<string, [Tone, string]> = {
  open: ['warn', 'Open'], in_progress: ['accent', 'Dikerjakan'], waiting_part: ['warn', 'Tunggu part'], done: ['ok', 'Selesai'], cancelled: ['muted', 'Dibatalkan'],
};
export const PRIORITY: Record<string, [Tone, string]> = {
  urgent: ['crit', 'Urgent'], high: ['crit', 'Tinggi'], medium: ['warn', 'Sedang'], low: ['muted', 'Rendah'],
};
export const paTone = (pa: number): Tone => (pa >= 90 ? 'ok' : pa >= 80 ? 'warn' : 'crit');

export const DOWNTIME: Record<string, string> = {
  planned_pm: 'Servis terencana (PM)', breakdown: 'Kerusakan', waiting_part: 'Menunggu suku cadang', waiting_mechanic: 'Menunggu mekanik',
  accident: 'Kecelakaan / insiden', weather: 'Cuaca', other: 'Lainnya', unclassified: 'Belum diberi kode',
};
export const COMP_TYPE: Record<string, string> = {
  engine: 'Engine', transmission: 'Transmisi', final_drive: 'Final drive', differential: 'Differential', hydraulic_pump: 'Pompa hidrolik',
  turbocharger: 'Turbocharger', axle: 'Axle', other: 'Lainnya',
};
export const COMP_STATUS: Record<string, [Tone, string]> = {
  in_stock: ['muted', 'Di stok'], installed: ['ok', 'Terpasang'], rebuild: ['warn', 'Overhaul'], scrapped: ['muted', 'Dibuang'],
};
export const REMOVE_REASON: Record<string, string> = { planned_overhaul: 'Overhaul terjadwal', failure: 'Rusak / gagal', condition: 'Kondisi (hasil inspeksi / oli)', other: 'Lainnya' };
export const lifeTone = (pct: number): Tone => (pct >= 100 ? 'crit' : pct >= 90 ? 'warn' : 'ok');
export const rp = (n: number | string | null) => (n == null ? '–' : `Rp ${Number(n).toLocaleString('id-ID')}`);
