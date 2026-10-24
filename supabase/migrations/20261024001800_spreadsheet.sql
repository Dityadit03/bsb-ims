-- BSB IMS · Laporan ke spreadsheet dan impor satu tombol.
-- 1. Feed Google Sheets: =IMPORTDATA("https://…/api/feed/<token>/<dataset>") memakai token pribadi yang bisa dicabut.
--    Token hanya membuka register operasional yang memang terbaca semua pengguna aktif (bukan dokumen terkendali,
--    pelanggaran, fit to work, permintaan GA, data karyawan).
-- 2. Impor massal: satu fungsi untuk semua jenis data, dengan mode periksa (tanpa menyimpan) dan per baris
--    memanggil fungsi simpan yang sudah ada, sehingga izin dan aturan bisnisnya tetap sama.

-- ---------------------------------------------------------------- token feed
create table public.feed_tokens(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  label text not null,
  token_hash text not null unique,
  hint text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
alter table public.feed_tokens enable row level security;
revoke all on public.feed_tokens from anon;
revoke insert, update, delete on public.feed_tokens from authenticated;
create policy feed_tokens_own on public.feed_tokens for select to authenticated using (user_id = auth.uid());
create trigger feed_tokens_audit after insert or update or delete on public.feed_tokens for each row execute function app.audit_row();

create or replace function app.feed_hash(p_token text) returns text language sql immutable as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
$$;

-- Token ditampilkan sekali saat dibuat; yang disimpan hanya hash-nya
create or replace function public.feed_token_create(p_label text) returns text
language plpgsql security definer set search_path = public as $$
declare v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if not app.is_active_user() then raise exception 'Akun tidak aktif' using errcode = '42501'; end if;
  if (select count(*) from public.feed_tokens where user_id = auth.uid() and revoked_at is null) >= 10 then
    raise exception 'Maksimal 10 token aktif; cabut yang tidak dipakai' using errcode = '22023';
  end if;
  insert into public.feed_tokens(label, token_hash, hint) values (app.require_text(p_label, 'Nama spreadsheet'), app.feed_hash(v_token), right(v_token, 4));
  return v_token;
end $$;

create or replace function public.feed_token_revoke(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.feed_tokens set revoked_at = now() where id = p_id and user_id = auth.uid() and revoked_at is null;
  if not found then raise exception 'Token tidak ditemukan' using errcode = 'P0002'; end if;
end $$;

-- Dipanggil tanpa login oleh Google Sheets. Hanya dataset di daftar ini; pemilik token harus masih aktif.
create or replace function public.feed_rows(p_token text, p_dataset text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.feed_tokens;
  v_view text;
  v_order text;
  v_rows jsonb;
begin
  select * into t from public.feed_tokens where token_hash = app.feed_hash(coalesce(p_token, '')) and revoked_at is null;
  if not found or not exists(select 1 from public.profiles where id = t.user_id and status = 'active') then
    raise exception 'Token tidak berlaku' using errcode = '42501';
  end if;
  select x.v, x.o into v_view, v_order from (values
    ('hazard', 'she_hazard_register', 'created_at desc'),
    ('temuan', 'she_finding_register', 'inspected_on desc'),
    ('insiden', 'incident_register', 'occurred_at desc'),
    ('capa', 'capa_register', 'created_at desc'),
    ('risiko', 'risk_register_view', 'risk_no'),
    ('unit', 'unit_availability', 'unit_no'),
    ('wo', 'work_order_register', 'reported_at desc'),
    ('pm', 'pm_due', 'unit_no'),
    ('spip', 'commissioning_register', 'ref_code'),
    ('produksi', 'production_summary', 'report_date desc'),
    ('stok', 'material_stock', 'code'),
    ('mutasi', 'stock_ledger', 'moved_at desc'),
    ('mr', 'mr_register', 'created_at desc'),
    ('tracking', 'mr_tracking', 'mr_no desc'),
    ('pr', 'pr_register', 'created_at desc'),
    ('po', 'po_register', 'created_at desc'),
    ('sap', 'sap_weekly', 'week_start desc')
  ) as x(k, v, o) where x.k = p_dataset;
  if v_view is null then raise exception 'Dataset tidak tersedia untuk feed' using errcode = '22023'; end if;
  update public.feed_tokens set last_used_at = now() where id = t.id;
  -- satu nilai jsonb (bukan setof) agar tidak terpotong batas baris API
  execute format('select coalesce(jsonb_agg(to_jsonb(r)), ''[]'') from (select * from public.%I order by %s limit 20000) r', v_view, v_order) into v_rows;
  return v_rows;
end $$;

-- ---------------------------------------------------------------- impor massal
-- p_rows: [{kolom: nilai}] dengan nama kolom baku (lihat src/lib/datasets.ts). p_commit=false: periksa saja.
-- Hasil: {"ok": n, "errors": [{"row": i, "error": "…"}]}
create or replace function public.import_rows(p_dataset text, p_rows jsonb, p_commit boolean default false) returns jsonb
language plpgsql set search_path = public as $$
declare
  r jsonb;
  i int := 0;
  ok int := 0;
  errs jsonb := '[]';
  v_dept uuid;
  v_id uuid;
  t text;
  d date;
begin
  if not app.is_active_user() then raise exception 'Akun tidak aktif' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Data tidak valid' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'Maksimal 2000 baris sekali impor' using errcode = '22023'; end if;
  begin
    for r in select * from jsonb_array_elements(p_rows) loop
      i := i + 1;
      begin
        case p_dataset
        when 'karyawan' then
          v_dept := app.dept_by_code(upper(r->>'departemen'));
          if v_dept is null then raise exception 'Departemen "%" tidak dikenal', r->>'departemen'; end if;
          v_id := null;
          if coalesce(r->>'jabatan', '') <> '' then
            select id into v_id from public.positions where (department_id = v_dept or department_id is null)
              and (upper(code) = upper(btrim(r->>'jabatan')) or lower(name) = lower(btrim(r->>'jabatan'))) limit 1;
            if v_id is null then raise exception 'Jabatan "%" tidak ada di departemen %', r->>'jabatan', upper(r->>'departemen'); end if;
          end if;
          t := lower(coalesce(r->>'status_kerja', ''));
          perform public.employee_save(r->>'nrp', r->>'nama', v_dept, v_id,
            case when t in ('', 'tetap', 'permanent', 'pkwtt') then 'permanent' when t in ('kontrak', 'contract', 'pkwt') then 'contract'
                 when t in ('subkon', 'subcon', 'subkontraktor') then 'subcon' else t end,
            nullif(r->>'perusahaan', ''), (nullif(r->>'tgl_masuk', ''))::date, nullif(r->>'email', ''),
            (select id from public.sections where department_id = v_dept and code = upper(nullif(r->>'seksi', ''))));
        when 'barang' then
          t := lower(coalesce(r->>'kategori', ''));
          perform public.material_save(r->>'kode', r->>'nama',
            case t when 'suku cadang' then 'spare_part' when 'sparepart' then 'spare_part' when 'ban' then 'tire' when 'bbm' then 'fuel'
                   when 'pelumas' then 'lubricant' when 'oli' then 'lubricant' when 'habis pakai' then 'consumable' when 'apd' then 'ppe'
                   when 'lainnya' then 'other' when '' then 'other' else t end,
            coalesce(nullif(r->>'satuan', ''), 'pcs'), coalesce((nullif(r->>'stok_min', ''))::numeric, 0));
        when 'supplier' then
          perform public.supplier_save(r->>'kode', r->>'nama', nullif(r->>'kategori', ''), nullif(r->>'kontak', ''), nullif(r->>'telepon', ''));
        when 'unit' then
          v_dept := app.dept_by_code(upper(coalesce(nullif(r->>'departemen', ''), 'PRD')));
          if v_dept is null then raise exception 'Departemen "%" tidak dikenal', r->>'departemen'; end if;
          t := lower(coalesce(r->>'kepemilikan', ''));
          perform public.unit_save(r->>'no_unit', upper(coalesce(nullif(r->>'jenis', ''), 'OTHER')), v_dept,
            case when t in ('', 'milik', 'owned', 'sendiri') then 'owned' when t in ('sewa', 'rental') then 'rental' else t end,
            nullif(r->>'vendor', ''), nullif(r->>'merek', ''), nullif(r->>'model', ''), nullif(r->>'serial', ''),
            (nullif(r->>'tahun', ''))::int, (nullif(r->>'hm', ''))::numeric);
        when 'sertifikat' then
          select id into v_id from public.employees where nrp = upper(btrim(r->>'nrp'));
          if v_id is null then raise exception 'NRP "%" tidak ditemukan', r->>'nrp'; end if;
          perform public.employee_competency_add(v_id,
            (select id from public.competencies where upper(code) = upper(btrim(r->>'kompetensi')) or lower(name) = lower(btrim(r->>'kompetensi')) limit 1),
            coalesce((nullif(r->>'tgl_terbit', ''))::date, current_date), (nullif(r->>'berlaku_sampai', ''))::date,
            nullif(r->>'no_sertifikat', ''), nullif(r->>'penerbit', ''));
        when 'spip' then
          t := lower(coalesce(r->>'jenis_objek', ''));
          select id into v_id from public.commissioning_records where ref_code = upper(btrim(r->>'kode'))
            and coalesce(reg_no, '') = coalesce(nullif(btrim(r->>'no_reg'), ''), '');
          perform public.commissioning_save(v_id,
            case when t in ('', 'unit') then 'unit' when t in ('alat', 'tool', 'tools') then 'tool' when t in ('instalasi', 'installation') then 'installation' else t end,
            r->>'kode', r->>'nama', nullif(r->>'kategori', ''), nullif(r->>'no_reg', ''), (nullif(r->>'tgl_komisioning', ''))::date,
            (nullif(r->>'berlaku_sampai', ''))::date, nullif(r->>'penerbit', ''), nullif(r->>'catatan', ''));
        when 'opname' then
          select id into v_id from public.materials where code = upper(btrim(r->>'kode'));
          if v_id is null then raise exception 'Kode barang "%" tidak ditemukan', r->>'kode'; end if;
          perform public.stock_opname(v_id, (r->>'stok_fisik')::numeric, coalesce(nullif(r->>'keterangan', ''), 'Impor stok opname'));
        else
          raise exception 'Jenis data "%" tidak dikenal', p_dataset using errcode = '22023';
        end case;
        ok := ok + 1;
      exception
        when sqlstate '22023' then
          if sqlerrm like 'Jenis data%' then raise; end if;
          errs := errs || jsonb_build_object('row', i, 'error', sqlerrm);
        when others then
          errs := errs || jsonb_build_object('row', i, 'error', sqlerrm);
      end;
    end loop;
    if not p_commit then raise exception 'periksa-saja' using errcode = 'P0099'; end if;
  exception when sqlstate 'P0099' then
    null; -- mode periksa: semua perubahan dibatalkan, hasil validasi tetap dikembalikan
  end;
  return jsonb_build_object('ok', ok, 'errors', errs, 'committed', p_commit);
end $$;

revoke all on function public.import_rows(text, jsonb, boolean) from public, anon;
grant execute on function public.import_rows(text, jsonb, boolean) to authenticated;
revoke all on function app.feed_hash(text) from public, anon;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and p.proname not in ('verify_document', 'feed_rows') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
revoke all on function public.feed_rows(text, text) from public;
grant execute on function public.feed_rows(text, text) to anon, authenticated;
