-- Audit keamanan 2026-11-05: celah yang ditemukan sebelum go-live.

-- 1) Hak TRUNCATE/REFERENCES/TRIGGER bawaan Supabase tidak diperlukan pengguna aplikasi (TRUNCATE melewati RLS).
do $$
declare r record;
begin
  for r in select c.oid::regclass as t from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') loop
    execute format('revoke truncate, references, trigger on %s from anon, authenticated', r.t);
  end loop;
end $$;
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;

-- 2) Pengguna hanya boleh menandai notifikasinya terbaca; judul, isi, dan tautan tidak boleh diubah sendiri.
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- 3) Lampiran mengikuti hak lihat atas rekaman pemiliknya (tidak lagi terbuka untuk semua pengguna aktif).
--    Selfie absensi hanya untuk pemilik dan HRGA. Berkas yang belum dikaitkan hanya untuk pengunggahnya.
create or replace function app.attachment_visible(p_owner_table text, p_owner_id uuid, p_uploaded_by uuid, p_path text) returns boolean
language plpgsql stable set search_path = public as $$
declare ok boolean;
begin
  if p_uploaded_by = auth.uid() then return true; end if;
  if p_owner_table is null or p_owner_id is null then return coalesce(p_path like 'controlled/%', false); end if;
  if p_owner_table = 'attendance_logs' then return app.has_permission('hr.manage', (select d.id from public.departments d where d.code = 'HRGA')); end if;
  if to_regclass('public.' || quote_ident(p_owner_table)) is null then return false; end if;
  -- dijalankan sebagai pemanggil: RLS tabel pemilik (termasuk pemisahan site) ikut berlaku
  execute format('select exists(select 1 from public.%I where id = $1)', p_owner_table) into ok using p_owner_id;
  return coalesce(ok, false);
end $$;
revoke execute on function app.attachment_visible(text, uuid, uuid, text) from public, anon;
grant execute on function app.attachment_visible(text, uuid, uuid, text) to authenticated;

drop policy if exists attachments_read on public.attachments;
create policy attachments_read on public.attachments for select to authenticated
  using (app.is_active_user() and (
    uploaded_by = auth.uid()
    or app.has_permission('records.read_restricted')
    or (classification = 'internal' and app.attachment_visible(owner_table, owner_id, uploaded_by, storage_path))));
create index if not exists attachments_storage_path_idx on public.attachments(storage_path);

-- Penyimpanan: berkas hanya terbaca bila barisnya di tabel attachments terlihat oleh pengguna, atau berada di folder drafnya sendiri.
do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists records_read on storage.objects;
    create policy records_read on storage.objects for select to authenticated
      using (bucket_id = 'records' and app.is_active_user() and (
        ((storage.foldername(name))[1] = 'drafts' and (storage.foldername(name))[2] = auth.uid()::text)
        or exists(select 1 from public.attachments a where a.storage_path = storage.objects.name)));
  end if;
end $$;

-- 4) Fungsi pembantu isolasi site: search_path tetap
alter function app.site_isolate(regclass) set search_path = public;

-- 5) Metadata putaran payroll yang sudah terbit hanya untuk pengguna aktif
drop policy if exists payroll_runs_read on public.payroll_runs;
create policy payroll_runs_read on public.payroll_runs for select to authenticated
  using (app.is_payroll() or (app.is_active_user() and status = 'published' and not parallel));
