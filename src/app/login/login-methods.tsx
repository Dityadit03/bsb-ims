'use client';
import { useState } from 'react';
import { LoginButton } from './login-button';
import { NikForm } from './nik-form';

// Dua jalur yang jelas terpisah: karyawan lapangan masuk dengan NIK; akun email (HO, staf kantor) masuk dengan Microsoft atau Google tanpa NIK.
export function LoginMethods({ next, site, microsoft, initial }: { next?: string; site: string; microsoft: boolean; initial: 'nik' | 'email' }) {
  const [tab, setTab] = useState<'nik' | 'email'>(initial);
  return (
    <div className="grid gap-4">
      <div role="tablist" aria-label="Cara masuk" className="grid grid-cols-2 gap-1 rounded-xl bg-white/10 p-1 text-sm font-semibold">
        {([['nik', 'Karyawan (NIK)'], ['email', 'Akun email']] as const).map(([k, l]) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`min-h-10 rounded-lg px-2 ${tab === k ? 'bg-white text-coal' : 'text-coal-ink/70 hover:text-coal-ink'}`}>{l}</button>
        ))}
      </div>
      {tab === 'nik' ? <NikForm next={next} site={site} /> : (
        <div className="grid gap-3">
          <p className="text-sm text-coal-ink/70">Untuk akun email kantor (HO dan staf kantor). Tidak perlu mengisi NIK.</p>
          <LoginButton next={next} site={site} microsoft={microsoft} />
        </div>
      )}
    </div>
  );
}
