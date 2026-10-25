import Link from 'next/link';

export const metadata = { title: 'Halaman tidak ditemukan' };

export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-[60dvh] max-w-md content-center gap-4 px-6 text-center">
      <p className="text-5xl font-bold text-violet">404</p>
      <h1 className="text-lg font-bold">Halaman tidak ditemukan</h1>
      <p className="text-sm text-muted">Tautan mungkin salah, atau Anda tidak punya akses ke data ini.</p>
      <Link href="/" className="rounded-xl bg-violet py-3 font-semibold text-white">Ke beranda</Link>
    </main>
  );
}
