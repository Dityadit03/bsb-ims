-- HRIS tahap G: analitik HR. Satu fungsi pembaca (security invoker, tunduk RLS) mengumpulkan angka dari modul tahap A-F
-- untuk dasbor /hrga/analitik. Data gaji hanya ikut bila pemanggil pemegang peran payroll.

create or replace function public.hr_analytics(p_months int default 12, p_dept uuid default null) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  v_today date := app.site_today();
  v_months int := least(greatest(coalesce(p_months, 12), 3), 36);
  v_from date := (date_trunc('month', v_today) - make_interval(months => least(greatest(coalesce(p_months, 12), 3), 36) - 1))::date;
  v_monthly jsonb;
  v_dept jsonb;
  v_tenure jsonb;
  v_age jsonb;
  v_recruit jsonb;
  v_perf jsonb;
  v_lms jsonb;
  v_cost jsonb := null;
  v_contracts jsonb;
  v_cycle uuid;
begin
  if not app.is_hr() then raise exception 'Analitik HR hanya untuk HRGA' using errcode = '42501'; end if;

  -- tren bulanan: headcount akhir bulan, masuk/keluar, turnover, kehadiran, lembur, cuti
  with m as (
    select g::date as month_start, (g + interval '1 month' - interval '1 day')::date as month_end
      from generate_series(v_from, date_trunc('month', v_today)::date, interval '1 month') g),
  e as (select * from public.employees where p_dept is null or department_id = p_dept),
  hc as (
    select m.month_start,
           (select count(*) from e where (e.join_date is null or e.join_date <= m.month_end) and (e.exit_date is null or e.exit_date > m.month_end))::int as headcount,
           (select count(*) from e where e.join_date between m.month_start and m.month_end)::int as joins,
           (select count(*) from e where e.exit_date between m.month_start and m.month_end)::int as exits
      from m),
  att as (
    select date_trunc('month', a.work_date)::date as month_start,
           count(*) filter (where a.status in ('hadir','terlambat','masuk_off'))::int as present,
           count(*) filter (where a.status = 'terlambat')::int as late,
           count(*) filter (where a.status = 'alpa')::int as absent,
           count(*) filter (where a.status in ('hadir','terlambat','alpa','sakit','izin','cuti'))::int as scheduled
      from public.attendance_daily a
     where a.work_date between v_from and v_today and (p_dept is null or a.department_id = p_dept)
     group by 1),
  ot as (
    select date_trunc('month', o.work_date)::date as month_start, sum(o.hours) as hours
      from public.overtime_requests o join e on e.id = o.employee_id
     where o.status = 'approved' and o.work_date between v_from and v_today group by 1),
  lv as (
    select date_trunc('month', r.start_date)::date as month_start, sum(r.days) as days
      from public.leave_requests r join e on e.id = r.employee_id
     where r.status = 'approved' and r.start_date between v_from and v_today group by 1)
  select jsonb_agg(jsonb_build_object(
           'month', to_char(hc.month_start, 'YYYY-MM'), 'headcount', hc.headcount, 'joins', hc.joins, 'exits', hc.exits,
           'turnover_pct', case when hc.headcount > 0 then round(100.0 * hc.exits / hc.headcount, 2) end,
           'present', coalesce(att.present, 0), 'late', coalesce(att.late, 0), 'absent', coalesce(att.absent, 0),
           'absent_pct', case when coalesce(att.scheduled, 0) > 0 then round(100.0 * att.absent / att.scheduled, 2) end,
           'late_pct', case when coalesce(att.present, 0) > 0 then round(100.0 * att.late / att.present, 2) end,
           'overtime_hours', coalesce(ot.hours, 0), 'leave_days', coalesce(lv.days, 0)) order by hc.month_start)
    into v_monthly
    from hc left join att using (month_start) left join ot using (month_start) left join lv using (month_start);

  -- per departemen (karyawan aktif)
  select coalesce(jsonb_agg(x order by x->>'department'), '[]') into v_dept from (
    select jsonb_build_object('department', d.code, 'headcount', count(*)::int,
             'permanent', count(*) filter (where e.employment_type = 'permanent')::int,
             'contract', count(*) filter (where e.employment_type = 'contract')::int,
             'subcon', count(*) filter (where e.employment_type = 'subcon')::int,
             'ready', count(*) filter (where w.ready)::int,
             'avg_tenure_years', round(avg((v_today - e.join_date) / 365.25) filter (where e.join_date is not null), 1),
             'exits_12m', (select count(*) from public.employees x where x.department_id = d.id and x.exit_date > v_today - 365)::int) as x
      from public.employees e
      join public.departments d on d.id = e.department_id
      left join public.workforce_readiness w on w.employee_id = e.id
     where e.status = 'active' and (p_dept is null or e.department_id = p_dept)
     group by d.id, d.code) t;

  -- masa kerja & usia (usia dari data pribadi, hanya HRGA)
  select coalesce(jsonb_agg(jsonb_build_object('band', b, 'n', n) order by o), '[]') into v_tenure from (
    select case when e.join_date is null then 'Tanpa data' when v_today - e.join_date < 365 then '< 1 th' when v_today - e.join_date < 365 * 3 then '1-3 th'
                when v_today - e.join_date < 365 * 5 then '3-5 th' else '> 5 th' end as b,
           case when e.join_date is null then 9 when v_today - e.join_date < 365 then 1 when v_today - e.join_date < 365 * 3 then 2
                when v_today - e.join_date < 365 * 5 then 3 else 4 end as o, count(*)::int as n
      from public.employees e where e.status = 'active' and (p_dept is null or e.department_id = p_dept) group by 1, 2) t;
  select coalesce(jsonb_agg(jsonb_build_object('band', b, 'n', n) order by o), '[]') into v_age from (
    select case when p.birth_date is null then 'Tanpa data' when age(v_today, p.birth_date) < interval '25 years' then '< 25'
                when age(v_today, p.birth_date) < interval '35 years' then '25-34' when age(v_today, p.birth_date) < interval '45 years' then '35-44'
                when age(v_today, p.birth_date) < interval '55 years' then '45-54' else '55+' end as b,
           case when p.birth_date is null then 9 when age(v_today, p.birth_date) < interval '25 years' then 1
                when age(v_today, p.birth_date) < interval '35 years' then 2 when age(v_today, p.birth_date) < interval '45 years' then 3
                when age(v_today, p.birth_date) < interval '55 years' then 4 else 5 end as o, count(*)::int as n
      from public.employees e left join public.employee_private p on p.employee_id = e.id
     where e.status = 'active' and (p_dept is null or e.department_id = p_dept) group by 1, 2) t;

  -- kontrak
  select jsonb_build_object('expired', count(*) filter (where contract_status = 'expired')::int, 'expiring', count(*) filter (where contract_status = 'expiring')::int,
                            'active', count(*) filter (where contract_status = 'active')::int, 'permanent', count(*) filter (where contract_status = 'permanent')::int)
    into v_contracts from public.contract_register where p_dept is null or department_code = (select code from public.departments where id = p_dept);

  -- rekrutmen
  select jsonb_build_object(
    'open_requisitions', (select count(*) from public.requisition_register where status = 'open' and (p_dept is null or department_id = p_dept))::int,
    'open_headcount', (select coalesce(sum(headcount - hired), 0) from public.requisition_register where status = 'open' and (p_dept is null or department_id = p_dept))::int,
    'overdue', (select count(*) from public.requisition_register where overdue and (p_dept is null or department_id = p_dept))::int,
    'avg_days_to_fill', (select round(avg(extract(epoch from q.closed_at - q.approved_at) / 86400)::numeric, 1)
                           from public.job_requisitions q where q.status = 'filled' and q.approved_at is not null and q.closed_at >= v_from
                             and (p_dept is null or q.department_id = p_dept)),
    'filled_period', (select count(*) from public.job_requisitions q where q.status = 'filled' and q.closed_at >= v_from and (p_dept is null or q.department_id = p_dept))::int,
    'funnel', (select coalesce(jsonb_object_agg(stage, n), '{}') from (
                 select a.stage, count(*)::int n from public.application_register a
                  where a.created_at >= v_from and (p_dept is null or a.department_id = p_dept) group by a.stage) f),
    'local_pct', (select round(100.0 * count(*) filter (where is_local) / nullif(count(*), 0), 1) from public.application_register a
                   where a.stage = 'hired' and a.created_at >= v_from and (p_dept is null or a.department_id = p_dept)))
    into v_recruit;

  -- kinerja: siklus terbaru yang sudah ditutup
  select id into v_cycle from public.perf_cycles where status = 'closed' order by period_end desc limit 1;
  select jsonb_build_object('cycle', (select name from public.perf_cycles where id = v_cycle),
    'grades', (select coalesce(jsonb_object_agg(g, n), '{}') from (
                 select r.final_grade g, count(*)::int n from public.perf_review_register r
                  where r.cycle_id = v_cycle and r.final_grade is not null and (p_dept is null or r.department_id = p_dept) group by 1) t),
    'avg_score', (select round(avg(final_score), 2) from public.perf_review_register r where r.cycle_id = v_cycle and (p_dept is null or r.department_id = p_dept)),
    'participants', (select count(*) from public.perf_review_register r where r.cycle_id = v_cycle and (p_dept is null or r.department_id = p_dept))::int)
    into v_perf;

  -- e-learning & kompetensi
  select jsonb_build_object(
    'assigned', count(*)::int, 'completed', count(*) filter (where status = 'completed')::int, 'overdue', count(*) filter (where status = 'overdue')::int,
    'avg_best_score', round(avg(best_score), 1),
    'competency_pct', (select round(avg(compliance_pct), 1) from public.workforce_readiness w where p_dept is null or exists(
                         select 1 from public.employees e where e.id = w.employee_id and e.department_id = p_dept)))
    into v_lms
    from public.course_assignment_register a
   where p_dept is null or exists(select 1 from public.employees e where e.id = a.employee_id and e.department_id = p_dept);

  -- biaya tenaga kerja: proses gaji terbit (bukan uji paralel), hanya payroll
  if app.is_payroll() then
    select jsonb_agg(jsonb_build_object('period', t.period, 'employer_cost', t.cost, 'net', t.net, 'overtime_hours', t.ot, 'headcount', t.hc) order by t.period)
      into v_cost from (
        select r.period, sum(c.employer_cost) cost, sum(c.net) net, sum(c.overtime_hours) ot, sum(c.headcount)::int hc
          from public.payroll_cost_recap c join public.payroll_runs r on r.id = c.run_id
         where r.status = 'published' and not r.parallel and r.period >= to_char(v_from, 'YYYY-MM')
           and (p_dept is null or c.department_code = (select code from public.departments where id = p_dept))
         group by r.period) t;
  end if;

  return jsonb_build_object('generated_on', v_today, 'from', v_from, 'monthly', coalesce(v_monthly, '[]'), 'departments', v_dept,
    'tenure', v_tenure, 'age', v_age, 'contracts', v_contracts, 'recruitment', v_recruit, 'performance', v_perf, 'learning', v_lms, 'cost', v_cost);
end $$;

revoke all on function public.hr_analytics(int, uuid) from public, anon;
grant execute on function public.hr_analytics(int, uuid) to authenticated;
