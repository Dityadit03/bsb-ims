import Link from 'next/link';

export const metadata = { title: 'Tidak ada sinyal' };

// Cadangan saat halaman belum pernah dibuka di ponsel ini dan jaringan sedang tidak ada.
export default function OfflinePage() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-4 px-6 text-center">
      <div aria-hidden className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-warn/15 text-3xl">📡</div>
      <h1 className="text-xl font-bold">Tidak ada sinyal</h1>
      <p className="text-sm text-muted">
        Halaman ini belum tersimpan di ponsel. Formulir <b>P2H</b>, <b>Hazard</b>, dan <b>Absen</b> yang pernah dibuka tetap bisa diisi:
        isian disimpan di ponsel dan dikirim otomatis saat sinyal kembali.
      </p>
      <div className="grid gap-2">
        <Link href="/she/p2h" className="rounded-xl bg-violet py-3 font-semibold text-white">Buka P2H</Link>
        <Link href="/she/hazard" className="rounded-xl border border-line py-3 font-semibold">Buka Hazard</Link>
        <Link href="/absen" className="rounded-xl border border-line py-3 font-semibold">Buka Absen</Link>
      </div>
    </main>
  );
}
