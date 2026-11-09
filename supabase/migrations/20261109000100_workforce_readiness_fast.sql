-- Percepat workforce_readiness (halaman HRGA Kesiapan): sebelumnya fungsi category_valid dipanggil 3x per karyawan dan
-- tiap panggilan memanggil competency_valid per kompetensi. Sekarang semuanya dihitung sekali per tabel (set-based).
-- Kolom dan arti hasil tidak berubah.
create or replace view public.workforce_readiness with (security_invoker = true) as
with cfg as materialized (select app.site_today() as today),
cv as (
  select ec.employee_id,
         bool_or(c.category = 'induction') as induction_ok,
         bool_or(c.category = 'medical') as medical_ok
    from public.employee_competencies ec
    join public.competencies c on c.id = ec.competency_id and c.category in ('induction', 'medical')
    cross join cfg
   where ec.status = 'valid' and coalesce(ec.fitness, 'fit') not in ('unfit', 'temporary_unfit')
     and ec.issued_on <= cfg.today and (ec.valid_until is null or ec.valid_until >= cfg.today)
   group by ec.employee_id
),
fit as (
  select distinct on (ec.employee_id) ec.employee_id, ec.fitness
    from public.employee_competencies ec join public.competencies c on c.id = ec.competency_id
   where c.category = 'medical' and ec.status = 'valid'
   order by ec.employee_id, ec.issued_on desc
),
card as (
  select distinct ic.employee_id from public.id_cards ic cross join cfg
   where ic.status = 'active' and (ic.valid_until is null or ic.valid_until >= cfg.today)
),
ros as (
  select re.employee_id, min(re.code) as code from public.roster_entries re cross join cfg where re.work_date = cfg.today group by re.employee_id
),
ut as (
  select employee_id, array_agg(distinct unit_type order by unit_type) as unit_types
    from public.authorization_register group by employee_id
)
select e.id as employee_id, e.nrp, e.full_name, d.code as department_code, p.name as position_name, p.level, e.employment_type, e.company,
       coalesce(cv.induction_ok, false) as induction_ok,
       coalesce(cv.medical_ok, false) as medical_ok,
       fit.fitness,
       r.required, r.compliant, r.compliance_pct,
       (card.employee_id is not null) as id_card_ok,
       ros.code as roster_today,
       coalesce(ut.unit_types, '{}') as unit_types,
       coalesce(cv.induction_ok, false) and coalesce(cv.medical_ok, false) and (card.employee_id is not null)
         and coalesce(r.compliance_pct, 100) >= 100 as ready
  from public.employees e
  join public.departments d on d.id = e.department_id
  left join public.positions p on p.id = e.position_id
  left join public.employee_register r on r.id = e.id
  left join cv on cv.employee_id = e.id
  left join fit on fit.employee_id = e.id
  left join card on card.employee_id = e.id
  left join ros on ros.employee_id = e.id
  left join ut on ut.employee_id = e.id
 where e.status = 'active';
