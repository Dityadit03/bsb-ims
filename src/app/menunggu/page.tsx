import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Menunggu persetujuan' };

export default async function PendingPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login');
  const { data: profile } = await supabase.from('profiles').select('email, status').eq('id', auth.user.id).single();
  if (profile?.status === 'active') redirect('/');

  const email = profile?.email ?? auth.user.email ?? '';
  const shown = email.endsWith('@nrp.bsb.local') ? `NIK ${email.split('@')[0].toUpperCase()}` : email;
  const suspended = profile?.status === 'suspended' || profile?.status === 'exited';
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="grid max-w-md gap-4">
        <h1 className="text-4xl font-bold">{suspended ? 'Akses dinonaktifkan' : 'Menunggu persetujuan'}</h1>
        <p className="text-muted">
          {suspended
            ? 'Akun ini sudah dinonaktifkan. Hubungi administrator BSB IMS bila ini keliru.'
            : <>Akun <b className="text-ink">{shown}</b> sudah terdaftar. Administrator perlu mengaktifkan akun dan memberi peran sebelum Anda bisa masuk.</>}
        </p>
        <form action="/auth/keluar" method="post"><button className="text-sm text-accent hover:underline">Keluar dan pakai akun lain</button></form>
      </div>
    </main>
  );
}
