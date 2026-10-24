-- BSB IMS · M7 · Logistik: master barang, supplier & evaluasi (SMKP 4.6), Material Request (MR), penerimaan (GR),
-- pengeluaran (GI) wajib MR disetujui, suku cadang wajib referensi WO, BBM/oli per unit + HM, stok opname.
-- Stok dan harga rata-rata hanya berubah lewat fungsi; stok tidak boleh minus.

insert into public.permissions(code, module, description) values
  ('log.request','logistics','Membuat material request untuk departemennya'),
  ('log.approve','logistics','Menyetujui material request departemennya'),
  ('log.approve_high','logistics','Menyetujui material request di atas batas nilai'),
  ('log.warehouse','logistics','Penerimaan, pengeluaran barang, BBM dan stok opname'),
  ('log.manage','logistics','Mengelola master barang, supplier dan evaluasi supplier');

insert into public.role_permissions(role_code, permission_code)
select r, p from (values
  ('STAFF','log.request'), ('SUPERVISOR','log.request'), ('SUPERINTENDENT','log.request'), ('DEPT_HEAD','log.request'),
  ('SUPERVISOR','log.approve'), ('SUPERINTENDENT','log.approve'), ('DEPT_HEAD','log.approve'),
  ('DEPT_HEAD','log.approve_high'), ('PJO','log.approve_high'),
  ('STAFF','log.warehouse'), ('SUPERVISOR','log.warehouse'), ('SUPERINTENDENT','log.warehouse'), ('DEPT_HEAD','log.warehouse'),
  ('DEPT_HEAD','log.manage'), ('PJO','log.manage')
) as x(r, p);

insert into public.numbering_schemes(code, name, pattern, module) values
  ('GR','Penerimaan barang','GR-BSB-{YYYY}-{N6}','logistics'),
  ('GI','Pengeluaran barang','GI-BSB-{YYYY}-{N6}','logistics');

insert into public.app_settings(key, value, description) values
  ('mr_high_value_limit', '10000000', 'Nilai MR (Rp) di atas batas ini wajib disetujui Dept Head / PJO');

create table public.materials(
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9][A-Z0-9./-]*$'),
  name text not null,
  category text not null check (category in ('spare_part','tire','fuel','lubricant','consumable','ppe','other')),
  uom text not null,
  min_stock numeric not null default 0 check (min_stock >= 0),
  stock_qty numeric not null default 0 check (stock_qty >= 0),
  avg_cost numeric not null default 0 check (avg_cost >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.suppliers(
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9][A-Z0-9./-]*$'),
  name text not null,
  category text,
  contact_name text,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.supplier_evaluations(
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id),
  period date not null check (extract(day from period) = 1),
  quality smallint not null check (quality between 1 and 5),
  delivery smallint not null check (delivery between 1 and 5),
  price smallint not null check (price between 1 and 5),
  service smallint not null check (service between 1 and 5),
  safety smallint not null check (safety between 1 and 5),
  score numeric generated always as (round((quality + delivery + price + service + safety) / 5.0, 2)) stored,
  note text,
  evaluated_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (supplier_id, period)
);

create table public.material_requests(
  id uuid primary key default gen_random_uuid(),
  mr_no text not null unique,
  department_id uuid not null references public.departments(id),
  requested_by uuid not null references public.profiles(id) default auth.uid(),
  purpose text not null,
  need_date date,
  wo_id uuid references public.work_orders(id),
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','partial','issued','cancelled')),
  total_value numeric not null default 0,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.material_request_lines(
  id uuid primary key default gen_random_uuid(),
  mr_id uuid not null references public.material_requests(id) on delete cascade,
  material_id uuid not null references public.materials(id),
  qty numeric not null check (qty > 0),
  qty_issued numeric not null default 0 check (qty_issued >= 0),
  note text,
  unique (mr_id, material_id),
  check (qty_issued <= qty)
);

create table public.stock_movements(
  id uuid primary key default gen_random_uuid(),
  movement_no text,
  movement_type text not null check (movement_type in ('receipt','issue','fuel','adjust')),
  material_id uuid not null references public.materials(id),
  qty numeric not null check (qty <> 0),
  unit_cost numeric not null default 0,
  supplier_id uuid references public.suppliers(id),
  doc_ref text,
  mr_id uuid references public.material_requests(id),
  mr_line_id uuid references public.material_request_lines(id),
  wo_id uuid references public.work_orders(id),
  unit_id uuid references public.units(id),
  hour_meter numeric,
  note text,
  moved_by uuid not null references public.profiles(id) default auth.uid(),
  moved_at timestamptz not null default now(),
  check (movement_type <> 'receipt' or (qty > 0 and supplier_id is not null)),
  check (movement_type not in ('issue','fuel') or qty < 0),
  check (movement_type <> 'fuel' or unit_id is not null)
);
create index on public.stock_movements(material_id, moved_at desc);

do $$
declare t text;
begin
  foreach t in array array['materials','suppliers','material_requests'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['materials','suppliers','supplier_evaluations','material_requests','material_request_lines','stock_movements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create policy %I_read on public.%I for select to authenticated using (app.is_active_user())', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
  end loop;
end $$;
revoke insert, update, delete on public.materials, public.suppliers, public.supplier_evaluations, public.material_requests,
  public.material_request_lines, public.stock_movements from authenticated;

-- ---------------------------------------------------------------- pembantu
create or replace function app.log_dept() returns uuid language sql stable security definer set search_path = public as $$
  select id from public.departments where code = 'LOG'
$$;

create or replace function app.require_log(p_perm text) returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not app.has_permission(p_perm, app.log_dept()) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
end $$;

-- Mengurangi stok dengan kunci baris; stok tidak boleh minus.
create or replace function app.stock_out(p_material uuid, p_qty numeric) returns public.materials
language plpgsql security definer set search_path = public as $$
declare m public.materials;
begin
  select * into m from public.materials where id = p_material for update;
  if not found then raise exception 'Barang tidak ditemukan' using errcode = 'P0002'; end if;
  if m.stock_qty < p_qty then
    raise exception 'Stok % tidak cukup (tersedia % %)', m.code, m.stock_qty, m.uom using errcode = '22023';
  end if;
  update public.materials set stock_qty = stock_qty - p_qty where id = p_material returning * into m;
  return m;
end $$;

-- ---------------------------------------------------------------- master
create or replace function public.material_save(p_code text, p_name text, p_category text, p_uom text, p_min_stock numeric default 0,
  p_active boolean default true)
returns public.materials language plpgsql security definer set search_path = public as $$
declare v public.materials;
begin
  perform app.require_log('log.manage');
  insert into public.materials(code, name, category, uom, min_stock, active)
  values (upper(app.require_text(p_code, 'Kode barang')), app.require_text(p_name, 'Nama barang'), p_category,
          app.require_text(p_uom, 'Satuan'), coalesce(p_min_stock, 0), p_active)
  on conflict (code) do update set name = excluded.name, category = excluded.category, uom = excluded.uom,
    min_stock = excluded.min_stock, active = excluded.active
  returning * into v;
  return v;
end $$;

create or replace function public.supplier_save(p_code text, p_name text, p_category text default null, p_contact text default null,
  p_phone text default null, p_active boolean default true)
returns public.suppliers language plpgsql security definer set search_path = public as $$
declare v public.suppliers;
begin
  perform app.require_log('log.manage');
  insert into public.suppliers(code, name, category, contact_name, phone, active)
  values (upper(app.require_text(p_code, 'Kode supplier')), app.require_text(p_name, 'Nama supplier'), p_category, p_contact, p_phone, p_active)
  on conflict (code) do update set name = excluded.name, category = excluded.category, contact_name = excluded.contact_name,
    phone = excluded.phone, active = excluded.active
  returning * into v;
  return v;
end $$;

-- Evaluasi supplier bulanan (SMKP 4.6); nilai rendah (< 3) wajib catatan.
create or replace function public.supplier_evaluate(p_supplier uuid, p_period date, p_quality int, p_delivery int, p_price int,
  p_service int, p_safety int, p_note text default null)
returns public.supplier_evaluations language plpgsql security definer set search_path = public as $$
declare v public.supplier_evaluations;
begin
  perform app.require_log('log.manage');
  if least(p_quality, p_delivery, p_price, p_service, p_safety) < 3 and coalesce(btrim(p_note), '') = '' then
    raise exception 'Nilai di bawah 3 wajib diberi catatan' using errcode = '22023';
  end if;
  insert into public.supplier_evaluations(supplier_id, period, quality, delivery, price, service, safety, note)
  values (p_supplier, date_trunc('month', p_period)::date, p_quality, p_delivery, p_price, p_service, p_safety, p_note)
  on conflict (supplier_id, period) do update set quality = excluded.quality, delivery = excluded.delivery, price = excluded.price,
    service = excluded.service, safety = excluded.safety, note = excluded.note, evaluated_by = auth.uid()
  returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------- material request
-- p_lines: [{"material": uuid, "qty": n, "note": "..."}]. Suku cadang & ban wajib terkait WO yang masih terbuka.
create or replace function public.mr_create(p_department uuid, p_purpose text, p_lines jsonb, p_need_date date default null,
  p_wo uuid default null, p_idempotency_key text default null)
returns public.material_requests language plpgsql security definer set search_path = public as $$
declare
  v public.material_requests;
  v_reg public.registrations;
  l jsonb;
  m public.materials;
begin
  if p_idempotency_key is not null then
    select x.* into v from public.registrations r join public.material_requests x on x.mr_no = r.number where r.idempotency_key = p_idempotency_key;
    if found then return v; end if;
  end if;
  if not app.has_permission('log.request', p_department) then raise exception 'Tidak berwenang membuat MR untuk departemen ini' using errcode = '42501'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Isi minimal satu barang' using errcode = '22023';
  end if;
  if p_wo is not null and not exists(select 1 from public.work_orders where id = p_wo and status in ('open','in_progress','waiting_part')) then
    raise exception 'WO tidak ditemukan atau sudah ditutup' using errcode = '22023';
  end if;
  v_reg := app.allocate_number('MR', '{}', p_idempotency_key);
  insert into public.material_requests(mr_no, department_id, purpose, need_date, wo_id)
  values (v_reg.number, p_department, app.require_text(p_purpose, 'Keperluan'), p_need_date, p_wo)
  returning * into v;
  for l in select * from jsonb_array_elements(p_lines) loop
    select * into m from public.materials where id = (l->>'material')::uuid and active;
    if not found then raise exception 'Barang tidak ditemukan / tidak aktif' using errcode = '22023'; end if;
    if m.category in ('spare_part','tire') and p_wo is null then
      raise exception 'Barang % (suku cadang/ban) wajib terkait work order', m.code using errcode = '22023';
    end if;
    insert into public.material_request_lines(mr_id, material_id, qty, note) values (v.id, m.id, (l->>'qty')::numeric, l->>'note');
  end loop;
  update public.material_requests set total_value = (select coalesce(sum(ln.qty * mt.avg_cost), 0) from public.material_request_lines ln
    join public.materials mt on mt.id = ln.material_id where ln.mr_id = v.id) where id = v.id returning * into v;
  update public.registrations set ref_table = 'material_requests', ref_id = v.id where id = v_reg.id;
  perform app.notify_users(app.users_with_permission('log.approve', p_department), 'log.mr', 'MR ' || v.mr_no, left(v.purpose, 140), '/logistik/mr/' || v.id);
  return v;
end $$;

-- Persetujuan oleh orang lain; nilai di atas batas wajib log.approve_high; penolakan wajib alasan.
create or replace function public.mr_review(p_mr uuid, p_approve boolean, p_note text default null)
returns public.material_requests language plpgsql security definer set search_path = public as $$
declare
  v public.material_requests;
  v_limit numeric := coalesce((select value::text::numeric from public.app_settings where key = 'mr_high_value_limit'), 10000000);
  v_high boolean;
begin
  select * into v from public.material_requests where id = p_mr for update;
  if not found then raise exception 'MR tidak ditemukan' using errcode = 'P0002'; end if;
  v_high := app.has_permission('log.approve_high', v.department_id);
  if not (v_high or app.has_permission('log.approve', v.department_id)) then raise exception 'Tidak berwenang menyetujui MR' using errcode = '42501'; end if;
  if v.status <> 'submitted' then raise exception 'MR tidak menunggu persetujuan' using errcode = '22023'; end if;
  if v.requested_by = auth.uid() then raise exception 'Peminta tidak boleh menyetujui MR sendiri' using errcode = '42501'; end if;
  if p_approve and v.total_value > v_limit and not v_high then
    raise exception 'Nilai MR di atas batas; wajib disetujui Dept Head / PJO' using errcode = '42501';
  end if;
  update public.material_requests set status = case when p_approve then 'approved' else 'rejected' end,
    reviewed_by = auth.uid(), reviewed_at = now(),
    review_note = case when p_approve then p_note else app.require_text(p_note, 'Alasan penolakan') end
   where id = p_mr returning * into v;
  perform app.notify_users(array[v.requested_by], 'log.mr', 'MR ' || v.mr_no || case when p_approve then ' disetujui' else ' ditolak' end,
    coalesce(p_note, ''), '/logistik/mr/' || v.id);
  if p_approve then
    perform app.notify_users(app.users_with_permission('log.warehouse', app.log_dept()), 'log.mr', 'MR ' || v.mr_no || ' siap dikeluarkan',
      left(v.purpose, 140), '/logistik/mr/' || v.id);
  end if;
  return v;
end $$;

create or replace function public.mr_cancel(p_mr uuid, p_reason text)
returns public.material_requests language plpgsql security definer set search_path = public as $$
declare v public.material_requests;
begin
  select * into v from public.material_requests where id = p_mr for update;
  if not found then raise exception 'MR tidak ditemukan' using errcode = 'P0002'; end if;
  if v.requested_by <> auth.uid() and not app.has_permission('log.manage', app.log_dept()) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if v.status not in ('submitted','approved') then raise exception 'MR yang sudah dikeluarkan sebagian/penuh tidak bisa dibatalkan' using errcode = '22023'; end if;
  update public.material_requests set status = 'cancelled', review_note = app.require_text(p_reason, 'Alasan pembatalan')
   where id = p_mr returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------- gudang
-- Penerimaan barang dari supplier; harga rata-rata bergerak (moving average).
create or replace function public.goods_receive(p_material uuid, p_supplier uuid, p_qty numeric, p_unit_cost numeric, p_doc_ref text,
  p_note text default null, p_idempotency_key text default null)
returns public.stock_movements language plpgsql security definer set search_path = public as $$
declare
  v public.stock_movements;
  v_reg public.registrations;
  m public.materials;
begin
  perform app.require_log('log.warehouse');
  if p_idempotency_key is not null then
    select s.* into v from public.registrations r join public.stock_movements s on s.id = r.ref_id where r.idempotency_key = p_idempotency_key;
    if found then return v; end if;
  end if;
  if p_qty is null or p_qty <= 0 or p_unit_cost is null or p_unit_cost < 0 then raise exception 'Jumlah dan harga tidak valid' using errcode = '22023'; end if;
  if not exists(select 1 from public.suppliers where id = p_supplier and active) then raise exception 'Supplier tidak aktif' using errcode = '22023'; end if;
  select * into m from public.materials where id = p_material for update;
  if not found then raise exception 'Barang tidak ditemukan' using errcode = 'P0002'; end if;
  update public.materials set avg_cost = round((stock_qty * avg_cost + p_qty * p_unit_cost) / (stock_qty + p_qty), 2),
    stock_qty = stock_qty + p_qty where id = p_material;
  v_reg := app.allocate_number('GR', '{}', p_idempotency_key);
  insert into public.stock_movements(movement_no, movement_type, material_id, qty, unit_cost, supplier_id, doc_ref, note)
  values (v_reg.number, 'receipt', p_material, p_qty, p_unit_cost, p_supplier, app.require_text(p_doc_ref, 'No. surat jalan / PO'), p_note)
  returning * into v;
  update public.registrations set ref_table = 'stock_movements', ref_id = v.id where id = v_reg.id;
  return v;
end $$;

-- Pengeluaran barang terhadap MR yang disetujui. p_lines: [{"line": uuid, "qty": n}]
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
    if ln.qty_issued + q > ln.qty then raise exception 'Jumlah melebihi sisa permintaan' using errcode = '22023'; end if;
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
  update public.material_requests set status = case when exists(select 1 from public.material_request_lines where mr_id = p_mr and qty_issued < qty)
    then 'partial' else 'issued' end where id = p_mr returning * into v;
  perform app.notify_users(array[v.requested_by], 'log.mr', 'Barang MR ' || v.mr_no || ' dikeluarkan (' || v_reg.number || ')', '', '/logistik/mr/' || v.id);
  return v;
end $$;

-- BBM / oli langsung ke unit, dengan HM (tidak boleh mundur).
create or replace function public.fuel_issue(p_unit uuid, p_material uuid, p_qty numeric, p_hm numeric, p_note text default null,
  p_idempotency_key text default null)
returns public.stock_movements language plpgsql security definer set search_path = public as $$
declare
  v public.stock_movements;
  v_reg public.registrations;
  u public.units;
  m public.materials;
begin
  perform app.require_log('log.warehouse');
  if p_idempotency_key is not null then
    select s.* into v from public.registrations r join public.stock_movements s on s.id = r.ref_id where r.idempotency_key = p_idempotency_key;
    if found then return v; end if;
  end if;
  select * into u from public.units where id = p_unit;
  if not found or u.status = 'retired' then raise exception 'Unit tidak ditemukan' using errcode = '22023'; end if;
  if p_hm is null then raise exception 'HM/KM wajib diisi' using errcode = '22023'; end if;
  if p_hm < u.current_hm then raise exception 'HM % lebih kecil dari HM terakhir unit (%)', p_hm, u.current_hm using errcode = '22023'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Jumlah tidak valid' using errcode = '22023'; end if;
  if (select category from public.materials where id = p_material) not in ('fuel','lubricant') then
    raise exception 'Hanya BBM / pelumas yang bisa dikeluarkan langsung ke unit' using errcode = '22023';
  end if;
  m := app.stock_out(p_material, p_qty);
  v_reg := app.allocate_number('GI', '{}', p_idempotency_key);
  insert into public.stock_movements(movement_no, movement_type, material_id, qty, unit_cost, unit_id, hour_meter, note)
  values (v_reg.number, 'fuel', p_material, -p_qty, m.avg_cost, p_unit, p_hm, p_note)
  returning * into v;
  update public.registrations set ref_table = 'stock_movements', ref_id = v.id where id = v_reg.id;
  perform app.unit_hm(p_unit, p_hm);
  return v;
end $$;

-- Stok opname: selisih dicatat sebagai penyesuaian dan wajib keterangan.
create or replace function public.stock_opname(p_material uuid, p_counted numeric, p_note text default null)
returns public.materials language plpgsql security definer set search_path = public as $$
declare
  m public.materials;
  d numeric;
begin
  perform app.require_log('log.warehouse');
  if p_counted is null or p_counted < 0 then raise exception 'Jumlah hitung tidak valid' using errcode = '22023'; end if;
  select * into m from public.materials where id = p_material for update;
  if not found then raise exception 'Barang tidak ditemukan' using errcode = 'P0002'; end if;
  d := p_counted - m.stock_qty;
  if d = 0 then return m; end if;
  insert into public.stock_movements(movement_type, material_id, qty, unit_cost, note)
  values ('adjust', p_material, d, m.avg_cost, app.require_text(p_note, 'Keterangan selisih opname'));
  update public.materials set stock_qty = p_counted where id = p_material returning * into m;
  return m;
end $$;

-- ---------------------------------------------------------------- tampilan
create view public.material_stock with (security_invoker = true) as
select m.id, m.code, m.name, m.category, m.uom, m.min_stock, m.stock_qty, m.avg_cost, m.active,
       round(m.stock_qty * m.avg_cost, 2) as stock_value, (m.active and m.stock_qty <= m.min_stock) as low_stock
  from public.materials m;

create view public.mr_register with (security_invoker = true) as
select r.id, r.mr_no, r.status, r.purpose, r.need_date, r.total_value, r.created_at, r.department_id, d.code as department_code,
       r.requested_by, p.full_name as requester_name, r.wo_id, w.wo_no, r.reviewed_at, rv.full_name as reviewer_name, r.review_note,
       (select count(*)::int from public.material_request_lines l where l.mr_id = r.id) as lines,
       r.status in ('submitted','approved','partial') as is_open
  from public.material_requests r
  join public.departments d on d.id = r.department_id
  join public.profiles p on p.id = r.requested_by
  left join public.profiles rv on rv.id = r.reviewed_by
  left join public.work_orders w on w.id = r.wo_id;

create view public.stock_ledger with (security_invoker = true) as
select s.id, s.movement_no, s.movement_type, s.moved_at, s.material_id, m.code as material_code, m.name as material_name, m.uom,
       s.qty, s.unit_cost, round(abs(s.qty) * s.unit_cost, 2) as value, sp.name as supplier_name, s.doc_ref,
       s.mr_id, r.mr_no, s.wo_id, w.wo_no, s.unit_id, u.unit_no, s.hour_meter, s.note, p.full_name as moved_by_name
  from public.stock_movements s
  join public.materials m on m.id = s.material_id
  join public.profiles p on p.id = s.moved_by
  left join public.suppliers sp on sp.id = s.supplier_id
  left join public.material_requests r on r.id = s.mr_id
  left join public.work_orders w on w.id = s.wo_id
  left join public.units u on u.id = s.unit_id;

-- Nilai supplier: rata-rata 6 bulan terakhir; A ≥ 4, B ≥ 3, C < 3 (perlu tindak lanjut).
create view public.supplier_score with (security_invoker = true) as
select s.id, s.code, s.name, s.category, s.contact_name, s.phone, s.active, e.score, e.evaluations, e.last_period,
       case when e.score is null then null when e.score >= 4 then 'A' when e.score >= 3 then 'B' else 'C' end as grade
  from public.suppliers s
  left join (select supplier_id, round(avg(score), 2) score, count(*)::int evaluations, max(period) last_period
               from public.supplier_evaluations where period >= (date_trunc('month', current_date) - interval '6 months')
              group by supplier_id) e on e.supplier_id = s.id;

do $$
declare v text;
begin
  foreach v in array array['material_stock','mr_register','stock_ledger','supplier_score'] loop
    execute format('grant select on public.%I to authenticated', v);
    execute format('revoke all on public.%I from anon', v);
  end loop;
end $$;

revoke all on function app.log_dept(), app.require_log(text), app.stock_out(uuid, numeric) from public, anon, authenticated;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and p.proname <> 'verify_document' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
