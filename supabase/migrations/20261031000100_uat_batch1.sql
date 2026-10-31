-- Masukan UAT batch 1: unit & part khusus di MR, lampiran fisik WO/MR/PR/PO, konfirmasi penerimaan barang di plant,
-- dan PIC perbaikan dari mitra kerja untuk hazard & temuan inspeksi.

-- ---------------------------------------------------------------- 1. MR: unit dan part khusus
alter table public.material_requests add column unit_id uuid references public.units(id);
create index material_requests_unit_idx on public.material_requests(unit_id) where unit_id is not null;

create table public.mr_special_items(
  id uuid primary key default gen_random_uuid(),
  mr_id uuid not null references public.material_requests(id) on delete cascade,
  name text not null,
  spec text,
  part_no text,
  qty numeric not null check (qty > 0),
  uom text not null default 'pcs',
  status text not null default 'requested' check (status in ('requested','registered','rejected')),
  material_id uuid references public.materials(id),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  resolve_note text,
  created_at timestamptz not null default now(),
  check (status <> 'registered' or material_id is not null)
);
create index mr_special_items_mr_idx on public.mr_special_items(mr_id);
alter table public.mr_special_items enable row level security;
revoke all on public.mr_special_items from anon;
create policy mr_special_items_read on public.mr_special_items for select to authenticated using (app.is_active_user());
revoke insert, update, delete on public.mr_special_items from authenticated;
create trigger mr_special_items_audit after insert or update or delete on public.mr_special_items for each row execute function app.audit_row();

drop function public.mr_create(uuid, text, jsonb, date, uuid, text);
-- p_special: [{"name","spec","part_no","qty","uom"}]; part khusus didaftarkan logistik dulu (mr_special_resolve) sebelum bisa disetujui
create or replace function public.mr_create(p_department uuid, p_purpose text, p_lines jsonb, p_need_date date default null,
  p_wo uuid default null, p_idempotency_key text default null, p_unit uuid default null, p_special jsonb default '[]')
returns public.material_requests language plpgsql security definer set search_path = public as $$
declare
  v public.material_requests;
  v_reg public.registrations;
  l jsonb;
  m public.materials;
  v_wo_unit uuid;
  v_unit uuid := p_unit;
  v_nspecial int := case when jsonb_typeof(p_special) = 'array' then jsonb_array_length(p_special) else 0 end;
begin
  if p_idempotency_key is not null then
    select x.* into v from public.registrations r join public.material_requests x on x.mr_no = r.number where r.idempotency_key = p_idempotency_key;
    if found then return v; end if;
  end if;
  if not app.has_permission('log.request', p_department) then raise exception 'Tidak berwenang membuat MR untuk departemen ini' using errcode = '42501'; end if;
  if (jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0) and v_nspecial = 0 then
    raise exception 'Isi minimal satu barang' using errcode = '22023';
  end if;
  if p_wo is not null then
    select unit_id into v_wo_unit from public.work_orders where id = p_wo and status in ('open','in_progress','waiting_part');
    if not found then raise exception 'WO tidak ditemukan atau sudah ditutup' using errcode = '22023'; end if;
    if v_unit is null then v_unit := v_wo_unit; end if;
    if v_wo_unit is not null and v_unit <> v_wo_unit then raise exception 'Unit tidak sesuai dengan unit pada WO' using errcode = '22023'; end if;
  end if;
  if v_unit is not null and not exists(select 1 from public.units where id = v_unit) then raise exception 'Unit tidak ditemukan' using errcode = '22023'; end if;
  if v_nspecial > 0 and v_unit is null then raise exception 'Permintaan part khusus wajib menyebut unit' using errcode = '22023'; end if;
  v_reg := app.allocate_number('MR', '{}', p_idempotency_key);
  insert into public.material_requests(mr_no, department_id, purpose, need_date, wo_id, unit_id)
  values (v_reg.number, p_department, app.require_text(p_purpose, 'Keperluan'), p_need_date, p_wo, v_unit)
  returning * into v;
  if jsonb_typeof(p_lines) = 'array' then
    for l in select * from jsonb_array_elements(p_lines) loop
      select * into m from public.materials where id = (l->>'material')::uuid and active;
      if not found then raise exception 'Barang tidak ditemukan / tidak aktif' using errcode = '22023'; end if;
      if m.category in ('spare_part','tire') and p_wo is null then
        raise exception 'Barang % (suku cadang/ban) wajib terkait work order', m.code using errcode = '22023';
      end if;
      insert into public.material_request_lines(mr_id, material_id, qty, note) values (v.id, m.id, (l->>'qty')::numeric, l->>'note');
    end loop;
  end if;
  if v_nspecial > 0 then
    for l in select * from jsonb_array_elements(p_special) loop
      insert into public.mr_special_items(mr_id, name, spec, part_no, qty, uom)
      values (v.id, app.require_text(l->>'name', 'Nama part khusus'), nullif(btrim(coalesce(l->>'spec', '')), ''),
              nullif(btrim(coalesce(l->>'part_no', '')), ''), (l->>'qty')::numeric, coalesce(nullif(btrim(l->>'uom'), ''), 'pcs'));
    end loop;
    perform app.notify_users(app.users_with_permission('log.manage', app.log_dept()), 'log.mr', 'Part khusus di MR ' || v.mr_no,
      'Perlu didaftarkan ke katalog', '/logistik/mr/' || v.id);
  end if;
  update public.material_requests set total_value = (select coalesce(sum(ln.qty * mt.avg_cost), 0) from public.material_request_lines ln
    join public.materials mt on mt.id = ln.material_id where ln.mr_id = v.id) where id = v.id returning * into v;
  update public.registrations set ref_table = 'material_requests', ref_id = v.id where id = v_reg.id;
  perform app.notify_users(app.users_with_permission('log.approve', p_department), 'log.mr', 'MR ' || v.mr_no, left(v.purpose, 140), '/logistik/mr/' || v.id);
  return v;
end $$;

-- Logistik mengaitkan part khusus ke barang katalog (jadi baris MR) atau menolaknya.
create or replace function public.mr_special_resolve(p_item uuid, p_material uuid default null, p_note text default null)
returns public.mr_special_items language plpgsql security definer set search_path = public as $$
declare i public.mr_special_items; r public.material_requests; m public.materials;
begin
  perform app.require_log('log.manage');
  select * into i from public.mr_special_items where id = p_item for update;
  if not found then raise exception 'Part khusus tidak ditemukan' using errcode = 'P0002'; end if;
  if i.status <> 'requested' then raise exception 'Part khusus sudah diproses' using errcode = '22023'; end if;
  select * into r from public.material_requests where id = i.mr_id for update;
  if r.status not in ('submitted','pending') then raise exception 'MR sudah tidak menunggu persetujuan' using errcode = '22023'; end if;
  if p_material is null then
    update public.mr_special_items set status = 'rejected', resolved_by = auth.uid(), resolved_at = now(),
      resolve_note = app.require_text(p_note, 'Alasan penolakan') where id = p_item returning * into i;
  else
    select * into m from public.materials where id = p_material and active;
    if not found then raise exception 'Barang katalog tidak ditemukan / tidak aktif' using errcode = '22023'; end if;
    if exists(select 1 from public.material_request_lines where mr_id = r.id and material_id = m.id) then
      raise exception 'Barang % sudah ada di MR ini', m.code using errcode = '23505';
    end if;
    insert into public.material_request_lines(mr_id, material_id, qty, note)
    values (r.id, m.id, i.qty, 'Part khusus: ' || i.name || coalesce(' · ' || i.part_no, ''));
    update public.mr_special_items set status = 'registered', material_id = m.id, resolved_by = auth.uid(), resolved_at = now(), resolve_note = p_note
     where id = p_item returning * into i;
    update public.material_requests set total_value = (select coalesce(sum(ln.qty * mt.avg_cost), 0) from public.material_request_lines ln
      join public.materials mt on mt.id = ln.material_id where ln.mr_id = r.id) where id = r.id;
  end if;
  perform app.notify_users(array[r.requested_by], 'log.mr', 'Part khusus MR ' || r.mr_no || case when p_material is null then ' ditolak' else ' didaftarkan' end,
    i.name, '/logistik/mr/' || r.id);
  return i;
end $$;

-- MR tidak bisa disetujui selama masih ada part khusus yang belum diproses logistik
create or replace function app.mr_block_unresolved() returns trigger language plpgsql as $$
begin
  if new.status in ('approved') and old.status in ('submitted','pending')
     and exists(select 1 from public.mr_special_items where mr_id = new.id and status = 'requested') then
    raise exception 'MR masih punya part khusus yang belum diproses logistik' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger material_requests_block_special before update of status on public.material_requests
  for each row execute function app.mr_block_unresolved();

drop view public.mr_register;
create view public.mr_register with (security_invoker = true) as
select r.id, r.mr_no, r.status, r.purpose, r.need_date, r.total_value, r.created_at, r.department_id, d.code as department_code,
       r.requested_by, p.full_name as requester_name, r.wo_id, w.wo_no, r.reviewed_at, rv.full_name as reviewer_name, r.review_note,
       (select count(*)::int from public.material_request_lines l where l.mr_id = r.id) as lines,
       r.status in ('submitted','pending','approved','partial') as is_open,
       r.unit_id, u.unit_no,
       (select count(*)::int from public.mr_special_items s where s.mr_id = r.id) as special_items,
       (select count(*)::int from public.mr_special_items s where s.mr_id = r.id and s.status = 'requested') as special_open
  from public.material_requests r
  join public.departments d on d.id = r.department_id
  join public.profiles p on p.id = r.requested_by
  left join public.profiles rv on rv.id = r.reviewed_by
  left join public.work_orders w on w.id = r.wo_id
  left join public.units u on u.id = r.unit_id;

-- ---------------------------------------------------------------- 2. Lampiran bentuk fisik WO / MR / PR / PO
-- Foto atau PDF formulir bertanda tangan. Lampiran tidak bisa dihapus (jejak audit).
create or replace function public.doc_attach(p_table text, p_id uuid, p_attachments uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  if coalesce(cardinality(p_attachments), 0) = 0 then raise exception 'Pilih berkas yang diunggah' using errcode = '22023'; end if;
  case p_table
    when 'work_orders' then
      perform 1 from public.work_orders where id = p_id; if not found then raise exception 'WO tidak ditemukan' using errcode = 'P0002'; end if;
      ok := app.has_permission('plant.work') or app.has_permission('log.manage', app.log_dept());
    when 'material_requests' then
      select (requested_by = auth.uid()) or app.has_permission('log.manage', app.log_dept()) or app.has_permission('log.warehouse', app.log_dept())
        into ok from public.material_requests where id = p_id;
      if not found then raise exception 'MR tidak ditemukan' using errcode = 'P0002'; end if;
    when 'purchase_requisitions' then
      perform 1 from public.purchase_requisitions where id = p_id; if not found then raise exception 'PR tidak ditemukan' using errcode = 'P0002'; end if;
      ok := app.has_permission('log.purchase', app.log_dept()) or app.has_permission('log.manage', app.log_dept());
    when 'purchase_orders' then
      perform 1 from public.purchase_orders where id = p_id; if not found then raise exception 'PO tidak ditemukan' using errcode = 'P0002'; end if;
      ok := app.has_permission('log.purchase', app.log_dept()) or app.has_permission('log.manage', app.log_dept());
    else raise exception 'Jenis dokumen tidak didukung' using errcode = '22023';
  end case;
  if not coalesce(ok, false) then raise exception 'Tidak berwenang mengunggah lampiran dokumen ini' using errcode = '42501'; end if;
  perform app.claim_attachments(p_attachments, p_table, p_id);
  perform app.log_event('doc.attach', p_table, p_id::text, jsonb_build_object('count', cardinality(p_attachments)));
  return cardinality(p_attachments);
end $$;

-- ---------------------------------------------------------------- 3. Pengeluaran gudang ke plant + konfirmasi penerimaan
alter table public.stock_movements
  add column received_by uuid references public.profiles(id),
  add column received_at timestamptz,
  add column receive_note text,
  add constraint stock_movements_received_chk check ((received_by is null) = (received_at is null));

-- Penerima = peminta MR atau orang lain berwenang di departemen peminta; bukan petugas gudang yang mengeluarkan.
create or replace function public.goods_issue_confirm(p_mr uuid, p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare r public.material_requests; n int;
begin
  select * into r from public.material_requests where id = p_mr;
  if not found then raise exception 'MR tidak ditemukan' using errcode = 'P0002'; end if;
  if not (r.requested_by = auth.uid() or app.has_permission('log.request', r.department_id)) then
    raise exception 'Hanya peminta atau pengguna departemen peminta yang dapat mengonfirmasi penerimaan' using errcode = '42501';
  end if;
  if exists(select 1 from public.stock_movements where mr_id = p_mr and movement_type = 'issue' and received_at is null and moved_by = auth.uid()) then
    raise exception 'Petugas gudang yang mengeluarkan barang tidak boleh mengonfirmasi penerimaannya sendiri' using errcode = '42501';
  end if;
  update public.stock_movements set received_by = auth.uid(), received_at = now(), receive_note = nullif(btrim(coalesce(p_note, '')), '')
   where mr_id = p_mr and movement_type = 'issue' and received_at is null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Tidak ada pengeluaran yang menunggu konfirmasi' using errcode = '22023'; end if;
  perform app.log_event('goods.confirm', 'material_requests', p_mr::text, jsonb_build_object('lines', n));
  return n;
end $$;

create or replace view public.stock_issue_report with (security_invoker = true) as
select s.id, s.movement_no, s.moved_at, s.moved_at::date as issue_date, r.id as mr_id, r.mr_no, d.code as department_code,
       m.code as material_code, m.name as material_name, m.uom, abs(s.qty) as qty, s.unit_cost, round(abs(s.qty) * s.unit_cost, 2) as value,
       u.unit_no, w.wo_no, mv.full_name as issued_by_name, rq.full_name as requester_name,
       s.received_at, rc.full_name as received_by_name, s.receive_note,
       (s.received_at is not null) as received
  from public.stock_movements s
  join public.materials m on m.id = s.material_id
  join public.profiles mv on mv.id = s.moved_by
  join public.material_requests r on r.id = s.mr_id
  join public.departments d on d.id = r.department_id
  join public.profiles rq on rq.id = r.requested_by
  left join public.units u on u.id = coalesce(s.unit_id, r.unit_id)
  left join public.work_orders w on w.id = coalesce(s.wo_id, r.wo_id)
  left join public.profiles rc on rc.id = s.received_by
 where s.movement_type = 'issue';

-- ---------------------------------------------------------------- 4. Mitra kerja sebagai PIC perbaikan (hazard & temuan inspeksi)
create table public.partners(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create unique index partners_name_uq on public.partners(lower(name));
alter table public.partners enable row level security;
revoke all on public.partners from anon;
create policy partners_read on public.partners for select to authenticated using (app.is_active_user());
revoke insert, update, delete on public.partners from authenticated;
create trigger partners_audit after insert or update or delete on public.partners for each row execute function app.audit_row();

alter table public.hazard_reports add column pic_partner_id uuid references public.partners(id);
alter table public.inspection_findings add column pic_partner_id uuid references public.partners(id);

create or replace function public.partner_save(p_name text, p_active boolean default true, p_id uuid default null)
returns public.partners language plpgsql security definer set search_path = public as $$
declare v public.partners;
begin
  if not exists(select 1 from public.my_permissions() where permission_code = 'she.followup') then
    raise exception 'Tidak berwenang' using errcode = '42501';
  end if;
  if p_id is null then
    insert into public.partners(name) values (app.require_text(p_name, 'Nama mitra kerja')) returning * into v;
  else
    update public.partners set name = app.require_text(p_name, 'Nama mitra kerja'), active = coalesce(p_active, true) where id = p_id returning * into v;
    if not found then raise exception 'Mitra kerja tidak ditemukan' using errcode = 'P0002'; end if;
  end if;
  return v;
end $$;

-- Menetapkan/menghapus mitra kerja pelaksana perbaikan; dept PIC tetap penanggung jawab tindak lanjut.
create or replace function public.set_pic_partner(p_table text, p_id uuid, p_partner uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_dept uuid;
begin
  if p_partner is not null and not exists(select 1 from public.partners where id = p_partner and active) then
    raise exception 'Mitra kerja tidak ditemukan / tidak aktif' using errcode = '22023';
  end if;
  if p_table = 'hazard_reports' then
    select pic_department_id into v_dept from public.hazard_reports where id = p_id;
    if not found then raise exception 'Hazard tidak ditemukan' using errcode = 'P0002'; end if;
    if not (app.has_permission('she.followup', v_dept) or exists(select 1 from public.hazard_reports where id = p_id and reporter_id = auth.uid())) then
      raise exception 'Tidak berwenang' using errcode = '42501';
    end if;
    update public.hazard_reports set pic_partner_id = p_partner where id = p_id;
  elsif p_table = 'inspection_findings' then
    select pic_department_id into v_dept from public.inspection_findings where id = p_id;
    if not found then raise exception 'Temuan tidak ditemukan' using errcode = 'P0002'; end if;
    if not app.has_permission('she.followup', v_dept) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
    update public.inspection_findings set pic_partner_id = p_partner where id = p_id;
  else
    raise exception 'Jenis rekaman tidak didukung' using errcode = '22023';
  end if;
end $$;

drop view public.she_hazard_register;
create view public.she_hazard_register with (security_invoker = true) as
select h.*, d.code as department_code, pd.code as pic_department_code, w.name as work_area_name, p.full_name as reporter_name,
       (h.status = 'open' and h.due_date < current_date) as is_overdue,
       (select count(*) from public.corrective_actions a where a.source_table = 'hazard_reports' and a.source_id = h.id)::int as capa_count,
       pt.name as pic_partner_name
  from public.hazard_reports h
  join public.departments d on d.id = h.department_id
  join public.departments pd on pd.id = h.pic_department_id
  left join public.work_areas w on w.id = h.work_area_id
  join public.profiles p on p.id = h.reporter_id
  left join public.partners pt on pt.id = h.pic_partner_id;

drop view public.she_finding_register;
create view public.she_finding_register with (security_invoker = true) as
select f.*, i.inspection_no, i.inspected_on, i.inspection_type, i.object, pd.code as pic_department_code,
       (f.status = 'open' and f.due_date < current_date) as is_overdue, pt.name as pic_partner_name
  from public.inspection_findings f
  join public.inspections i on i.id = f.inspection_id
  join public.departments pd on pd.id = f.pic_department_id
  left join public.partners pt on pt.id = f.pic_partner_id;

-- ---------------------------------------------------------------- hak akses
grant select on public.mr_register, public.stock_issue_report, public.she_hazard_register, public.she_finding_register to authenticated;
revoke all on public.mr_register, public.stock_issue_report, public.she_hazard_register, public.she_finding_register from anon;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and p.proname not in ('verify_document','feed_rows') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
