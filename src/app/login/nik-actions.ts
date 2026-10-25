'use server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isNrp, normalizeNrp, nrpEmail, passwordProblem } from '@/lib/nik';

export type NikState = { error?: string; ok?: string };
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const safeNext = (n: string) => (n.startsWith('/') && !n.startsWith('//') ? n : '/');

// Pesan galat sengaja seragam: tidak membocorkan apakah NIK terdaftar.
export async function loginNik(_: NikState, f: FormData): Promise<NikState> {
  const nrp = normalizeNrp(str(f, 'nrp'));
  const password = String(f.get('password') ?? '');
  if (!isNrp(nrp) || !password) return { error: 'NIK atau sandi salah' };
  const supabase = await createClient();
  const captcha = str(f, 'cf-turnstile-response');
  const { error } = await supabase.auth.signInWithPassword({
    email: nrpEmail(nrp), password, options: captcha ? { captchaToken: captcha } : undefined,
  });
  if (error) {
    if (/captcha/i.test(error.message)) return { error: 'Verifikasi keamanan gagal, muat ulang halaman lalu coba lagi' };
    if (/rate|too many|limit/i.test(error.message)) return { error: 'Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.' };
    return { error: 'NIK atau sandi salah' };
  }
  redirect(safeNext(str(f, 'next')));
}

// Pendaftaran membuat akun berstatus "menunggu"; administrator mencocokkan NIK + tanggal lahir dengan data karyawan.
export async function registerNik(_: NikState, f: FormData): Promise<NikState> {
  const nrp = normalizeNrp(str(f, 'nrp'));
  const name = str(f, 'name').slice(0, 100);
  const birth = str(f, 'birth');
  const password = String(f.get('password') ?? '');
  if (!isNrp(nrp)) return { error: 'NIK tidak valid (huruf besar, angka, strip; contoh BSB-0123)' };
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
