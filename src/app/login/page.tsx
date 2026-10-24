import Image from 'next/image';
import { LoginButton } from './login-button';

export const metadata = { title: 'Masuk' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main className="grid min-h-dvh place-items-center bg-coal px-4 py-10 text-coal-ink">
      <div className="grid w-full max-w-sm gap-8">
        <div className="grid gap-2">
          <span className="mb-2 grid size-20 place-items-center rounded-2xl bg-white p-2 shadow-lg">
            <Image src="/logo.png" alt="Logo PT Berkarya Sejahtera Bersama" width={72} height={72} priority />
          </span>
          <span className="font-mono text-xs uppercase tracking-wider text-coal-ink/60">PT Berkarya Sejahtera Bersama</span>
          <h1 className="text-5xl font-bold leading-none">BSB IMS</h1>
          <p className="text-sm text-coal-ink/70">Document Control, SMKP Minerba, SHE, Plant, Produksi, Logistik dan HRGA dalam satu sistem.</p>
        </div>
        {error && (
          <p role="alert" className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-sm">
            Login gagal. Gunakan akun Google Workspace BSB, lalu coba lagi.
          </p>
        )}
        <LoginButton next={next} />
        <p className="text-xs text-coal-ink/50">Akun di luar domain perusahaan perlu disetujui administrator sebelum bisa dipakai.</p>
      </div>
    </main>
  );
}
