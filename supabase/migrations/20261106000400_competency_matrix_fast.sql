-- Percepat matriks kompetensi: status terbaik per (karyawan, kompetensi) dihitung set-based,
-- bukan subquery per baris yang membaca ulang view berlapis RLS (1,5 dtk -> puluhan ms).
-- Kolom dan arti hasil tidak berubah.
create or replace view public.competency_matrix with (security_invoker = true) as
with cfg as materialized (
  select app.site_today() as today,
         coalesce((select value::text::int from public.app_settings where key = 'competency_warning_days'), 30) as days
), v as (
  select ec.employee_id, ec.competency_id, ec.valid_until,
         case when ec.status = 'revoked' then 'revoked'
              when ec.valid_until is not null and ec.valid_until < (select today from cfg) then 'expired'
              when coalesce(ec.fitness, 'fit') in ('unfit', 'temporary_unfit') then 'unfit'
              when ec.valid_until is not null and ec.valid_until - (select today from cfg) <= (select days from cfg) then 'expiring'
              else 'valid' end as validity
    from public.employee_competencies ec
), best as materialized (
  select employee_id, competency_id,
         (array_agg(validity order by case validity when 'valid' then 1 when 'expiring' then 2 when 'expired' then 3 else 4 end,
                    valid_until desc nulls first))[1] as status,
         max(valid_until) filter (where validity in ('valid', 'expiring')) as valid_until
    from v group by employee_id, competency_id
)
select e.id as employee_id, e.nrp, e.full_name, e.department_id, d.code as department_code, e.position_id, p.name as position_name,
       c.id as competency_id, c.code as competency_code, c.name as competency_name,
       coalesce(b.status, 'missing') as status,
       b.valid_until
  from public.employees e
  join public.departments d on d.id = e.department_id
  join public.positions p on p.id = e.position_id
  join public.competency_requirements r on r.position_id = e.position_id
  join public.competencies c on c.id = r.competency_id
  left join best b on b.employee_id = e.id and b.competency_id = c.id
 where e.status = 'active';
