// Register yang bisa diekspor ke Excel/CSV, ditarik ke Google Sheets (feed) dan jenis data yang bisa diimpor.
import { HAZARD_TYPE, INCIDENT_CLASS, OPEN_CLOSED, VALIDITY } from '@/lib/she';
import { UNIT_STATUS, WO_STATUS, WO_TYPE } from '@/lib/plant';
import { CATEGORY, MOVE, MR_STATUS, PO_STATUS, PR_STATUS, STAGE } from '@/lib/logistics';
import { ATT_STATUS, CARD_STATUS, CONTRACT, CONTRACT_STATUS, DAY_TYPE, EMPLOYMENT, LEAVE_STATUS, MOVE as MOVEMENT, OT_STATUS, RUN_KIND, RUN_STATUS, CLAIM_STATUS, ADV_STATUS, ADV_KIND, PAY_METHOD, REQ_STATUS, REQ_REASON, APP_STAGE, CAND_SOURCE } from '@/lib/hrga';

type Label = Record<string, string | [string, string]>;
const lbl = (m: Label) => (v: unknown) => { const x = m[String(v)]; return x == null ? v : Array.isArray(x) ? x[1] : x; };
const yn = (v: unknown) => (v == null ? '' : v ? 'Ya' : 'Tidak');

export type Column = [key: string, header: string, fmt?: (v: unknown) => unknown];
export type Dataset = { key: string; label: string; group: string; view: string; order: string; desc?: boolean; feed: boolean; filter?: [param: string, column: string]; columns: Column[] };

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
  { key: 'kesiapan', label: 'Kesiapan tenaga kerja', group: 'HRGA', view: 'workforce_readiness', order: 'full_name', feed: false, columns: [
    ['nrp', 'NRP'], ['full_name', 'Nama'], ['department_code', 'Dept'], ['position_name', 'Jabatan'], ['employment_type', 'Status kerja', lbl(EMPLOYMENT)],
    ['company', 'Perusahaan'], ['induction_ok', 'Induksi', yn], ['medical_ok', 'MCU fit', yn], ['compliant', 'Kompetensi terpenuhi'],
    ['required', 'Kompetensi wajib'], ['id_card_ok', 'ID card', yn], ['unit_types', 'SIMPER', v => (Array.isArray(v) ? v.join(', ') : v)],
    ['roster_today', 'Roster hari ini'], ['ready', 'Siap kerja', yn]] },
  { key: 'kontrak', label: 'Kontrak kerja aktif', group: 'HRGA', view: 'contract_register', order: 'end_date', feed: false, columns: [
    ['nrp', 'NRP'], ['full_name', 'Nama'], ['department_code', 'Dept'], ['contract_type', 'Jenis', lbl(CONTRACT)], ['contract_no', 'No. kontrak'],
    ['start_date', 'Mulai'], ['end_date', 'Berakhir'], ['days_left', 'Sisa hari'], ['contract_status', 'Status', lbl(CONTRACT_STATUS)]] },
  { key: 'riwayat_karyawan', label: 'Riwayat mutasi & promosi', group: 'HRGA', view: 'movement_register', order: 'effective_date', desc: true, feed: false, columns: [
    ['effective_date', 'Tgl efektif'], ['nrp', 'NRP'], ['full_name', 'Nama'], ['kind', 'Jenis', lbl(MOVEMENT)], ['from_department', 'Dari dept'],
    ['to_department', 'Ke dept'], ['from_position', 'Dari jabatan'], ['to_position', 'Ke jabatan'], ['from_type', 'Dari status'], ['to_type', 'Ke status'],
    ['reason', 'Alasan'], ['reference_no', 'No. SK'], ['recorded_by_name', 'Dicatat oleh']] },
  { key: 'idcard', label: 'ID card & akses site', group: 'HRGA', view: 'id_card_register', order: 'card_no', feed: false, columns: [
    ['card_no', 'No. kartu'], ['nrp', 'NRP'], ['full_name', 'Nama'], ['department_code', 'Dept'], ['company', 'Perusahaan'],
    ['access_areas', 'Area', v => (Array.isArray(v) ? v.join(', ') : v)], ['issued_on', 'Terbit'], ['valid_until', 'Berlaku sampai'],
    ['status', 'Status', lbl(CARD_STATUS)], ['status_note', 'Keterangan']] },
  { key: 'dokumen', label: 'Register dokumen', group: 'Dokumen', view: 'document_register', order: 'document_number', feed: false, columns: [
    ['document_number', 'No. dokumen'], ['title', 'Judul'], ['type_code', 'Jenis'], ['department_code', 'Dept'], ['section_code', 'Seksi'],
    ['current_revision', 'Revisi'], ['status', 'Status'], ['effective_date', 'Berlaku'], ['next_review_at', 'Tinjau ulang'], ['owner_name', 'Pemilik']] },
  { key: 'pelanggaran', label: 'Pelanggaran GR/SPDK', group: 'SHE', view: 'violation_register', order: 'occurred_on', desc: true, feed: false, columns: [
    ['violation_no', 'No.'], ['occurred_on', 'Tanggal'], ['nrp', 'NRP'], ['offender_name', 'Nama'], ['department_code', 'Dept'], ['violation_type', 'Jenis'],
    ['chronology', 'Kronologi'], ['sanction', 'Sanksi'], ['sp_no', 'No. SP'], ['repeat_no', 'Pengulangan ke'], ['status', 'Status']] },
  { key: 'izin', label: 'Izin masuk area', group: 'SHE', view: 'area_permit_register', order: 'start_on', desc: true, feed: false, columns: [
    ['permit_no', 'No. izin'], ['visitor_name', 'Tamu'], ['company', 'Perusahaan'], ['people_count', 'Orang'], ['work_area_name', 'Area'],
    ['purpose', 'Keperluan'], ['start_on', 'Mulai'], ['end_on', 'Sampai'], ['escort_name', 'Pendamping'], ['status', 'Status']] },
  { key: 'absensi', label: 'Absensi harian', group: 'HRGA', view: 'attendance_daily', order: 'work_date', desc: true, feed: false, columns: [
    ['work_date', 'Tanggal'], ['nrp', 'NRP'], ['full_name', 'Nama'], ['department_code', 'Dept'], ['roster_code', 'Roster'], ['clock_in', 'Masuk'],
    ['clock_out', 'Pulang'], ['late_minutes', 'Terlambat (mnt)'], ['early_minutes', 'Pulang awal (mnt)'], ['worked_hours', 'Jam kerja'],
    ['status', 'Status', lbl(ATT_STATUS)], ['outside_geofence', 'Di luar radius', yn]] },
  { key: 'cuti', label: 'Pengajuan cuti & izin', group: 'HRGA', view: 'leave_register', order: 'start_date', desc: true, feed: false, columns: [
    ['request_no', 'No.'], ['nrp', 'NRP'], ['full_name', 'Nama'], ['department_code', 'Dept'], ['leave_name', 'Jenis'], ['paid', 'Dibayar', yn],
    ['start_date', 'Mulai'], ['end_date', 'Sampai'], ['days', 'Hari'], ['reason', 'Keterangan'], ['status', 'Status', lbl(LEAVE_STATUS)],
    ['approver1_name', 'Atasan'], ['approver2_name', 'HRGA'], ['decision_note', 'Catatan']] },
  { key: 'saldo_cuti', label: 'Saldo cuti tahun berjalan', group: 'HRGA', view: 'leave_balance', order: 'full_name', feed: false, columns: [
    ['nrp', 'NRP'], ['full_name', 'Nama'], ['department_code', 'Dept'], ['leave_name', 'Jenis'], ['year', 'Tahun'], ['quota', 'Kuota'],
    ['adjustment', 'Penyesuaian'], ['used', 'Terpakai'], ['pending', 'Menunggu'], ['available', 'Sisa']] },
  { key: 'lembur', label: 'Lembur (SPL)', group: 'HRGA', view: 'overtime_register', order: 'work_date', desc: true, feed: false, columns: [
    ['request_no', 'No. SPL'], ['work_date', 'Tanggal'], ['nrp', 'NRP'], ['full_name', 'Nama'], ['department_code', 'Dept'], ['start_at', 'Mulai'],
    ['end_at', 'Selesai'], ['hours', 'Jam SPL'], ['actual_hours', 'Jam aktual'], ['day_type', 'Jenis hari', lbl(DAY_TYPE)], ['reason', 'Pekerjaan'],
    ['status', 'Status', lbl(OT_STATUS)], ['approver_name', 'Disetujui oleh']] },
  { key: 'klaim', label: 'Klaim reimbursement', group: 'HRGA', view: 'expense_claim_register', order: 'created_at', desc: true, feed: false, columns: [
    ['claim_no', 'No. klaim'], ['nrp', 'NRP'], ['full_name', 'Nama'], ['department_code', 'Dept'], ['claim_type_name', 'Jenis'], ['taxable', 'Kena pajak', yn],
    ['expense_date', 'Tgl biaya'], ['description', 'Keterangan'], ['amount', 'Diajukan'], ['approved_amount', 'Disetujui'],
    ['pay_method', 'Cara bayar', lbl(PAY_METHOD)], ['status', 'Status', lbl(CLAIM_STATUS)], ['paid_on', 'Tgl bayar'], ['paid_run_no', 'Proses gaji'],
    ['approver1_name', 'Atasan'], ['approver2_name', 'Payroll'], ['decision_note', 'Catatan']] },
  { key: 'kasbon', label: 'Kasbon & uang muka', group: 'HRGA', view: 'cash_advance_register', order: 'created_at', desc: true, feed: false, columns: [
    ['advance_no', 'No.'], ['nrp', 'NRP'], ['full_name', 'Nama'], ['department_code', 'Dept'], ['kind', 'Jenis', lbl(ADV_KIND)], ['purpose', 'Keperluan'],
    ['amount', 'Nominal'], ['installments', 'Cicilan (bln)'], ['installment_amount', 'Potongan/bulan'], ['disbursed_on', 'Tgl cair'],
    ['actual_amount', 'Biaya sebenarnya'], ['repaid', 'Sudah kembali'], ['balance', 'Sisa'], ['status', 'Status', lbl(ADV_STATUS)],
    ['approver1_name', 'Atasan'], ['approver2_name', 'Payroll']] },
  { key: 'fptk', label: 'Permintaan tenaga kerja (FPTK)', group: 'HRGA', view: 'requisition_register', order: 'created_at', desc: true, feed: false, columns: [
    ['req_no', 'No. FPTK'], ['department_code', 'Dept'], ['position_name', 'Jabatan'], ['headcount', 'Jumlah'], ['employment_type', 'Status kerja', lbl(EMPLOYMENT)],
    ['reason', 'Alasan', lbl(REQ_REASON)], ['replaced_name', 'Menggantikan'], ['needed_by', 'Dibutuhkan'], ['mpp_planned', 'MPP'], ['mpp_actual', 'Aktual'],
    ['status', 'Status', lbl(REQ_STATUS)], ['applicants', 'Pelamar'], ['in_process', 'Dalam proses'], ['hired', 'Diterima'],
    ['requester_name', 'Pemohon'], ['verifier_name', 'Verifikasi HR'], ['approver_name', 'Disetujui'], ['decision_note', 'Catatan']] },
  { key: 'pelamar', label: 'Pelamar per FPTK', group: 'HRGA', view: 'application_register', order: 'stage_at', desc: true, feed: false, columns: [
    ['req_no', 'No. FPTK'], ['department_code', 'Dept'], ['position_name', 'Jabatan'], ['full_name', 'Nama'], ['phone', 'No. HP'],
    ['education_level', 'Pendidikan'], ['experience_years', 'Pengalaman (th)'], ['domicile', 'Domisili'], ['is_local', 'Lokal', yn],
    ['source', 'Sumber', lbl(CAND_SOURCE)], ['stage', 'Tahap', lbl(APP_STAGE)], ['stage_at', 'Sejak'], ['psikotes_score', 'Nilai psikotes'],
    ['interview_score', 'Nilai interview'], ['close_reason', 'Alasan gugur']] },
  // payroll: hanya terbaca pemegang peran payroll (RLS); tidak pernah jadi feed
  { key: 'slip_gaji', label: 'Rincian gaji per karyawan', group: 'HRGA', view: 'payroll_slip_register', order: 'period', desc: true, feed: false, filter: ['run', 'run_id'], columns: [
    ['run_no', 'No. proses'], ['period', 'Periode'], ['kind', 'Jenis', lbl(RUN_KIND)], ['run_status', 'Status', lbl(RUN_STATUS)], ['parallel', 'Uji paralel', yn],
    ['nrp', 'NRP'], ['full_name', 'Nama'], ['department_code', 'Dept'], ['position_name', 'Jabatan'], ['ptkp_status', 'PTKP'], ['ter_category', 'TER'],
    ['days_present', 'Hadir'], ['days_absent', 'Alpa'], ['days_unpaid', 'Izin tdk dibayar'], ['nights', 'Shift malam'], ['overtime_hours', 'Jam lembur'],
    ['fixed_wage', 'Upah tetap'], ['earnings', 'Bruto'], ['deductions', 'Potongan'], ['bpjs_ee', 'BPJS karyawan'], ['bpjs_er', 'BPJS perusahaan'],
    ['gross_tax', 'Bruto pajak'], ['ter_rate', 'Tarif TER %'], ['pph21', 'PPh 21'], ['annualized', 'Hitung setahun', yn], ['net', 'Gaji bersih'],
    ['employer_cost', 'Biaya perusahaan'], ['bank_name', 'Bank'], ['bank_account', 'No. rekening'], ['bank_holder', 'Atas nama'],
    ['legacy_net', 'Bersih sistem lama'], ['diff_net', 'Selisih bersih'], ['diff_pph21', 'Selisih PPh']] },
  { key: 'biaya_gaji', label: 'Rekap biaya gaji per departemen', group: 'HRGA', view: 'payroll_cost_recap', order: 'period', desc: true, feed: false, columns: [
    ['run_no', 'No. proses'], ['period', 'Periode'], ['kind', 'Jenis', lbl(RUN_KIND)], ['department_code', 'Dept'], ['department_name', 'Departemen'],
    ['headcount', 'Karyawan'], ['earnings', 'Bruto'], ['bpjs_er', 'BPJS perusahaan'], ['employer_cost', 'Biaya perusahaan'], ['bpjs_ee', 'BPJS karyawan'],
    ['pph21', 'PPh 21'], ['net', 'Gaji bersih'], ['overtime_hours', 'Jam lembur']] },
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
export type ImportField = { key: string; label: string; required?: boolean; date?: boolean; datetime?: boolean; aliases: string[]; example: string };
export type ImportKind = { key: string; label: string; perm: string; note: string; fields: ImportField[]; max?: number };
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
  { key: 'data_pribadi', label: 'Data pribadi karyawan', perm: 'hr.manage', note: 'Hanya kolom yang diisi yang diperbarui. Data ini hanya terlihat oleh HRGA dan karyawan ybs.', fields: [
    f('nrp', 'NRP', ['nrp', 'no karyawan'], 'BSB-0123', { required: true }),
    f('nik', 'NIK KTP', ['nik', 'nik ktp', 'no ktp', 'ktp'], '6471010101900001'),
    f('tempat_lahir', 'Tempat lahir', ['tempat lahir', 'tmp lahir'], 'Balikpapan'),
    f('tgl_lahir', 'Tgl lahir', ['tgl lahir', 'tanggal lahir', 'birth date'], '1990-01-01', { date: true }),
    f('jenis_kelamin', 'Jenis kelamin', ['jenis kelamin', 'jk', 'gender', 'l/p'], 'L'),
    f('agama', 'Agama', ['agama'], 'Islam'),
    f('ptkp', 'Status PTKP', ['ptkp', 'status ptkp', 'status pajak'], 'K/1'),
    f('pendidikan', 'Pendidikan', ['pendidikan', 'pendidikan terakhir'], 'SMA'),
    f('alamat', 'Alamat KTP', ['alamat', 'alamat ktp'], 'Jl. ...'),
    f('no_hp', 'No. HP', ['no hp', 'hp', 'telepon', 'no telp'], '0812...'),
    f('npwp', 'NPWP', ['npwp'], ''),
    f('bpjs_tk', 'BPJS TK', ['bpjs tk', 'bpjs ketenagakerjaan', 'no bpjs tk'], ''),
    f('bpjs_kes', 'BPJS Kesehatan', ['bpjs kes', 'bpjs kesehatan', 'no bpjs kes'], ''),
    f('bank', 'Bank', ['bank', 'nama bank'], 'Mandiri'),
    f('no_rekening', 'No. rekening', ['no rekening', 'rekening', 'no rek'], ''),
    f('nama_rekening', 'Nama rekening', ['nama rekening', 'atas nama'], ''),
    f('kontak_darurat', 'Kontak darurat', ['kontak darurat', 'nama darurat'], ''),
    f('hp_darurat', 'HP darurat', ['hp darurat', 'telp darurat'], '')] },
  { key: 'kontrak', label: 'Kontrak kerja', perm: 'hr.manage', note: 'Jenis: PKWT, PKWTT, percobaan, subkon. Status kerja karyawan ikut kontrak terbaru.', fields: [
    f('nrp', 'NRP', ['nrp', 'no karyawan'], 'BSB-0123', { required: true }),
    f('jenis', 'Jenis', ['jenis', 'jenis kontrak', 'status'], 'PKWT', { required: true }),
    f('no_kontrak', 'No. kontrak', ['no kontrak', 'nomor kontrak', 'no pkwt'], 'PKWT/001/2026'),
    f('mulai', 'Mulai', ['mulai', 'tgl mulai', 'awal kontrak'], '2026-01-01', { required: true, date: true }),
    f('berakhir', 'Berakhir', ['berakhir', 'tgl berakhir', 'akhir kontrak', 'selesai'], '2026-12-31', { date: true }),
    f('catatan', 'Catatan', ['catatan', 'keterangan'], '')] },
  { key: 'organisasi', label: 'Atasan langsung & data organisasi', perm: 'hr.manage', note: 'Atasan diisi NRP atasan langsung; dipakai untuk struktur organisasi dan persetujuan cuti/lembur.', fields: [
    f('nrp', 'NRP', ['nrp', 'no karyawan'], 'BSB-0123', { required: true }),
    f('atasan', 'NRP atasan', ['atasan', 'nrp atasan', 'atasan langsung', 'supervisor'], 'BSB-0010'),
    f('golongan', 'Golongan', ['golongan', 'grade', 'level'], 'G3'),
    f('pola_roster', 'Pola roster', ['pola roster', 'roster', 'pola kerja'], '10/4'),
    f('poh', 'Point of hire', ['poh', 'point of hire', 'asal penerimaan'], 'Balikpapan'),
    f('site', 'Kode site', ['site', 'kode site', 'lokasi'], 'BDA')] },
  { key: 'idcard', label: 'ID card & akses site', perm: 'hr.manage', note: 'Area dipisah koma: OFFICE, MESS, WORKSHOP, PIT, HAULING, PORT, FUEL. Karyawan wajib punya induksi & MCU fit yang berlaku.', fields: [
    f('nrp', 'NRP', ['nrp', 'no karyawan'], 'BSB-0123', { required: true }),
    f('no_kartu', 'No. kartu', ['no kartu', 'nomor kartu', 'no id card', 'id card'], 'IDC-0123', { required: true }),
    f('area', 'Area', ['area', 'akses', 'area akses'], 'OFFICE, MESS, PIT'),
    f('berlaku_sampai', 'Berlaku sampai', ['berlaku sampai', 'masa berlaku', 'expired'], '2027-06-30', { date: true })] },
  { key: 'absensi', label: 'Absensi mesin fingerprint', perm: 'hr.manage', max: 20000, note: 'Satu baris = satu sentuhan. Isi Waktu (tanggal + jam) atau kolom Tanggal dan Jam terpisah. Jenis boleh kosong: sentuhan pertama dianggap masuk, terakhir pulang. Data yang sama tidak tercatat dua kali.', fields: [
    f('nrp', 'NRP', ['nrp', 'no karyawan', 'id', 'user id', 'pin', 'ac-no', 'no. id', 'emp no'], 'BSB-0123', { required: true }),
    f('waktu', 'Waktu', ['waktu', 'tanggal jam', 'datetime', 'date time', 'time', 'scan time', 'check time'], '2026-10-20 06:02', { datetime: true }),
    f('tanggal', 'Tanggal', ['tanggal', 'tgl', 'date'], '2026-10-20', { date: true }),
    f('jam', 'Jam', ['jam', 'jam scan', 'clock'], '06:02'),
    f('jenis', 'Jenis', ['jenis', 'status', 'state', 'in/out', 'check type'], 'Masuk'),
    f('mesin', 'Mesin', ['mesin', 'device', 'terminal', 'machine'], 'FP-OFFICE')] },
  { key: 'saldo_cuti', label: 'Saldo awal / penyesuaian cuti', perm: 'hr.manage', note: 'Hari positif menambah, negatif mengurangi saldo (mis. -4 untuk cuti yang sudah diambil sebelum aplikasi dipakai). Jenis default CT (cuti tahunan).', fields: [
    f('nrp', 'NRP', ['nrp', 'no karyawan'], 'BSB-0123', { required: true }),
    f('hari', 'Hari', ['hari', 'jumlah hari', 'days', 'saldo'], '-4', { required: true }),
    f('tahun', 'Tahun', ['tahun', 'year', 'periode'], '2026'),
    f('jenis', 'Jenis', ['jenis', 'jenis cuti', 'kode'], 'CT'),
    f('keterangan', 'Keterangan', ['keterangan', 'alasan', 'catatan'], 'Cuti terpakai Jan–Okt')] },
  { key: 'gaji', label: 'Struktur gaji', perm: 'payroll.manage', note: 'Satu baris = satu komponen per karyawan (GP, TJAB, TSITE, TMAKAN, TTRANS, TSHIFT, atau kode lain di Payroll → Komponen). Nilai berlaku mulai tanggal yang diisi; riwayat lama tetap tersimpan.', fields: [
    f('nrp', 'NRP', ['nrp', 'no karyawan'], 'BSB-0123', { required: true }),
    f('komponen', 'Komponen', ['komponen', 'kode', 'kode komponen'], 'GP', { required: true }),
    f('nilai', 'Nilai', ['nilai', 'jumlah', 'nominal', 'amount'], '8000000', { required: true }),
    f('berlaku_mulai', 'Berlaku mulai', ['berlaku mulai', 'mulai', 'tmt', 'efektif'], '2026-01-01', { required: true, date: true }),
    f('keterangan', 'Keterangan', ['keterangan', 'catatan'], '')] },
  { key: 'input_gaji', label: 'Input gaji per periode', perm: 'payroll.manage', note: 'Insentif, rapel, kasbon, potongan lain untuk proses gaji bulanan periode itu yang belum disetujui (buat prosesnya dulu di Payroll).', fields: [
    f('periode', 'Periode', ['periode', 'bulan', 'period'], '2026-11', { required: true }),
    f('nrp', 'NRP', ['nrp', 'no karyawan'], 'BSB-0123', { required: true }),
    f('komponen', 'Komponen', ['komponen', 'kode'], 'INSENTIF', { required: true }),
    f('nilai', 'Nilai', ['nilai', 'jumlah', 'nominal'], '750000', { required: true }),
    f('keterangan', 'Keterangan', ['keterangan', 'catatan'], 'Premi ritase')] },
  { key: 'saldo_pajak', label: 'Saldo PPh 21 awal tahun', perm: 'payroll.manage', note: 'Akumulasi bruto, PPh 21 dan iuran JHT+JP karyawan dari Januari sampai bulan terakhir sebelum aplikasi dipakai; dipakai di perhitungan setahun (Desember / bulan keluar).', fields: [
    f('tahun', 'Tahun', ['tahun', 'year'], '2026', { required: true }),
    f('nrp', 'NRP', ['nrp', 'no karyawan'], 'BSB-0123', { required: true }),
    f('bruto', 'Bruto', ['bruto', 'penghasilan bruto', 'gross'], '85000000', { required: true }),
    f('pph21', 'PPh 21', ['pph21', 'pph 21', 'pajak'], '1500000', { required: true }),
    f('iuran_pensiun', 'Iuran JHT+JP', ['iuran pensiun', 'iuran jht jp', 'jht jp'], '2700000'),
    f('bulan', 'Jumlah bulan', ['bulan', 'jumlah bulan', 'masa kerja'], '10'),
    f('keterangan', 'Keterangan', ['keterangan', 'catatan'], 'Dari sistem lama')] },
  { key: 'gaji_lama', label: 'Hasil gaji sistem lama (uji paralel)', perm: 'payroll.manage', note: 'Untuk membandingkan proses uji paralel periode itu dengan hasil sistem lama per karyawan.', fields: [
    f('periode', 'Periode', ['periode', 'bulan', 'period'], '2026-11', { required: true }),
    f('nrp', 'NRP', ['nrp', 'no karyawan'], 'BSB-0123', { required: true }),
    f('bruto', 'Bruto', ['bruto', 'gross', 'total pendapatan'], '9500000'),
    f('pph21', 'PPh 21', ['pph21', 'pph 21', 'pajak'], '166272'),
    f('gaji_bersih', 'Gaji bersih', ['gaji bersih', 'take home pay', 'thp', 'net'], '8273728', { required: true }),
    f('keterangan', 'Keterangan', ['keterangan', 'catatan'], '')] },
  { key: 'kasbon_awal', label: 'Saldo kasbon dari sistem lama', perm: 'payroll.manage', note: 'Sisa kasbon yang belum lunas; langsung berjalan dan dipotong gaji sebesar Cicilan per bulan (kosong = dipotong sekaligus).', fields: [
    f('nrp', 'NRP', ['nrp', 'no karyawan'], 'BSB-0123', { required: true }),
    f('sisa', 'Sisa kasbon', ['sisa', 'sisa kasbon', 'saldo', 'outstanding'], '1200000', { required: true }),
    f('cicilan', 'Cicilan per bulan', ['cicilan', 'potongan', 'angsuran', 'cicilan per bulan'], '400000'),
    f('keterangan', 'Keterangan', ['keterangan', 'catatan', 'keperluan'], 'Kasbon Agustus')] },
  { key: 'kandidat', label: 'Bank kandidat', perm: 'hr.manage', note: 'Pelamar walk-in / job fair. NIK yang sudah ada diperbarui. Pendidikan: SD, SMP, SMA (SMK/STM ikut SMA), D3, S1, S2.', fields: [
    f('nama', 'Nama', ['nama', 'nama lengkap', 'nama kandidat'], 'Budi Santoso', { required: true }),
    f('nik', 'NIK KTP', ['nik', 'no ktp', 'ktp'], '6371010101900001'),
    f('no_hp', 'No. HP', ['no hp', 'hp', 'telepon', 'no telp', 'wa'], '081234567890'),
    f('email', 'Email', ['email', 'e-mail'], ''), f('tgl_lahir', 'Tanggal lahir', ['tgl lahir', 'tanggal lahir'], '1990-01-01'),
    f('jenis_kelamin', 'Jenis kelamin', ['jenis kelamin', 'jk', 'l/p'], 'L'), f('domisili', 'Domisili', ['domisili', 'alamat', 'kota'], 'Tanjung'),
    f('pendidikan', 'Pendidikan', ['pendidikan', 'pendidikan terakhir'], 'SMA'), f('jurusan', 'Jurusan', ['jurusan'], ''),
    f('pengalaman', 'Pengalaman (tahun)', ['pengalaman', 'pengalaman kerja', 'lama kerja'], '3'),
    f('perusahaan_terakhir', 'Perusahaan terakhir', ['perusahaan terakhir', 'tempat kerja terakhir'], ''),
    f('lokal', 'Warga lokal', ['lokal', 'warga lokal', 'putra daerah'], 'Ya'), f('keterangan', 'Keterangan', ['keterangan', 'catatan', 'posisi dilamar'], 'Operator DT')] },
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

// Tanggal + jam (serial Excel, "2026-10-20 06:20", "20/10/2026 06:20:15") → "YYYY-MM-DD HH:MM[:SS]"
export function toIsoDateTime(v: string): string {
  const s = v.trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(Number(s) * 86400) * 1000).toISOString().slice(0, 19).replace('T', ' ');
  }
  const m = /^(.+?)[\sT]+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*$/.exec(s);
  if (!m) return toIsoDate(s);
  return `${toIsoDate(m[1])} ${m[2].padStart(2, '0')}:${m[3]}${m[4] ? `:${m[4]}` : ''}`;
}

// Jam saja (serial pecahan Excel 0.2638 atau "06.20") → "HH:MM"
export function toTime(v: string): string {
  const s = v.trim();
  if (/^0?\.\d+$/.test(s)) { const t = Math.round(Number(s) * 1440); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; }
  return s.replace('.', ':');
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
