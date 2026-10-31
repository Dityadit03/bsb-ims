-- Penguatan hasil audit OWASP Top 10 (2026-10-31).

-- A01/A04: tabel penunjukan pejabat hanya diubah lewat fungsi (RLS sudah menolak, hak tulis ikut dicabut)
revoke insert, update, delete on public.approver_designations from authenticated;

-- A03/A04 (unggahan): klien tidak boleh menentukan pemilik rekaman sendiri (mengikat berkas ke rekaman orang lain) dan
-- hanya jenis berkas yang aman yang boleh dicatat. Pemilik diisi lewat fungsi database (app.claim_attachments, dsb.).
drop policy attachments_insert on public.attachments;
create policy attachments_insert on public.attachments for insert to authenticated
  with check (app.is_active_user() and uploaded_by = auth.uid()
    and owner_table is null and owner_id is null and phase is null and classification = 'internal'
    and mime_type in ('application/pdf','image/png','image/jpeg','image/webp','image/gif','image/heic','image/heif',
      'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/csv','text/plain'));

-- A05: bucket penyimpanan ikut membatasi jenis dan ukuran berkas (lapis kedua selain aplikasi)
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets set file_size_limit = 26214400,
      allowed_mime_types = array['application/pdf','image/png','image/jpeg','image/webp','image/gif','image/heic','image/heif',
        'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/csv','text/plain']
     where id = 'records';
  end if;
end $$;
