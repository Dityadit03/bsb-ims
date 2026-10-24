-- BSB IMS · M3 · Master kepatuhan SMKP Minerba (pusat sistem), legal register, CAPA
-- Setiap persyaratan punya ID unik dan sumber ketentuan. Bukti, temuan dan action plan menunjuk ke persyaratan.
-- Bobot penilaian tidak ditanam di kode: diisi per versi kerangka setelah pedoman resmi dikonfirmasi.

insert into public.permissions(code, module, description) values
  ('compliance.configure','compliance','Mengelola master elemen/persyaratan dan kontrol'),
  ('compliance.assess','compliance','Menilai pemenuhan dan menerima bukti'),
  ('legal.manage','compliance','Mengelola legal register dan evaluasi kepatuhan'),
  ('capa.create','capa','Membuat action plan'),
  ('capa.manage','capa','Memperpanjang target atau membatalkan action plan'),
  ('capa.verify','capa','Memverifikasi penyelesaian action plan');

insert into public.role_permissions(role_code, permission_code)
select r, p from (values
  ('SYS_ADMIN','compliance.configure'),
  ('HSE_MANAGER','compliance.configure'), ('HSE_MANAGER','compliance.assess'), ('HSE_MANAGER','legal.manage'),
  ('HSE_MANAGER','capa.create'), ('HSE_MANAGER','capa.manage'), ('HSE_MANAGER','capa.verify'),
  ('PJO','compliance.assess'), ('PJO','capa.create'), ('PJO','capa.manage'), ('PJO','capa.verify'),
  ('DEPT_HEAD','capa.create'), ('DEPT_HEAD','capa.manage'), ('DEPT_HEAD','capa.verify'),
  ('SUPERINTENDENT','capa.create'), ('SUPERINTENDENT','capa.verify'),
  ('SUPERVISOR','capa.create'), ('SUPERVISOR','capa.verify'),
  ('INTERNAL_AUDITOR','compliance.assess'), ('INTERNAL_AUDITOR','capa.create')
) as x(r, p);

insert into public.numbering_schemes(code, name, pattern, module) values
  ('LGL','Legal register','LGL-BSB-{N4}','compliance');

-- Batas hari target action plan per tingkat risiko (bisa diubah di pengaturan).
insert into public.app_settings(key, value, description) values
  ('capa_max_days', '{"extreme":7,"high":14,"medium":30,"low":90}', 'Batas maksimal hari target action plan per tingkat risiko'),
  ('capa_effectiveness_days', '30', 'Jeda hari sebelum cek efektivitas action plan risiko tinggi/ekstrem');

-- Izin di departemen mana pun (untuk fungsi tingkat site seperti konfigurasi master).
create or replace function app.has_permission_anywhere(p_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.user_roles ur
      join public.role_permissions rp on rp.role_code = ur.role_code
      join public.profiles p on p.id = ur.user_id
     where ur.user_id = auth.uid() and p.status = 'active' and rp.permission_code = p_perm
       and current_date >= ur.valid_from and (ur.valid_until is null or current_date <= ur.valid_until))
$$;

-- ---------------------------------------------------------------- kerangka & persyaratan
create table public.compliance_frameworks(
  code text primary key check (code ~ '^[A-Z0-9_]{2,20}$'),
  name text not null,
  version text not null,
  source_ref text,
  is_core boolean not null default false,
  status text not null default 'active' check (status in ('draft','active','retired')),
  note text,
  created_at timestamptz not null default now()
);

create table public.compliance_clauses(
  id uuid primary key default gen_random_uuid(),
  framework_code text not null references public.compliance_frameworks(code),
  parent_id uuid references public.compliance_clauses(id),
  code text not null,
  level text not null check (level in ('element','subelement','requirement')),
  title text not null,
  description text,
  evidence_expectation text,
  owner_department_id uuid references public.departments(id),
  applicability text not null default 'applicable' check (applicability in ('applicable','not_applicable','to_confirm')),
  applicability_note text,
  weight numeric check (weight >= 0),
  source_verified boolean not null default false,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (framework_code, code),
  check (applicability = 'applicable' or coalesce(btrim(applicability_note), '') <> '')
);
create index compliance_clauses_parent_idx on public.compliance_clauses(parent_id);

-- Pemetaan silang SMKP ↔ ISO 45001/14001/9001 ↔ SMK3
create table public.clause_mappings(
  clause_id uuid not null references public.compliance_clauses(id) on delete cascade,
  mapped_clause_id uuid not null references public.compliance_clauses(id) on delete cascade,
  primary key (clause_id, mapped_clause_id),
  check (clause_id <> mapped_clause_id)
);

create table public.compliance_controls(
  id uuid primary key default gen_random_uuid(),
  clause_id uuid not null references public.compliance_clauses(id),
  title text not null,
  control_type text not null check (control_type in ('document','record','program','inspection','training','kpi','meeting','other')),
  owner_department_id uuid references public.departments(id),
  frequency text not null default 'annual'
    check (frequency in ('once','daily','weekly','monthly','quarterly','semiannual','annual','event')),
  document_type_code text references public.document_types(code),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index compliance_controls_clause_idx on public.compliance_controls(clause_id);

-- Bukti objektif: menunjuk ke rekaman di modul lain (dokumen, lampiran, action plan, evaluasi legal).
create table public.evidence_links(
  id uuid primary key default gen_random_uuid(),
  clause_id uuid not null references public.compliance_clauses(id),
  control_id uuid references public.compliance_controls(id),
  source_table text not null check (source_table in ('documents','attachments','corrective_actions','legal_evaluations')),
  source_id uuid not null,
  label text not null,
  period_start date,
  period_end date,
  status text not null default 'submitted' check (status in ('submitted','accepted','rejected')),
  linked_by uuid references public.profiles(id) default auth.uid(),
  linked_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  unique (clause_id, source_table, source_id),
  check (period_end is null or period_start is null or period_end >= period_start)
);
create index evidence_links_source_idx on public.evidence_links(source_table, source_id);

-- ---------------------------------------------------------------- legal register
create table public.legal_requirements(
  id uuid primary key default gen_random_uuid(),
  register_no text unique,
  title text not null,
  regulation_no text not null,
  regulation_type text not null check (regulation_type in ('UU','PP','PERPRES','PERMEN','KEPMEN','KEPDIRJEN','PERDA','SNI','ISO','CLIENT','OTHER')),
  issuer text,
  issued_date date,
  status text not null default 'in_force' check (status in ('in_force','partially_revoked','revoked','replaced')),
  status_note text,
  replaced_by uuid references public.legal_requirements(id),
  source_url text check (source_url is null or source_url ~ '^https?://'),
  summary text,
  owner_department_id uuid references public.departments(id),
  next_review_at date,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (status = 'in_force' or coalesce(btrim(status_note), '') <> '')
);

create table public.legal_obligations(
  id uuid primary key default gen_random_uuid(),
  legal_requirement_id uuid not null references public.legal_requirements(id) on delete cascade,
  article_ref text,
  obligation text not null,
  clause_id uuid references public.compliance_clauses(id),
  owner_department_id uuid references public.departments(id),
  frequency text not null default 'annual'
    check (frequency in ('once','monthly','quarterly','semiannual','annual','event')),
  compliance_status text not null default 'not_evaluated'
    check (compliance_status in ('not_evaluated','compliant','partial','non_compliant','not_applicable')),
  last_evaluated_at date,
  next_evaluation_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index legal_obligations_req_idx on public.legal_obligations(legal_requirement_id);

create table public.legal_evaluations(
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references public.legal_obligations(id),
  result text not null check (result in ('compliant','partial','non_compliant','not_applicable')),
  note text,
  evidence_attachment_id uuid references public.attachments(id),
  evaluated_by uuid references public.profiles(id) default auth.uid(),
  evaluated_at date not null default current_date,
  created_at timestamptz not null default now(),
  check (result = 'compliant' or coalesce(btrim(note), '') <> '')
);

-- ---------------------------------------------------------------- CAPA / action plan
create table public.corrective_actions(
  id uuid primary key default gen_random_uuid(),
  action_no text not null unique,
  title text not null,
  description text not null,
  source_type text not null check (source_type in ('inspection','incident','audit','legal','assessment','management_review','hazard_report','effectiveness','other')),
  source_table text,
  source_id uuid,
  source_ref text,
  clause_id uuid not null references public.compliance_clauses(id),
  action_type text not null default 'corrective' check (action_type in ('correction','corrective','preventive','improvement')),
  control_hierarchy text check (control_hierarchy in ('elimination','substitution','engineering','administrative','ppe')),
  risk_level text not null check (risk_level in ('low','medium','high','extreme')),
  site_id uuid references public.sites(id),
  department_id uuid not null references public.departments(id),
  pic_id uuid not null references public.profiles(id),
  verifier_id uuid not null references public.profiles(id),
  created_by uuid not null references public.profiles(id) default auth.uid(),
  due_date date not null,
  original_due_date date not null,
  extension_count int not null default 0,
  status text not null default 'open' check (status in ('open','in_progress','submitted','closed','cancelled')),
  completion_note text,
  submitted_at timestamptz,
  closed_at timestamptz,
  cancel_reason text,
  effectiveness_due date,
  effectiveness_result text check (effectiveness_result in ('effective','not_effective')),
  effectiveness_note text,
  effectiveness_checked_at timestamptz,
  effectiveness_checked_by uuid references public.profiles(id),
  parent_id uuid references public.corrective_actions(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (pic_id <> verifier_id)
);
create index corrective_actions_status_idx on public.corrective_actions(status, due_date);
create index corrective_actions_pic_idx on public.corrective_actions(pic_id) where status in ('open','in_progress');
create index corrective_actions_clause_idx on public.corrective_actions(clause_id);
create index corrective_actions_source_idx on public.corrective_actions(source_table, source_id);

create table public.action_evidence(
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.corrective_actions(id),
  attachment_id uuid not null references public.attachments(id),
  note text,
  submitted_by uuid references public.profiles(id) default auth.uid(),
  submitted_at timestamptz not null default now(),
  unique (action_id, attachment_id)
);

-- Riwayat yang tampil di layar (audit_logs tetap mencatat semua perubahan baris).
create table public.capa_events(
  id bigint generated always as identity primary key,
  action_id uuid not null references public.corrective_actions(id),
  event text not null,
  from_status text,
  to_status text,
  note text,
  actor_id uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index capa_events_action_idx on public.capa_events(action_id, id);

-- ---------------------------------------------------------------- self-assessment / audit internal
create table public.compliance_assessments(
  id uuid primary key default gen_random_uuid(),
  framework_code text not null references public.compliance_frameworks(code),
  title text not null,
  kind text not null default 'self' check (kind in ('self','internal_audit','external_audit')),
  period_start date not null,
  period_end date not null,
  status text not null default 'in_progress' check (status in ('in_progress','completed','cancelled')),
  lead_id uuid not null references public.profiles(id) default auth.uid(),
  completed_at timestamptz,
  summary text,
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create table public.assessment_results(
  assessment_id uuid not null references public.compliance_assessments(id) on delete cascade,
  clause_id uuid not null references public.compliance_clauses(id),
  result text not null check (result in ('fulfilled','partial','not_fulfilled','not_applicable')),
  score numeric check (score >= 0),
  note text,
  assessed_by uuid references public.profiles(id) default auth.uid(),
  assessed_at timestamptz not null default now(),
  primary key (assessment_id, clause_id),
  check (result = 'fulfilled' or coalesce(btrim(note), '') <> '')
);

-- ---------------------------------------------------------------- trigger, RLS, hak tabel
do $$
declare t text;
begin
  foreach t in array array['compliance_clauses','compliance_controls','legal_requirements','legal_obligations','corrective_actions'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['compliance_frameworks','compliance_clauses','clause_mappings','compliance_controls','evidence_links',
                           'legal_requirements','legal_obligations','legal_evaluations','corrective_actions','action_evidence',
                           'capa_events','compliance_assessments','assessment_results'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create policy %I_read on public.%I for select to authenticated using (app.is_active_user())', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
  end loop;
  -- master boleh diubah langsung oleh pemegang compliance.configure; sisanya hanya lewat fungsi
  foreach t in array array['compliance_frameworks','compliance_clauses','clause_mappings','compliance_controls'] loop
    execute format('create policy %I_write on public.%I for all to authenticated
      using (app.has_permission_anywhere(''compliance.configure'')) with check (app.has_permission_anywhere(''compliance.configure''))', t, t);
  end loop;
end $$;
revoke insert, update, delete on public.evidence_links, public.legal_requirements, public.legal_obligations, public.legal_evaluations,
  public.corrective_actions, public.action_evidence, public.capa_events, public.compliance_assessments, public.assessment_results
  from authenticated;

-- Pola master tidak boleh berubah kode setelah dipakai sebagai rujukan
create or replace function app.guard_clause_code() returns trigger
language plpgsql as $$
begin
  if new.code <> old.code and (exists(select 1 from public.corrective_actions where clause_id = old.id)
                               or exists(select 1 from public.evidence_links where clause_id = old.id)
                               or exists(select 1 from public.assessment_results where clause_id = old.id)) then
    raise exception 'Kode persyaratan % sudah dipakai rujukan dan tidak bisa diubah', old.code using errcode = '22023';
  end if;
  return new;
end $$;
create trigger compliance_clauses_guard before update on public.compliance_clauses for each row execute function app.guard_clause_code();

-- ---------------------------------------------------------------- bukti
create or replace function app.source_exists(p_table text, p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_table
    when 'documents' then exists(select 1 from public.documents where id = p_id and status in ('effective','under_revision'))
    when 'attachments' then exists(select 1 from public.attachments where id = p_id)
    when 'corrective_actions' then exists(select 1 from public.corrective_actions where id = p_id and status = 'closed')
    when 'legal_evaluations' then exists(select 1 from public.legal_evaluations where id = p_id)
    else false end
$$;

create or replace function public.evidence_link(p_clause uuid, p_source_table text, p_source_id uuid, p_label text,
  p_control uuid default null, p_period_start date default null, p_period_end date default null)
returns public.evidence_links language plpgsql security definer set search_path = public as $$
declare v public.evidence_links;
begin
  if not app.is_active_user() then raise exception 'Akun tidak aktif' using errcode = '42501'; end if;
  if not exists(select 1 from public.compliance_clauses where id = p_clause and active) then
    raise exception 'Persyaratan tidak ditemukan' using errcode = 'P0002';
  end if;
  if p_control is not null and not exists(select 1 from public.compliance_controls where id = p_control and clause_id = p_clause) then
    raise exception 'Kontrol bukan milik persyaratan ini' using errcode = '22023';
  end if;
  if not app.source_exists(p_source_table, p_source_id) then
    raise exception 'Rekaman bukti tidak ditemukan atau belum sah (dokumen harus berlaku, action plan harus closed)' using errcode = '22023';
  end if;
  if p_source_table = 'attachments' and not exists(select 1 from public.attachments where id = p_source_id and uploaded_by = auth.uid())
     and not app.has_permission_anywhere('compliance.assess') then
    raise exception 'Hanya pengunggah lampiran yang bisa menautkannya' using errcode = '42501';
  end if;
  insert into public.evidence_links(clause_id, control_id, source_table, source_id, label, period_start, period_end)
  values (p_clause, p_control, p_source_table, p_source_id, btrim(p_label), p_period_start, p_period_end)
  on conflict (clause_id, source_table, source_id) do update set label = excluded.label
  returning * into v;
  return v;
end $$;

create or replace function public.evidence_review(p_link uuid, p_accept boolean, p_note text default null)
returns public.evidence_links language plpgsql security definer set search_path = public as $$
declare v public.evidence_links;
begin
  if not app.has_permission_anywhere('compliance.assess') then raise exception 'Tidak berwenang menilai bukti' using errcode = '42501'; end if;
  select * into v from public.evidence_links where id = p_link for update;
  if not found then raise exception 'Bukti tidak ditemukan' using errcode = 'P0002'; end if;
  if v.linked_by = auth.uid() then raise exception 'Bukti tidak bisa dinilai oleh pengirimnya sendiri' using errcode = '42501'; end if;
  if not p_accept and coalesce(btrim(p_note), '') = '' then raise exception 'Alasan penolakan wajib diisi' using errcode = '22023'; end if;
  update public.evidence_links set status = case when p_accept then 'accepted' else 'rejected' end,
         reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
   where id = p_link returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------- CAPA
create or replace function app.capa_log(p_action uuid, p_event text, p_from text, p_to text, p_note text default null)
returns void language sql security definer set search_path = public as $$
  insert into public.capa_events(action_id, event, from_status, to_status, note) values (p_action, p_event, p_from, p_to, p_note)
$$;

create or replace function app.capa_check_due(p_risk text, p_due date) returns void
language plpgsql stable security definer set search_path = public as $$
declare v_max int;
begin
  if p_due < app.site_today() then raise exception 'Target tidak boleh di masa lalu' using errcode = '22023'; end if;
  select (value->>p_risk)::int into v_max from public.app_settings where key = 'capa_max_days';
  if v_max is not null and p_due > app.site_today() + v_max then
    raise exception 'Target untuk risiko % paling lambat % hari', p_risk, v_max using errcode = '22023';
  end if;
end $$;

create or replace function public.capa_create(
  p_title text, p_description text, p_source_type text, p_clause uuid, p_risk text, p_department uuid,
  p_pic uuid, p_verifier uuid, p_due date, p_action_type text default 'corrective', p_control_hierarchy text default null,
  p_source_table text default null, p_source_id uuid default null, p_source_ref text default null,
  p_parent uuid default null, p_idempotency_key text default null)
returns public.corrective_actions language plpgsql security definer set search_path = public as $$
declare
  v public.corrective_actions;
  v_reg public.registrations;
begin
  if not app.has_permission('capa.create', p_department) then
    raise exception 'Tidak berwenang membuat action plan untuk departemen ini' using errcode = '42501';
  end if;
  if coalesce(btrim(p_title), '') = '' or coalesce(btrim(p_description), '') = '' then
    raise exception 'Judul dan uraian wajib diisi' using errcode = '22023';
  end if;
  if not exists(select 1 from public.compliance_clauses where id = p_clause and active) then
    raise exception 'Action plan wajib menunjuk persyaratan SMKP/ISO yang valid' using errcode = '22023';
  end if;
  if p_pic = p_verifier then raise exception 'Verifikator harus orang lain selain PIC' using errcode = '22023'; end if;
  if not exists(select 1 from public.profiles where id = p_pic and status = 'active') then
    raise exception 'PIC harus pengguna aktif' using errcode = '22023';
  end if;
  -- verifikator harus berwenang memverifikasi di departemen tersebut
  if not exists(select 1 from public.user_roles ur join public.role_permissions rp on rp.role_code = ur.role_code
                  join public.profiles p on p.id = ur.user_id
                 where ur.user_id = p_verifier and p.status = 'active' and rp.permission_code = 'capa.verify'
                   and (ur.department_id is null or ur.department_id = p_department)
                   and current_date >= ur.valid_from and (ur.valid_until is null or current_date <= ur.valid_until)) then
    raise exception 'Verifikator tidak memiliki kewenangan verifikasi di departemen ini' using errcode = '22023';
  end if;
  perform app.capa_check_due(p_risk, p_due);

  if p_idempotency_key is not null then
    select a.* into v from public.registrations r join public.corrective_actions a on a.action_no = r.number
     where r.idempotency_key = p_idempotency_key;
    if found then return v; end if;
  end if;
  v_reg := app.allocate_number('ACT', '{}', p_idempotency_key);
  insert into public.corrective_actions(action_no, title, description, source_type, source_table, source_id, source_ref, clause_id,
    action_type, control_hierarchy, risk_level, site_id, department_id, pic_id, verifier_id, due_date, original_due_date, parent_id)
  values (v_reg.number, btrim(p_title), btrim(p_description), p_source_type, p_source_table, p_source_id, p_source_ref, p_clause,
    p_action_type, p_control_hierarchy, p_risk, (select id from public.sites order by created_at limit 1), p_department,
    p_pic, p_verifier, p_due, p_due, p_parent)
  returning * into v;
  update public.registrations set ref_table = 'corrective_actions', ref_id = v.id where id = v_reg.id;
  perform app.capa_log(v.id, 'created', null, 'open');
  perform app.notify_users(array[p_pic], 'capa.assigned', 'Action plan untuk Anda: ' || v.action_no, v.title, '/capa/' || v.id);
  return v;
end $$;

create or replace function public.capa_start(p_action uuid)
returns public.corrective_actions language plpgsql security definer set search_path = public as $$
declare v public.corrective_actions;
begin
  select * into v from public.corrective_actions where id = p_action for update;
  if v.pic_id is distinct from auth.uid() then raise exception 'Hanya PIC yang bisa memulai' using errcode = '42501'; end if;
  if v.status <> 'open' then raise exception 'Action plan tidak berstatus open' using errcode = '22023'; end if;
  update public.corrective_actions set status = 'in_progress' where id = p_action returning * into v;
  perform app.capa_log(v.id, 'started', 'open', 'in_progress');
  return v;
end $$;

-- PIC melapor selesai dengan minimal satu bukti lampiran.
create or replace function public.capa_submit(p_action uuid, p_note text, p_attachments uuid[])
returns public.corrective_actions language plpgsql security definer set search_path = public as $$
declare
  v public.corrective_actions;
  v_from text;
  n int;
begin
  select * into v from public.corrective_actions where id = p_action for update;
  if v.pic_id is distinct from auth.uid() then raise exception 'Hanya PIC yang bisa melaporkan penyelesaian' using errcode = '42501'; end if;
  if v.status not in ('open','in_progress') then raise exception 'Action plan tidak sedang dikerjakan' using errcode = '22023'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'Uraian penyelesaian wajib diisi' using errcode = '22023'; end if;
  select count(*) into n from public.attachments where id = any(p_attachments) and uploaded_by = auth.uid();
  if n = 0 or n <> cardinality(p_attachments) then raise exception 'Lampirkan bukti penyelesaian yang Anda unggah' using errcode = '22023'; end if;
  insert into public.action_evidence(action_id, attachment_id, note)
  select p_action, a, p_note from unnest(p_attachments) a on conflict do nothing;
  update public.attachments set owner_table = 'corrective_actions', owner_id = p_action where id = any(p_attachments);
  v_from := v.status;
  update public.corrective_actions set status = 'submitted', completion_note = p_note, submitted_at = now()
   where id = p_action returning * into v;
  perform app.capa_log(v.id, 'submitted', v_from, 'submitted', p_note);
  perform app.notify_users(array[v.verifier_id], 'capa.verify', 'Verifikasi action plan: ' || v.action_no, v.title, '/capa/' || v.id);
  return v;
end $$;

-- Verifikator independen menerima (closed) atau mengembalikan ke PIC.
create or replace function public.capa_verify(p_action uuid, p_accept boolean, p_note text default null)
returns public.corrective_actions language plpgsql security definer set search_path = public as $$
declare
  v public.corrective_actions;
  v_days int;
begin
  select * into v from public.corrective_actions where id = p_action for update;
  if v.verifier_id is distinct from auth.uid() or not app.has_permission('capa.verify', v.department_id) then
    raise exception 'Hanya verifikator yang ditunjuk yang bisa memverifikasi' using errcode = '42501';
  end if;
  if v.status <> 'submitted' then raise exception 'Belum ada penyelesaian yang dilaporkan' using errcode = '22023'; end if;
  if not p_accept and coalesce(btrim(p_note), '') = '' then raise exception 'Alasan pengembalian wajib diisi' using errcode = '22023'; end if;

  if p_accept then
    select value::int into v_days from public.app_settings where key = 'capa_effectiveness_days';
    update public.corrective_actions
       set status = 'closed', closed_at = now(),
           effectiveness_due = case when risk_level in ('high','extreme') then app.site_today() + coalesce(v_days, 30) end
     where id = p_action returning * into v;
    perform app.capa_log(v.id, 'verified', 'submitted', 'closed', p_note);
    -- action plan yang ditutup otomatis menjadi bukti untuk persyaratannya
    insert into public.evidence_links(clause_id, source_table, source_id, label, status, reviewed_by, reviewed_at, review_note)
    values (v.clause_id, 'corrective_actions', v.id, v.action_no || ' · ' || v.title, 'accepted', auth.uid(), now(), 'Diverifikasi')
    on conflict do nothing;
  else
    update public.corrective_actions set status = 'in_progress', submitted_at = null where id = p_action returning * into v;
    perform app.capa_log(v.id, 'returned', 'submitted', 'in_progress', p_note);
  end if;
  perform app.notify_users(array[v.pic_id], 'capa.' || case when p_accept then 'closed' else 'returned' end,
    case when p_accept then 'Action plan ditutup: ' else 'Action plan dikembalikan: ' end || v.action_no, coalesce(p_note, v.title), '/capa/' || v.id);
  return v;
end $$;

create or replace function public.capa_extend(p_action uuid, p_new_due date, p_reason text)
returns public.corrective_actions language plpgsql security definer set search_path = public as $$
declare
  v public.corrective_actions;
  v_old date;
begin
  select * into v from public.corrective_actions where id = p_action for update;
  if not app.has_permission('capa.manage', v.department_id) then raise exception 'Tidak berwenang memperpanjang target' using errcode = '42501'; end if;
  if v.pic_id = auth.uid() then raise exception 'PIC tidak bisa menyetujui perpanjangan untuk dirinya sendiri' using errcode = '42501'; end if;
  if v.status not in ('open','in_progress') then raise exception 'Action plan tidak sedang dikerjakan' using errcode = '22023'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Alasan perpanjangan wajib diisi' using errcode = '22023'; end if;
  if p_new_due <= v.due_date then raise exception 'Target baru harus setelah target lama' using errcode = '22023'; end if;
  if v.extension_count >= 2 then raise exception 'Perpanjangan maksimal dua kali; buat action plan lanjutan' using errcode = '22023'; end if;
  v_old := v.due_date;
  update public.corrective_actions set due_date = p_new_due, extension_count = extension_count + 1 where id = p_action returning * into v;
  perform app.capa_log(v.id, 'extended', v.status, v.status, format('%s → %s: %s', v_old, p_new_due, p_reason));
  perform app.notify_users(array[v.pic_id], 'capa.extended', 'Target diperpanjang: ' || v.action_no, p_reason, '/capa/' || v.id);
  return v;
end $$;

create or replace function public.capa_cancel(p_action uuid, p_reason text)
returns public.corrective_actions language plpgsql security definer set search_path = public as $$
declare
  v public.corrective_actions;
  v_from text;
begin
  select * into v from public.corrective_actions where id = p_action for update;
  if not app.has_permission('capa.manage', v.department_id) then raise exception 'Tidak berwenang membatalkan' using errcode = '42501'; end if;
  if v.status in ('closed','cancelled') then raise exception 'Action plan sudah selesai' using errcode = '22023'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Alasan pembatalan wajib diisi' using errcode = '22023'; end if;
  v_from := v.status;
  update public.corrective_actions set status = 'cancelled', cancel_reason = p_reason where id = p_action returning * into v;
  perform app.capa_log(v.id, 'cancelled', v_from, 'cancelled', p_reason);
  return v;
end $$;

-- Cek efektivitas setelah jeda; bila tidak efektif, action plan lanjutan dibuat otomatis untuk PIC yang sama.
create or replace function public.capa_review_effectiveness(p_action uuid, p_effective boolean, p_note text, p_new_due date default null)
returns public.corrective_actions language plpgsql security definer set search_path = public as $$
declare
  v public.corrective_actions;
  v_next public.corrective_actions;
  v_reg public.registrations;
begin
  select * into v from public.corrective_actions where id = p_action for update;
  if v.verifier_id is distinct from auth.uid() and not app.has_permission('capa.manage', v.department_id) then
    raise exception 'Tidak berwenang menilai efektivitas' using errcode = '42501';
  end if;
  if v.status <> 'closed' or v.effectiveness_result is not null then raise exception 'Efektivitas sudah dinilai atau action plan belum ditutup' using errcode = '22023'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'Catatan efektivitas wajib diisi' using errcode = '22023'; end if;
  update public.corrective_actions
     set effectiveness_result = case when p_effective then 'effective' else 'not_effective' end,
         effectiveness_note = p_note, effectiveness_checked_at = now(), effectiveness_checked_by = auth.uid()
   where id = p_action returning * into v;
  perform app.capa_log(v.id, case when p_effective then 'effective' else 'not_effective' end, 'closed', 'closed', p_note);
  if not p_effective then
    perform app.capa_check_due(v.risk_level, coalesce(p_new_due, app.site_today() + 7));
    v_reg := app.allocate_number('ACT', '{}', 'effectiveness:' || v.id);
    insert into public.corrective_actions(action_no, title, description, source_type, source_table, source_id, source_ref, clause_id,
      action_type, risk_level, site_id, department_id, pic_id, verifier_id, due_date, original_due_date, parent_id)
    values (v_reg.number, 'Lanjutan: ' || v.title, p_note, 'effectiveness', 'corrective_actions', v.id, v.action_no, v.clause_id,
      'corrective', v.risk_level, v.site_id, v.department_id, v.pic_id, v.verifier_id,
      coalesce(p_new_due, app.site_today() + 7), coalesce(p_new_due, app.site_today() + 7), v.id)
    returning * into v_next;
    update public.registrations set ref_table = 'corrective_actions', ref_id = v_next.id where id = v_reg.id;
    perform app.capa_log(v_next.id, 'created', null, 'open', 'Tindakan sebelumnya tidak efektif: ' || v.action_no);
    perform app.notify_users(array[v.pic_id], 'capa.assigned', 'Action plan lanjutan: ' || v_next.action_no, p_note, '/capa/' || v_next.id);
  end if;
  return v;
end $$;

-- Dijalankan terjadwal (pg_cron) bersama app.escalate_overdue: pengingat untuk PIC dan atasan departemen.
create or replace function app.capa_remind_overdue() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  for r in select * from public.corrective_actions
            where status in ('open','in_progress') and due_date < app.site_today()
              and not exists(select 1 from public.notifications x where x.kind = 'capa.overdue' and x.link = '/capa/' || corrective_actions.id
                              and x.created_at > now() - interval '1 day') loop
    perform app.notify_users(array[r.pic_id, r.verifier_id], 'capa.overdue', 'Action plan lewat target: ' || r.action_no, r.title, '/capa/' || r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- legal register
create or replace function public.legal_register(
  p_title text, p_regulation_no text, p_regulation_type text, p_owner_department uuid,
  p_issuer text default null, p_issued_date date default null, p_source_url text default null, p_summary text default null,
  p_status text default 'in_force', p_status_note text default null, p_next_review date default null)
returns public.legal_requirements language plpgsql security definer set search_path = public as $$
declare
  v public.legal_requirements;
  v_reg public.registrations;
begin
  if not app.has_permission_anywhere('legal.manage') then raise exception 'Tidak berwenang mengelola legal register' using errcode = '42501'; end if;
  if exists(select 1 from public.legal_requirements where lower(regulation_no) = lower(btrim(p_regulation_no))) then
    raise exception 'Regulasi % sudah terdaftar', p_regulation_no using errcode = '23505';
  end if;
  v_reg := app.allocate_number('LGL', '{}');
  insert into public.legal_requirements(register_no, title, regulation_no, regulation_type, issuer, issued_date, status, status_note,
    source_url, summary, owner_department_id, next_review_at)
  values (v_reg.number, btrim(p_title), btrim(p_regulation_no), p_regulation_type, p_issuer, p_issued_date, p_status, p_status_note,
    p_source_url, p_summary, p_owner_department, coalesce(p_next_review, app.site_today() + 365))
  returning * into v;
  update public.registrations set ref_table = 'legal_requirements', ref_id = v.id where id = v_reg.id;
  return v;
end $$;

create or replace function public.legal_add_obligation(p_requirement uuid, p_obligation text, p_article text default null,
  p_clause uuid default null, p_owner_department uuid default null, p_frequency text default 'annual')
returns public.legal_obligations language plpgsql security definer set search_path = public as $$
declare v public.legal_obligations;
begin
  if not app.has_permission_anywhere('legal.manage') then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  insert into public.legal_obligations(legal_requirement_id, article_ref, obligation, clause_id, owner_department_id, frequency, next_evaluation_at)
  values (p_requirement, p_article, btrim(p_obligation), p_clause,
    coalesce(p_owner_department, (select owner_department_id from public.legal_requirements where id = p_requirement)),
    p_frequency, app.site_today())
  returning * into v;
  return v;
end $$;

-- Evaluasi kepatuhan. Hasil tidak patuh/sebagian wajib diikuti action plan (dibuat dari layar setelah evaluasi).
create or replace function public.legal_evaluate(p_obligation uuid, p_result text, p_note text default null, p_attachment uuid default null)
returns public.legal_evaluations language plpgsql security definer set search_path = public as $$
declare
  v public.legal_evaluations;
  v_ob public.legal_obligations;
begin
  if not app.has_permission_anywhere('legal.manage') and not app.has_permission_anywhere('compliance.assess') then
    raise exception 'Tidak berwenang mengevaluasi kepatuhan' using errcode = '42501';
  end if;
  select * into v_ob from public.legal_obligations where id = p_obligation for update;
  if not found then raise exception 'Kewajiban tidak ditemukan' using errcode = 'P0002'; end if;
  insert into public.legal_evaluations(obligation_id, result, note, evidence_attachment_id) values (p_obligation, p_result, p_note, p_attachment)
  returning * into v;
  update public.legal_obligations
     set compliance_status = p_result, last_evaluated_at = v.evaluated_at,
         next_evaluation_at = case frequency when 'monthly' then v.evaluated_at + 30 when 'quarterly' then v.evaluated_at + 91
           when 'semiannual' then v.evaluated_at + 182 when 'annual' then v.evaluated_at + 365 end
   where id = p_obligation;
  if v_ob.clause_id is not null and p_result = 'compliant' then
    insert into public.evidence_links(clause_id, source_table, source_id, label)
    values (v_ob.clause_id, 'legal_evaluations', v.id, 'Evaluasi kepatuhan: ' || left(v_ob.obligation, 80))
    on conflict do nothing;
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------- penilaian
create or replace function public.assessment_start(p_framework text, p_title text, p_kind text, p_start date, p_end date)
returns public.compliance_assessments language plpgsql security definer set search_path = public as $$
declare v public.compliance_assessments;
begin
  if not app.has_permission_anywhere('compliance.assess') then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  insert into public.compliance_assessments(framework_code, title, kind, period_start, period_end)
  values (p_framework, btrim(p_title), p_kind, p_start, p_end) returning * into v;
  return v;
end $$;

create or replace function public.assessment_record(p_assessment uuid, p_clause uuid, p_result text, p_note text default null, p_score numeric default null)
returns public.assessment_results language plpgsql security definer set search_path = public as $$
declare
  v public.assessment_results;
  a public.compliance_assessments;
begin
  if not app.has_permission_anywhere('compliance.assess') then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  select * into a from public.compliance_assessments where id = p_assessment;
  if a.status <> 'in_progress' then raise exception 'Penilaian sudah ditutup' using errcode = '22023'; end if;
  if not exists(select 1 from public.compliance_clauses where id = p_clause and framework_code = a.framework_code) then
    raise exception 'Persyaratan bukan bagian kerangka ini' using errcode = '22023';
  end if;
  insert into public.assessment_results(assessment_id, clause_id, result, note, score)
  values (p_assessment, p_clause, p_result, p_note, p_score)
  on conflict (assessment_id, clause_id) do update
    set result = excluded.result, note = excluded.note, score = excluded.score, assessed_by = auth.uid(), assessed_at = now()
  returning * into v;
  return v;
end $$;

-- Penilaian hanya bisa ditutup bila semua persyaratan terbawah yang berlaku sudah dinilai.
create or replace function public.assessment_complete(p_assessment uuid, p_summary text)
returns public.compliance_assessments language plpgsql security definer set search_path = public as $$
declare
  a public.compliance_assessments;
  n int;
begin
  select * into a from public.compliance_assessments where id = p_assessment for update;
  if a.lead_id is distinct from auth.uid() then raise exception 'Hanya ketua penilaian yang bisa menutup' using errcode = '42501'; end if;
  if a.status <> 'in_progress' then raise exception 'Penilaian sudah ditutup' using errcode = '22023'; end if;
  select count(*) into n from public.compliance_clauses c
   where c.framework_code = a.framework_code and c.active and c.applicability = 'applicable'
     and not exists(select 1 from public.compliance_clauses ch where ch.parent_id = c.id and ch.active)
     and not exists(select 1 from public.assessment_results r where r.assessment_id = a.id and r.clause_id = c.id);
  if n > 0 then raise exception '% persyaratan belum dinilai', n using errcode = '22023'; end if;
  update public.compliance_assessments set status = 'completed', completed_at = now(), summary = p_summary
   where id = p_assessment returning * into a;
  perform app.log_event('assessment.complete', 'compliance_assessments', a.id::text, null);
  return a;
end $$;

-- ---------------------------------------------------------------- ringkasan status per persyaratan
create view public.compliance_clause_status with (security_invoker = true) as
select c.id, c.framework_code, c.parent_id, c.code, c.level, c.title, c.applicability, c.owner_department_id, c.sort_order,
       (select count(*) from public.compliance_controls k where k.clause_id = c.id and k.active)::int as controls,
       (select count(*) from public.evidence_links e where e.clause_id = c.id and e.status = 'accepted'
          and (e.period_end is null or e.period_end >= current_date - 365))::int as evidence_accepted,
       (select count(*) from public.evidence_links e where e.clause_id = c.id and e.status = 'submitted')::int as evidence_pending,
       (select count(*) from public.corrective_actions a where a.clause_id = c.id and a.status in ('open','in_progress','submitted'))::int as capa_open,
       (select count(*) from public.corrective_actions a where a.clause_id = c.id and a.status in ('open','in_progress')
          and a.due_date < current_date)::int as capa_overdue
  from public.compliance_clauses c
 where c.active;
grant select on public.compliance_clause_status to authenticated;
revoke all on public.compliance_clause_status from anon;

create view public.capa_register with (security_invoker = true) as
select a.*, c.code as clause_code, c.title as clause_title, c.framework_code,
       d.code as department_code, pic.full_name as pic_name, ver.full_name as verifier_name,
       (a.status in ('open','in_progress') and a.due_date < current_date) as is_overdue
  from public.corrective_actions a
  join public.compliance_clauses c on c.id = a.clause_id
  join public.departments d on d.id = a.department_id
  join public.profiles pic on pic.id = a.pic_id
  join public.profiles ver on ver.id = a.verifier_id;
grant select on public.capa_register to authenticated;
revoke all on public.capa_register from anon;

-- ---------------------------------------------------------------- hak eksekusi
revoke all on function app.capa_log(uuid, text, text, text, text), app.capa_remind_overdue(), app.source_exists(text, uuid),
  app.capa_check_due(text, date) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'public.evidence_link(uuid, text, uuid, text, uuid, date, date)',
    'public.evidence_review(uuid, boolean, text)',
    'public.capa_create(text, text, text, uuid, text, uuid, uuid, uuid, date, text, text, text, uuid, text, uuid, text)',
    'public.capa_start(uuid)', 'public.capa_submit(uuid, text, uuid[])', 'public.capa_verify(uuid, boolean, text)',
    'public.capa_extend(uuid, date, text)', 'public.capa_cancel(uuid, text)',
    'public.capa_review_effectiveness(uuid, boolean, text, date)',
    'public.legal_register(text, text, text, uuid, text, date, text, text, text, text, date)',
    'public.legal_add_obligation(uuid, text, text, uuid, uuid, text)',
    'public.legal_evaluate(uuid, text, text, uuid)',
    'public.assessment_start(text, text, text, date, date)',
    'public.assessment_record(uuid, uuid, text, text, numeric)',
    'public.assessment_complete(uuid, text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
