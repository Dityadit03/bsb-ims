-- Rekonsiliasi downtime 30 hari: jam breakdown menurut work order (Plant) vs jam tertunda "breakdown" menurut laporan produksi.
-- Selisih besar berarti ada kerusakan yang tidak dibuatkan WO, atau WO yang tidak dicatat sebagai penundaan produksi.
create view public.downtime_reconcile with (security_invoker = true) as
with p as (
  select d.unit_id, sum(d.hours) as hours from public.production_delays d join public.production_reports r on r.id = d.report_id
   where d.category = 'breakdown' and d.unit_id is not null and r.report_date >= current_date - 30 and r.status in ('submitted','approved') group by 1)
select u.id as unit_id, u.unit_no, round(a.breakdown_hours_30d::numeric, 1) as wo_hours, round(coalesce(p.hours, 0)::numeric, 1) as production_hours,
       round((a.breakdown_hours_30d - coalesce(p.hours, 0))::numeric, 1) as gap_hours,
       case when a.breakdown_hours_30d - coalesce(p.hours, 0) > 4 then 'wo_not_in_production'
            when coalesce(p.hours, 0) - a.breakdown_hours_30d > 2 then 'production_without_wo' end as flag
  from public.units u join public.unit_availability a on a.unit_id = u.id left join p on p.unit_id = u.id
 where u.status <> 'retired' and (a.breakdown_hours_30d > 0 or coalesce(p.hours, 0) > 0);
