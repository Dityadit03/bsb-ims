-- BSB IMS · M9 · Audit internal SMKP (5.6), tinjauan manajemen (7) dan dashboard eksekutif.
-- Auditor tidak mengaudit departemennya sendiri; temuan mayor/minor wajib punya action plan sebelum audit ditutup;
-- tinjauan manajemen wajib membahas semua masukan baku dan minimal sekali setahun.

insert into public.permissions(code, module, description) values
  ('ia.manage','audit','Menyusun program audit internal dan menutup audit'),
  ('ia.perform','audit','Melaksanakan audit internal dan mencatat temuan'),
  ('mgmt.review','management','Menyelenggarakan tinjauan manajemen');

insert into public.role_permissions(role_code, permission_code)
select r, p from (values
  ('HSE_MANAGER','ia.manage'), ('PJO','ia.manage'), ('MGMT_APPROVER','ia.manage'),
  ('INTERNAL_AUDITOR','ia.perform'), ('HSE_MANAGER','ia.perform'), ('DEPT_HEAD','ia.perform'), ('SUPERINTENDENT','ia.perform'),
  ('PJO','mgmt.review'), ('MGMT_APPROVER','mgmt.review'), ('HSE_MANAGER','mgmt.review')
) as x(r, p);

insert into public.numbering_schemes(code, name, pattern, module) values
  ('AUD','Audit internal','AUD-BSB-{YYYY}-{N3}','audit'),
  ('RTM','Rapat tinjauan manajemen','RTM-BSB-{YYYY}-{N2}','management');

insert into public.app_settings(key, value, description) values
  ('management_review_max_days', '365', 'Batas hari antar tinjauan manajemen (minimal sekali setahun)');

-- ---------------------------------------------------------------- audit internal
create table public.internal_audits(
  id uuid primary key default gen_random_uuid(),
  audit_no text not null unique,
  title text not null,
  framework_code text not null references public.compliance_frameworks(code),
  scope text not null,
  auditee_department_id uuid references public.departments(id),
  planned_start date not null,
  planned_end date not null,
  lead_auditor_id uuid not null references public.profiles(id),
  status text not null default 'planned' check (status in ('planned','in_progress','reported','closed','cancelled')),
  started_at timestamptz,
  report_summary text,
  reported_at timestamptz,
  closed_at timestamptz,
  closed_by uuid references public.profiles(id),
  cancel_reason text,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (planned_end >= planned_start)
);

create table public.audit_team(
  audit_id uuid not null references public.internal_audits(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  team_role text not null check (team_role in ('lead','member')),
  primary key (audit_id, user_id)
);

create table public.audit_findings(
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.internal_audits(id),
  finding_no int not null,
  clause_id uuid not null references public.compliance_clauses(id),
  category text not null check (category in ('major','minor','observation','ofi')),
  department_id uuid not null references public.departments(id),
  statement text not null,
  evidence text not null,
  recorded_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (audit_id, finding_no)
);

-- ---------------------------------------------------------------- tinjauan manajemen
create table public.management_reviews(
  id uuid primary key default gen_random_uuid(),
  review_no text not null unique,
  title text not null,
  meeting_date date not null,
  chair_id uuid not null references public.profiles(id),
  status text not null default 'draft' check (status in ('draft','held','closed')),
  attendees text,
  conclusion text,
  performance_snapshot jsonb,
  held_at timestamptz,
  closed_at timestamptz,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- Masukan baku tinjauan manajemen (ISO 9.3 / SMKP elemen 7)
create table public.management_review_topics(
  code text primary key,
  name text not null,
  required boolean not null default true,
  sort_order int not null
);
insert into public.management_review_topics(code, name, required, sort_order) values
  ('previous_actions','Status tindak lanjut tinjauan sebelumnya',true,1),
  ('context','Perubahan isu internal/eksternal dan peraturan',true,2),
  ('objectives','Pencapaian sasaran dan program keselamatan',true,3),
  ('performance','Kinerja keselamatan, lingkungan dan operasional',true,4),
  ('incidents','Kecelakaan, kejadian berbahaya, ketidaksesuaian dan tindakan perbaikan',true,5),
  ('audit','Hasil audit internal dan eksternal',true,6),
  ('compliance','Evaluasi kepatuhan peraturan',true,7),
  ('consultation','Hasil komunikasi, konsultasi dan partisipasi pekerja',true,8),
  ('resources','Kecukupan sumber daya',true,9),
  ('risks','Risiko dan peluang',true,10),
  ('improvement','Peluang perbaikan berkelanjutan',true,11);

create table public.management_review_items(
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.management_reviews(id) on delete cascade,
  topic_code text not null references public.management_review_topics(code),
  discussion text not null,
  decision text,
  action_required boolean not null default false,
  clause_id uuid references public.compliance_clauses(id),
  department_id uuid references public.departments(id),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (review_id, topic_code),
  check (not action_required or (coalesce(btrim(decision), '') <> '' and clause_id is not null and department_id is not null))
);

do $$
declare t text;
begin
  foreach t in array array['internal_audits','management_reviews'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['internal_audits','audit_team','audit_findings','management_reviews','management_review_topics','management_review_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create policy %I_read on public.%I for select to authenticated using (app.is_active_user())', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
  end loop;
end $$;
revoke insert, update, delete on public.internal_audits, public.audit_team, public.audit_findings, public.management_reviews,
  public.management_review_topics, public.management_review_items from authenticated;

-- Sumber action plan: temuan audit dan keputusan tinjauan manajemen
alter table public.evidence_links drop constraint evidence_links_source_table_check;
alter table public.evidence_links add constraint evidence_links_source_table_check check (source_table in
  ('documents','attachments','corrective_actions','legal_evaluations','risk_register','inspections','incidents',
   'internal_audits','management_reviews'));

create or replace function app.source_exists(p_table text, p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_table
    when 'documents' then exists(select 1 from public.documents where id = p_id and status in ('effective','under_revision'))
    when 'attachments' then exists(select 1 from public.attachments where id = p_id)
    when 'corrective_actions' then exists(select 1 from public.corrective_actions where id = p_id and status = 'closed')
    when 'legal_evaluations' then exists(select 1 from public.legal_evaluations where id = p_id)
    when 'risk_register' then exists(select 1 from public.risk_register where id = p_id and status = 'approved')
    when 'inspections' then exists(select 1 from public.inspections where id = p_id)
    when 'incidents' then exists(select 1 from public.incidents where id = p_id and status = 'closed')
    when 'internal_audits' then exists(select 1 from public.internal_audits where id = p_id and status = 'closed')
    when 'management_reviews' then exists(select 1 from public.management_reviews where id = p_id and status = 'closed')
    else false end
$$;
revoke all on function app.source_exists(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- pembantu
-- Auditor independen: tidak memegang peran di departemen auditee (peran tanpa departemen dianggap tidak independen
-- hanya bila auditee site-wide tidak ditentukan — audit site-wide boleh dilakukan siapa pun yang berwenang).
create or replace function app.auditor_independent(p_user uuid, p_department uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_department is null or not exists(
    select 1 from public.user_roles ur
     where ur.user_id = p_user and ur.department_id = p_department
       and current_date >= ur.valid_from and (ur.valid_until is null or current_date <= ur.valid_until))
$$;

create or replace function app.can_audit(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.user_roles ur join public.role_permissions rp on rp.role_code = ur.role_code
                  join public.profiles p on p.id = ur.user_id
                 where ur.user_id = p_user and p.status = 'active' and rp.permission_code = 'ia.perform'
                   and current_date >= ur.valid_from and (ur.valid_until is null or current_date <= ur.valid_until))
$$;

create or replace function app.audit_member(p_audit uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.audit_team where audit_id = p_audit and user_id = auth.uid())
$$;

-- Temuan mayor/minor yang belum punya action plan aktif
create or replace function app.finding_needs_capa(p_finding uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.audit_findings f where f.id = p_finding and f.category in ('major','minor'))
     and not exists(select 1 from public.corrective_actions a where a.source_table = 'audit_findings' and a.source_id = p_finding
                     and a.status <> 'cancelled')
$$;

-- ---------------------------------------------------------------- fungsi audit
create or replace function public.audit_plan(p_title text, p_scope text, p_start date, p_end date, p_lead uuid,
  p_department uuid default null, p_members uuid[] default '{}', p_framework text default 'SMKP', p_idempotency_key text default null)
returns public.internal_audits language plpgsql security definer set search_path = public as $$
declare
  v public.internal_audits;
  v_reg public.registrations;
  m uuid;
begin
  if not app.has_permission_anywhere('ia.manage') then raise exception 'Tidak berwenang menyusun program audit' using errcode = '42501'; end if;
  if p_idempotency_key is not null then
    select a.* into v from public.registrations r join public.internal_audits a on a.audit_no = r.number where r.idempotency_key = p_idempotency_key;
    if found then return v; end if;
  end if;
  foreach m in array array_prepend(p_lead, coalesce(p_members, '{}')) loop
    if not app.can_audit(m) then raise exception 'Anggota tim tidak memiliki kewenangan auditor' using errcode = '22023'; end if;
    if not app.auditor_independent(m, p_department) then
      raise exception 'Auditor tidak boleh mengaudit departemennya sendiri' using errcode = '22023';
    end if;
  end loop;
  v_reg := app.allocate_number('AUD', jsonb_build_object('date', p_start), p_idempotency_key);
  insert into public.internal_audits(audit_no, title, framework_code, scope, auditee_department_id, planned_start, planned_end, lead_auditor_id)
  values (v_reg.number, app.require_text(p_title, 'Judul audit'), p_framework, app.require_text(p_scope, 'Lingkup audit'), p_department,
          p_start, p_end, p_lead)
  returning * into v;
  insert into public.audit_team(audit_id, user_id, team_role) values (v.id, p_lead, 'lead');
  insert into public.audit_team(audit_id, user_id, team_role)
  select v.id, x, 'member' from unnest(coalesce(p_members, '{}')) x where x <> p_lead on conflict do nothing;
  update public.registrations set ref_table = 'internal_audits', ref_id = v.id where id = v_reg.id;
  perform app.notify_users(array(select user_id from public.audit_team where audit_id = v.id), 'audit.plan',
    'Penugasan audit ' || v.audit_no, v.title, '/manajemen/audit/' || v.id);
  return v;
end $$;

create or replace function public.audit_start(p_audit uuid)
returns public.internal_audits language plpgsql security definer set search_path = public as $$
declare v public.internal_audits;
begin
  select * into v from public.internal_audits where id = p_audit for update;
  if not found then raise exception 'Audit tidak ditemukan' using errcode = 'P0002'; end if;
  if v.lead_auditor_id <> auth.uid() then raise exception 'Hanya ketua tim yang memulai audit' using errcode = '42501'; end if;
  if v.status <> 'planned' then raise exception 'Audit sudah dimulai / ditutup' using errcode = '22023'; end if;
  if app.site_today() < v.planned_start then raise exception 'Audit dijadwalkan mulai %', v.planned_start using errcode = '22023'; end if;
  update public.internal_audits set status = 'in_progress', started_at = now() where id = p_audit returning * into v;
  if v.auditee_department_id is not null then
    perform app.notify_users(app.users_with_permission('capa.manage', v.auditee_department_id), 'audit.start',
      'Audit ' || v.audit_no || ' dimulai', v.scope, '/manajemen/audit/' || v.id);
  end if;
  return v;
end $$;

create or replace function public.audit_finding_add(p_audit uuid, p_clause uuid, p_category text, p_statement text, p_evidence text,
  p_department uuid default null)
returns public.audit_findings language plpgsql security definer set search_path = public as $$
declare
  a public.internal_audits;
  v public.audit_findings;
  v_dept uuid;
begin
  select * into a from public.internal_audits where id = p_audit for update;
  if not found then raise exception 'Audit tidak ditemukan' using errcode = 'P0002'; end if;
  if not app.audit_member(p_audit) then raise exception 'Hanya tim audit yang mencatat temuan' using errcode = '42501'; end if;
  if a.status <> 'in_progress' then raise exception 'Temuan hanya dicatat saat audit berlangsung' using errcode = '22023'; end if;
  if not exists(select 1 from public.compliance_clauses where id = p_clause and framework_code = a.framework_code and active) then
    raise exception 'Persyaratan bukan bagian kriteria audit ini' using errcode = '22023';
  end if;
  v_dept := coalesce(a.auditee_department_id, p_department);
  if v_dept is null then raise exception 'Tentukan departemen yang diaudit untuk temuan ini' using errcode = '22023'; end if;
  insert into public.audit_findings(audit_id, finding_no, clause_id, category, department_id, statement, evidence)
  values (p_audit, coalesce((select max(finding_no) from public.audit_findings where audit_id = p_audit), 0) + 1, p_clause, p_category, v_dept,
          app.require_text(p_statement, 'Pernyataan temuan'), app.require_text(p_evidence, 'Bukti objektif'))
  returning * into v;
  if p_category in ('major','minor') then
    perform app.notify_users(app.users_with_permission('capa.manage', v_dept), 'audit.finding',
      'Temuan ' || p_category || ' audit ' || a.audit_no, left(v.statement, 140), '/manajemen/audit/' || a.id);
  end if;
  return v;
end $$;

create or replace function public.audit_finding_remove(p_finding uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a public.internal_audits;
begin
  select ia.* into a from public.internal_audits ia join public.audit_findings f on f.audit_id = ia.id where f.id = p_finding;
  if not found then raise exception 'Temuan tidak ditemukan' using errcode = 'P0002'; end if;
  if not app.audit_member(a.id) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if a.status <> 'in_progress' then raise exception 'Audit sudah dilaporkan; temuan terkunci' using errcode = '22023'; end if;
  delete from public.audit_findings where id = p_finding;
end $$;

create or replace function public.audit_report(p_audit uuid, p_summary text)
returns public.internal_audits language plpgsql security definer set search_path = public as $$
declare v public.internal_audits;
begin
  select * into v from public.internal_audits where id = p_audit for update;
  if not found then raise exception 'Audit tidak ditemukan' using errcode = 'P0002'; end if;
  if v.lead_auditor_id <> auth.uid() then raise exception 'Hanya ketua tim yang menerbitkan laporan' using errcode = '42501'; end if;
  if v.status <> 'in_progress' then raise exception 'Audit belum berlangsung / sudah dilaporkan' using errcode = '22023'; end if;
  update public.internal_audits set status = 'reported', reported_at = now(), report_summary = app.require_text(p_summary, 'Ringkasan laporan')
   where id = p_audit returning * into v;
  perform app.notify_users(app.users_with_permission('ia.manage', null) || coalesce(app.users_with_permission('capa.manage', v.auditee_department_id), '{}'),
    'audit.report', 'Laporan audit ' || v.audit_no, left(v.report_summary, 140), '/manajemen/audit/' || v.id);
  return v;
end $$;

-- Ditutup oleh pengelola program audit (bukan ketua tim) setelah semua temuan mayor/minor punya action plan.
create or replace function public.audit_close(p_audit uuid)
returns public.internal_audits language plpgsql security definer set search_path = public as $$
declare
  v public.internal_audits;
  n int;
begin
  if not app.has_permission_anywhere('ia.manage') then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  select * into v from public.internal_audits where id = p_audit for update;
  if not found then raise exception 'Audit tidak ditemukan' using errcode = 'P0002'; end if;
  if v.status <> 'reported' then raise exception 'Laporan audit belum terbit' using errcode = '22023'; end if;
  if v.lead_auditor_id = auth.uid() then raise exception 'Ketua tim tidak menutup auditnya sendiri' using errcode = '42501'; end if;
  select count(*) into n from public.audit_findings f where f.audit_id = p_audit and app.finding_needs_capa(f.id);
  if n > 0 then raise exception '% temuan mayor/minor belum punya action plan', n using errcode = '22023'; end if;
  update public.internal_audits set status = 'closed', closed_at = now(), closed_by = auth.uid() where id = p_audit returning * into v;
  perform app.log_event('audit.close', 'internal_audits', v.id::text, null);
  return v;
end $$;

create or replace function public.audit_cancel(p_audit uuid, p_reason text)
returns public.internal_audits language plpgsql security definer set search_path = public as $$
declare v public.internal_audits;
begin
  if not app.has_permission_anywhere('ia.manage') then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  update public.internal_audits set status = 'cancelled', cancel_reason = app.require_text(p_reason, 'Alasan pembatalan')
   where id = p_audit and status in ('planned','in_progress') returning * into v;
  if not found then raise exception 'Audit tidak bisa dibatalkan' using errcode = '22023'; end if;
  return v;
end $$;

-- ---------------------------------------------------------------- fungsi tinjauan manajemen
create or replace function public.mgmt_review_create(p_title text, p_meeting_date date, p_chair uuid, p_idempotency_key text default null)
returns public.management_reviews language plpgsql security definer set search_path = public as $$
declare
  v public.management_reviews;
  v_reg public.registrations;
begin
  if not app.has_permission_anywhere('mgmt.review') then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if p_idempotency_key is not null then
    select m.* into v from public.registrations r join public.management_reviews m on m.review_no = r.number where r.idempotency_key = p_idempotency_key;
    if found then return v; end if;
  end if;
  if not exists(select 1 from public.profiles where id = p_chair and status = 'active') then raise exception 'Pimpinan rapat harus pengguna aktif' using errcode = '22023'; end if;
  v_reg := app.allocate_number('RTM', jsonb_build_object('date', p_meeting_date), p_idempotency_key);
  insert into public.management_reviews(review_no, title, meeting_date, chair_id)
  values (v_reg.number, app.require_text(p_title, 'Judul'), p_meeting_date, p_chair) returning * into v;
  update public.registrations set ref_table = 'management_reviews', ref_id = v.id where id = v_reg.id;
  return v;
end $$;

create or replace function app.mr_editable(p_review uuid) returns public.management_reviews
language plpgsql security definer set search_path = public as $$
declare v public.management_reviews;
begin
  select * into v from public.management_reviews where id = p_review for update;
  if not found then raise exception 'Tinjauan tidak ditemukan' using errcode = 'P0002'; end if;
  if not (app.has_permission_anywhere('mgmt.review') or v.chair_id = auth.uid()) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  return v;
end $$;

create or replace function public.mgmt_review_item_save(p_review uuid, p_topic text, p_discussion text, p_decision text default null,
  p_action_required boolean default false, p_clause uuid default null, p_department uuid default null)
returns public.management_review_items language plpgsql security definer set search_path = public as $$
declare
  r public.management_reviews;
  v public.management_review_items;
begin
  r := app.mr_editable(p_review);
  if r.status = 'closed' then raise exception 'Tinjauan sudah ditutup' using errcode = '22023'; end if;
  insert into public.management_review_items(review_id, topic_code, discussion, decision, action_required, clause_id, department_id, updated_by)
  values (p_review, p_topic, app.require_text(p_discussion, 'Pembahasan'), nullif(btrim(coalesce(p_decision, '')), ''), coalesce(p_action_required, false),
          p_clause, p_department, auth.uid())
  on conflict (review_id, topic_code) do update set discussion = excluded.discussion, decision = excluded.decision,
    action_required = excluded.action_required, clause_id = excluded.clause_id, department_id = excluded.department_id,
    updated_by = auth.uid(), updated_at = now()
  returning * into v;
  return v;
end $$;

create or replace function public.mgmt_review_hold(p_review uuid, p_attendees text)
returns public.management_reviews language plpgsql security definer set search_path = public as $$
declare
  v public.management_reviews;
  missing text;
begin
  v := app.mr_editable(p_review);
  if v.status <> 'draft' then raise exception 'Tinjauan sudah dilaksanakan' using errcode = '22023'; end if;
  if v.meeting_date > app.site_today() then raise exception 'Rapat belum dilaksanakan' using errcode = '22023'; end if;
  select string_agg(t.name, '; ' order by t.sort_order) into missing from public.management_review_topics t
   where t.required and not exists(select 1 from public.management_review_items i where i.review_id = p_review and i.topic_code = t.code);
  if missing is not null then raise exception 'Masukan wajib belum dibahas: %', missing using errcode = '22023'; end if;
  update public.management_reviews set status = 'held', held_at = now(), attendees = app.require_text(p_attendees, 'Daftar hadir'),
    performance_snapshot = app.performance_snapshot()
   where id = p_review returning * into v;
  return v;
end $$;

-- Ditutup pimpinan rapat setelah setiap keputusan yang butuh tindakan punya action plan.
create or replace function public.mgmt_review_close(p_review uuid, p_conclusion text)
returns public.management_reviews language plpgsql security definer set search_path = public as $$
declare
  v public.management_reviews;
  n int;
begin
  select * into v from public.management_reviews where id = p_review for update;
  if not found then raise exception 'Tinjauan tidak ditemukan' using errcode = 'P0002'; end if;
  if v.chair_id <> auth.uid() then raise exception 'Hanya pimpinan rapat yang menutup tinjauan' using errcode = '42501'; end if;
  if v.status <> 'held' then raise exception 'Tinjauan belum dilaksanakan' using errcode = '22023'; end if;
  select count(*) into n from public.management_review_items i
   where i.review_id = p_review and i.action_required
     and not exists(select 1 from public.corrective_actions a where a.source_table = 'management_review_items' and a.source_id = i.id
                     and a.status <> 'cancelled');
  if n > 0 then raise exception '% keputusan belum punya action plan', n using errcode = '22023'; end if;
  update public.management_reviews set status = 'closed', closed_at = now(), conclusion = app.require_text(p_conclusion, 'Kesimpulan')
   where id = p_review returning * into v;
  perform app.log_event('mgmt_review.close', 'management_reviews', v.id::text, null);
  return v;
end $$;

-- ---------------------------------------------------------------- tampilan
create view public.audit_register with (security_invoker = true) as
select a.id, a.audit_no, a.title, a.framework_code, a.scope, a.auditee_department_id, d.code as department_code, a.planned_start, a.planned_end,
       a.status, a.lead_auditor_id, l.full_name as lead_name, a.report_summary, a.reported_at, a.closed_at, a.cancel_reason,
       (select count(*) from public.audit_findings f where f.audit_id = a.id and f.category = 'major')::int as major,
       (select count(*) from public.audit_findings f where f.audit_id = a.id and f.category = 'minor')::int as minor,
       (select count(*) from public.audit_findings f where f.audit_id = a.id and f.category in ('observation','ofi'))::int as observations,
       (select count(*) from public.audit_findings f where f.audit_id = a.id and app.finding_needs_capa(f.id))::int as without_capa
  from public.internal_audits a
  left join public.departments d on d.id = a.auditee_department_id
  join public.profiles l on l.id = a.lead_auditor_id;

create view public.audit_finding_register with (security_invoker = true) as
select f.id, f.audit_id, a.audit_no, f.finding_no, a.audit_no || '-F' || lpad(f.finding_no::text, 2, '0') as finding_ref,
       f.category, f.statement, f.evidence, f.clause_id, c.framework_code, c.code as clause_code, c.title as clause_title,
       f.department_id, d.code as department_code, f.created_at, p.full_name as recorded_by_name,
       ca.id as capa_id, ca.action_no, ca.status as capa_status, app.finding_needs_capa(f.id) as needs_capa
  from public.audit_findings f
  join public.internal_audits a on a.id = f.audit_id
  join public.compliance_clauses c on c.id = f.clause_id
  join public.departments d on d.id = f.department_id
  join public.profiles p on p.id = f.recorded_by
  left join lateral (select x.id, x.action_no, x.status from public.corrective_actions x
                      where x.source_table = 'audit_findings' and x.source_id = f.id and x.status <> 'cancelled'
                      order by x.created_at desc limit 1) ca on true;

create view public.mgmt_review_register with (security_invoker = true) as
select m.id, m.review_no, m.title, m.meeting_date, m.status, m.chair_id, p.full_name as chair_name, m.held_at, m.closed_at,
       (select count(*) from public.management_review_items i where i.review_id = m.id)::int as items,
       (select count(*) from public.management_review_topics t where t.required)::int as required_topics,
       (select count(*) from public.management_review_items i where i.review_id = m.id and i.action_required)::int as actions
  from public.management_reviews m
  join public.profiles p on p.id = m.chair_id;

-- Pencapaian per elemen SMKP: persyaratan terbawah berlaku yang punya bukti diterima dalam 12 bulan
create view public.smkp_element_status with (security_invoker = true) as
with leaf as (
  select s.*, coalesce(p2.code, p1.code, s.code) as element_code
    from public.compliance_clause_status s
    left join public.compliance_clauses p1 on p1.id = s.parent_id
    left join public.compliance_clauses p2 on p2.id = p1.parent_id
   where s.framework_code = 'SMKP' and s.applicability = 'applicable'
     and not exists(select 1 from public.compliance_clauses ch where ch.parent_id = s.id and ch.active)
)
select e.code, e.title, e.sort_order,
       count(l.id)::int as requirements,
       count(l.id) filter (where l.evidence_accepted > 0)::int as with_evidence,
       case when count(l.id) = 0 then null else round(100.0 * count(l.id) filter (where l.evidence_accepted > 0) / count(l.id), 0) end as coverage_pct,
       coalesce(sum(l.capa_open), 0)::int as capa_open,
       coalesce(sum(l.capa_overdue), 0)::int as capa_overdue
  from public.compliance_clauses e
  left join leaf l on l.element_code = e.code
 where e.framework_code = 'SMKP' and e.level = 'element' and e.active
 group by e.code, e.title, e.sort_order;

-- Satu baris KPI untuk dashboard eksekutif (dibaca sesuai hak baca pengguna)
create view public.executive_kpi with (security_invoker = true) as
select
  (select count(*) from public.corrective_actions where status in ('open','in_progress','submitted'))::int as capa_open,
  (select count(*) from public.corrective_actions where status in ('open','in_progress') and due_date < app.site_today())::int as capa_overdue,
  (select count(*) from public.incidents where occurred_at >= date_trunc('year', now()))::int as incidents_ytd,
  (select count(*) from public.incidents where occurred_at >= date_trunc('year', now()) and classification in ('lti','fatality'))::int as lti_ytd,
  (select count(*) from public.incidents where occurred_at >= date_trunc('year', now()) and classification = 'nearmiss')::int as nearmiss_ytd,
  (select count(*) from public.hazard_reports where status = 'open')::int as hazards_open,
  (select count(*) from public.inspections where inspected_on >= app.site_today() - 30)::int as inspections_30d,
  (select count(*) from public.p2h_checks where check_date >= app.site_today() - 30)::int as p2h_30d,
  (select count(*) from public.p2h_checks where check_date >= app.site_today() - 30 and conclusion = 'unfit')::int as p2h_unfit_30d,
  (select round(avg(pa_30d), 1) from public.unit_availability) as pa_avg,
  (select count(*) from public.work_orders where status in ('open','in_progress','waiting_part'))::int as wo_open,
  (select tonnage_approved from public.production_month where month = date_trunc('month', app.site_today())::date) as tonnage_mtd,
  (select tonnage_target from public.production_targets where month = date_trunc('month', app.site_today())::date) as tonnage_target,
  (select count(*) from public.material_stock where low_stock)::int as low_stock,
  (select count(*) from public.material_requests where status = 'submitted')::int as mr_pending,
  (select count(*) from public.competency_matrix where status in ('missing','expired','revoked'))::int as competency_gaps,
  (select count(*) from public.employee_competency_view where validity = 'expiring')::int as competency_expiring,
  (select count(*) from public.documents where status = 'effective' and next_review_at < app.site_today())::int as documents_review_overdue,
  (select round(100.0 * sum(with_evidence) / nullif(sum(requirements), 0), 0) from public.smkp_element_status) as smkp_coverage_pct,
  (select count(*) from public.internal_audits where status <> 'cancelled' and planned_start >= date_trunc('year', now()))::int as audits_ytd,
  (select count(*) from public.audit_findings f where app.finding_needs_capa(f.id))::int as findings_without_capa,
  (select max(meeting_date) from public.management_reviews where status in ('held','closed')) as last_review_date,
  coalesce((select max(meeting_date) from public.management_reviews where status in ('held','closed'))
           + coalesce((select value::text::int from public.app_settings where key = 'management_review_max_days'), 365) < app.site_today(), true)
    as review_overdue;

-- Ringkasan kinerja saat rapat, disimpan agar notulen tidak berubah ketika data berjalan berubah.
create or replace function app.performance_snapshot() returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(k) from public.executive_kpi k
$$;

do $$
declare v text;
begin
  foreach v in array array['audit_register','audit_finding_register','mgmt_review_register','smkp_element_status','executive_kpi'] loop
    execute format('grant select on public.%I to authenticated', v);
    execute format('revoke all on public.%I from anon', v);
  end loop;
end $$;

-- Dipakai view (security invoker), jadi boleh dieksekusi pengguna login; isinya hanya boolean.
revoke all on function app.auditor_independent(uuid, uuid), app.can_audit(uuid), app.audit_member(uuid), app.mr_editable(uuid),
  app.performance_snapshot() from public, anon, authenticated;
revoke all on function app.finding_needs_capa(uuid) from public, anon;
grant execute on function app.finding_needs_capa(uuid) to authenticated;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and p.proname <> 'verify_document' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
