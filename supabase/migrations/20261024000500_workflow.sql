-- BSB IMS · M1 · Workflow engine
-- Alur approval dikonfigurasi sebagai data (langkah berversi), bukan di kode. Setiap langkah menyebut izin yang
-- dibutuhkan dan lingkupnya; siapa pun yang memegang izin itu (atau delegasinya) di departemen terkait bisa bertindak.
-- Pemisahan tugas: satu orang tidak boleh bertindak di dua langkah pada instance yang sama, dan pemohon tidak boleh menyetujui.

insert into public.permissions(code, module, description) values
  ('document.approve_policy','document','Menyetujui kebijakan dan manual (pimpinan tertinggi / PJO)'),
  ('workflow.configure','workflow','Mengatur definisi workflow dan matriks kewenangan'),
  ('workflow.delegate','workflow','Membuat delegasi kewenangan approval');
insert into public.role_permissions(role_code, permission_code) values
  ('PJO','document.approve_policy'), ('MGMT_APPROVER','document.approve_policy'),
  ('SYS_ADMIN','workflow.configure'),
  ('DEPT_HEAD','workflow.delegate'), ('PJO','workflow.delegate'), ('HSE_MANAGER','workflow.delegate'), ('SUPERINTENDENT','workflow.delegate');

create table public.workflow_definitions(
  code text primary key check (code ~ '^[A-Z_]{2,30}$'),
  name text not null,
  module text not null,
  on_event text check (on_event ~ '^app\.[a-z_]+$'),   -- fungsi app.* yang dipanggil saat langkah berpindah/selesai
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- steps: [{ "key": "review", "name": "Review teknis", "kind": "review|verify|approve",
--           "permission": "document.review", "scope": "department|any", "sla_hours": 48 }]
create table public.workflow_versions(
  id uuid primary key default gen_random_uuid(),
  definition_code text not null references public.workflow_definitions(code),
  version int not null,
  steps jsonb not null check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) > 0),
  active boolean not null default true,
  basis text,                                -- dasar pengesahan matriks kewenangan
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (definition_code, version)
);
create unique index workflow_versions_one_active on public.workflow_versions(definition_code) where active;

create table public.workflow_instances(
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.workflow_versions(id),
  definition_code text not null references public.workflow_definitions(code),
  subject_table text not null,
  subject_id uuid not null,
  subject_hash text,                         -- sidik isi yang sedang disetujui (mis. SHA-256 berkas)
  department_id uuid references public.departments(id),
  site_id uuid references public.sites(id),
  initiator_id uuid not null references public.profiles(id),
  status text not null default 'in_progress' check (status in ('in_progress','approved','returned','rejected','cancelled')),
  current_step int not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index workflow_instances_subject_idx on public.workflow_instances(subject_table, subject_id);
create unique index workflow_instances_one_running on public.workflow_instances(subject_table, subject_id) where status = 'in_progress';

create table public.workflow_tasks(
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.workflow_instances(id),
  step_index int not null,
  step_key text not null,
  step_name text not null,
  step_kind text not null,
  permission_code text not null references public.permissions(code),
  department_id uuid references public.departments(id),
  status text not null default 'open' check (status in ('open','done','cancelled')),
  due_at timestamptz,
  escalated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (instance_id, step_index)
);
create index workflow_tasks_open_idx on public.workflow_tasks(permission_code, department_id) where status = 'open';

create table public.approval_events(
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.workflow_instances(id),
  task_id uuid not null references public.workflow_tasks(id),
  actor_id uuid not null references public.profiles(id),
  on_behalf_of uuid references public.profiles(id),
  decision text not null check (decision in ('approve','return','reject')),
  comment text,
  subject_hash text,
  acted_at timestamptz not null default now(),
  check (decision = 'approve' or coalesce(btrim(comment), '') <> '')
);
create index approval_events_instance_idx on public.approval_events(instance_id);

create table public.delegations(
  id uuid primary key default gen_random_uuid(),
  delegator_id uuid not null references public.profiles(id),
  delegate_id uuid not null references public.profiles(id),
  permission_code text not null references public.permissions(code),
  department_id uuid references public.departments(id),
  valid_from timestamptz not null default now(),
  valid_until timestamptz not null,
  basis text not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (delegator_id <> delegate_id),
  check (valid_until > valid_from)
);

create table public.notifications(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);

-- ---------------------------------------------------------------- otorisasi tindakan
-- Mengembalikan id pemberi kewenangan: actor sendiri bila punya izin, delegator bila lewat delegasi, null bila tidak berwenang.
create or replace function app.task_authority(p_task public.workflow_tasks, p_actor uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select case
    when exists(
      select 1 from public.user_roles ur
        join public.role_permissions rp on rp.role_code = ur.role_code
        join public.profiles p on p.id = ur.user_id and p.status = 'active'
       where ur.user_id = p_actor and rp.permission_code = p_task.permission_code
         and current_date between ur.valid_from and coalesce(ur.valid_until, 'infinity'::date)
         and (ur.department_id is null or ur.department_id = p_task.department_id))
    then p_actor
    else (
      select d.delegator_id from public.delegations d
        join public.user_roles ur on ur.user_id = d.delegator_id
        join public.role_permissions rp on rp.role_code = ur.role_code and rp.permission_code = d.permission_code
       where d.delegate_id = p_actor and d.permission_code = p_task.permission_code and d.revoked_at is null
         and now() between d.valid_from and d.valid_until
         and (d.department_id is null or d.department_id = p_task.department_id)
         and (ur.department_id is null or ur.department_id = p_task.department_id)
         and exists(select 1 from public.profiles where id = p_actor and status = 'active')
       limit 1)
  end
$$;

create or replace function app.notify_task(p_task public.workflow_tasks, p_title text, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications(user_id, kind, title, body, link)
  select distinct ur.user_id, 'workflow.task', p_title, p_task.step_name, p_link
    from public.user_roles ur
    join public.role_permissions rp on rp.role_code = ur.role_code and rp.permission_code = p_task.permission_code
    join public.profiles p on p.id = ur.user_id and p.status = 'active'
   where current_date between ur.valid_from and coalesce(ur.valid_until, 'infinity'::date)
     and (ur.department_id is null or ur.department_id = p_task.department_id)
$$;

create or replace function app.workflow_emit(p_instance public.workflow_instances, p_event text)
returns void language plpgsql security definer set search_path = public as $$
declare v_fn text;
begin
  select on_event into v_fn from public.workflow_definitions where code = p_instance.definition_code;
  if v_fn is not null then
    execute format('select %s($1, $2)', v_fn) using p_instance.id, p_event;
  end if;
end $$;

create or replace function app.open_step(p_instance public.workflow_instances, p_index int)
returns public.workflow_tasks language plpgsql security definer set search_path = public as $$
declare
  v_steps jsonb;
  v_step jsonb;
  v_task public.workflow_tasks;
begin
  select steps into v_steps from public.workflow_versions where id = p_instance.version_id;
  v_step := v_steps -> p_index;
  insert into public.workflow_tasks(instance_id, step_index, step_key, step_name, step_kind, permission_code, department_id, due_at)
  values (p_instance.id, p_index, v_step->>'key', v_step->>'name', v_step->>'kind', v_step->>'permission',
          case when coalesce(v_step->>'scope', 'department') = 'department' then p_instance.department_id end,
          now() + make_interval(hours => coalesce((v_step->>'sla_hours')::int, 72)))
  returning * into v_task;
  update public.workflow_instances set current_step = p_index where id = p_instance.id;
  perform app.notify_task(v_task, 'Tugas baru: ' || v_task.step_name, '/tugas');
  return v_task;
end $$;

-- Dipanggil fungsi modul (mis. pengajuan dokumen). Tidak diekspos langsung ke klien.
create or replace function app.start_workflow(
  p_definition text, p_subject_table text, p_subject_id uuid, p_department uuid, p_subject_hash text default null)
returns public.workflow_instances language plpgsql security definer set search_path = public as $$
declare
  v_ver public.workflow_versions;
  v_inst public.workflow_instances;
begin
  select * into v_ver from public.workflow_versions where definition_code = p_definition and active;
  if not found then raise exception 'Workflow % belum dikonfigurasi', p_definition using errcode = '22023'; end if;
  insert into public.workflow_instances(version_id, definition_code, subject_table, subject_id, subject_hash, department_id, initiator_id)
  values (v_ver.id, p_definition, p_subject_table, p_subject_id, p_subject_hash, p_department, auth.uid())
  returning * into v_inst;
  perform app.open_step(v_inst, 0);
  perform app.log_event('workflow.start', p_subject_table, p_subject_id::text, jsonb_build_object('workflow', p_definition, 'instance', v_inst.id));
  return v_inst;
end $$;

create or replace function public.act_on_task(p_task uuid, p_decision text, p_comment text default null, p_subject_hash text default null)
returns public.workflow_instances language plpgsql security definer set search_path = public as $$
declare
  v_task public.workflow_tasks;
  v_inst public.workflow_instances;
  v_authority uuid;
  v_steps int;
begin
  select * into v_task from public.workflow_tasks where id = p_task for update;
  if not found or v_task.status <> 'open' then
    raise exception 'Tugas tidak ditemukan atau sudah diproses' using errcode = 'P0002';
  end if;
  select * into v_inst from public.workflow_instances where id = v_task.instance_id for update;

  v_authority := app.task_authority(v_task, auth.uid());
  if v_authority is null then raise exception 'Anda tidak berwenang pada langkah ini' using errcode = '42501'; end if;
  if v_inst.initiator_id in (auth.uid(), v_authority) then
    raise exception 'Pemohon tidak boleh memproses pengajuannya sendiri' using errcode = '42501';
  end if;
  if exists(select 1 from public.approval_events where instance_id = v_inst.id
              and (actor_id in (auth.uid(), v_authority) or on_behalf_of in (auth.uid(), v_authority))) then
    raise exception 'Satu orang hanya boleh bertindak di satu langkah pada pengajuan yang sama' using errcode = '42501';
  end if;
  if p_decision not in ('approve','return','reject') then raise exception 'Keputusan tidak dikenal' using errcode = '22023'; end if;
  if p_decision <> 'approve' and coalesce(btrim(p_comment), '') = '' then
    raise exception 'Alasan wajib diisi untuk mengembalikan atau menolak' using errcode = '22023';
  end if;
  if p_decision = 'approve' and v_inst.subject_hash is not null and p_subject_hash is distinct from v_inst.subject_hash then
    raise exception 'Isi yang disetujui berbeda dengan yang diajukan; muat ulang lalu periksa kembali' using errcode = '40001';
  end if;

  insert into public.approval_events(instance_id, task_id, actor_id, on_behalf_of, decision, comment, subject_hash)
  values (v_inst.id, v_task.id, auth.uid(), nullif(v_authority, auth.uid()), p_decision, p_comment, p_subject_hash);
  update public.workflow_tasks set status = 'done' where id = v_task.id;

  select jsonb_array_length(steps) into v_steps from public.workflow_versions where id = v_inst.version_id;
  if p_decision = 'approve' and v_task.step_index + 1 < v_steps then
    perform app.open_step(v_inst, v_task.step_index + 1);
    select * into v_inst from public.workflow_instances where id = v_inst.id;
    perform app.workflow_emit(v_inst, 'step:' || (select step_kind from public.workflow_tasks where instance_id = v_inst.id and step_index = v_inst.current_step));
  else
    update public.workflow_instances
       set status = case p_decision when 'approve' then 'approved' when 'return' then 'returned' else 'rejected' end,
           completed_at = now()
     where id = v_inst.id returning * into v_inst;
    perform app.workflow_emit(v_inst, v_inst.status);
    insert into public.notifications(user_id, kind, title, body, link)
    values (v_inst.initiator_id, 'workflow.result',
            case v_inst.status when 'approved' then 'Pengajuan disetujui' when 'returned' then 'Pengajuan dikembalikan untuk revisi' else 'Pengajuan ditolak' end,
            p_comment, '/tugas');
  end if;

  perform app.log_event('workflow.' || p_decision, v_inst.subject_table, v_inst.subject_id::text,
    jsonb_build_object('instance', v_inst.id, 'step', v_task.step_key, 'on_behalf_of', nullif(v_authority, auth.uid())));
  return v_inst;
end $$;

-- Pemohon menarik pengajuan yang masih berjalan.
create or replace function public.cancel_workflow(p_instance uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_inst public.workflow_instances;
begin
  select * into v_inst from public.workflow_instances where id = p_instance for update;
  if v_inst.status <> 'in_progress' then raise exception 'Pengajuan sudah selesai' using errcode = '22023'; end if;
  if v_inst.initiator_id <> auth.uid() and not app.has_permission('workflow.configure') then
    raise exception 'Tidak berwenang' using errcode = '42501';
  end if;
  update public.workflow_tasks set status = 'cancelled' where instance_id = p_instance and status = 'open';
  update public.workflow_instances set status = 'cancelled', completed_at = now() where id = p_instance returning * into v_inst;
  perform app.workflow_emit(v_inst, 'cancelled');
  perform app.log_event('workflow.cancel', v_inst.subject_table, v_inst.subject_id::text, jsonb_build_object('reason', p_reason));
end $$;

-- Kotak tugas: semua tugas terbuka yang bisa diproses pengguna (langsung atau lewat delegasi).
create or replace function public.my_tasks()
returns table(task_id uuid, instance_id uuid, definition_code text, step_name text, step_kind text, subject_table text,
              subject_id uuid, department_id uuid, due_at timestamptz, created_at timestamptz, on_behalf_of uuid)
language sql stable security definer set search_path = public as $$
  select t.id, i.id, i.definition_code, t.step_name, t.step_kind, i.subject_table, i.subject_id, t.department_id, t.due_at, t.created_at,
         nullif(app.task_authority(t, auth.uid()), auth.uid())
    from public.workflow_tasks t
    join public.workflow_instances i on i.id = t.instance_id
   where t.status = 'open'
     and i.initiator_id <> auth.uid()
     and app.task_authority(t, auth.uid()) is not null
     and not exists(select 1 from public.approval_events e where e.instance_id = i.id and e.actor_id = auth.uid())
   order by t.due_at
$$;

create or replace function public.create_delegation(p_delegate uuid, p_permission text, p_department uuid, p_until timestamptz, p_basis text)
returns public.delegations language plpgsql security definer set search_path = public as $$
declare v public.delegations;
begin
  if not app.has_permission('workflow.delegate', p_department) then raise exception 'Tidak berwenang membuat delegasi' using errcode = '42501'; end if;
  if not app.has_permission(p_permission, p_department) then
    raise exception 'Hanya kewenangan yang Anda miliki yang bisa didelegasikan' using errcode = '42501';
  end if;
  if p_until > now() + interval '90 days' then raise exception 'Delegasi maksimal 90 hari' using errcode = '22023'; end if;
  insert into public.delegations(delegator_id, delegate_id, permission_code, department_id, valid_until, basis)
  values (auth.uid(), p_delegate, p_permission, p_department, p_until, p_basis) returning * into v;
  perform app.log_event('workflow.delegate', 'delegations', v.id::text, to_jsonb(v));
  return v;
end $$;

-- SLA: dipanggil pg_cron tiap jam. Tugas lewat tenggat dieskalasi ke pemegang workflow.delegate di departemen yang sama.
create or replace function app.escalate_overdue() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with overdue as (
    update public.workflow_tasks set escalated_at = now()
     where status = 'open' and due_at < now() and escalated_at is null
     returning *
  ), notified as (
    insert into public.notifications(user_id, kind, title, body, link)
    select distinct ur.user_id, 'workflow.overdue', 'Tugas melewati tenggat: ' || o.step_name, null, '/tugas'
      from overdue o
      join public.user_roles ur on (ur.department_id is null or ur.department_id = o.department_id)
      join public.role_permissions rp on rp.role_code = ur.role_code and rp.permission_code = 'workflow.delegate'
    returning 1
  )
  select count(*) into n from overdue;
  return n;
end $$;

-- ---------------------------------------------------------------- RLS
do $$
declare t text;
begin
  foreach t in array array['workflow_definitions','workflow_versions','workflow_instances','workflow_tasks','approval_events','delegations','notifications'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
  foreach t in array array['workflow_definitions','workflow_versions','workflow_instances','workflow_tasks','approval_events','delegations'] loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
  end loop;
end $$;

create policy wf_def_read on public.workflow_definitions for select to authenticated using (app.is_active_user());
create policy wf_def_write on public.workflow_definitions for all to authenticated
  using (app.has_permission('workflow.configure')) with check (app.has_permission('workflow.configure'));
create policy wf_ver_read on public.workflow_versions for select to authenticated using (app.is_active_user());
create policy wf_ver_write on public.workflow_versions for insert to authenticated with check (app.has_permission('workflow.configure'));
create policy wf_inst_read on public.workflow_instances for select to authenticated using (app.is_active_user());
create policy wf_task_read on public.workflow_tasks for select to authenticated using (app.is_active_user());
create policy wf_event_read on public.approval_events for select to authenticated using (app.is_active_user());
create policy delegations_read on public.delegations for select to authenticated
  using (delegator_id = auth.uid() or delegate_id = auth.uid() or app.has_permission('workflow.configure'));
create policy delegations_revoke on public.delegations for update to authenticated
  using (delegator_id = auth.uid()) with check (delegator_id = auth.uid());
create policy notifications_own on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke insert, delete on public.notifications from authenticated;
revoke insert, update, delete on public.workflow_instances, public.workflow_tasks, public.approval_events from authenticated;

revoke all on function app.start_workflow(text, text, uuid, uuid, text), app.open_step(public.workflow_instances, int),
  app.escalate_overdue() from public, anon, authenticated;
grant execute on function public.act_on_task(uuid, text, text, text), public.cancel_workflow(uuid, text),
  public.my_tasks(), public.create_delegation(uuid, text, uuid, timestamptz, text) to authenticated;
revoke execute on function public.act_on_task(uuid, text, text, text), public.cancel_workflow(uuid, text),
  public.my_tasks(), public.create_delegation(uuid, text, uuid, timestamptz, text) from anon;
