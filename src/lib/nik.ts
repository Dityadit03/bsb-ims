// Login NIK (NRP): akun memakai alamat sintetis yang tidak pernah dikirimi email.
export const NIK_DOMAIN = 'nrp.bsb.local';
const NRP = /^[A-Z0-9][A-Z0-9.-]{2,19}$/;

export const normalizeNrp = (v: string) => v.trim().toUpperCase().replace(/\s+/g, '');
export const isNrp = (v: string) => NRP.test(v);
export const nrpEmail = (nrp: string) => `${nrp.toLowerCase()}@${NIK_DOMAIN}`;

// Kebijakan sandi: cukup panjang, bukan NRP / angka saja. (Panjang minimum juga diatur di Supabase → Auth → Password.)
export function passwordProblem(pw: string, nrp = ''): string | null {
  if (pw.length < 10) return 'Sandi minimal 10 karakter';
  if (/^\d+$/.test(pw)) return 'Sandi tidak boleh hanya angka';
  if (nrp && pw.toUpperCase().includes(nrp)) return 'Sandi tidak boleh memuat NIK';
  if (/^(.)\1+$/.test(pw)) return 'Sandi terlalu mudah ditebak';
  return null;
}
