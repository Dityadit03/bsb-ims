import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PasswordForm } from './password-form';

export const metadata = { title: 'Ganti sandi' };

export default async function ChangePasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login');
  const forced = !!data.user.user_metadata?.must_change_password;
  const email = data.user.email ?? '';
  const nrp = email.endsWith('@nrp.bsb.local') ? email.split('@')[0].toUpperCase() : '';
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="grid w-full max-w-sm gap-4">
        <h1 className="text-2xl font-bold">Ganti sandi</h1>
        <p className="text-sm text-muted">
          {forced ? 'Sandi Anda baru direset administrator. Buat sandi baru sebelum memakai aplikasi.' : 'Buat sandi baru untuk akun ini.'}
        </p>
        {nrp || forced ? <PasswordForm nrp={nrp} forced={forced} /> : <p className="text-sm text-muted">Akun Google dikelola lewat Google, bukan di sini.</p>}
      </div>
    </main>
  );
}
