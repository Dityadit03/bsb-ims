-- Pembelian langsung dari luar oleh departemen (di luar pengambilan barang dari stok gudang).
--
-- Dua jalur yang dipisahkan jelas:
--   MR  = mengambil barang dari stok gudang. Bila stok kurang, kekurangannya otomatis jadi PR (sumber "mr_shortage").
--   PR sumber "dept_direct" = departemen membeli barang/jasa dari luar yang TIDAK masuk stok gudang.
-- Keduanya memakai satu rantai PR → penawaran → PO → penerimaan, sehingga tidak ada dokumen ganda.
-- Alur dept_direct: pemohon → approval departemen pemohon (log.approve di departemennya) → approval PR oleh Logistik →
-- penawaran supplier → PO (di atas batas nilai disetujui PJO) → barang diterima dan diserahkan ke pemohon (tanpa stok).

-- ---------------------------------------------------------------- PR: sumber, departemen, tahap approval departemen
alter table public.purchase_requisitions drop constraint purchase_requisitions_status_check;
alter table public.purchase_requisitions add constraint purchase_requisitions_status_check
  check (status in ('dept_review','submitted','approved','rejected','ordered','closed','cancelled'));
alter table public.purchase_requisitions
  add column source text not null default 'stock_refill' check (source in ('mr_shortage','stock_refill','dept_direct')),
  add column department_id uuid references public.departments(id),
  add column dept_decided_by uuid references public.profiles(id),
  add column dept_decided_at timestamptz,
  add column dept_decision_note text,
  add constraint pr_dept_direct_dept_chk check (source <> 'dept_direct' or department_id is not null);
update public.purchase_requisitions set source = 'mr_shortage' where mr_id is not null;

create function app.pr_set_source() returns trigger language plpgsql set search_path = public as $$
begin
  if new.mr_id is not null and new.source = 'stock_refill' then new.source := 'mr_shortage'; end if;
  return new;
end $$;
create trigger purchase_requisitions_source before insert on public.purchase_requisitions
  for each row execute function app.pr_set_source();

-- ---------------------------------------------------------------- baris PR/PO untuk barang di luar katalog stok
alter table public.purchase_requisition_lines
  alter column material_id drop not null,
  add column item_name text,
  add column uom text,
  add column est_price numeric check (est_price is null or est_price >= 0),
  add constraint pr_line_item_chk check (material_id is not null or (nullif(btrim(item_name), '') is not null and nullif(btrim(uom), '') is not null));
alter table public.purchase_order_lines
  alter column material_id drop not null,
  add column item_name text,
  add column uom text,
  add constraint po_line_item_chk check (material_id is not null or (nullif(btrim(item_name), '') is not null and nullif(btrim(uom), '') is not null));

-- Barang non-stok yang diterima: dicatat per baris PO (tidak menambah stok gudang)
create table public.po_direct_receipts(
  id uuid primary key default gen_random_uuid(),
  po_line_id uuid not null references public.purchase_order_lines(id) on delete cascade,
  receipt_no text not null,
  qty numeric not null check (qty > 0),
  doc_ref text not null,
  note text,
  received_by uuid not null references public.profiles(id) default auth.uid(),
  received_at timestamptz not null default now()
);
alter table public.po_direct_receipts enable row level security;
revoke all on public.po_direct_receipts from anon;
revoke insert, update, delete on public.po_direct_receipts from authenticated;
create policy po_direct_receipts_read on public.po_direct_receipts for select to authenticated using (app.is_active_user());
create trigger po_direct_receipts_audit after insert or update or delete on public.po_direct_receipts
  for each row execute function app.audit_row();

-- ---------------------------------------------------------------- fungsi: pengajuan pembelian langsung
-- p_lines: [{"name": text, "uom": text, "qty": n, "est_price": n, "note": text}]
create function public.pr_request(p_department uuid, p_purpose text, p_lines jsonb, p_need_date date default null, p_idempotency_key text default null)
returns public.purchase_requisitions language plpgsql security definer set search_path = public as $$
declare
  v public.purchase_requisitions;
  v_reg public.registrations;
  l jsonb;
begin
  if not app.has_permission('log.request', p_department) then raise exception 'Tidak berwenang mengajukan pembelian untuk departemen ini' using errcode = '42501'; end if;
  if p_idempotency_key is not null then
    select x.* into v from public.registrations r join public.purchase_requisitions x on x.pr_no = r.number where r.idempotency_key = p_idempotency_key;
    if found then return v; end if;
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Isi minimal satu barang' using errcode = '22023'; end if;
  v_reg := app.allocate_number('PR', '{}', p_idempotency_key);
  insert into public.purchase_requisitions(pr_no, purpose, need_date, source, department_id, status)
  values (v_reg.number, app.require_text(p_purpose, 'Keperluan'), p_need_date, 'dept_direct', p_department, 'dept_review') returning * into v;
  for l in select * from jsonb_array_elements(p_lines) loop
    if coalesce((l->>'qty')::numeric, 0) <= 0 then raise exception 'Jumlah harus lebih dari 0' using errcode = '22023'; end if;
    insert into public.purchase_requisition_lines(pr_id, item_name, uom, qty, est_price, note)
    values (v.id, app.require_text(l->>'name', 'Nama barang'), app.require_text(l->>'uom', 'Satuan'), (l->>'qty')::numeric,
            nullif(l->>'est_price', '')::numeric, nullif(btrim(l->>'note'), ''));
  end loop;
  update public.registrations set ref_table = 'purchase_requisitions', ref_id = v.id where id = v_reg.id;
  perform app.notify_users(app.users_with_permission('log.approve', p_department), 'log.pr', 'Permintaan pembelian ' || v.pr_no || ' menunggu persetujuan',
    left(v.purpose, 140), '/logistik/pengadaan/' || v.id);
  return v;
end $$;

-- Tahap 1: approval departemen pemohon (bukan pemohon sendiri). Disetujui → masuk antrean approval PR Logistik.
create function public.pr_dept_decide(p_pr uuid, p_approve boolean, p_note text default null)
returns public.purchase_requisitions language plpgsql security definer set search_path = public as $$
declare v public.purchase_requisitions;
begin
  select * into v from public.purchase_requisitions where id = p_pr for update;
  if not found then raise exception 'Permintaan tidak ditemukan' using errcode = 'P0002'; end if;
  if v.status <> 'dept_review' then raise exception 'Permintaan tidak menunggu persetujuan departemen' using errcode = '22023'; end if;
  if not app.has_permission('log.approve', v.department_id) then raise exception 'Tidak berwenang menyetujui untuk departemen ini' using errcode = '42501'; end if;
  if v.requested_by = auth.uid() then raise exception 'Pemohon tidak boleh menyetujui sendiri' using errcode = '42501'; end if;
  update public.purchase_requisitions set status = case when p_approve then 'submitted' else 'rejected' end,
    dept_decided_by = auth.uid(), dept_decided_at = now(),
    dept_decision_note = case when p_approve then p_note else app.require_text(p_note, 'Alasan penolakan') end
   where id = p_pr returning * into v;
  if p_approve then
    perform app.notify_users(app.users_with_permission('log.approve', app.log_dept()), 'log.pr', 'PR ' || v.pr_no || ' menunggu persetujuan', left(v.purpose, 140), '/logistik/pengadaan/' || v.id);
  end if;
  perform app.notify_users(array[v.requested_by], 'log.pr', 'Permintaan pembelian ' || v.pr_no || case when p_approve then ' disetujui departemen' else ' ditolak departemen' end,
    coalesce(p_note, ''), '/logistik/pengadaan/' || v.id);
  return v;
end $$;

-- Pemohon boleh membatalkan selama belum diputuskan Logistik
create function public.pr_request_cancel(p_pr uuid, p_reason text) returns public.purchase_requisitions
language plpgsql security definer set search_path = public as $$
declare v public.purchase_requisitions;
begin
  select * into v from public.purchase_requisitions where id = p_pr for update;
  if not found then raise exception 'Permintaan tidak ditemukan' using errcode = 'P0002'; end if;
  if v.source <> 'dept_direct' or v.requested_by <> auth.uid() then raise exception 'Hanya pemohon yang bisa membatalkan' using errcode = '42501'; end if;
  if v.status not in ('dept_review','submitted') then raise exception 'Permintaan sudah diproses Logistik' using errcode = '22023'; end if;
  update public.purchase_requisitions set status = 'cancelled', decision_note = app.require_text(p_reason, 'Alasan pembatalan') where id = p_pr returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------- PO dari PR: baris non-katalog ikut terbawa
create or replace function public.po_from_pr(p_pr uuid, p_expected date default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  pr public.purchase_requisitions;
  s record;
  v public.purchase_orders;
  v_reg public.registrations;
  v_limit numeric := coalesce((select value::text::numeric from public.app_settings where key = 'po_approval_limit'), 10000000);
  n int := 0;
begin
  perform app.require_log('log.purchase');
  select * into pr from public.purchase_requisitions where id = p_pr for update;
  if not found then raise exception 'PR tidak ditemukan' using errcode = 'P0002'; end if;
  if pr.status <> 'approved' then raise exception 'PR belum disetujui atau sudah dipesan' using errcode = '22023'; end if;
  if exists(select 1 from public.purchase_requisition_lines l where l.pr_id = p_pr
             and not exists(select 1 from public.supplier_quotes q where q.pr_line_id = l.id and q.selected)) then
    raise exception 'Setiap barang wajib punya supplier terpilih' using errcode = '22023';
  end if;
  for s in select distinct q.supplier_id from public.supplier_quotes q join public.purchase_requisition_lines l on l.id = q.pr_line_id
            where l.pr_id = p_pr and q.selected loop
    v_reg := app.allocate_number('PO', '{}', null);
    insert into public.purchase_orders(po_no, supplier_id, pr_id, expected_date) values (v_reg.number, s.supplier_id, p_pr, p_expected) returning * into v;
    insert into public.purchase_order_lines(po_id, material_id, item_name, uom, qty, unit_price, pr_line_id)
    select v.id, l.material_id, l.item_name, l.uom, l.qty, q.unit_price, l.id from public.purchase_requisition_lines l
      join public.supplier_quotes q on q.pr_line_id = l.id and q.selected and q.supplier_id = s.supplier_id where l.pr_id = p_pr;
    update public.purchase_orders set total_value = (select sum(qty * unit_price) from public.purchase_order_lines where po_id = v.id),
      status = case when (select sum(qty * unit_price) from public.purchase_order_lines where po_id = v.id) > v_limit then 'awaiting_approval' else 'issued' end
     where id = v.id returning * into v;
    update public.registrations set ref_table = 'purchase_orders', ref_id = v.id where id = v_reg.id;
    if v.status = 'awaiting_approval' then
      perform app.notify_users(app.users_with_permission('log.approve_high', app.log_dept()), 'log.po', 'PO ' || v.po_no || ' menunggu approval',
        'Nilai Rp ' || to_char(v.total_value, 'FM999G999G999G999'), '/logistik/pengadaan/' || p_pr);
    end if;
    n := n + 1;
  end loop;
  update public.purchase_requisitions set status = 'ordered' where id = p_pr;
  return n;
end $$;

-- ---------------------------------------------------------------- penerimaan PO: baris katalog → stok; baris non-katalog → serah ke pemohon
create or replace function public.goods_receive_po(p_po uuid, p_lines jsonb, p_doc_ref text, p_note text default null, p_idempotency_key text default null)
returns public.purchase_orders language plpgsql security definer set search_path = public as $$
declare
  v public.purchase_orders;
  v_reg public.registrations;
  l jsonb;
  pl public.purchase_order_lines;
  q numeric;
  v_first uuid;
  v_mv uuid;
  v_req uuid[];
  v_direct boolean := false;
  v_any boolean := false;
  pr public.purchase_requisitions;
begin
  perform app.require_log('log.warehouse');
  if p_idempotency_key is not null and exists(select 1 from public.registrations where idempotency_key = p_idempotency_key) then
    select * into v from public.purchase_orders where id = p_po;
    return v;
  end if;
  select * into v from public.purchase_orders where id = p_po for update;
  if not found then raise exception 'PO tidak ditemukan' using errcode = 'P0002'; end if;
  if v.status not in ('issued','partial') then raise exception 'PO belum terbit atau sudah diterima penuh' using errcode = '22023'; end if;
  v_reg := app.allocate_number('GR', '{}', p_idempotency_key);
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
    q := (l->>'qty')::numeric;
    continue when q is null or q = 0;
    if q < 0 then raise exception 'Jumlah tidak valid' using errcode = '22023'; end if;
    select * into pl from public.purchase_order_lines where id = (l->>'line')::uuid and po_id = p_po for update;
    if not found then raise exception 'Baris PO tidak ditemukan' using errcode = '22023'; end if;
    if pl.qty_received + q > pl.qty then raise exception 'Jumlah melebihi sisa PO' using errcode = '22023'; end if;
    update public.purchase_order_lines set qty_received = qty_received + q where id = pl.id;
    v_any := true;
    if pl.material_id is null then
      insert into public.po_direct_receipts(po_line_id, receipt_no, qty, doc_ref, note)
      values (pl.id, v_reg.number, q, app.require_text(p_doc_ref, 'No. surat jalan'), p_note);
      v_direct := true;
    else
      perform app.stock_in(pl.material_id, q, pl.unit_price);
      insert into public.stock_movements(movement_no, movement_type, material_id, qty, unit_cost, supplier_id, doc_ref, po_line_id, note)
      values (v_reg.number, 'receipt', pl.material_id, q, pl.unit_price, v.supplier_id, app.require_text(p_doc_ref, 'No. surat jalan'), pl.id, p_note)
      returning id into v_mv;
      v_first := coalesce(v_first, v_mv);
    end if;
  end loop;
  if not v_any then raise exception 'Isi jumlah yang diterima' using errcode = '22023'; end if;
  if v_first is not null then
    update public.registrations set ref_table = 'stock_movements', ref_id = v_first where id = v_reg.id;
  else
    update public.registrations set ref_table = 'purchase_orders', ref_id = p_po where id = v_reg.id;
  end if;
  update public.purchase_orders set status = case when exists(select 1 from public.purchase_order_lines where po_id = p_po and qty_received < qty)
    then 'partial' else 'received' end where id = p_po returning * into v;
  if v.pr_id is not null and not exists(select 1 from public.purchase_orders where pr_id = v.pr_id and status in ('awaiting_approval','issued','partial')) then
    update public.purchase_requisitions set status = 'closed' where id = v.pr_id;
  end if;
  select array_agg(distinct r.requested_by) into v_req from public.purchase_order_lines pol
    join public.purchase_requisition_lines prl on prl.id = pol.pr_line_id
    join public.material_request_lines ml on ml.id = prl.mr_line_id
    join public.material_requests r on r.id = ml.mr_id where pol.po_id = p_po;
  if v_req is not null then
    perform app.notify_users(v_req, 'log.mr', 'Barang PO ' || v.po_no || ' sudah diterima gudang', 'MR Anda bisa segera dikeluarkan', '/logistik/mr');
  end if;
  if v_direct and v.pr_id is not null then
    select * into pr from public.purchase_requisitions where id = v.pr_id;
    perform app.notify_users(array[pr.requested_by], 'log.pr', 'Barang ' || pr.pr_no || ' (PO ' || v.po_no || ') sudah tiba',
      'Barang tidak masuk stok; silakan ambil di gudang/Logistik', '/logistik/pengadaan/' || pr.id);
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------- tampilan
drop view public.pr_register;
create view public.pr_register with (security_invoker = true) as
select p.*, r.mr_no, u.full_name as requester_name, d.code as department_code,
       (select count(*)::int from public.purchase_requisition_lines l where l.pr_id = p.id) as lines,
       (select count(*)::int from public.purchase_requisition_lines l where l.pr_id = p.id
          and exists(select 1 from public.supplier_quotes q where q.pr_line_id = l.id and q.selected)) as lines_quoted,
       (select coalesce(sum(l.qty * l.est_price), 0) from public.purchase_requisition_lines l where l.pr_id = p.id) as est_total
  from public.purchase_requisitions p
  left join public.material_requests r on r.id = p.mr_id
  left join public.departments d on d.id = p.department_id
  join public.profiles u on u.id = p.requested_by;
revoke all on public.pr_register from anon;
grant select on public.pr_register to authenticated;

revoke execute on function public.pr_request(uuid, text, jsonb, date, text), public.pr_dept_decide(uuid, boolean, text), public.pr_request_cancel(uuid, text) from public, anon;
grant execute on function public.pr_request(uuid, text, jsonb, date, text), public.pr_dept_decide(uuid, boolean, text), public.pr_request_cancel(uuid, text) to authenticated;
revoke execute on function public.po_from_pr(uuid, date), public.goods_receive_po(uuid, jsonb, text, text, text) from public, anon;
grant execute on function public.po_from_pr(uuid, date), public.goods_receive_po(uuid, jsonb, text, text, text) to authenticated;
