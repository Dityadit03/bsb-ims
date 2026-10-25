-- BSB IMS · Logistik: tangki & stasiun BBM sendiri. BBM dipasok truk vendor ke tangki, dikeluarkan ke unit dengan HM.
-- Terima (surat jalan + ukur sebelum/sesudah), keluar ke unit (memakai fuel_issue → stok & biaya BBM per unit tetap satu sumber),
-- ukur harian (dipstick) dengan selisih tercatat sebagai penyesuaian stok, konsumsi liter/HM per unit dan peringatan anomali.

insert into public.app_settings(key, value, description) values
  ('fuel_receipt_tolerance_pct', '0.5', 'Selisih ukur tangki vs surat jalan (persen dari kiriman) yang masih wajar tanpa catatan'),
  ('fuel_anomaly_pct', '20', 'Konsumsi liter/HM 14 hari terakhir melebihi rata-rata 90 hari sebelumnya sebesar persen ini ditandai anomali');

create table public.fuel_tanks(
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9][A-Z0-9./-]*$'),
  name text not null,
  material_id uuid not null references public.materials(id),
  capacity_l numeric not null check (capacity_l > 0),
  level_l numeric not null default 0 check (level_l >= 0),
  opened boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (level_l <= capacity_l)
);

create table public.fuel_tank_logs(
  id uuid primary key default gen_random_uuid(),
  tank_id uuid not null references public.fuel_tanks(id),
  kind text not null check (kind in ('opening','receipt','issue','dip')),
  liters numeric not null,
  level_after numeric not null check (level_after >= 0),
  movement_id uuid references public.stock_movements(id),
  supplier_id uuid references public.suppliers(id),
  unit_id uuid references public.units(id),
  hour_meter numeric,
  doc_ref text,
  dip_before numeric,
  dip_after numeric,
  measured_l numeric,
  note text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index fuel_tank_logs_idx on public.fuel_tank_logs(tank_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['fuel_tanks','fuel_tank_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create policy %I_read on public.%I for select to authenticated using (app.is_active_user())', t, t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
  end loop;
  create trigger fuel_tanks_touch before update on public.fuel_tanks for each row execute function app.touch_updated_at();
end $$;

create or replace function public.fuel_tank_save(p_code text, p_name text, p_material uuid, p_capacity numeric, p_active boolean default true)
returns public.fuel_tanks language plpgsql security definer set search_path = public as $$
declare v public.fuel_tanks;
begin
  perform app.require_log('log.manage');
  if (select category from public.materials where id = p_material) is distinct from 'fuel' then
    raise exception 'Tangki hanya untuk barang kategori BBM' using errcode = '22023';
  end if;
  insert into public.fuel_tanks(code, name, material_id, capacity_l, active)
  values (upper(app.require_text(p_code, 'Kode tangki')), app.require_text(p_name, 'Nama tangki'), p_material, p_capacity, coalesce(p_active, true))
  on conflict (code) do update set name = excluded.name, material_id = excluded.material_id, capacity_l = excluded.capacity_l, active = excluded.active
  returning * into v;
  return v;
end $$;

-- Isi awal tangki (sekali). Tidak mengubah stok barang: stok BBM yang sudah tercatat dianggap sudah mencakupnya.
create or replace function public.fuel_tank_opening(p_tank uuid, p_liters numeric, p_note text default null)
returns public.fuel_tanks language plpgsql security definer set search_path = public as $$
declare v public.fuel_tanks;
begin
  perform app.require_log('log.warehouse');
  select * into v from public.fuel_tanks where id = p_tank for update;
  if not found then raise exception 'Tangki tidak ditemukan' using errcode = 'P0002'; end if;
  if v.opened then raise exception 'Isi awal tangki % sudah dicatat' , v.code using errcode = '22023'; end if;
  if p_liters is null or p_liters < 0 or p_liters > v.capacity_l then raise exception 'Isi awal melebihi kapasitas tangki (% L)', v.capacity_l using errcode = '22023'; end if;
  update public.fuel_tanks set level_l = p_liters, opened = true where id = p_tank returning * into v;
  insert into public.fuel_tank_logs(tank_id, kind, liters, level_after, measured_l, note) values (p_tank, 'opening', p_liters, p_liters, p_liters, p_note);
  return v;
end $$;

-- Terima kiriman truk vendor. Selisih ukur (sesudah − sebelum) terhadap surat jalan di atas toleransi wajib dicatat.
create or replace function public.fuel_tank_receive(p_tank uuid, p_supplier uuid, p_liters numeric, p_unit_cost numeric, p_doc_ref text,
  p_dip_before numeric default null, p_dip_after numeric default null, p_note text default null, p_idempotency_key text default null)
returns public.fuel_tank_logs language plpgsql security definer set search_path = public as $$
declare
  t public.fuel_tanks; v public.fuel_tank_logs; mv public.stock_movements;
  v_tol numeric := coalesce((select value::text::numeric from public.app_settings where key = 'fuel_receipt_tolerance_pct'), 0.5);
  v_diff numeric;
begin
  perform app.require_log('log.warehouse');
  select * into t from public.fuel_tanks where id = p_tank for update;
  if not found or not t.active then raise exception 'Tangki tidak aktif' using errcode = '22023'; end if;
  if not t.opened then raise exception 'Catat isi awal tangki % dulu', t.code using errcode = '22023'; end if;
  if p_liters is null or p_liters <= 0 then raise exception 'Jumlah liter tidak valid' using errcode = '22023'; end if;
  if t.level_l + p_liters > t.capacity_l then
    raise exception 'Melebihi kapasitas tangki %: isi % L + kiriman % L > % L', t.code, t.level_l, p_liters, t.capacity_l using errcode = '22023';
  end if;
  if (p_dip_before is null) <> (p_dip_after is null) then raise exception 'Isi ukur sebelum dan sesudah bersama-sama' using errcode = '22023'; end if;
  if p_dip_after is not null then
    if p_dip_after < p_dip_before then raise exception 'Ukur sesudah tidak boleh lebih kecil dari sebelum' using errcode = '22023'; end if;
    v_diff := (p_dip_after - p_dip_before) - p_liters;
    if abs(v_diff) > p_liters * v_tol / 100 and coalesce(btrim(p_note), '') = '' then
      raise exception 'Hasil ukur (% L) berbeda % L dari surat jalan; beri catatan', p_dip_after - p_dip_before, round(v_diff, 1) using errcode = '22023';
    end if;
  end if;
  mv := public.goods_receive(t.material_id, p_supplier, p_liters, p_unit_cost, p_doc_ref, p_note, p_idempotency_key);
  if exists(select 1 from public.fuel_tank_logs where movement_id = mv.id) then
    select * into v from public.fuel_tank_logs where movement_id = mv.id; return v;
  end if;
  update public.fuel_tanks set level_l = level_l + p_liters where id = p_tank;
  insert into public.fuel_tank_logs(tank_id, kind, liters, level_after, movement_id, supplier_id, doc_ref, dip_before, dip_after, note)
  values (p_tank, 'receipt', p_liters, t.level_l + p_liters, mv.id, p_supplier, p_doc_ref, p_dip_before, p_dip_after, p_note)
  returning * into v;
  return v;
end $$;

-- Keluarkan BBM dari tangki ke unit (HM wajib, tidak boleh mundur)
create or replace function public.fuel_tank_dispense(p_tank uuid, p_unit uuid, p_liters numeric, p_hm numeric, p_note text default null,
  p_idempotency_key text default null)
returns public.fuel_tank_logs language plpgsql security definer set search_path = public as $$
declare t public.fuel_tanks; v public.fuel_tank_logs; mv public.stock_movements;
begin
  perform app.require_log('log.warehouse');
  select * into t from public.fuel_tanks where id = p_tank for update;
  if not found or not t.active then raise exception 'Tangki tidak aktif' using errcode = '22023'; end if;
  if not t.opened then raise exception 'Catat isi awal tangki % dulu', t.code using errcode = '22023'; end if;
  if p_liters is null or p_liters <= 0 then raise exception 'Jumlah liter tidak valid' using errcode = '22023'; end if;
  if t.level_l < p_liters then raise exception 'Isi tangki % hanya % L', t.code, t.level_l using errcode = '22023'; end if;
  mv := public.fuel_issue(p_unit, t.material_id, p_liters, p_hm, p_note, p_idempotency_key);
  if exists(select 1 from public.fuel_tank_logs where movement_id = mv.id) then
    select * into v from public.fuel_tank_logs where movement_id = mv.id; return v;
  end if;
  update public.fuel_tanks set level_l = level_l - p_liters where id = p_tank;
  insert into public.fuel_tank_logs(tank_id, kind, liters, level_after, movement_id, unit_id, hour_meter, note)
  values (p_tank, 'issue', -p_liters, t.level_l - p_liters, mv.id, p_unit, p_hm, p_note) returning * into v;
  return v;
end $$;

-- Ukur tangki (dipstick). Selisih terhadap catatan sistem menyesuaikan isi tangki dan stok barang; keterangan wajib bila ada selisih.
create or replace function public.fuel_tank_dip(p_tank uuid, p_measured numeric, p_note text default null)
returns public.fuel_tank_logs language plpgsql security definer set search_path = public as $$
declare t public.fuel_tanks; v public.fuel_tank_logs; m public.materials; d numeric;
begin
  perform app.require_log('log.warehouse');
  select * into t from public.fuel_tanks where id = p_tank for update;
  if not found or not t.active then raise exception 'Tangki tidak aktif' using errcode = '22023'; end if;
  if not t.opened then raise exception 'Catat isi awal tangki % dulu', t.code using errcode = '22023'; end if;
  if p_measured is null or p_measured < 0 or p_measured > t.capacity_l then raise exception 'Hasil ukur tidak valid (kapasitas % L)', t.capacity_l using errcode = '22023'; end if;
  d := p_measured - t.level_l;
  if d <> 0 then
    if coalesce(btrim(p_note), '') = '' then raise exception 'Selisih % L terhadap sistem; keterangan wajib diisi', round(d, 1) using errcode = '22023'; end if;
    select * into m from public.materials where id = t.material_id for update;
    if m.stock_qty + d < 0 then raise exception 'Penyesuaian membuat stok % negatif', m.code using errcode = '22023'; end if;
    insert into public.stock_movements(movement_type, material_id, qty, unit_cost, note)
    values ('adjust', t.material_id, d, m.avg_cost, 'Ukur tangki ' || t.code || ': ' || p_note);
    update public.materials set stock_qty = stock_qty + d where id = t.material_id;
  end if;
  update public.fuel_tanks set level_l = p_measured where id = p_tank;
  insert into public.fuel_tank_logs(tank_id, kind, liters, level_after, measured_l, note) values (p_tank, 'dip', d, p_measured, p_measured, p_note) returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------- tampilan
create view public.fuel_tank_status with (security_invoker = true) as
select t.id as tank_id, t.code, t.name, t.active, m.code as material_code, m.name as material_name, t.capacity_l, t.level_l, t.opened,
       round(100 * t.level_l / t.capacity_l, 1) as level_pct,
       (select max(l.created_at) from public.fuel_tank_logs l where l.tank_id = t.id and l.kind = 'dip') as last_dip_at,
       (select l.liters from public.fuel_tank_logs l where l.tank_id = t.id and l.kind = 'dip' order by l.created_at desc limit 1) as last_dip_variance,
       coalesce((select sum(l.liters) from public.fuel_tank_logs l where l.tank_id = t.id and l.kind = 'receipt' and l.created_at >= now() - interval '30 days'), 0) as received_30d,
       coalesce((select -sum(l.liters) from public.fuel_tank_logs l where l.tank_id = t.id and l.kind = 'issue' and l.created_at >= now() - interval '30 days'), 0) as issued_30d,
       case when coalesce((select -sum(l.liters) from public.fuel_tank_logs l where l.tank_id = t.id and l.kind = 'issue' and l.created_at >= now() - interval '14 days'), 0) > 0
            then round(t.level_l / ((select -sum(l.liters) from public.fuel_tank_logs l where l.tank_id = t.id and l.kind = 'issue' and l.created_at >= now() - interval '14 days') / 14.0), 1) end as days_cover
  from public.fuel_tanks t join public.materials m on m.id = t.material_id;

create view public.fuel_tank_log_view with (security_invoker = true) as
select l.*, t.code as tank_code, t.name as tank_name, s.name as supplier_name, u.unit_no, p.full_name as by_name, sm.movement_no
  from public.fuel_tank_logs l join public.fuel_tanks t on t.id = l.tank_id
  left join public.suppliers s on s.id = l.supplier_id left join public.units u on u.id = l.unit_id
  left join public.profiles p on p.id = l.created_by left join public.stock_movements sm on sm.id = l.movement_id;

-- Konsumsi fill-to-fill: liter yang diisi dibagi selisih HM sejak pengisian sebelumnya pada unit yang sama
create view public.fuel_fills with (security_invoker = true) as
select f.*, f.hm - f.prev_hm as hm_delta,
       case when f.prev_hm is not null and f.hm > f.prev_hm then round(f.liters / (f.hm - f.prev_hm), 2) end as l_per_hm
  from (
    select s.id, s.unit_id, u.unit_no, u.unit_type, s.moved_at, -s.qty as liters, s.hour_meter as hm,
           lag(s.hour_meter) over (partition by s.unit_id order by s.hour_meter, s.moved_at) as prev_hm
      from public.stock_movements s join public.units u on u.id = s.unit_id join public.materials m on m.id = s.material_id
     where s.movement_type = 'fuel' and m.category = 'fuel' and s.hour_meter is not null
  ) f;

-- Anomali: liter/HM 14 hari terakhir dibanding 90 hari sebelumnya (berbobot HM), minimal 2 pengisian di tiap jendela
create view public.fuel_anomaly with (security_invoker = true) as
with w as (
  select unit_id, unit_no, unit_type,
         sum(liters) filter (where moved_at >= now() - interval '14 days' and l_per_hm is not null) as rec_l,
         sum(hm_delta) filter (where moved_at >= now() - interval '14 days' and l_per_hm is not null) as rec_hm,
         count(*) filter (where moved_at >= now() - interval '14 days' and l_per_hm is not null) as rec_n,
         sum(liters) filter (where moved_at < now() - interval '14 days' and moved_at >= now() - interval '104 days' and l_per_hm is not null) as base_l,
         sum(hm_delta) filter (where moved_at < now() - interval '14 days' and moved_at >= now() - interval '104 days' and l_per_hm is not null) as base_hm,
         count(*) filter (where moved_at < now() - interval '14 days' and moved_at >= now() - interval '104 days' and l_per_hm is not null) as base_n
    from public.fuel_fills group by unit_id, unit_no, unit_type)
select unit_id, unit_no, unit_type, round(rec_l / nullif(rec_hm, 0), 2) as recent_l_per_hm, round(base_l / nullif(base_hm, 0), 2) as base_l_per_hm,
       round(100 * ((rec_l / nullif(rec_hm, 0)) / nullif(base_l / nullif(base_hm, 0), 0) - 1), 1) as deviation_pct,
       rec_n, base_n,
       (rec_n >= 2 and base_n >= 2 and (rec_l / nullif(rec_hm, 0)) >
          (base_l / nullif(base_hm, 0)) * (1 + coalesce((select value::text::numeric from public.app_settings where key = 'fuel_anomaly_pct'), 20) / 100.0)) as is_anomaly
  from w where rec_n > 0;

-- Rekonsiliasi: stok BBM menurut buku vs jumlah isi semua tangki
create view public.fuel_reconciliation with (security_invoker = true) as
select m.id as material_id, m.code, m.name, m.stock_qty as book_stock, coalesce(sum(t.level_l), 0) as tank_total, m.stock_qty - coalesce(sum(t.level_l), 0) as gap
  from public.materials m join public.fuel_tanks t on t.material_id = m.id and t.active
 group by m.id, m.code, m.name, m.stock_qty;

do $$
declare v text;
begin
  foreach v in array array['fuel_tank_status','fuel_tank_log_view','fuel_fills','fuel_anomaly','fuel_reconciliation'] loop
    execute format('grant select on public.%I to authenticated', v);
    execute format('revoke all on public.%I from anon', v);
  end loop;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and p.proname not in ('verify_document','feed_rows') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
