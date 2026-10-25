'use client';

// Kesalahan di halaman mana pun: pesan jelas dan tombol coba lagi (sinyal site sering putus di tengah memuat).
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto grid min-h-[60dvh] max-w-md content-center gap-4 px-6 text-center">
      <div aria-hidden className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-crit/10 text-2xl">⚠️</div>
      <h1 className="text-lg font-bold">Halaman gagal dimuat</h1>
      <p className="text-sm text-muted">Biasanya karena sinyal terputus. Data yang sudah Anda kirim tidak hilang.</p>
      <div className="grid gap-2">
        <button onClick={reset} className="rounded-xl bg-violet py-3 font-semibold text-white">Coba lagi</button>
        <a href="/" className="rounded-xl border border-line py-3 font-semibold">Ke beranda</a>
      </div>
      {error.digest && <p className="font-mono text-[11px] text-muted">Kode: {error.digest}</p>}
    </main>
  );
}
