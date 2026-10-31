// Label M4: SHE (risk register, hazard report, observasi, inspeksi, P2H, fit to work, insiden).
type Tone = 'ok' | 'warn' | 'crit' | 'muted' | 'accent';

export const riskLevel = (score: number) => (score >= 20 ? 'extreme' : score >= 10 ? 'high' : score >= 5 ? 'medium' : 'low');

export const HAZARD_TYPE: Record<string, string> = { KTA: 'KTA · kondisi tidak aman', TTA: 'TTA · tindakan tidak aman' };

export const OPEN_CLOSED: Record<string, [Tone, string]> = {
  open: ['warn', 'Terbuka'], closed: ['ok', 'Ditutup'], cancelled: ['muted', 'Dibatalkan'],
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
  reported: ['warn', 'Dilaporkan'], investigating: ['accent', 'Investigasi'], investigated: ['warn', 'Menunggu penutupan'], closed: ['ok', 'Ditutup'],
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

// Adaptasi Portal SHE: pelanggaran, induksi, izin masuk area, komisioning, SAP per karyawan
export const VIOLATION_TYPE: Record<string, string> = {
  GR1: 'Golden Rule 1', GR2: 'Golden Rule 2', GR3: 'Golden Rule 3', GR4: 'Golden Rule 4', GR5: 'Golden Rule 5', GR6: 'Golden Rule 6',
  GR7: 'Golden Rule 7', GR8: 'Golden Rule 8', SPDK_OVERSPEED: 'SPDK · Overspeed', SPDK_PROSEDUR: 'SPDK · Pelanggaran prosedur',
  APD: 'Tidak memakai APD', SAFETY_BELT: 'Tidak memakai safety belt', FATIGUE: 'Fatigue / tidur saat kerja', OTHER: 'Lainnya',
};
export const SANCTION: Record<string, string> = {
  verbal: 'Teguran lisan', coaching: 'Pembinaan', sp1: 'SP 1', sp2: 'SP 2', sp3: 'SP 3', suspension: 'Skorsing', termination: 'PHK',
};
export const INDUCTION_TYPE: Record<string, string> = {
  new_hire: 'Induksi karyawan baru', reinduction: 'Reinduksi (kembali cuti)', transfer: 'Induksi mutasi', visitor: 'Induksi tamu',
};
export const PERMIT_STATUS: Record<string, [Tone, string]> = {
  submitted: ['warn', 'Diajukan'], approved: ['ok', 'Disetujui'], rejected: ['crit', 'Ditolak'], closed: ['muted', 'Selesai'],
};
export const VALIDITY: Record<string, [Tone, string]> = {
  valid: ['ok', 'Berlaku'], expiring: ['warn', 'Segera habis'], expired: ['crit', 'Expired'], none: ['muted', 'Belum ada'],
};
export const OBJECT_TYPE: Record<string, string> = { unit: 'Unit / sarana', tool: 'Alat workshop', installation: 'Instalasi / prasarana' };
export const SAP_LEVEL: Record<string, string> = { PJO: 'PJO', DH: 'Dept Head', SH: 'Section Head', FOR: 'Foreman / GL' };
export const SAP_SECTION = ['PJO', 'HSE', 'PRO', 'PLANT', 'LOG', 'HRGA', 'ENG'] as const;
