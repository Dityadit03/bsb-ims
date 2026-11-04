import { env } from '@/lib/env';

// Pintu masuk per site di halaman login. Site baru: tambahkan di sini dan di tabel public.sites (kode, nama, email_domain).
export const LOGIN_SITES: { code: string; name: string; short: string; hd: string }[] = [
  { code: 'BDA', name: 'Site BDA', short: 'Site', hd: env.workspaceDomain },
  { code: 'HO', name: 'Kantor Pusat (HO)', short: 'Kantor Pusat', hd: 'bsb-mine.id' },
];
export const siteByCode = (c?: string | null) => LOGIN_SITES.find(s => s.code === (c ?? '').toUpperCase());
