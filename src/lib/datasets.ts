// Register yang bisa diekspor ke Excel/CSV, ditarik ke Google Sheets (feed) dan jenis data yang bisa diimpor.
import { HAZARD_TYPE, INCIDENT_CLASS, OPEN_CLOSED, VALIDITY } from '@/lib/she';
import { UNIT_STATUS, WO_STATUS, WO_TYPE } from '@/lib/plant';
import { CATEGORY, MOVE, MR_STATUS, PO_STATUS, PR_STATUS, STAGE } from '@/lib/logistics';
import { EMPLOYMENT } from '@/lib/hrga';

type Label = Record<string, string | [string, string]>;
const lbl = (m: Label) => (v: unknown) => { const x = m[String(v)]; return x == null ? v : Array.isArray(x) ? x[1] : x; };
const yn = (v: unknown) => (v == null ? '' : v ? 'Ya' : 'Tidak');

export type Column = [key: string, header: string, fmt?: (v: unknown) => unknown];
export type Dataset = { key: string; label: string; group: string; view: string; order: string; desc?: boolean; feed: boolean; columns: Column[] };

// feed: true hanya untuk register yang terbaca semua pengguna aktif (sama dengan daftar di fungsi feed_rows)
export const DATASETS: Dataset[] = [
  { key: 'hazard', label: 'Laporan hazard', group: 'SHE', view: 'she_hazard_register', order: 'created_at', desc: true, feed: true, columns: [
    ['hazard_no', 'No. hazard'], ['reported_on', 'Tanggal'], ['department_code', 'Dept'], ['work_area_name', 'Area'], ['location_note', 'Lokasi'],
    ['hazard_type', 'Jenis', lbl(HAZARD_TYPE)], ['description', 'Uraian'], ['recommendation', 'Rekomendasi'], ['risk_level', 'Risiko'],
    ['pic_department_code', 'Dept PIC'], ['due_date', 'Batas waktu'], ['status', 'Status', lbl(OPEN_CLOSED)], ['is_overdue', 'Terlambat', yn],
    ['reporter_name', 'Pelapor'], ['closed_at', 'Ditutup']] },
  { key: 'temuan', label: 'Temuan inspeksi', group: 'SHE', view: 'she_finding_register', order: 'inspected_on', desc: true, feed: true, columns: [
    ['inspection_no', 'No. inspeksi'], ['inspected_on', 'Tanggal'], ['inspection_type', 'Jenis'], ['object', 'Objek'], ['seq', 'No.'],
    ['description', 'Temuan'], ['risk_level', 'Risiko'], ['recommendation', 'Rekomendasi'], ['pic_department_code', 'Dept PIC'],
    ['due_date', 'Batas waktu'], ['status', 'Status', lbl(OPEN_CLOSED)], ['is_overdue', 'Terlambat', yn]] },
  { key: 'insiden', label: 'Insiden', group: 'SHE', view: 'incident_register', order: 'occurred_at', desc: true, feed: true, columns: [
    ['incident_no', 'No. insiden'], ['occurred_at', 'Waktu kejadian'], ['department_code', 'Dept'], ['work_area_name', 'Area'],
    ['classification', 'Klasifikasi', lbl(INCIDENT_CLASS)], ['unit_no', 'Unit'], ['chronology', 'Kronologi'], ['immediate_action', 'Tindakan segera'],
    ['root_cause', 'Akar masalah'], ['status', 'Status'], ['investigator_name', 'Investigator'], ['capa_count', 'Jumlah action plan']] },
  { key: 'capa', label: 'Action plan (CAPA)', group: 'SMKP', view: 'capa_register', order: 'created_at', desc: true, feed: true, columns: [
    ['action_no', 'No. CAPA'], ['title', 'Judul'], ['source_type', 'Sumber'], ['source_ref', 'Referensi'], ['clause_code', 'Klausul'],
    ['department_code', 'Dept'], ['pic_name', 'PIC'], ['verifier_name', 'Verifikator'], ['risk_level', 'Risiko'], ['due_date', 'Batas waktu'],
    ['status', 'Status'], ['is_overdue', 'Terlambat', yn], ['closed_at', 'Ditutup']] },
  { key: 'risiko', label: 'Risk register', group: 'SHE', view: 'risk_register_view', order: 'risk_no', feed: true, columns: [
    ['risk_no', 'No.'], ['revision', 'Rev'], ['department_code', 'Dept'], ['work_area_name', 'Area'], ['activity', 'Aktivitas'], ['hazard', 'Bahaya'],
    ['risk', 'Risiko'], ['existing_controls', 'Pengendalian'], ['initial_score', 'Skor awal'], ['initial_level', 'Tingkat awal'],
    ['additional_controls', 'Pengendalian tambahan'], ['residual_score', 'Skor sisa'], ['residual_level', 'Tingkat sisa'], ['owner_name', 'Pemilik'],
    ['status', 'Status'], ['review_due', 'Tinjau ulang']] },
  { key: 'sap', label: 'SAP mingguan', group: 'SHE', view: 'sap_weekly', order: 'week_start', desc: true, feed: true, columns: [
    ['week_start', 'Minggu mulai'], ['week_no', 'Minggu ke'], ['nrp', 'NRP'], ['full_name', 'Nama'], ['level', 'Level'], ['sap_section', 'Seksi'],
    ['on_leave', 'Cuti', yn], ['obs_target', 'Plan observasi'], ['obs_act', 'Aktual observasi'], ['insp_target', 'Plan inspeksi'],
    ['insp_act', 'Aktual inspeksi'], ['hazard_target', 'Plan hazard'], ['hazard_act', 'Aktual hazard'], ['locked', 'Terkunci', yn]] },
  { key: 'unit', label: 'Unit & PA 30 hari', group: 'Plant', view: 'unit_availability', order: 'unit_no', feed: true, columns: [
    ['unit_no', 'No. unit'], ['unit_type', 'Jenis'], ['ownership', 'Kepemilikan'], ['status', 'Status', lbl(UNIT_STATUS)], ['current_hm', 'HM'],
    ['breakdown_hours_30d', 'Breakdown 30 hari (jam)'], ['pa_30d', 'PA 30 hari (%)']] },
  { key: 'wo', label: 'Work order', group: 'Plant', view: 'work_order_register', order: 'reported_at', desc: true, feed: true, columns: [
    ['wo_no', 'No. WO'], ['reported_at', 'Dilaporkan'], ['unit_no', 'Unit'], ['wo_type', 'Jenis', lbl(WO_TYPE)], ['priority', 'Prioritas'],
    ['description', 'Keluhan'], ['status', 'Status', lbl(WO_STATUS)], ['mechanic_name', 'Mekanik'], ['action_taken', 'Tindakan'],
    ['completed_at', 'Selesai'], ['downtime_hours', 'Downtime (jam)'], ['reporter_name', 'Pelapor']] },
  { key: 'pm', label: 'Jadwal servis (PM)', group: 'Plant', view: 'pm_due', order: 'unit_no', feed: true, columns: [
    ['unit_no', 'Unit'], ['task', 'Servis'], ['interval_hm', 'Interval HM'], ['last_service_hm', 'HM servis terakhir'], ['current_hm', 'HM sekarang'],
    ['next_due_hm', 'Jatuh tempo HM'], ['remaining_hm', 'Sisa HM'], ['overdue', 'Lewat', yn], ['wo_open', 'WO terbuka', yn]] },
  { key: 'spip', label: 'Komisioning SPIP', group: 'Plant', view: 'commissioning_register', order: 'ref_code', feed: true, columns: [
    ['object_type', 'Jenis objek'], ['ref_code', 'Kode / no. lambung'], ['name', 'Nama'], ['category', 'Kategori'], ['reg_no', 'No. registrasi'],
    ['commissioned_on', 'Tgl komisioning'], ['valid_until', 'Berlaku sampai'], ['validity', 'Status', lbl(VALIDITY)], ['issuer', 'Penerbit']] },
  { key: 'produksi', label: 'Laporan produksi', group: 'Produksi', view: 'production_summary', order: 'report_date', desc: true, feed: true, columns: [
    ['report_no', 'No. laporan'], ['report_date', 'Tanggal'], ['shift', 'Shift'], ['status', 'Status'], ['supervisor_name', 'Pengawas'],
    ['trips', 'Ritase'], ['tonnage', 'Tonase'], ['units', 'Unit'], ['ton_km', 'Ton-km'], ['delay_hours', 'Delay (jam)']] },
  { key: 'stok', label: 'Stok barang', group: 'Logistik', view: 'material_stock', order: 'code', feed: true, columns: [
    ['code', 'Kode'], ['name', 'Nama'], ['category', 'Kategori', lbl(CATEGORY)], ['uom', 'Satuan'], ['min_stock', 'Stok minimum'], ['stock_qty', 'Stok'],
    ['avg_cost', 'Harga rata-rata'], ['stock_value', 'Nilai stok'], ['low_stock', 'Di bawah minimum', yn], ['active', 'Aktif', yn]] },
  { key: 'mutasi', label: 'Mutasi stok', group: 'Logistik', view: 'stock_ledger', order: 'moved_at', desc: true, feed: true, columns: [
    ['movement_no', 'No. dokumen'], ['moved_at', 'Waktu'], ['movement_type', 'Jenis', lbl(MOVE)], ['material_code', 'Kode barang'], ['material_name', 'Barang'],
    ['qty', 'Jumlah'], ['uom', 'Satuan'], ['unit_cost', 'Harga'], ['value', 'Nilai'], ['supplier_name', 'Supplier'], ['doc_ref', 'Surat jalan'],
    ['mr_no', 'MR'], ['wo_no', 'WO'], ['unit_no', 'Unit'], ['hour_meter', 'HM'], ['moved_by_name', 'Petugas'], ['note', 'Catatan']] },
  { key: 'mr', label: 'Material request', group: 'Logistik', view: 'mr_register', order: 'created_at', desc: true, feed: true, columns: [
    ['mr_no', 'No. MR'], ['created_at', 'Dibuat'], ['department_code', 'Dept'], ['purpose', 'Keperluan'], ['wo_no', 'WO'], ['requester_name', 'Peminta'],
    ['total_value', 'Nilai'], ['status', 'Status', lbl(MR_STATUS)], ['reviewer_name', 'Diperiksa'], ['review_note', 'Catatan']] },
  { key: 'tracking', label: 'Tracking MR → PR → PO', group: 'Logistik', view: 'mr_tracking', order: 'mr_no', desc: true, feed: true, columns: [
    ['mr_no', 'No. MR'], ['material_code', 'Kode'], ['material_name', 'Barang'], ['qty', 'Diminta'], ['qty_approved', 'Disetujui'],
    ['qty_issued', 'Keluar'], ['stock_qty', 'Stok'], ['stage', 'Posisi', lbl(STAGE)], ['pr_no', 'PR'], ['po_no', 'PO'], ['supplier_name', 'Supplier'],
    ['qty_received', 'Diterima dari PO']] },
  { key: 'pr', label: 'Purchase requisition', group: 'Logistik', view: 'pr_register', order: 'created_at', desc: true, feed: true, columns: [
    ['pr_no', 'No. PR'], ['created_at', 'Dibuat'], ['purpose', 'Keperluan'], ['mr_no', 'Dari MR'], ['requester_name', 'Pembuat'], ['need_date', 'Dibutuhkan'],
    ['lines', 'Jumlah barang'], ['lines_quoted', 'Sudah ada supplier'], ['status', 'Status', lbl(PR_STATUS)]] },
  { key: 'po', label: 'Purchase order', group: 'Logistik', view: 'po_register', order: 'created_at', desc: true, feed: true, columns: [
    ['po_no', 'No. PO'], ['created_at', 'Dibuat'], ['supplier_code', 'Kode supplier'], ['supplier_name', 'Supplier'], ['pr_no', 'PR'],
    ['total_value', 'Nilai'], ['expected_date', 'Estimasi tiba'], ['status', 'Status', lbl(PO_STATUS)], ['creator_name', 'Pembuat']] },
  // hanya ekspor (baris dibatasi hak akses pengguna yang mengunduh)
  { key: 'karyawan', label: 'Karyawan & kepatuhan kompetensi', group: 'HRGA', view: 'employee_register', order: 'nrp', feed: false, columns: [
    ['nrp', 'NRP'], ['full_name', 'Nama'], ['department_code', 'Dept'], ['position_name', 'Jabatan'], ['employment_type', 'Status kerja', lbl(EMPLOYMENT)],
    ['company', 'Perusahaan'], ['join_date', 'Tgl masuk'], ['status', 'Status'], ['email', 'Email akun'], ['required', 'Kompetensi wajib'],
    ['compliant', 'Terpenuhi'], ['expiring', 'Segera habis'], ['compliance_pct', 'Kepatuhan (%)']] },
  { key: 'kompetensi', label: 'Sertifikat, MCU & SIMPER', group: 'HRGA', view: 'employee_competency_view', order: 'nrp', feed: false, columns: [
    ['nrp', 'NRP'], ['full_name', 'Nama'], ['department_code', 'Dept'], ['competency_code', 'Kode'], ['competency_name', 'Kompetensi'],
    ['unit_type', 'Jenis unit'], ['cert_no', 'No. sertifikat'], ['issuer', 'Penerbit'], ['issued_on', 'Terbit'], ['valid_until', 'Berlaku sampai'],
    ['days_left', 'Sisa hari'], ['validity', 'Masa berlaku', lbl(VALIDITY)], ['status', 'Status']] },
  { key: 'dokumen', label: 'Register dokumen', group: 'Dokumen', view: 'document_register', order: 'document_number', feed: false, columns: [
    ['document_number', 'No. dokumen'], ['title', 'Judul'], ['type_code', 'Jenis'], ['department_code', 'Dept'], ['section_code', 'Seksi'],
    ['current_revision', 'Revisi'], ['status', 'Status'], ['effective_date', 'Berlaku'], ['next_review_at', 'Tinjau ulang'], ['owner_name', 'Pemilik']] },
  { key: 'pelanggaran', label: 'Pelanggaran GR/SPDK', group: 'SHE', view: 'violation_register', order: 'occurred_on', desc: true, feed: false, columns: [
    ['violation_no', 'No.'], ['occurred_on', 'Tanggal'], ['nrp', 'NRP'], ['offender_name', 'Nama'], ['department_code', 'Dept'], ['violation_type', 'Jenis'],
    ['chronology', 'Kronologi'], ['sanction', 'Sanksi'], ['sp_no', 'No. SP'], ['repeat_no', 'Pengulangan ke'], ['status', 'Status']] },
  { key: 'izin', label: 'Izin masuk area', group: 'SHE', view: 'area_permit_register', order: 'start_on', desc: true, feed: false, columns: [
    ['permit_no', 'No. izin'], ['visitor_name', 'Tamu'], ['company', 'Perusahaan'], ['people_count', 'Orang'], ['work_area_name', 'Area'],
    ['purpose', 'Keperluan'], ['start_on', 'Mulai'], ['end_on', 'Sampai'], ['escort_name', 'Pendamping'], ['status', 'Status']] },
];

export const dataset = (key: string) => DATASETS.find(d => d.key === key);

// Cap waktu ISO → "2026-10-24 14:30" (WITA, zona site)
const time = (v: unknown) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(v)
  ? new Date(new Date(v).getTime() + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ') : v;

export function tableOf(d: Dataset, rows: Record<string, unknown>[]) {
  return [d.columns.map(c => c[1]), ...rows.map(r => d.columns.map(([k, , f]) => {
    const v = time(f ? f(r[k]) : r[k]);
    return v == null ? null : typeof v === 'number' || typeof v === 'boolean' ? v : String(v);
  }))] as (string | number | boolean | null)[][];
}

export function toCsv(rows: (string | number | boolean | null)[][]) {
  return rows.map(r => r.map(v => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');
}

// ---------------------------------------------------------------- impor
export type ImportField = { key: string; label: string; required?: boolean; date?: boolean; aliases: string[]; example: string };
export type ImportKind = { key: string; label: string; perm: string; note: string; fields: ImportField[] };
const f = (key: string, label: string, aliases: string[], example: string, opt: Partial<ImportField> = {}): ImportField =>
  ({ key, label, aliases, example, ...opt });

export const IMPORTS: ImportKind[] = [
  { key: 'karyawan', label: 'Data karyawan', perm: 'hr.manage', note: 'NRP yang sudah ada diperbarui. Departemen pakai kode (HSE, PLT, PRD, HRGA, LOG, MGT).', fields: [
    f('nrp', 'NRP', ['nrp', 'nik karyawan', 'no karyawan', 'id karyawan'], 'BSB-0123', { required: true }),
    f('nama', 'Nama', ['nama', 'nama karyawan', 'nama lengkap', 'name'], 'Budi Santoso', { required: true }),
    f('departemen', 'Departemen', ['departemen', 'dept', 'department'], 'PRD', { required: true }),
    f('jabatan', 'Jabatan', ['jabatan', 'posisi', 'position'], 'Operator DT'),
    f('seksi', 'Seksi', ['seksi', 'section'], 'OPR'),
    f('status_kerja', 'Status kerja', ['status kerja', 'status karyawan', 'status', 'tipe'], 'Kontrak'),
    f('perusahaan', 'Perusahaan', ['perusahaan', 'company', 'pt'], 'PT BSB'),
    f('tgl_masuk', 'Tgl masuk', ['tgl masuk', 'tanggal masuk', 'join date', 'tmk'], '2026-01-15', { date: true }),
    f('email', 'Email akun', ['email', 'email akun'], '')] },
  { key: 'sertifikat', label: 'Sertifikat, MCU & SIMPER', perm: 'hr.manage', note: 'Kompetensi pakai kode master (mis. MCU, SIMPER-DT, INDUKSI, POP).', fields: [
    f('nrp', 'NRP', ['nrp', 'no karyawan'], 'BSB-0123', { required: true }),
    f('kompetensi', 'Kompetensi', ['kompetensi', 'kode kompetensi', 'sertifikat', 'jenis'], 'SIMPER-DT', { required: true }),
    f('tgl_terbit', 'Tgl terbit', ['tgl terbit', 'tanggal terbit', 'terbit', 'issued'], '2026-03-01', { date: true }),
    f('berlaku_sampai', 'Berlaku sampai', ['berlaku sampai', 'masa berlaku', 'expired', 'exp', 'valid until'], '2027-03-01', { date: true }),
    f('no_sertifikat', 'No. sertifikat', ['no sertifikat', 'nomor sertifikat', 'no simper', 'no'], 'SIM/001'),
    f('penerbit', 'Penerbit', ['penerbit', 'lembaga', 'issuer'], 'Internal')] },
  { key: 'unit', label: 'Unit / sarana', perm: 'plant.manage', note: 'No. unit yang sudah ada diperbarui. Jenis: DT, LV, ST, FT, WT, BUS, EXC, OTHER.', fields: [
    f('no_unit', 'No. unit', ['no unit', 'no lambung', 'unit', 'kode unit'], 'DT-21', { required: true }),
    f('jenis', 'Jenis', ['jenis', 'tipe unit', 'type'], 'DT', { required: true }),
    f('departemen', 'Departemen', ['departemen', 'dept'], 'PRD'),
    f('kepemilikan', 'Kepemilikan', ['kepemilikan', 'milik', 'ownership'], 'Sewa'),
    f('vendor', 'Vendor', ['vendor', 'pemilik', 'rental'], 'PT Rental Jaya'),
    f('merek', 'Merek', ['merek', 'brand'], 'Hino'), f('model', 'Model', ['model'], '500 FM 260 JD'),
    f('serial', 'No. rangka/serial', ['serial', 'no rangka', 'sn'], ''), f('tahun', 'Tahun', ['tahun', 'year'], '2022'),
    f('hm', 'HM', ['hm', 'hour meter', 'km/hm'], '12500')] },
  { key: 'barang', label: 'Master barang', perm: 'log.manage', note: 'Kode yang sudah ada diperbarui. Kategori: suku cadang, ban, BBM, pelumas, habis pakai, APD, lainnya.', fields: [
    f('kode', 'Kode', ['kode', 'kode barang', 'part number', 'pn', 'item code'], 'SP-FLT-01', { required: true }),
    f('nama', 'Nama', ['nama', 'nama barang', 'deskripsi', 'description'], 'Filter oli', { required: true }),
    f('kategori', 'Kategori', ['kategori', 'category', 'grup'], 'Suku cadang'),
    f('satuan', 'Satuan', ['satuan', 'uom', 'unit'], 'pcs'),
    f('stok_min', 'Stok minimum', ['stok min', 'stok minimum', 'min stock', 'min'], '5')] },
  { key: 'supplier', label: 'Supplier', perm: 'log.manage', note: 'Kode yang sudah ada diperbarui.', fields: [
    f('kode', 'Kode', ['kode', 'kode supplier', 'vendor code'], 'SUP-01', { required: true }),
    f('nama', 'Nama', ['nama', 'nama supplier', 'supplier', 'vendor'], 'CV Mitra Teknik', { required: true }),
    f('kategori', 'Kategori', ['kategori', 'bidang'], 'Suku cadang'), f('kontak', 'Kontak', ['kontak', 'pic', 'contact'], 'Pak Andi'),
    f('telepon', 'Telepon', ['telepon', 'hp', 'phone', 'no hp'], '0812xxxx')] },
  { key: 'opname', label: 'Stok opname', perm: 'log.warehouse', note: 'Stok sistem disamakan dengan hasil hitung; selisih tercatat sebagai penyesuaian.', fields: [
    f('kode', 'Kode barang', ['kode', 'kode barang', 'part number'], 'SP-FLT-01', { required: true }),
    f('stok_fisik', 'Stok fisik', ['stok fisik', 'hasil hitung', 'qty', 'jumlah', 'stok'], '12', { required: true }),
    f('keterangan', 'Keterangan', ['keterangan', 'catatan', 'note'], 'Opname Oktober')] },
  { key: 'spip', label: 'Komisioning SPIP', perm: 'spip.manage', note: 'Kode + no. registrasi yang sama diperbarui. Jenis objek: unit, alat, instalasi.', fields: [
    f('jenis_objek', 'Jenis objek', ['jenis objek', 'objek', 'jenis'], 'unit'),
    f('kode', 'Kode / no. lambung', ['kode', 'no lambung', 'no unit', 'kode alat'], 'DT-21', { required: true }),
    f('nama', 'Nama', ['nama', 'nama alat', 'deskripsi'], 'Dump truck Hino', { required: true }),
    f('kategori', 'Kategori', ['kategori'], 'Sarana'), f('no_reg', 'No. registrasi', ['no reg', 'no registrasi', 'nomor'], 'SPIP/001'),
    f('tgl_komisioning', 'Tgl komisioning', ['tgl komisioning', 'tanggal komisioning', 'tgl uji', 'tanggal'], '2026-05-01', { date: true }),
    f('berlaku_sampai', 'Berlaku sampai', ['berlaku sampai', 'masa berlaku', 'expired', 'exp'], '2027-05-01', { date: true }),
    f('penerbit', 'Penerbit', ['penerbit', 'inspektur', 'issuer'], 'KTT'), f('catatan', 'Catatan', ['catatan', 'keterangan'], '')] },
];

export const importKind = (key: string) => IMPORTS.find(k => k.key === key);
const norm = (s: string) => s.toLowerCase().replace(/[._\-/()]+/g, ' ').replace(/\s+/g, ' ').trim();

// Cocokkan judul kolom berkas dengan kolom baku (nama baku, label, atau alias)
export function mapHeaders(kind: ImportKind, headers: string[]) {
  const map: (string | null)[] = headers.map(() => null);
  for (const fld of kind.fields) {
    const names = [fld.key, fld.label, ...fld.aliases].map(norm);
    const i = headers.findIndex((h, j) => map[j] == null && names.includes(norm(h)));
    if (i >= 0) map[i] = fld.key;
  }
  return map;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, agt: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12 };
// Tanggal dari Excel (nomor seri), ISO, dd/mm/yyyy atau "12 Okt 2026" → yyyy-mm-dd
export function toIsoDate(v: string): string {
  const s = v.trim();
  if (!s || s === '-') return '';
  if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000).toISOString().slice(0, 10);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/.exec(s);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{1,2})[\s\-]+([a-z]{3})[a-z]*[\s\-]+(\d{4})$/i.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s;
}

// CSV / teks tempelan dari Excel (tab) → baris
export function parseDelimited(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = first.includes('\t') ? '\t' : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}
