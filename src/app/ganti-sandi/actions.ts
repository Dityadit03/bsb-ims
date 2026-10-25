'use server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { passwordProblem } from '@/lib/nik';

export async function changePassword(_: { error?: string }, f: FormData): Promise<{ error?: string }> {
  const password = String(f.get('password') ?? '');
  if (password !== String(f.get('confirm') ?? '')) return { error: 'Konfirmasi sandi tidak sama' };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login');
  const email = data.user.email ?? '';
  const nrp = email.endsWith('@nrp.bsb.local') ? email.split('@')[0].toUpperCase() : '';
  const problem = passwordProblem(password, nrp);
  if (problem) return { error: problem };
  const { error } = await supabase.auth.updateUser({ password, data: { must_change_password: false } });
  if (error) return { error: /same|different/i.test(error.message) ? 'Sandi baru harus berbeda dari sandi lama' : 'Gagal mengganti sandi, coba lagi' };
  await supabase.auth.refreshSession(); // klaim di token diperbarui agar tidak diminta ganti lagi
  redirect('/');
}
