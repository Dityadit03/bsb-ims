import Image from 'next/image';
import { ClearOfflineCache } from './clear-offline-cache';
import { LoginButton } from './login-button';
import { NikForm } from './nik-form';
import { SiteSelect } from './site-select';
import { loginSites } from '@/lib/sites';

export const metadata = { title: 'Masuk' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; site?: string; akun?: string }> }) {
  const { next, error, site: siteParam, akun } = await searchParams;
  const sites = await loginSites();
  const byCode = (c?: string) => sites.find(s => s.code === (c ?? '').toUpperCase());
  const site = byCode(siteParam) ?? sites[0];
  const actual = byCode(akun);
  return (
    <main className="grid min-h-dvh bg-coal text-coal-ink lg:grid-cols-[1.15fr_1fr]">
      <ClearOfflineCache />
      {/* Sisi kiri: identitas tambang (di ponsel menjadi header ringkas) */}
      <section className="relative isolate flex flex-col justify-between gap-10 overflow-hidden bg-[radial-gradient(70%_60%_at_10%_0%,rgb(234_11_96/0.35),transparent_70%),radial-gradient(60%_50%_at_100%_30%,rgb(106_31_192/0.45),transparent_70%),linear-gradient(180deg,#1e1433,#120b22)] px-6 pb-28 pt-8 sm:px-10 lg:min-h-dvh lg:px-14 lg:pb-16 lg:pt-12">
        <svg aria-hidden="true" className="absolute inset-0 -z-10 size-full opacity-[0.18]" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" viewBox="0 0 800 800" fill="none" stroke="white" strokeWidth="1">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => <ellipse key={i} cx="520" cy="300" rx={60 + i * 55} ry={34 + i * 34} transform={`rotate(-18 520 300)`} />)}
        </svg>
        <div className="flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-xl bg-white p-1.5 shadow-lg"><Image src="/logo.png" alt="Logo PT Berkarya Sejahtera Bersama" width={40} height={40} priority /></span>
          <span className="grid leading-tight">
            <span className="text-sm font-bold">PT Berkarya Sejahtera Bersama</span>
            <span className="text-xs text-coal-ink/60">Mining, hauling, services</span>
          </span>
        </div>
        <div className="grid max-w-xl gap-4">
          <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">BSB <span className="bg-gradient-to-r from-[#ff3d8b] via-[#ff7a2f] to-[#ffb020] bg-clip-text text-transparent">IMS</span></h1>
          <p className="text-lg font-medium text-coal-ink/90 sm:text-xl">Satu sistem untuk operasi tambang yang aman, tertib, dan patuh.</p>
          <ul className="mt-2 hidden flex-wrap gap-2 text-xs font-semibold sm:flex">
            {['SMKP Minerba', 'K3 & Hazard', 'P2H & Plant', 'Produksi', 'Logistik', 'HRGA', 'Document Control'].map(t => (
              <li key={t} className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 backdrop-blur">{t}</li>
            ))}
          </ul>
        </div>
        {/* Siluet jenjang tambang terbuka (pit bench) */}
        <svg aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-40 w-full lg:h-56" viewBox="0 0 800 220" preserveAspectRatio="none">
          <path d="M0 220V120l70-18 60 22 70-30 80 26 90-40 70 30 90-34 80 24 90-30V220Z" fill="#2a1a4a" opacity=".9" />
          <path d="M0 220V160l90-14 70 20 90-26 90 22 100-30 80 24 110-22 170 20V220Z" fill="#1a1030" />
          <path d="M0 220V190l120-8 100 12 140-14 120 10 160-12 160 8V220Z" fill="#0f0b18" />
        </svg>
        <div className="absolute inset-x-0 bottom-0 hidden h-2 bg-[repeating-linear-gradient(135deg,#f95a11_0_14px,#0f0b18_14px_28px)] lg:block" aria-hidden="true" />
        <p className="absolute bottom-5 left-6 hidden lg:block text-xs font-semibold text-coal-ink/70 sm:left-10 lg:left-14">Keselamatan adalah yang utama</p>
      </section>

      {/* Sisi kanan: form masuk */}
      <section className="relative grid place-items-center bg-[#120b22] px-4 py-8 sm:px-8 lg:py-12">
        <div className="-mt-20 grid w-full max-w-md gap-6 rounded-2xl border border-white/10 bg-[#1b1230] p-6 shadow-2xl ring-1 ring-white/5 sm:p-8 lg:mt-0">
          <div className="grid gap-1">
            <h2 className="text-2xl font-bold">Selamat datang</h2>
            <p className="text-sm text-coal-ink/65">Pilih site, lalu masuk dengan NIK atau akun Google perusahaan.</p>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="site-select" className="text-xs font-semibold text-coal-ink/70">Site</label>
            <SiteSelect sites={sites} value={site.code} next={next} />
          </div>
          {error === 'site' ? (
            <p role="alert" className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-sm">
              Akun ini terdaftar di {actual ? actual.name : 'site lain'}. Pilih "{actual ? actual.name : 'site yang benar'}" pada pilihan site, lalu masuk lagi.
            </p>
          ) : error && (
            <p role="alert" className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-sm">
              Login Google gagal. Gunakan akun email perusahaan {site.name}, lalu coba lagi.
            </p>
          )}
          <NikForm next={next} site={site.code} />
          <div className="flex items-center gap-3 text-xs text-coal-ink/50"><span className="h-px flex-1 bg-white/15" />atau<span className="h-px flex-1 bg-white/15" /></div>
          <LoginButton next={next} site={site.code} hd={site.hd} />
          <p className="text-xs leading-relaxed text-coal-ink/50">Akun baru perlu disetujui administrator sebelum bisa dipakai. Admin sistem dan akun HO dapat memilih site mana pun.</p>
        </div>
      </section>
    </main>
  );
}
