'use server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { siteMismatch } from '@/lib/site-guard';
import { isNrp, normalizeNrp, nrpEmail, passwordProblem } from '@/lib/nik';

export type NikState = { error?: string; ok?: string };
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const lockedMsg = (sec: number) => {
  const m = Math.ceil(sec / 60);
  return `Terlalu banyak sandi salah. Akun dikunci sementara, coba lagi dalam ${m >= 60 ? `${Math.floor(m / 60)} jam ${m % 60} menit` : `${m} menit`}. Lupa sandi? Hubungi administrator.`;
};
const safeNext = (n: string) => (n.startsWith('/') && !n.startsWith('//') ? n : '/');

// Pesan galat sengaja seragam: tidak membocorkan apakah NIK terdaftar.
export async function loginNik(_: NikState, f: FormData): Promise<NikState> {
  const nrp = normalizeNrp(str(f, 'nrp'));
  const password = String(f.get('password') ?? '');
  if (!isNrp(nrp) || !password) return { error: 'NIK atau sandi salah' };
  const supabase = await createClient();
  // Kunci per NIK: 5x salah -> 30 menit, salah lagi -> waktu tunggu berlipat (dicatat di database)
  const { data: wait } = await supabase.rpc('nik_login_gate', { p_nrp: nrp });
  if (Number(wait) > 0) return { error: lockedMsg(Number(wait)) };
  const captcha = str(f, 'cf-turnstile-response');
  const { error } = await supabase.auth.signInWithPassword({
    email: nrpEmail(nrp), password, options: captcha ? { captchaToken: captcha } : undefined,
  });
  if (error) {
    if (/captcha/i.test(error.message)) return { error: 'Verifikasi keamanan gagal, muat ulang halaman lalu coba lagi' };
    if (/rate|too many|limit/i.test(error.message)) return { error: 'Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.' };
    if (/invalid|credentials/i.test(error.message)) {
      const { data: locked } = await supabase.rpc('nik_login_failed', { p_nrp: nrp });
      if (Number(locked) > 0) return { error: lockedMsg(Number(locked)) };
    }
    return { error: 'NIK atau sandi salah' };
  }
  await supabase.rpc('nik_login_succeeded');
  const site = str(f, 'site');
  const actual = await siteMismatch(site);
  if (actual) redirect(`/login?error=site&site=${encodeURIComponent(site)}&akun=${actual}`);
  redirect(safeNext(str(f, 'next')));
}

// Pendaftaran membuat akun berstatus "menunggu"; administrator mencocokkan NIK + tanggal lahir dengan data karyawan.
export async function registerNik(_: NikState, f: FormData): Promise<NikState> {
  const nrp = normalizeNrp(str(f, 'nrp'));
  const name = str(f, 'name').slice(0, 100);
  const birth = str(f, 'birth');
  const password = String(f.get('password') ?? '');
  if (!isNrp(nrp)) return { error: 'NIK tidak valid (contoh 24.05.064)' };
  if (name.length < 3) return { error: 'Isi nama lengkap' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth) || Number.isNaN(Date.parse(birth))) return { error: 'Isi tanggal lahir' };
  if (password !== String(f.get('confirm') ?? '')) return { error: 'Konfirmasi sandi tidak sama' };
  const problem = passwordProblem(password, nrp);
  if (problem) return { error: problem };
  const supabase = await createClient();
  const captcha = str(f, 'cf-turnstile-response');
  const { error } = await supabase.auth.signUp({
    email: nrpEmail(nrp), password,
    options: { data: { full_name: name, nrp, birth_date: birth }, captchaToken: captcha || undefined },
  });
  if (error) {
    if (/already|registered|exists/i.test(error.message)) return { error: 'NIK ini sudah pernah didaftarkan. Bila lupa sandi, hubungi administrator.' };
    if (/captcha/i.test(error.message)) return { error: 'Verifikasi keamanan gagal, muat ulang halaman lalu coba lagi' };
    if (/rate|too many|limit/i.test(error.message)) return { error: 'Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.' };
    return { error: 'Pendaftaran gagal. Coba lagi atau hubungi administrator.' };
  }
  redirect('/menunggu');
}
