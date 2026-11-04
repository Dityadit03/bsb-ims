import Image from 'next/image';
import { ClearOfflineCache } from './clear-offline-cache';
import { LoginButton } from './login-button';
import { NikForm } from './nik-form';
import { LOGIN_SITES, siteByCode } from '@/lib/sites';

export const metadata = { title: 'Masuk' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; site?: string; akun?: string }> }) {
  const { next, error, site: siteParam, akun } = await searchParams;
  const site = siteByCode(siteParam) ?? LOGIN_SITES[0];
  const actual = siteByCode(akun);
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-coal bg-[radial-gradient(60%_45%_at_15%_10%,rgb(234_11_96/0.30),transparent_70%),radial-gradient(55%_45%_at_90%_95%,rgb(249_90_17/0.22),transparent_70%),radial-gradient(50%_40%_at_85%_15%,rgb(106_31_192/0.35),transparent_70%)] px-4 py-10 text-coal-ink">
      <ClearOfflineCache />
      <div className="grid w-full max-w-sm gap-8 rounded-2xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur sm:p-8">
        <div className="grid gap-2">
          <span className="mb-2 grid size-20 place-items-center rounded-2xl bg-white p-2 shadow-lg">
            <Image src="/logo.png" alt="Logo PT Berkarya Sejahtera Bersama" width={72} height={72} priority />
          </span>
          <span className="font-mono text-xs uppercase tracking-wider text-coal-ink/60">PT Berkarya Sejahtera Bersama</span>
          <h1 className="text-5xl font-bold leading-none">BSB IMS</h1>
          <p className="text-sm text-coal-ink/70">Document Control, SMKP Minerba, SHE, Plant, Produksi, Logistik dan HRGA dalam satu sistem.</p>
        </div>
        <div className="grid gap-1.5">
          <span className="text-xs text-coal-ink/60">Masuk ke</span>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/10 p-1 text-sm font-semibold">
            {LOGIN_SITES.map(x => (
              <a key={x.code} href={`/login?site=${x.code}${next ? `&next=${encodeURIComponent(next)}` : ''}`} aria-current={x.code === site.code}
                className={`rounded-lg py-2 text-center ${x.code === site.code ? 'bg-white text-coal' : 'text-coal-ink/70'}`}>{x.name}</a>
            ))}
          </div>
        </div>
        {error === 'site' ? (
          <p role="alert" className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-sm">
            Akun ini terdaftar di {actual ? actual.name : 'site lain'}. Pilih "{actual ? actual.name : 'site yang benar'}" di atas, lalu masuk lagi.
          </p>
        ) : error && (
          <p role="alert" className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-sm">
            Login Google gagal. Gunakan akun email perusahaan {site.name}, lalu coba lagi.
          </p>
        )}
        <NikForm next={next} site={site.code} />
        <div className="flex items-center gap-3 text-xs text-coal-ink/50"><span className="h-px flex-1 bg-white/15" />atau<span className="h-px flex-1 bg-white/15" /></div>
        <LoginButton next={next} site={site.code} hd={site.hd} />
        <p className="text-xs text-coal-ink/50">Login Google untuk akun email perusahaan. Akun baru perlu disetujui administrator sebelum bisa dipakai.</p>
      </div>
    </main>
  );
}
