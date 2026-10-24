-- BSB IMS · Pengadaan mengikuti alur Syshab yang dipakai di site, dibuat sederhana:
-- MR (User Request) → approval per baris (setujui / kurangi / tolak, atau pending dengan catatan) →
-- stok cukup: dikeluarkan gudang (GI) · stok kurang: Purchase Requisition (PR) dari kekurangan →
-- penawaran supplier & pemilihan → Purchase Order (PO, approval bila di atas batas) → penerimaan dari PO (GR) → GI.
-- Tracking MR → PR → PO → GR → GI per baris barang.

insert into public.permissions(code, module, description) values
  ('log.purchase','logistics','Membuat PR, mencatat penawaran supplier dan menerbitkan PO');

insert into public.role_permissions(role_code, permission_code)
select r, 'log.purchase' from (values ('STAFF'), ('SUPERVISOR'), ('SUPERINTENDENT'), ('DEPT_HEAD')) as x(r);

insert into public.numbering_schemes(code, name, pattern, module) values
  ('PR','Purchase requisition','PR-BSB-{YYYY}-{N5}','logistics'),
  ('PO','Purchase order','PO-BSB-{YYYY}-{N5}','logistics');

insert into public.app_settings(key, value, description) values
  ('po_approval_limit', '10000000', 'Nilai PO (Rp) di atas batas ini wajib disetujui Dept Head / PJO sebelum dikirim ke supplier');

-- ---------------------------------------------------------------- MR: approval per baris + pending
alter table public.material_requests drop constraint material_requests_status_check;
alter table public.material_requests add constraint material_requests_status_check
  check (status in ('submitted','pending','approved','rejected','partial','issued','cancelled'));
alter table public.material_request_lines add column qty_approved numeric check (qty_approved is null or (qty_approved >= 0 and qty_approved <= qty));
alter table public.material_request_lines drop constraint material_request_lines_check;
alter table public.material_request_lines add constraint material_request_lines_issued_check check (qty_issued <= coalesce(qty_approved, qty));

-- ---------------------------------------------------------------- PR, penawaran, PO
create table public.purchase_requisitions(
  id uuid primary key default gen_random_uuid(),
  pr_no text not null unique,
  purpose text not null,
  mr_id uuid references public.material_requests(id),
  need_date date,
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','ordered','closed','cancelled')),
  requested_by uuid not null references public.profiles(id) default auth.uid(),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.purchase_requisition_lines(
  id uuid primary key default gen_random_uuid(),
  pr_id uuid not null references public.purchase_requisitions(id) on delete cascade,
  material_id uuid not null references public.materials(id),
  qty numeric not null check (qty > 0),
  mr_line_id uuid references public.material_request_lines(id),
  note text,
  unique (pr_id, material_id)
);

create table public.supplier_quotes(
  id uuid primary key default gen_random_uuid(),
  pr_line_id uuid not null references public.purchase_requisition_lines(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id),
  unit_price numeric not null check (unit_price >= 0),
  lead_days int check (lead_days is null or lead_days >= 0),
  note text,
  selected boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (pr_line_id, supplier_id)
);
create unique index supplier_quotes_selected_uq on public.supplier_quotes(pr_line_id) where selected;

create table public.purchase_orders(
  id uuid primary key default gen_random_uuid(),
  po_no text not null unique,
  supplier_id uuid not null references public.suppliers(id),
  pr_id uuid references public.purchase_requisitions(id),
  status text not null default 'awaiting_approval' check (status in ('awaiting_approval','issued','partial','received','cancelled')),
  total_value numeric not null default 0,
  expected_date date,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.purchase_order_lines(
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  material_id uuid not null references public.materials(id),
  qty numeric not null check (qty > 0),
  unit_price numeric not null check (unit_price >= 0),
  qty_received numeric not null default 0 check (qty_received >= 0),
  pr_line_id uuid references public.purchase_requisition_lines(id),
  check (qty_received <= qty)
);

alter table public.stock_movements add column po_line_id uuid references public.purchase_order_lines(id);

do $$
declare t text;
begin
  foreach t in array array['purchase_requisitions','purchase_orders'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['purchase_requisitions','purchase_requisition_lines','supplier_quotes','purchase_orders','purchase_order_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
    execute format('create policy %I_read on public.%I for select to authenticated using (app.is_active_user())', t, t);
  end loop;
end $$;

-- Stok masuk dengan harga rata-rata bergerak
create or replace function app.stock_in(p_material uuid, p_qty numeric, p_unit_cost numeric) returns public.materials
language plpgsql security definer set search_path = public as $$
declare m public.materials;
begin
  update public.materials set avg_cost = round((stock_qty * avg_cost + p_qty * p_unit_cost) / (stock_qty + p_qty), 2),
    stock_qty = stock_qty + p_qty where id = p_material returning * into m;
  if not found then raise exception 'Barang tidak ditemukan' using errcode = 'P0002'; end if;
  return m;
end $$;

-- ---------------------------------------------------------------- fungsi: approval MR
-- p_decision: approve | pending | reject. p_lines (opsional): [{"line": uuid, "qty": n}] — qty dikurangi atau 0 = baris ditolak.
create or replace function public.mr_decide(p_mr uuid, p_decision text, p_note text default null, p_lines jsonb default '[]')
returns public.material_requests language plpgsql security definer set search_path = public as $$
declare
  v public.material_requests;
  v_limit numeric := coalesce((select value::text::numeric from public.app_settings where key = 'mr_high_value_limit'), 10000000);
  v_high boolean;
  l jsonb;
  v_value numeric;
begin
  select * into v from public.material_requests where id = p_mr for update;
  if not found then raise exception 'MR tidak ditemukan' using errcode = 'P0002'; end if;
  v_high := app.has_permission('log.approve_high', v.department_id);
  if not (v_high or app.has_permission('log.approve', v.department_id)) then raise exception 'Tidak berwenang menyetujui MR' using errcode = '42501'; end if;
  if v.status not in ('submitted','pending') then raise exception 'MR tidak menunggu persetujuan' using errcode = '22023'; end if;
  if v.requested_by = auth.uid() then raise exception 'Peminta tidak boleh menyetujui MR sendiri' using errcode = '42501'; end if;
  if p_decision not in ('approve','pending','reject') then raise exception 'Keputusan tidak valid' using errcode = '22023'; end if;
  if p_decision in ('pending','reject') then
    update public.material_requests set status = case when p_decision = 'pending' then 'pending' else 'rejected' end,
      reviewed_by = auth.uid(), reviewed_at = now(), review_note = app.require_text(p_note, 'Catatan untuk peminta')
     where id = p_mr returning * into v;
  else
    for l in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
      update public.material_request_lines set qty_approved = (l->>'qty')::numeric
       where id = (l->>'line')::uuid and mr_id = p_mr;
      if not found then raise exception 'Baris MR tidak ditemukan' using errcode = '22023'; end if;
    end loop;
    update public.material_request_lines set qty_approved = qty where mr_id = p_mr and qty_approved is null;
    if not exists(select 1 from public.material_request_lines where mr_id = p_mr and qty_approved > 0) then
      raise exception 'Semua baris ditolak; gunakan Tolak' using errcode = '22023';
    end if;
    select coalesce(sum(ln.qty_approved * mt.avg_cost), 0) into v_value from public.material_request_lines ln
      join public.materials mt on mt.id = ln.material_id where ln.mr_id = p_mr;
    if v_value > v_limit and not v_high then
      raise exception 'Nilai MR di atas batas; wajib disetujui Dept Head / PJO' using errcode = '42501';
    end if;
    update public.material_requests set status = 'approved', total_value = v_value, reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
     where id = p_mr returning * into v;
    perform app.notify_users(app.users_with_permission('log.warehouse', app.log_dept()), 'log.mr', 'MR ' || v.mr_no || ' disetujui',
      left(v.purpose, 140), '/logistik/mr/' || v.id);
  end if;
  perform app.notify_users(array[v.requested_by], 'log.mr', 'MR ' || v.mr_no || ' ' ||
    case p_decision when 'approve' then 'disetujui' when 'pending' then 'di-pending' else 'ditolak' end, coalesce(p_note, ''), '/logistik/mr/' || v.id);
  return v;
end $$;

-- Persetujuan lama (tanpa rincian baris) tetap berjalan lewat mr_decide
create or replace function public.mr_review(p_mr uuid, p_approve boolean, p_note text default null)
returns public.material_requests language sql security definer set search_path = public as $$
  select public.mr_decide(p_mr, case when p_approve then 'approve' else 'reject' end, p_note)
$$;

-- Pengeluaran barang dibatasi jumlah yang disetujui
create or replace function public.goods_issue(p_mr uuid, p_lines jsonb, p_note text default null, p_idempotency_key text default null)
returns public.material_requests language plpgsql security definer set search_path = public as $$
declare
  v public.material_requests;
  v_reg public.registrations;
  l jsonb;
  ln public.material_request_lines;
  m public.materials;
  q numeric;
  v_first uuid;
  v_mv uuid;
begin
  perform app.require_log('log.warehouse');
  if p_idempotency_key is not null and exists(select 1 from public.registrations where idempotency_key = p_idempotency_key) then
    select * into v from public.material_requests where id = p_mr;
    return v;
  end if;
  select * into v from public.material_requests where id = p_mr for update;
  if not found then raise exception 'MR tidak ditemukan' using errcode = 'P0002'; end if;
  if v.status not in ('approved','partial') then raise exception 'MR belum disetujui' using errcode = '22023'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Isi jumlah yang dikeluarkan' using errcode = '22023'; end if;
  v_reg := app.allocate_number('GI', '{}', p_idempotency_key);
  for l in select * from jsonb_array_elements(p_lines) loop
    q := (l->>'qty')::numeric;
    continue when q is null or q = 0;
    if q < 0 then raise exception 'Jumlah tidak valid' using errcode = '22023'; end if;
    select * into ln from public.material_request_lines where id = (l->>'line')::uuid and mr_id = p_mr for update;
    if not found then raise exception 'Baris MR tidak ditemukan' using errcode = '22023'; end if;
    if ln.qty_issued + q > coalesce(ln.qty_approved, ln.qty) then raise exception 'Jumlah melebihi sisa yang disetujui' using errcode = '22023'; end if;
    m := app.stock_out(ln.material_id, q);
    update public.material_request_lines set qty_issued = qty_issued + q where id = ln.id;
    insert into public.stock_movements(movement_no, movement_type, material_id, qty, unit_cost, mr_id, mr_line_id, wo_id, unit_id, note)
    values (v_reg.number, 'issue', ln.material_id, -q, m.avg_cost, p_mr, ln.id, v.wo_id,
            (select unit_id from public.work_orders where id = v.wo_id), p_note)
    returning id into v_mv;
    v_first := coalesce(v_first, v_mv);
  end loop;
  if v_first is null then raise exception 'Isi jumlah yang dikeluarkan' using errcode = '22023'; end if;
  update public.registrations set ref_table = 'stock_movements', ref_id = v_first where id = v_reg.id;
  update public.material_requests set status = case when exists(select 1 from public.material_request_lines
      where mr_id = p_mr and qty_issued < coalesce(qty_approved, qty)) then 'partial' else 'issued' end
   where id = p_mr returning * into v;
  perform app.notify_users(array[v.requested_by], 'log.mr', 'Barang MR ' || v.mr_no || ' dikeluarkan (' || v_reg.number || ')', '', '/logistik/mr/' || v.id);
  return v;
end $$;

-- ---------------------------------------------------------------- fungsi: PR
-- PR otomatis dari kekurangan stok MR yang disetujui (sisa disetujui − stok tersedia − yang sudah di-PR)
create or replace function public.pr_from_mr(p_mr uuid, p_idempotency_key text default null)
returns public.purchase_requisitions language plpgsql security definer set search_path = public as $$
declare
  v public.purchase_requisitions;
  mr public.material_requests;
  v_reg public.registrations;
  n int;
begin
  perform app.require_log('log.purchase');
  if p_idempotency_key is not null then
    select x.* into v from public.registrations r join public.purchase_requisitions x on x.pr_no = r.number where r.idempotency_key = p_idempotency_key;
    if found then return v; end if;
  end if;
  select * into mr from public.material_requests where id = p_mr;
  if not found then raise exception 'MR tidak ditemukan' using errcode = 'P0002'; end if;
  if mr.status not in ('approved','partial') then raise exception 'MR belum disetujui' using errcode = '22023'; end if;
  v_reg := app.allocate_number('PR', '{}', p_idempotency_key);
  insert into public.purchase_requisitions(pr_no, purpose, mr_id, need_date)
  values (v_reg.number, 'Kekurangan stok ' || mr.mr_no || ': ' || mr.purpose, p_mr, mr.need_date) returning * into v;
  insert into public.purchase_requisition_lines(pr_id, material_id, qty, mr_line_id)
  select v.id, l.material_id, s.short, l.id
    from public.material_request_lines l
    join public.materials m on m.id = l.material_id
    cross join lateral (select coalesce(l.qty_approved, l.qty) - l.qty_issued - m.stock_qty
                         - coalesce((select sum(pl.qty) from public.purchase_requisition_lines pl join public.purchase_requisitions p on p.id = pl.pr_id
                                      where pl.mr_line_id = l.id and p.status not in ('rejected','cancelled')), 0) as short) s
   where l.mr_id = p_mr and s.short > 0;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Stok mencukupi; tidak ada yang perlu dibeli' using errcode = '22023'; end if;
  update public.registrations set ref_table = 'purchase_requisitions', ref_id = v.id where id = v_reg.id;
  perform app.notify_users(app.users_with_permission('log.approve', app.log_dept()), 'log.pr', 'PR ' || v.pr_no, left(v.purpose, 140), '/logistik/pengadaan/' || v.id);
  return v;
end $$;

-- PR manual (mis. isi ulang stok minimum). p_lines: [{"material": uuid, "qty": n, "note": text}]
create or replace function public.pr_create(p_purpose text, p_lines jsonb, p_need_date date default null, p_idempotency_key text default null)
returns public.purchase_requisitions language plpgsql security definer set search_path = public as $$
declare
  v public.purchase_requisitions;
  v_reg public.registrations;
  l jsonb;
begin
  perform app.require_log('log.purchase');
  if p_idempotency_key is not null then
    select x.* into v from public.registrations r join public.purchase_requisitions x on x.pr_no = r.number where r.idempotency_key = p_idempotency_key;
    if found then return v; end if;
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Isi minimal satu barang' using errcode = '22023'; end if;
  v_reg := app.allocate_number('PR', '{}', p_idempotency_key);
  insert into public.purchase_requisitions(pr_no, purpose, need_date) values (v_reg.number, app.require_text(p_purpose, 'Keperluan'), p_need_date) returning * into v;
  for l in select * from jsonb_array_elements(p_lines) loop
    if not exists(select 1 from public.materials where id = (l->>'material')::uuid and active) then raise exception 'Barang tidak aktif' using errcode = '22023'; end if;
    insert into public.purchase_requisition_lines(pr_id, material_id, qty, note) values (v.id, (l->>'material')::uuid, (l->>'qty')::numeric, l->>'note');
  end loop;
  update public.registrations set ref_table = 'purchase_requisitions', ref_id = v.id where id = v_reg.id;
  perform app.notify_users(app.users_with_permission('log.approve', app.log_dept()), 'log.pr', 'PR ' || v.pr_no, left(v.purpose, 140), '/logistik/pengadaan/' || v.id);
  return v;
end $$;

create or replace function public.pr_decide(p_pr uuid, p_approve boolean, p_note text default null)
returns public.purchase_requisitions language plpgsql security definer set search_path = public as $$
declare v public.purchase_requisitions;
begin
  perform app.require_log('log.approve');
  select * into v from public.purchase_requisitions where id = p_pr for update;
  if not found then raise exception 'PR tidak ditemukan' using errcode = 'P0002'; end if;
  if v.status <> 'submitted' then raise exception 'PR tidak menunggu persetujuan' using errcode = '22023'; end if;
  if v.requested_by = auth.uid() then raise exception 'Pembuat PR tidak boleh menyetujui sendiri' using errcode = '42501'; end if;
  update public.purchase_requisitions set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(),
    decision_note = case when p_approve then p_note else app.require_text(p_note, 'Alasan penolakan') end
   where id = p_pr returning * into v;
  perform app.notify_users(array[v.requested_by], 'log.pr', 'PR ' || v.pr_no || case when p_approve then ' disetujui' else ' ditolak' end,
    coalesce(p_note, ''), '/logistik/pengadaan/' || v.id);
  return v;
end $$;

-- ---------------------------------------------------------------- fungsi: penawaran & pemilihan supplier
create or replace function public.quote_save(p_pr_line uuid, p_supplier uuid, p_unit_price numeric, p_lead_days int default null, p_note text default null)
returns public.supplier_quotes language plpgsql security definer set search_path = public as $$
declare v public.supplier_quotes;
begin
  perform app.require_log('log.purchase');
  if not exists(select 1 from public.purchase_requisition_lines l join public.purchase_requisitions p on p.id = l.pr_id
                 where l.id = p_pr_line and p.status = 'approved') then
    raise exception 'Penawaran hanya untuk PR yang sudah disetujui dan belum dipesan' using errcode = '22023';
  end if;
  if not exists(select 1 from public.suppliers where id = p_supplier and active) then raise exception 'Supplier tidak aktif' using errcode = '22023'; end if;
  insert into public.supplier_quotes(pr_line_id, supplier_id, unit_price, lead_days, note)
  values (p_pr_line, p_supplier, p_unit_price, p_lead_days, p_note)
  on conflict (pr_line_id, supplier_id) do update set unit_price = excluded.unit_price, lead_days = excluded.lead_days, note = excluded.note
  returning * into v;
  -- penawaran pertama/termurah otomatis terpilih; pembeli bisa mengganti
  if not exists(select 1 from public.supplier_quotes where pr_line_id = p_pr_line and selected) then
    update public.supplier_quotes set selected = true where id = v.id returning * into v;
  end if;
  return v;
end $$;

create or replace function public.quote_select(p_quote uuid) returns void
language plpgsql security definer set search_path = public as $$
declare q public.supplier_quotes;
begin
  perform app.require_log('log.purchase');
  select * into q from public.supplier_quotes where id = p_quote;
  if not found then raise exception 'Penawaran tidak ditemukan' using errcode = 'P0002'; end if;
  if not exists(select 1 from public.purchase_requisition_lines l join public.purchase_requisitions p on p.id = l.pr_id
                 where l.id = q.pr_line_id and p.status = 'approved') then
    raise exception 'PR sudah dipesan' using errcode = '22023';
  end if;
  update public.supplier_quotes set selected = false where pr_line_id = q.pr_line_id and selected;
  update public.supplier_quotes set selected = true where id = p_quote;
end $$;

-- ---------------------------------------------------------------- fungsi: PO
-- Satu tombol: PR yang disetujui → satu PO per supplier terpilih. Di atas batas nilai menunggu approval.
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
    insert into public.purchase_order_lines(po_id, material_id, qty, unit_price, pr_line_id)
    select v.id, l.material_id, l.qty, q.unit_price, l.id from public.purchase_requisition_lines l
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

create or replace function public.po_approve(p_po uuid, p_approve boolean, p_note text default null)
returns public.purchase_orders language plpgsql security definer set search_path = public as $$
declare v public.purchase_orders;
begin
  perform app.require_log('log.approve_high');
  select * into v from public.purchase_orders where id = p_po for update;
  if not found then raise exception 'PO tidak ditemukan' using errcode = 'P0002'; end if;
  if v.status <> 'awaiting_approval' then raise exception 'PO tidak menunggu approval' using errcode = '22023'; end if;
  if v.created_by = auth.uid() then raise exception 'Pembuat PO tidak boleh menyetujui sendiri' using errcode = '42501'; end if;
  update public.purchase_orders set status = case when p_approve then 'issued' else 'cancelled' end, approved_by = auth.uid(), approved_at = now(),
    note = case when p_approve then coalesce(p_note, note) else app.require_text(p_note, 'Alasan penolakan') end
   where id = p_po returning * into v;
  return v;
end $$;

-- Penerimaan barang dari PO: harga dari PO, stok bertambah, peminta MR diberi tahu barang sudah datang.
-- p_lines: [{"line": uuid, "qty": n}]
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
    perform app.stock_in(pl.material_id, q, pl.unit_price);
    update public.purchase_order_lines set qty_received = qty_received + q where id = pl.id;
    insert into public.stock_movements(movement_no, movement_type, material_id, qty, unit_cost, supplier_id, doc_ref, po_line_id, note)
    values (v_reg.number, 'receipt', pl.material_id, q, pl.unit_price, v.supplier_id, app.require_text(p_doc_ref, 'No. surat jalan'), pl.id, p_note)
    returning id into v_mv;
    v_first := coalesce(v_first, v_mv);
  end loop;
  if v_first is null then raise exception 'Isi jumlah yang diterima' using errcode = '22023'; end if;
  update public.registrations set ref_table = 'stock_movements', ref_id = v_first where id = v_reg.id;
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
  return v;
end $$;

-- ---------------------------------------------------------------- tampilan
create view public.mr_tracking with (security_invoker = true) as
select l.id as mr_line_id, r.id as mr_id, r.mr_no, r.status as mr_status, m.code as material_code, m.name as material_name, m.uom,
       l.qty, l.qty_approved, l.qty_issued, m.stock_qty,
       greatest(coalesce(l.qty_approved, l.qty) - l.qty_issued, 0) as qty_open,
       pr.id as pr_id, pr.pr_no, pr.status as pr_status, po.po_no, po.status as po_status, pol.qty_received, sp.name as supplier_name,
       case when r.status in ('rejected','cancelled') then r.status
            when l.qty_approved = 0 then 'line_rejected'
            when l.qty_issued >= coalesce(l.qty_approved, l.qty) then 'issued'
            when r.status in ('submitted','pending') then 'awaiting_approval'
            when m.stock_qty >= coalesce(l.qty_approved, l.qty) - l.qty_issued then 'ready'
            when po.status in ('issued','partial') then 'on_order'
            when po.status = 'awaiting_approval' then 'po_approval'
            when pr.status in ('submitted','approved') then 'in_pr'
            else 'short' end as stage
  from public.material_request_lines l
  join public.material_requests r on r.id = l.mr_id
  join public.materials m on m.id = l.material_id
  left join lateral (select p.* from public.purchase_requisition_lines pl join public.purchase_requisitions p on p.id = pl.pr_id
                      where pl.mr_line_id = l.id and p.status not in ('rejected','cancelled') order by p.created_at desc limit 1) pr on true
  left join lateral (select pl.id from public.purchase_requisition_lines pl where pl.pr_id = pr.id and pl.mr_line_id = l.id) prl on true
  left join public.purchase_order_lines pol on pol.pr_line_id = prl.id
  left join public.purchase_orders po on po.id = pol.po_id
  left join public.suppliers sp on sp.id = po.supplier_id;

create view public.pr_register with (security_invoker = true) as
select p.*, r.mr_no, u.full_name as requester_name,
       (select count(*)::int from public.purchase_requisition_lines l where l.pr_id = p.id) as lines,
       (select count(*)::int from public.purchase_requisition_lines l where l.pr_id = p.id
          and exists(select 1 from public.supplier_quotes q where q.pr_line_id = l.id and q.selected)) as lines_quoted
  from public.purchase_requisitions p
  left join public.material_requests r on r.id = p.mr_id
  join public.profiles u on u.id = p.requested_by;

create view public.po_register with (security_invoker = true) as
select o.*, s.name as supplier_name, s.code as supplier_code, p.pr_no, c.full_name as creator_name
  from public.purchase_orders o
  join public.suppliers s on s.id = o.supplier_id
  left join public.purchase_requisitions p on p.id = o.pr_id
  join public.profiles c on c.id = o.created_by;

-- MR yang di-pending tetap terbuka
create or replace view public.mr_register with (security_invoker = true) as
select r.id, r.mr_no, r.status, r.purpose, r.need_date, r.total_value, r.created_at, r.department_id, d.code as department_code,
       r.requested_by, p.full_name as requester_name, r.wo_id, w.wo_no, r.reviewed_at, rv.full_name as reviewer_name, r.review_note,
       (select count(*)::int from public.material_request_lines l where l.mr_id = r.id) as lines,
       r.status in ('submitted','pending','approved','partial') as is_open
  from public.material_requests r
  join public.departments d on d.id = r.department_id
  join public.profiles p on p.id = r.requested_by
  left join public.profiles rv on rv.id = r.reviewed_by
  left join public.work_orders w on w.id = r.wo_id;

do $$
declare v text;
begin
  foreach v in array array['mr_tracking','pr_register','po_register'] loop
    execute format('grant select on public.%I to authenticated', v);
    execute format('revoke all on public.%I from anon', v);
  end loop;
end $$;

revoke all on function app.stock_in(uuid, numeric, numeric) from public, anon, authenticated;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and p.proname <> 'verify_document' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
