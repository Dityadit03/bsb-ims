-- Katalog suku cadang interaktif (Logistik & Plant): model unit -> kelompok sistem -> part bernomor.
-- Isi part (nomor part, jumlah per unit) TIDAK diisi sistem; diimpor dari buku parts resmi/pabrikan lewat Excel atau form.
-- Baca: semua pengguna aktif. Tulis: catalog.manage, hanya lewat fungsi.

insert into public.permissions(code, module, description) values
  ('catalog.manage','plant','Mengelola katalog suku cadang (kelompok, part, nomor part)');
insert into public.role_permissions(role_code, permission_code)
select distinct rp.role_code, 'catalog.manage' from public.role_permissions rp where rp.permission_code in ('plant.manage','log.warehouse');

create table public.catalog_models(
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9-]+$'),
  name text not null,
  brand text not null,
  template text not null check (template in ('pickup','service','dump')),
  unit_type text,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.catalog_groups(
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.catalog_models(id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9-]+$'),
  name text not null,
  description text,
  sort int not null default 0,
  unique (model_id, code)
);
create table public.catalog_parts(
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.catalog_groups(id) on delete cascade,
  ref_no int not null check (ref_no > 0),
  part_no text not null,
  name text not null,
  qty numeric not null default 1 check (qty > 0),
  description text,
  material_code text,
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (group_id, part_no),
  unique (group_id, ref_no)
);
create index catalog_groups_model_idx on public.catalog_groups(model_id);
create index catalog_parts_group_idx on public.catalog_parts(group_id);

alter table public.catalog_models enable row level security;
alter table public.catalog_groups enable row level security;
alter table public.catalog_parts enable row level security;
revoke all on public.catalog_models, public.catalog_groups, public.catalog_parts from anon;
revoke insert, update, delete on public.catalog_models, public.catalog_groups, public.catalog_parts from authenticated;
create policy catalog_models_read on public.catalog_models for select to authenticated using (app.is_active_user());
create policy catalog_groups_read on public.catalog_groups for select to authenticated using (app.is_active_user());
create policy catalog_parts_read on public.catalog_parts for select to authenticated using (app.is_active_user());
create trigger catalog_models_audit after insert or update or delete on public.catalog_models for each row execute function app.audit_row();
create trigger catalog_groups_audit after insert or update or delete on public.catalog_groups for each row execute function app.audit_row();
create trigger catalog_parts_audit after insert or update or delete on public.catalog_parts for each row execute function app.audit_row();

-- Part + stok gudang (bila terhubung ke kode barang)
create view public.catalog_part_view with (security_invoker = true) as
select p.id, p.group_id, g.model_id, g.code as group_code, g.name as group_name, p.ref_no, p.part_no, p.name, p.qty, p.description,
       p.material_code, p.note, m.id as material_id, m.stock_qty, m.uom, m.min_stock
  from public.catalog_parts p
  join public.catalog_groups g on g.id = p.group_id
  left join public.materials m on m.code = p.material_code;
grant select on public.catalog_models, public.catalog_groups, public.catalog_parts, public.catalog_part_view to authenticated;

create function public.catalog_group_save(p_model uuid, p_code text, p_name text, p_description text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not app.has_permission_anywhere('catalog.manage') then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  p_code := upper(btrim(app.require_text(p_code, 'Kode kelompok')));
  p_name := app.require_text(p_name, 'Nama kelompok');
  if not exists(select 1 from public.catalog_models where id = p_model) then raise exception 'Model tidak ditemukan' using errcode = '22023'; end if;
  insert into public.catalog_groups(model_id, code, name, description, sort)
  values (p_model, p_code, p_name, nullif(btrim(p_description), ''), coalesce((select max(sort) + 1 from public.catalog_groups where model_id = p_model), 1))
  on conflict (model_id, code) do update set name = excluded.name, description = excluded.description
  returning id into v_id;
  return v_id;
end $$;

create function public.catalog_part_save(p_group uuid, p_part_no text, p_name text, p_qty numeric default 1, p_ref int default null,
  p_description text default null, p_material text default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ref int; v_mat text;
begin
  if not app.has_permission_anywhere('catalog.manage') then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if p_group is null or not exists(select 1 from public.catalog_groups where id = p_group) then
    raise exception 'Kelompok tidak ditemukan' using errcode = '22023';
  end if;
  p_part_no := btrim(app.require_text(p_part_no, 'Nomor part'));
  p_name := app.require_text(p_name, 'Nama part');
  v_mat := nullif(upper(btrim(p_material)), '');
  if v_mat is not null and not exists(select 1 from public.materials where code = v_mat) then
    raise exception 'Kode barang "%" tidak ada di master barang', v_mat using errcode = '22023';
  end if;
  select id, ref_no into v_id, v_ref from public.catalog_parts where group_id = p_group and part_no = p_part_no;
  if v_id is null then
    v_ref := coalesce(p_ref, (select coalesce(max(ref_no), 0) + 1 from public.catalog_parts where group_id = p_group));
    insert into public.catalog_parts(group_id, ref_no, part_no, name, qty, description, material_code, note, updated_by)
    values (p_group, v_ref, p_part_no, p_name, coalesce(p_qty, 1), nullif(btrim(p_description), ''), v_mat, nullif(btrim(p_note), ''), auth.uid())
    returning id into v_id;
  else
    update public.catalog_parts set name = p_name, qty = coalesce(p_qty, qty), ref_no = coalesce(p_ref, ref_no),
      description = coalesce(nullif(btrim(p_description), ''), description), material_code = coalesce(v_mat, material_code),
      note = coalesce(nullif(btrim(p_note), ''), note), updated_at = now(), updated_by = auth.uid()
     where id = v_id;
  end if;
  return v_id;
end $$;

create function public.catalog_part_delete(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not app.has_permission_anywhere('catalog.manage') then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  delete from public.catalog_parts where id = p_id;
  perform app.log_event('catalog.part_delete', 'catalog_parts', p_id::text, null);
end $$;

-- Model awal + kelompok sistem menurut jenis (nomor part diisi dari buku parts)
insert into public.catalog_models(code, name, brand, template, unit_type, description) values
  ('HILUX','Toyota Hilux (LV)','Toyota','pickup','LV','Light vehicle double cabin 4x4'),
  ('TRITON','Mitsubishi Triton (LV)','Mitsubishi','pickup','LV','Light vehicle double cabin 4x4'),
  ('HINO-SVC','Hino Service Truck','Hino','service','ST','Truk servis lapangan (crane, kompresor, hidrolik)'),
  ('HINO-DT12','Hino Dump Truck 12 roda','Hino','dump','DT','Dump truck 12 roda (10x4 / 8x4 tandem)'),
  ('SHACMAN-F3000','Shacman F3000 12 roda','Shacman','dump','DT','Dump truck 12 roda');

insert into public.catalog_groups(model_id, code, name, sort)
select m.id, g.code, g.name, g.sort
  from public.catalog_models m
  join (values
    ('pickup','ENG','Mesin',1),('pickup','CLG','Sistem pendingin',2),('pickup','FUE','Bahan bakar',3),('pickup','EXH','Knalpot',4),
    ('pickup','TRM','Transmisi & transfer',5),('pickup','PRP','Poros propeller',6),('pickup','FAX','Gardan depan & suspensi',7),
    ('pickup','RAX','Gardan belakang & suspensi',8),('pickup','STR','Kemudi',9),('pickup','BRK','Rem',10),
    ('pickup','ELC','Kelistrikan',11),('pickup','CAB','Kabin & bodi',12),('pickup','WHL','Roda & ban',13),
    ('service','ENG','Mesin',1),('service','CLG','Sistem pendingin',2),('service','FUE','Bahan bakar',3),('service','EXH','Knalpot',4),
    ('service','CLT','Kopling',5),('service','TRM','Transmisi',6),('service','PRP','Poros propeller',7),('service','FAX','Gardan depan & suspensi',8),
    ('service','RAX','Gardan belakang & suspensi',9),('service','STR','Kemudi',10),('service','BRK','Rem',11),('service','ELC','Kelistrikan',12),
    ('service','CAB','Kabin & bodi',13),('service','WHL','Roda & ban',14),('service','HYD','Hidrolik & crane',15),('service','CMP','Kompresor & pneumatik',16),
    ('dump','ENG','Mesin',1),('dump','CLG','Sistem pendingin',2),('dump','FUE','Bahan bakar',3),('dump','EXH','Knalpot',4),
    ('dump','CLT','Kopling',5),('dump','TRM','Transmisi',6),('dump','PRP','Poros propeller',7),('dump','FAX','Gardan depan & suspensi',8),
    ('dump','RAX','Gardan belakang tandem & suspensi',9),('dump','STR','Kemudi',10),('dump','BRK','Rem & pneumatik',11),('dump','ELC','Kelistrikan',12),
    ('dump','CAB','Kabin',13),('dump','WHL','Roda & ban',14),('dump','DMP','Bak & hoist hidrolik',15)
  ) as g(template, code, name, sort) on g.template = m.template;

-- import_rows: tambah jenis data 'katalog'
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
        when 'katalog' then
          select id into v_id from public.catalog_models where upper(code) = upper(btrim(r->>'model')) or lower(name) = lower(btrim(r->>'model')) limit 1;
          if v_id is null then raise exception 'Model "%" tidak ada di katalog', r->>'model'; end if;
          perform public.catalog_part_save(
            (select g.id from public.catalog_groups g where g.model_id = v_id
              and (upper(g.code) = upper(btrim(r->>'kelompok')) or lower(g.name) = lower(btrim(r->>'kelompok'))) limit 1),
            r->>'no_part', r->>'nama', coalesce((nullif(r->>'jumlah', ''))::numeric, 1), (nullif(r->>'no_ref', ''))::int,
            nullif(r->>'keterangan', ''), nullif(r->>'kode_barang', ''), null);
        else
          if not app.import_row_ext(p_dataset, r) then
            raise exception 'Jenis data "%" tidak dikenal', p_dataset using errcode = '22023';
          end if;
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

revoke execute on function public.catalog_group_save(uuid, text, text, text), public.catalog_part_save(uuid, text, text, numeric, int, text, text, text),
  public.catalog_part_delete(uuid) from public, anon;
grant execute on function public.catalog_group_save(uuid, text, text, text), public.catalog_part_save(uuid, text, text, numeric, int, text, text, text),
  public.catalog_part_delete(uuid) to authenticated;
