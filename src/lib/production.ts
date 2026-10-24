// Label M6: Produksi hauling.
type Tone = 'ok' | 'warn' | 'crit' | 'muted' | 'accent';

export const REPORT_STATUS: Record<string, [Tone, string]> = {
  draft: ['muted', 'Draf'], submitted: ['warn', 'Menunggu persetujuan'], approved: ['ok', 'Disetujui'],
};
export const DELAY: Record<string, string> = {
  rain: 'Hujan', slippery: 'Jalan licin', breakdown: 'Unit breakdown', refuel: 'Isi BBM', p2h_briefing: 'P2H / briefing',
  queue: 'Antrian loading/dumping', road_repair: 'Perbaikan jalan', safety: 'Stop kerja (safety)', other: 'Lainnya',
};
export const ton = (n: number | string | null) => Number(n ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 1 });
