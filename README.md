# BSB IMS · Integrated Management System

Sistem manajemen terintegrasi PT Berkarya Sejahtera Bersama untuk jasa hauling batubara, berbasis SMKP Minerba, SMK3 dan ISO 9001/14001/45001.
Menggantikan dan menyatukan [Document Control BSB](https://github.com/Dityadit03/document-control-bsb) dan [Portal SHE BSB](https://github.com/Dityadit03/she-portal-bsb).

## Status modul

| Modul | Isi | Status |
|---|---|---|
| M0 Fondasi | Login Google, pengguna & peran per departemen, master organisasi, audit trail, lampiran | Selesai |
| M1 Penomoran & workflow | Skema nomor DC v4, alokasi atomik, impor nomor lama; approval berjenjang berversi, pemisahan tugas, delegasi, SLA, notifikasi | Selesai |
| M2 Document Control | Pengajuan, review, verifikasi DC, approval, rilis PDF berstempel + QR + SHA-256, distribusi & tanda terima, revisi, pencabutan, registrasi rekaman/izin/surat, halaman verifikasi publik | Selesai (impor data DC v4 menyusul) |
| M3–M10 | SMKP & CAPA, SHE, Plant, Produksi, Logistik, HRGA, Audit & MR, migrasi | Dijadwalkan |

## Menjalankan
1. Buat project Supabase (region Singapura), lalu jalankan semua file di `supabase/migrations` secara berurutan
   (Supabase CLI: `supabase db push`, atau tempel di SQL Editor).
2. Supabase → Authentication → Providers → **Google**: isi Client ID & Secret dari Google Cloud Console (OAuth client "Web application",
   redirect URI `https://<project>.supabase.co/auth/v1/callback`).
3. Supabase → Authentication → URL Configuration: Site URL = alamat aplikasi, tambahkan `<alamat>/auth/callback` ke Redirect URLs.
4. Daftarkan domain dan administrator pertama di SQL Editor:
   ```sql
   insert into public.allowed_domains(domain) values ('domain-bsb.co.id');
   insert into public.allowed_emails(email, initial_role) values ('email-admin@domain', 'SYS_ADMIN');
   ```
5. Salin `.env.example` ke `.env.local`, isi URL dan anon key, lalu `npm install && npm run dev`.

Deploy: import repo ke Vercel, isi environment variable yang sama.

## Keamanan
- Akun di luar domain/allowlist berstatus *menunggu* sampai diaktifkan administrator; administrator tidak bisa memberi peran untuk dirinya sendiri.
- Semua akses data dicek RLS di database. Audit log append-only, bahkan pemilik database tidak bisa mengubahnya.
- Nomor tidak pernah kembar (diuji 200 permintaan serentak), nomor batal tetap tercatat dan tidak dipakai ulang.
