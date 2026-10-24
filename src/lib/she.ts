// Label M4: SHE (risk register, hazard report, observasi, inspeksi, P2H, fit to work, insiden).
type Tone = 'ok' | 'warn' | 'crit' | 'muted' | 'accent';

export const riskLevel = (score: number) => (score >= 20 ? 'extreme' : score >= 10 ? 'high' : score >= 5 ? 'medium' : 'low');

export const HAZARD_TYPE: Record<string, string> = { KTA: 'KTA · kondisi tidak aman', TTA: 'TTA · tindakan tidak aman' };

export const OPEN_CLOSED: Record<string, [Tone, string]> = {
  open: ['warn', 'Open'], closed: ['ok', 'Closed'], cancelled: ['muted', 'Dibatalkan'],
};

export const INSPECTION_TYPE: Record<string, string> = {
  work_area: 'Area kerja / front', equipment: 'Unit & alat berat', workshop: 'Workshop', housekeeping: 'Housekeeping', ppe: 'APD',
  emergency_equipment: 'Alat tanggap darurat', facility: 'Fasilitas (mess, kantor, toilet)', electrical: 'Kelistrikan / genset',
  fuel_storage: 'Fuel storage', other: 'Lainnya',
};

export const UNIT_TYPE: Record<string, string> = {
  DT: 'Dump truck', LV: 'Light vehicle', ST: 'Service truck', FT: 'Fuel truck', WT: 'Water truck', BUS: 'Bus', EXC: 'Excavator', OTHER: 'Lainnya',
};

export const CONCLUSION: Record<string, [Tone, string]> = {
  fit: ['ok', 'Layak / fit'], fit_with_notes: ['warn', 'Dengan catatan'], unfit: ['crit', 'Tidak layak / tidak fit'],
};

export const INCIDENT_CLASS: Record<string, [Tone, string]> = {
  nearmiss: ['warn', 'Nearmiss'], property_damage: ['crit', 'Property damage'], first_aid: ['crit', 'First aid'],
  mti: ['crit', 'MTI'], lti: ['crit', 'LTI'], fatality: ['crit', 'Fatality'], environmental: ['crit', 'Lingkungan'],
};

export const INCIDENT_STATUS: Record<string, [Tone, string]> = {
  reported: ['warn', 'Dilaporkan'], investigating: ['accent', 'Investigasi'], investigated: ['warn', 'Menunggu penutupan'], closed: ['ok', 'Closed'],
};

export const RISK_STATUS: Record<string, [Tone, string]> = {
  draft: ['warn', 'Draft'], approved: ['ok', 'Disetujui'], retired: ['muted', 'Tidak berlaku'],
};

export const CONDITION: Record<string, string> = { routine: 'Rutin', non_routine: 'Non-rutin', emergency: 'Darurat' };
export const CATEGORY: Record<string, string> = { safety: 'Keselamatan', health: 'Kesehatan', environment: 'Lingkungan' };

export const LIKELIHOOD = ['', 'Jarang', 'Kecil kemungkinan', 'Mungkin', 'Kemungkinan besar', 'Hampir pasti'];
export const SEVERITY = ['', 'Tidak signifikan', 'Minor', 'Sedang', 'Mayor', 'Bencana'];

// Minggu SAP PT BDA: Selasa–Senin (sama dengan app.sap_week di database)
export function sapWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const isoDow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() - ((isoDow + 5) % 7));
  return t.toISOString().slice(0, 10);
}
