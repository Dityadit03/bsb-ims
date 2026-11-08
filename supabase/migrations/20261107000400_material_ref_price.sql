-- Harga acuan barang: dipakai hanya untuk menaksir nilai MR bila barang belum punya harga rata-rata dari penerimaan.
-- Nilai persediaan (stok x harga rata-rata) tidak berubah; harga rata-rata tetap hanya dari penerimaan barang.
alter table public.materials add column if not exists ref_price numeric not null default 0 check (ref_price >= 0);

create or replace function app.mat_price(m public.materials) returns numeric
language sql stable as $$ select coalesce(nullif(m.avg_cost, 0), nullif(m.ref_price, 0), 0) $$;

-- Harga acuan otomatis mengikuti harga PO terakhir.
create or replace function app.po_line_ref_price() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.material_id is not null and coalesce(new.unit_price, 0) > 0 then
    update public.materials set ref_price = new.unit_price where id = new.material_id;
  end if;
  return new;
end $$;
drop trigger if exists po_line_ref_price on public.purchase_order_lines;
create trigger po_line_ref_price after insert on public.purchase_order_lines for each row execute function app.po_line_ref_price();

-- Simpan barang: tambah harga acuan (kosong = tidak diubah).
drop function if exists public.material_save(text, text, text, text, numeric, boolean);
create or replace function public.material_save(p_code text, p_name text, p_category text, p_uom text, p_min_stock numeric default 0,
  p_active boolean default true, p_ref_price numeric default null)
returns public.materials language plpgsql security definer set search_path = public as $$
declare v public.materials;
begin
  perform app.require_log('log.manage');
  if p_ref_price is not null and p_ref_price < 0 then raise exception 'Harga acuan tidak boleh negatif' using errcode = '22023'; end if;
  insert into public.materials(code, name, category, uom, min_stock, active, ref_price)
  values (upper(app.require_text(p_code, 'Kode barang')), app.require_text(p_name, 'Nama barang'), p_category,
          app.require_text(p_uom, 'Satuan'), coalesce(p_min_stock, 0), p_active, coalesce(p_ref_price, 0))
  on conflict (code) do update set name = excluded.name, category = excluded.category, uom = excluded.uom,
    min_stock = excluded.min_stock, active = excluded.active, ref_price = coalesce(p_ref_price, public.materials.ref_price)
  returning * into v;
  return v;
end $$;
revoke execute on function public.material_save(text, text, text, text, numeric, boolean, numeric) from public, anon;
grant execute on function public.material_save(text, text, text, text, numeric, boolean, numeric) to authenticated;

-- Nilai MR memakai harga acuan bila harga rata-rata masih 0 (definisi fungsi yang ada ditulis ulang di tempat).
do $$
declare f record; d text;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname in ('mr_create', 'mr_review', 'mr_special_resolve') loop
    d := pg_get_functiondef(f.sig);
    if position('mt.avg_cost' in d) > 0 then
      execute replace(d, 'mt.avg_cost', 'app.mat_price(mt)');
    end if;
  end loop;
end $$;

-- Tampilan stok: tambah kolom harga acuan di akhir.
create or replace view public.material_stock with (security_invoker = true) as
select m.id, m.code, m.name, m.category, m.uom, m.min_stock, m.stock_qty, m.avg_cost, m.active,
       round(m.stock_qty * m.avg_cost, 2) as stock_value, (m.active and m.stock_qty <= m.min_stock) as low_stock, m.location, m.ref_price
  from public.materials m;
