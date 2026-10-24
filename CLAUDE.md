# BSB IMS – catatan untuk pengembang

Aplikasi terintegrasi PT Berkarya Sejahtera Bersama (site BDA): Document Control, SMKP Minerba, SHE, Plant, Produksi, Logistik, HRGA, PJO.
Rencana build: https://claude.ai/artifact/1hBNpZYGgXVwAzeB28bgAi

## Stack
- Next.js 16 (App Router, `src/proxy.ts` menggantikan middleware) + Tailwind 4, bahasa UI Indonesia.
- Supabase: Postgres relasional + RLS, Auth Google, Storage. Tidak ada service-role key di aplikasi.
- Logika bisnis yang harus aman (penomoran, approval, perubahan status) ditulis sebagai fungsi SQL `security definer`
  yang mengecek `app.has_permission(...)`. UI hanya menyembunyikan menu; pengamanan sebenarnya di database.

## Aturan
- Migrasi baru: `supabase/migrations/YYYYMMDDHHMMSS_nama.sql`; jangan mengubah migrasi yang sudah dipakai di production.
- Setiap tabel baru: aktifkan RLS, revoke dari `anon`, pasang trigger `app.audit_row()`.
- Nomor bisnis lewat `app.allocate_number(skema, params, idempotency_key, ref_table, ref_id)`, jangan pernah dari count(*).
- Format nomor dokumen mengikuti Document Control BSB v4 (KBJ, MAN, SOP, STD, IK, F, PRG, REK, IZN, EXT, SRM, SRK, SKP) dan tidak boleh diubah.
- Kode departemen/seksi: HSE(SFT,HLT,ENV) PLT(MTC) PRD(OPR) HRGA(HRD,GA) LOG(PUR) MGT(DIR,DC).
- Setiap aturan bisnis baru diberi uji di `scripts/db-test.mjs`.
- Fungsi yang boleh dipanggil `anon` hanya `verify_document` dan `feed_rows` (feed Google Sheets bertoken). Loop revoke di akhir migrasi baru wajib mengecualikan keduanya.
- Register baru yang perlu diunduh/ditarik ke spreadsheet didaftarkan di `src/lib/datasets.ts` (feed hanya untuk data yang terbaca semua pengguna aktif, dan juga ditambahkan ke daftar di `feed_rows`).

## Perintah
- `npm run dev` / `npm run build` / `npm run typecheck`
- `DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run db:test` – memasang semua migrasi di database baru dan menjalankan uji.
