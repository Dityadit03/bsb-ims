-- Lokasi rak/bin gudang per barang (mis. "R2-B03"), supaya penerimaan dan pengeluaran cepat ditemukan.
alter table public.materials add column location text check (location is null or location ~ '^[A-Za-z0-9][A-Za-z0-9 ./-]{0,23}$');

create or replace function public.material_location_set(p_material uuid, p_location text)
returns void language plpgsql security definer set search_path = public as $$
declare v text := nullif(btrim(coalesce(p_location, '')), '');
begin
  if not app.has_permission('log.warehouse', app.log_dept()) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  update public.materials set location = upper(v) where id = p_material;
  if not found then raise exception 'Barang tidak ditemukan' using errcode = 'P0002'; end if;
  perform app.log_event('material.location', 'materials', p_material::text, jsonb_build_object('location', upper(v)));
end $$;

-- material_stock dipakai halaman stok; tampilkan lokasi (kolom baru di akhir)
create or replace view public.material_stock with (security_invoker = true) as
select m.id, m.code, m.name, m.category, m.uom, m.min_stock, m.stock_qty, m.avg_cost, m.active,
       round(m.stock_qty * m.avg_cost, 2) as stock_value, (m.active and m.stock_qty <= m.min_stock) as low_stock, m.location
  from public.materials m;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and p.proname not in ('verify_document','feed_rows') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
