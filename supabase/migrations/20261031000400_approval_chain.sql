-- Penunjukan pejabat persetujuan menurut data manpower.
-- Peran approver (DEPT_HEAD, PJO, MGMT_APPROVER, dst.) ditetapkan untuk KARYAWAN, bukan untuk akun. Begitu karyawan
-- punya akun (employees.profile_id terisi), peran otomatis diberikan; bila penunjukan dicabut atau karyawan keluar,
-- peran ikut dicabut. Atasan langsung (employees.supervisor_id) diisi dari penunjukan ini.

create table public.approver_designations(
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  role_code text not null references public.roles(code),
  department_id uuid references public.departments(id),
  basis text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  unique nulls not distinct (employee_id, role_code, department_id)
);
create index approver_designations_emp_idx on public.approver_designations(employee_id);

alter table public.approver_designations enable row level security;
revoke all on public.approver_designations from anon;
create policy approver_designations_read on public.approver_designations for select to authenticated
  using (app.is_active_user());
create trigger approver_designations_audit after insert or update or delete on public.approver_designations
  for each row execute function app.audit_row();

-- Berikan peran bila karyawan sudah punya akun aktif
create function app.grant_designation(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare d public.approver_designations; v_profile uuid;
begin
  select * into d from public.approver_designations where id = p_id;
  if not found then return; end if;
  select e.profile_id into v_profile from public.employees e where e.id = d.employee_id and e.status = 'active';
  if v_profile is null then return; end if;
  insert into public.user_roles(user_id, role_code, department_id, basis, granted_by)
  values (v_profile, d.role_code, d.department_id, coalesce('Penunjukan manpower: ' || d.basis, 'Penunjukan manpower'), d.created_by)
  on conflict do nothing;
end $$;

create function app.designation_after_insert() returns trigger language plpgsql security definer set search_path = public as $$
begin perform app.grant_designation(new.id); return new; end $$;
create trigger approver_designations_grant after insert on public.approver_designations
  for each row execute function app.designation_after_insert();

create function app.designation_after_delete() returns trigger language plpgsql security definer set search_path = public as $$
declare v_profile uuid;
begin
  select profile_id into v_profile from public.employees where id = old.employee_id;
  if v_profile is not null then
    delete from public.user_roles where user_id = v_profile and role_code = old.role_code
      and department_id is not distinct from old.department_id;
  end if;
  return old;
end $$;
create trigger approver_designations_revoke after delete on public.approver_designations
  for each row execute function app.designation_after_delete();

-- Akun baru tertaut ke karyawan -> peran penunjukan diberikan; karyawan tidak aktif -> peran dicabut
create function app.employee_designation_sync() returns trigger language plpgsql security definer set search_path = public as $$
declare d record;
begin
  if new.status = 'active' and new.profile_id is not null
     and (old.profile_id is distinct from new.profile_id or old.status is distinct from new.status) then
    for d in select id from public.approver_designations where employee_id = new.id loop
      perform app.grant_designation(d.id);
    end loop;
  elsif new.status <> 'active' and old.status = 'active' and new.profile_id is not null then
    delete from public.user_roles ur using public.approver_designations a
     where a.employee_id = new.id and ur.user_id = new.profile_id and ur.role_code = a.role_code
       and ur.department_id is not distinct from a.department_id;
  end if;
  return new;
end $$;
create trigger employees_designation_sync after update of profile_id, status on public.employees
  for each row execute function app.employee_designation_sync();

create function public.designate_approver(p_employee uuid, p_role text, p_department uuid default null, p_basis text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; e public.employees;
begin
  if not app.has_permission('user.manage') then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  select * into e from public.employees where id = p_employee;
  if not found then raise exception 'Karyawan tidak ditemukan' using errcode = '22023'; end if;
  if e.status <> 'active' then raise exception 'Karyawan % tidak aktif', e.full_name using errcode = '22023'; end if;
  if e.profile_id = auth.uid() then raise exception 'Tidak bisa menunjuk diri sendiri' using errcode = '42501'; end if;
  if p_role not in ('DEPT_HEAD','SUPERINTENDENT','SUPERVISOR','PJO','MGMT_APPROVER','HSE_MANAGER','DOC_CONTROLLER') then
    raise exception 'Peran % tidak termasuk peran approver', p_role using errcode = '22023';
  end if;
  if p_role in ('DEPT_HEAD','SUPERINTENDENT','SUPERVISOR','HSE_MANAGER') and p_department is null then
    raise exception 'Peran % harus untuk satu departemen', p_role using errcode = '22023';
  end if;
  insert into public.approver_designations(employee_id, role_code, department_id, basis, created_by)
  values (p_employee, p_role, p_department, nullif(btrim(p_basis), ''), auth.uid())
  on conflict (employee_id, role_code, department_id) do update set basis = excluded.basis
  returning id into v_id;
  perform app.grant_designation(v_id);
  perform app.log_event('approver.designate', 'approver_designations', v_id::text, jsonb_build_object('employee', p_employee, 'role', p_role));
  return v_id;
end $$;

create function public.undesignate_approver(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not app.has_permission('user.manage') then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if exists(select 1 from public.approver_designations a join public.employees e on e.id = a.employee_id
             where a.id = p_id and e.profile_id = auth.uid()) then
    raise exception 'Tidak bisa mencabut penunjukan diri sendiri' using errcode = '42501';
  end if;
  delete from public.approver_designations where id = p_id;
  perform app.log_event('approver.undesignate', 'approver_designations', p_id::text, null);
end $$;

-- Isi atasan langsung yang masih kosong dari penunjukan: SPV/FOR/SH di departemen -> Kepala Departemen;
-- Kepala Departemen -> PJO. Operator/staf tidak diisi otomatis (atasannya diatur HRGA per orang).
create function public.fill_supervisors() returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; c int;
begin
  if not (app.has_permission('user.manage') or app.is_hr()) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  update public.employees e set supervisor_id = h.employee_id
    from public.approver_designations h, public.positions p
   where h.role_code = 'DEPT_HEAD' and h.department_id = e.department_id
     and p.id = e.position_id and p.level in ('SH','SPV','FOR')
     and e.supervisor_id is null and e.status = 'active' and e.id <> h.employee_id;
  get diagnostics c = row_count; n := n + c;
  update public.employees e set supervisor_id = j.employee_id
    from public.approver_designations j
   where j.role_code = 'PJO' and e.supervisor_id is null and e.status = 'active' and e.id <> j.employee_id
     and exists(select 1 from public.approver_designations h where h.employee_id = e.id and h.role_code = 'DEPT_HEAD');
  get diagnostics c = row_count; n := n + c;
  perform app.log_event('approver.fill_supervisors', 'employees', null, jsonb_build_object('updated', n));
  return n;
end $$;

-- Tampilan alur: siapa memegang peran apa, dan apakah sudah punya akun
create view public.approval_chain with (security_invoker = true) as
select a.id, a.role_code, d.code as department, e.id as employee_id, e.nrp, e.full_name, p.name as position, p.level,
       (e.profile_id is not null) as has_account, a.basis
  from public.approver_designations a
  join public.employees e on e.id = a.employee_id
  left join public.positions p on p.id = e.position_id
  left join public.departments d on d.id = a.department_id;

-- Penunjukan awal (keputusan Ad 2026-10-31), dicocokkan menurut nama pada data manpower
insert into public.approver_designations(employee_id, role_code, department_id, basis)
select e.id, v.role, (select id from public.departments where code = v.dept), 'Keputusan manajemen 2026-10-31'
  from (values
    ('Simon Pubra', 'PJO', null), ('Simon Pubra', 'MGMT_APPROVER', null),
    ('Bowo Pribowonto', 'DEPT_HEAD', 'PLT'),
    ('Muhammad Risky Adia Pratama', 'DEPT_HEAD', 'HSE'),
    ('Bambang Adi Pramono', 'DEPT_HEAD', 'HRGA'),
    ('M. Yasin', 'DEPT_HEAD', 'PRD'),
    ('Dani Hamdani', 'DEPT_HEAD', 'LOG')
  ) as v(name, role, dept)
  join public.employees e on e.full_name = v.name and e.status = 'active'
on conflict do nothing;

grant select on public.approval_chain to authenticated;
grant select on public.approver_designations to authenticated;

revoke execute on function public.designate_approver(uuid, text, uuid, text), public.undesignate_approver(uuid), public.fill_supervisors() from public, anon;
grant execute on function public.designate_approver(uuid, text, uuid, text), public.undesignate_approver(uuid), public.fill_supervisors() to authenticated;
