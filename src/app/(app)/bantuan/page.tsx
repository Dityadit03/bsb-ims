import Link from 'next/link';
import { PageHeader, Panel } from '@/components/ui';

export const metadata = { title: 'Bantuan' };

const FLOWS: { role: string; steps: [string, string][] }[] = [
  { role: 'Operator / driver', steps: [
    ['Sebelum bekerja', 'Scan stiker QR di unit atau buka P2H, isi checklist, lalu Simpan. Item kritis yang Tidak OK membuat unit tidak layak.'],
    ['Absen', 'Menu Absen: masuk dan pulang. Tanpa sinyal GPS, pilih absen tanpa GPS dan tulis alasannya.'],
    ['Melihat bahaya', 'Lapor hazard dengan foto. Bisa dikirim tanpa sinyal; terkirim otomatis saat online.'],
    ['Notifikasi', 'Pengaturan → Pemberitahuan di HP ini. Di iPhone, tambahkan aplikasi ke Layar Utama dulu.'],
  ] },
  { role: 'Pengawas', steps: [
    ['Awal shift', 'Catat Toolbox talk: topik, poin, dan NRP peserta.'],
    ['Akhir shift', 'Buat Serah terima: kondisi, pekerjaan belum selesai, bahaya, unit bermasalah. Pengawas shift berikutnya menekan Terima.'],
    ['Tindak lanjut', 'Kotak Tugas berisi hazard, temuan dan persetujuan yang menunggu Anda.'],
  ] },
  { role: 'Plant', steps: [
    ['Work order', 'Buat WO dari unit; tombol Minta suku cadang membuat MR ke gudang.'],
    ['Ban', 'Daftarkan ban, pasang ke unit dan posisi, ukur alur berkala. Peringatan muncul di lonceng.'],
    ['Keandalan', 'Produktivitas dan Keandalan menunjukkan MTBF, MTTR, PA, UA, dan selisih downtime WO vs produksi.'],
  ] },
  { role: 'Gudang / Logistik', steps: [
    ['Perencanaan', 'Isi lead time dan tandai barang kritis; sistem menghitung ROP dan usulan pesan.'],
    ['Rak', 'Isi lokasi rak per barang supaya penerimaan dan pengeluaran cepat.'],
    ['Pengeluaran', 'MR yang disetujui mencadangkan stok; keluarkan barang dari MR tersebut. Peminta lalu mengonfirmasi penerimaan; laporannya ada di tab Keluar ke plant.'],
    ['Part khusus', 'Part di luar katalog diproses dulu di detail MR (kaitkan ke barang katalog atau tolak) sebelum MR bisa disetujui.'],
    ['MR atau pembelian langsung?', 'MR dipakai untuk mengambil barang yang ada di stok gudang; bila stok kurang, Logistik membuat PR otomatis. Barang atau jasa yang dibeli dari luar dan tidak masuk stok diajukan di Logistik, Pengadaan, Ajukan pembelian langsung: disetujui Kepala Departemen Anda, lalu Logistik, PO, dan barang diserahkan ke Anda.'],
    ['Formulir fisik', 'Foto atau PDF formulir WO, MR, PR, dan PO yang sudah ditandatangani diunggah di halaman detail masing-masing.'],
  ] },
];

const GLOSSARY: [string, string][] = [
  ['P2H', 'Pemeriksaan harian unit sebelum dioperasikan.'],
  ['FTW', 'Fit to work: pemeriksaan kesiapan fisik pekerja.'],
  ['HM', 'Hour meter: jam kerja mesin.'],
  ['WO', 'Work order: perintah kerja perbaikan atau servis.'],
  ['MR', 'Material request: permintaan barang ke gudang.'],
  ['Mitra kerja', 'Kontraktor pelaksana perbaikan temuan; dipilih di detail hazard atau temuan inspeksi.'],
  ['PO', 'Purchase order: pesanan pembelian ke pemasok.'],
  ['ROP', 'Reorder point: batas stok untuk mulai memesan (pemakaian harian × lead time + stok minimum).'],
  ['ABC', 'Penggolongan barang menurut nilai pakai tahunan; A paling bernilai.'],
  ['MTBF / MTTR', 'Rata-rata jam antar kerusakan / rata-rata jam perbaikan.'],
  ['PA / UA', 'Physical availability / use of availability: ketersediaan unit dan pemakaiannya.'],
  ['OTD / RTD', 'Kedalaman alur ban baru / sisa kedalaman alur saat diukur (mm).'],
  ['CPH', 'Cost per hour: biaya per jam kerja.'],
  ['SMKP', 'Sistem Manajemen Keselamatan Pertambangan (Minerba).'],
  ['CAPA', 'Tindakan korektif dan pencegahan atas temuan.'],
  ['SAP', 'Program aktivitas pengawas: target observasi, inspeksi dan hazard mingguan.'],
  ['NIK / NRP', 'Nomor induk karyawan, dipakai untuk login dan identitas.'],
];

export default function HelpPage() {
  return (
    <>
      <PageHeader eyebrow="Panduan singkat" title="Bantuan" />
      <div className="grid gap-4 lg:grid-cols-2">
        {FLOWS.map(f => (
          <Panel key={f.role} title={f.role}>
            <ol className="grid gap-2 text-sm">
              {f.steps.map(([t, d], i) => (
                <li key={t} className="flex gap-3"><span className="font-mono text-xs text-muted">{i + 1}</span><span><b>{t}.</b> {d}</span></li>
              ))}
            </ol>
          </Panel>
        ))}
      </div>
      <Panel title="Istilah">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {GLOSSARY.map(([k, v]) => <div key={k}><dt className="inline font-semibold">{k}</dt> <dd className="inline text-muted">— {v}</dd></div>)}
        </dl>
      </Panel>
      <p className="text-sm text-muted">Masalah login atau akun? Hubungi admin sistem. Daftar formulir harian ada di <Link href="/she" className="text-accent">menu SHE</Link>.</p>
    </>
  );
}
