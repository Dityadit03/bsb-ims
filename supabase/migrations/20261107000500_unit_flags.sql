-- Tanda unit bermasalah (SPIP expired, breakdown terbuka) untuk dipakai di pilihan unit modul lain.
create or replace view public.unit_flags with (security_invoker = true) as
select u.id as unit_id, u.unit_no,
       (select c.validity from public.commissioning_register c where c.unit_id = u.id
         order by c.valid_until desc nulls last limit 1) as spip_validity,
       exists(select 1 from public.work_orders w where w.unit_id = u.id and w.wo_type = 'breakdown'
               and w.status in ('open', 'in_progress', 'waiting_part')) as open_breakdown
  from public.units u;
revoke all on public.unit_flags from public, anon;
grant select on public.unit_flags to authenticated;
