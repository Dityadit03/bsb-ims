-- Reservasi suku cadang: qty MR yang sudah disetujui tetapi belum dikeluarkan dianggap dicadangkan,
-- sehingga stok tersedia = stok fisik - dicadangkan. Dipakai perencanaan stok dan daftar part per WO.

create view public.material_reservation with (security_invoker = true) as
select l.material_id, sum(coalesce(l.qty_approved, l.qty) - l.qty_issued) as reserved_qty
  from public.material_request_lines l
  join public.material_requests r on r.id = l.mr_id and r.status in ('approved','partial')
 where coalesce(l.qty_approved, l.qty) > l.qty_issued
 group by l.material_id;

-- Part yang diminta untuk sebuah WO (lewat MR yang menautkan WO)
create view public.wo_parts with (security_invoker = true) as
select r.wo_id, r.id as mr_id, r.mr_no, r.status as mr_status, l.id as line_id, l.material_id, m.code, m.name, m.uom,
       l.qty, l.qty_approved, l.qty_issued, m.stock_qty,
       m.stock_qty - coalesce(rs.reserved_qty, 0) as available_qty,
       (m.stock_qty - coalesce(rs.reserved_qty, 0)) < greatest(0, coalesce(l.qty_approved, l.qty) - l.qty_issued)
         and r.status in ('submitted','pending','approved','partial') as short
  from public.material_requests r
  join public.material_request_lines l on l.mr_id = r.id
  join public.materials m on m.id = l.material_id
  left join public.material_reservation rs on rs.material_id = l.material_id
 where r.wo_id is not null and r.status <> 'cancelled';

-- Perencanaan stok memakai stok tersedia (setelah cadangan) untuk titik pesan ulang dan usulan pesan.
create or replace view public.stock_planning with (security_invoker = true) as
with use90 as (
  select material_id, sum(-qty) as used from public.stock_movements
   where movement_type in ('issue','fuel') and moved_at >= now() - interval '90 days' group by 1),
oo as (
  select l.material_id, sum(l.qty - l.qty_received) as q from public.purchase_order_lines l
    join public.purchase_orders o on o.id = l.po_id and o.status in ('issued','partial') group by 1),
base as (
  select m.id as material_id, m.code, m.name, m.category, m.uom, m.stock_qty, m.min_stock, m.avg_cost, m.lead_time_days, m.critical,
         coalesce(u.used, 0) / 90.0 as daily, coalesce(oo.q, 0) as on_order, coalesce(rs.reserved_qty, 0) as reserved,
         coalesce(u.used, 0) / 90.0 * 365 * m.avg_cost as annual_value
    from public.materials m left join use90 u on u.material_id = m.id left join oo on oo.material_id = m.id
    left join public.material_reservation rs on rs.material_id = m.id
   where m.active),
ranked as (
  select b.*, sum(annual_value) over (order by annual_value desc, code) / nullif(sum(annual_value) over (), 0) as cum
    from base b)
select material_id, code, name, category, uom, stock_qty, min_stock, avg_cost, lead_time_days, critical, on_order,
       round(daily::numeric, 3) as daily_use,
       case when daily > 0 then round(((stock_qty - reserved) / daily)::numeric, 1) end as cover_days,
       ceil(daily * lead_time_days + min_stock) as reorder_point,
       greatest(0, ceil(daily * (lead_time_days + 14) + min_stock - (stock_qty - reserved) - on_order)) as suggested_qty,
       (stock_qty - reserved + on_order) <= ceil(daily * lead_time_days + min_stock) as reorder_now,
       case when annual_value <= 0 then 'C' when cum <= 0.8 then 'A' when cum <= 0.95 then 'B' else 'C' end as abc,
       round(annual_value::numeric) as annual_value,
       reserved as reserved_qty
  from ranked;
