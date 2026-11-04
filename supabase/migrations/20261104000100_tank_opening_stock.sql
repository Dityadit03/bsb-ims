-- BSB IMS · Logistik: isi awal tangki ikut masuk ke stok barang BBM.
-- Sebelumnya isi awal hanya mengisi tangki, stok barang tetap 0, sehingga pengeluaran / ukur / "Lainnya" gagal "Stok tidak cukup".
-- Harga per liter isi awal opsional; bila diisi, harga rata-rata barang ikut dihitung.

drop function if exists public.fuel_tank_opening(uuid, numeric, text);
create or replace function public.fuel_tank_opening(p_tank uuid, p_liters numeric, p_note text default null, p_unit_cost numeric default null)
returns public.fuel_tanks language plpgsql security definer set search_path = public as $$
declare v public.fuel_tanks; m public.materials; mv public.stock_movements; v_cost numeric;
begin
  perform app.require_log('log.warehouse');
  select * into v from public.fuel_tanks where id = p_tank for update;
  if not found then raise exception 'Tangki tidak ditemukan' using errcode = 'P0002'; end if;
  if v.opened then raise exception 'Isi awal tangki % sudah dicatat', v.code using errcode = '22023'; end if;
  if p_liters is null or p_liters < 0 or p_liters > v.capacity_l then raise exception 'Isi awal melebihi kapasitas tangki (% L)', v.capacity_l using errcode = '22023'; end if;
  if p_unit_cost is not null and p_unit_cost < 0 then raise exception 'Harga tidak valid' using errcode = '22023'; end if;
  update public.fuel_tanks set level_l = p_liters, opened = true where id = p_tank returning * into v;
  if p_liters > 0 then
    select * into m from public.materials where id = v.material_id for update;
    v_cost := coalesce(p_unit_cost, m.avg_cost);
    insert into public.stock_movements(movement_type, material_id, qty, unit_cost, note)
    values ('adjust', v.material_id, p_liters, v_cost, 'Isi awal tangki ' || v.code || coalesce(': ' || nullif(btrim(p_note), ''), ''))
    returning * into mv;
    update public.materials set stock_qty = stock_qty + p_liters,
      avg_cost = case when p_unit_cost is not null and p_unit_cost > 0 then round((stock_qty * avg_cost + p_liters * p_unit_cost) / (stock_qty + p_liters), 2) else avg_cost end
     where id = v.material_id;
  end if;
  insert into public.fuel_tank_logs(tank_id, kind, liters, level_after, measured_l, movement_id, note)
  values (p_tank, 'opening', p_liters, p_liters, p_liters, mv.id, p_note);
  return v;
end $$;

-- Perbaikan data: isi awal yang sudah tercatat tanpa stok barang.
do $$
declare r record; mv public.stock_movements;
begin
  for r in select l.id as log_id, l.tank_id, l.liters, t.code, t.material_id from public.fuel_tank_logs l join public.fuel_tanks t on t.id = l.tank_id
            where l.kind = 'opening' and l.movement_id is null and l.liters > 0 loop
    insert into public.stock_movements(movement_type, material_id, qty, unit_cost, note, moved_by)
    select 'adjust', r.material_id, r.liters, m.avg_cost, 'Isi awal tangki ' || r.code || ' (perbaikan stok)', coalesce(l.created_by, (select id from public.profiles order by created_at limit 1))
      from public.materials m, public.fuel_tank_logs l where m.id = r.material_id and l.id = r.log_id
    returning * into mv;
    update public.materials set stock_qty = stock_qty + r.liters where id = r.material_id;
    update public.fuel_tank_logs set movement_id = mv.id where id = r.log_id;
  end loop;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'fuel_tank_opening' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
