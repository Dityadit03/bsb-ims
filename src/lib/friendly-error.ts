// Pesan galat teknis (Postgres/Supabase/jaringan, bahasa Inggris) diterjemahkan agar bisa dipahami pengguna lapangan.
// Pesan yang sudah berbahasa Indonesia (dari fungsi database kita) dibiarkan apa adanya.
const RULES: [RegExp, string][] = [
  [/duplicate key value|already exists|unique constraint/i, 'Data yang sama sudah ada. Periksa kembali nomor/kode yang diisi.'],
  [/violates not-null constraint|null value in column/i, 'Ada isian wajib yang masih kosong.'],
  [/violates check constraint/i, 'Ada isian yang nilainya tidak sesuai aturan (mis. angka negatif atau tanggal terbalik).'],
  [/violates foreign key constraint/i, 'Data ini masih dipakai atau rujukannya tidak ditemukan.'],
  [/invalid input syntax for type (numeric|integer|bigint|double)/i, 'Isian angka tidak valid. Gunakan angka saja.'],
  [/invalid input syntax for type (date|timestamp)/i, 'Format tanggal tidak valid.'],
  [/invalid input syntax for type uuid/i, 'Pilihan belum diisi atau tidak valid.'],
  [/value too long/i, 'Isian terlalu panjang.'],
  [/statement timeout|canceling statement/i, 'Server sedang sibuk. Coba lagi beberapa saat lagi.'],
  [/permission denied|row-level security|not authorized|42501/i, 'Anda tidak berwenang untuk tindakan ini.'],
  [/JWT expired|invalid JWT|Auth session missing|refresh token/i, 'Sesi login berakhir. Muat ulang halaman lalu masuk kembali.'],
  [/fetch failed|Failed to fetch|NetworkError|ECONNRESET|ETIMEDOUT|network ?error/i, 'Koneksi terputus. Periksa sinyal lalu coba lagi.'],
  [/Bad Gateway|Gateway Timeout|Service Unavailable/i, 'Server sedang tidak bisa dihubungi. Coba lagi beberapa saat lagi.'],
  [/payload too large|entity too large|exceeded the maximum allowed size/i, 'Berkas terlalu besar. Kecilkan foto atau kirim satu per satu.'],
];

export function friendlyError(msg: string | undefined | null): string {
  if (!msg) return 'Terjadi kesalahan. Coba lagi.';
  for (const [re, text] of RULES) if (re.test(msg)) return text;
  return msg;
}
