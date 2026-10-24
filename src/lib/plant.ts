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
