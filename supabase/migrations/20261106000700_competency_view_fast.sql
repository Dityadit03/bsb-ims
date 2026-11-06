-- Percepat employee_competency_view (dipakai lonceng, beranda, kompetensi): tanggal hari ini dan ambang peringatan
-- dihitung SEKALI (CTE materialized), bukan dua kali per baris (app.site_today() mahal). Kolom dan arti hasil tidak berubah.
create or replace view public.employee_competency_view with (security_invoker = true) as
with cfg as materialized (
  select app.site_today() as today,
         coalesce((select value::text::int from public.app_settings where key = 'competency_warning_days'), 30) as days
)
select ec.id, ec.employee_id, e.nrp, e.full_name, e.department_id, d.code as department_code, ec.competency_id, c.code as competency_code,
       c.name as competency_name, c.category, c.unit_type, ec.cert_no, ec.issuer, ec.issued_on, ec.valid_until, ec.status, ec.revoke_reason,
       ec.training_id,
       case when ec.status = 'revoked' then 'revoked'
            when ec.valid_until is not null and ec.valid_until < cfg.today then 'expired'
            when coalesce(ec.fitness, 'fit') in ('unfit', 'temporary_unfit') then 'unfit'
            when ec.valid_until is not null and ec.valid_until - cfg.today <= cfg.days then 'expiring'
            else 'valid' end as validity,
       ec.valid_until - cfg.today as days_left,
       ec.fitness, ec.fitness_note, ec.license_class
  from public.employee_competencies ec
  join public.employees e on e.id = ec.employee_id
  join public.departments d on d.id = e.department_id
  join public.competencies c on c.id = ec.competency_id
  cross join cfg;
