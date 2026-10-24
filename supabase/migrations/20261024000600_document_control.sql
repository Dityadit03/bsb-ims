-- BSB IMS · M2 · Document Control
-- Siklus: ajukan (REG-DOC) → unggah draf → review → verifikasi DC → approval → rilis (nomor resmi, PDF terkendali, SHA-256)
-- → distribusi + tanda terima → revisi (versi lama superseded) / dicabut. Rekaman, izin, dokumen eksternal dan surat masuk
-- cukup diregistrasi (nomor langsung terbit) tanpa approval.

-- ---------------------------------------------------------------- workflow dokumen (matriks approval awal)
insert into public.workflow_definitions(code, name, module, on_event) values
  ('DOC_POLICY', 'Kebijakan, manual & surat keputusan', 'document', 'app.document_on_workflow'),
  ('DOC_PROCEDURE', 'SOP, standar, instruksi kerja & program', 'document', 'app.document_on_workflow'),
  ('DOC_FORM', 'Formulir', 'document', 'app.document_on_workflow'),
  ('LETTER_OUT', 'Surat keluar', 'document', 'app.document_on_workflow');

insert into public.workflow_versions(definition_code, version, basis, created_by, steps) values
  ('DOC_POLICY', 1, 'Rencana build v1.0 – matriks approval awal', null, '[
    {"key":"review","name":"Review Department Head terkait","kind":"review","permission":"document.review","scope":"department","sla_hours":72},
    {"key":"verify","name":"Verifikasi Document Control","kind":"verify","permission":"document.verify","scope":"any","sla_hours":48},
    {"key":"approve","name":"Pengesahan PJO / pimpinan","kind":"approve","permission":"document.approve_policy","scope":"any","sla_hours":72}]'),
  ('DOC_PROCEDURE', 1, 'Rencana build v1.0 – matriks approval awal', null, '[
    {"key":"review","name":"Review teknis","kind":"review","permission":"document.review","scope":"department","sla_hours":72},
    {"key":"verify","name":"Verifikasi Document Control","kind":"verify","permission":"document.verify","scope":"any","sla_hours":48},
    {"key":"approve","name":"Persetujuan Department Head","kind":"approve","permission":"document.approve","scope":"department","sla_hours":72}]'),
  ('DOC_FORM', 1, 'Rencana build v1.0 – matriks approval awal', null, '[
    {"key":"review","name":"Review Supervisor","kind":"review","permission":"document.review","scope":"department","sla_hours":48},
    {"key":"verify","name":"Verifikasi Document Control","kind":"verify","permission":"document.verify","scope":"any","sla_hours":48},
    {"key":"approve","name":"Persetujuan Superintendent","kind":"approve","permission":"document.approve","scope":"department","sla_hours":48}]'),
  ('LETTER_OUT', 1, 'Rencana build v1.0 – matriks approval awal', null, '[
    {"key":"review","name":"Review Supervisor","kind":"review","permission":"document.review","scope":"department","sla_hours":24},
    {"key":"verify","name":"Verifikasi Document Control","kind":"verify","permission":"document.verify","scope":"any","sla_hours":24},
    {"key":"approve","name":"Tanda tangan Dept Head / PJO","kind":"approve","permission":"document.approve","scope":"department","sla_hours":24}]');

-- ---------------------------------------------------------------- jenis dokumen (Document Control v4)
create table public.document_types(
  code text primary key references public.numbering_schemes(code),
  name text not null,
  category text not null check (category in ('KS','REK','IZN','EXS')),
  workflow_code text references public.workflow_definitions(code),   -- null = cukup registrasi
  review_years int,                                                  -- periode tinjauan berkala
  parent_types text[],                                               -- IK & F wajib punya dokumen induk
  needs_section boolean not null default false,
  sort_order int not null default 0
);

insert into public.document_types(code, name, category, workflow_code, review_years, parent_types, needs_section, sort_order) values
  ('KBJ','Kebijakan','KS','DOC_POLICY',3,null,false,1),
  ('MAN','Manual','KS','DOC_POLICY',5,null,false,2),
  ('SOP','SOP / Prosedur','KS','DOC_PROCEDURE',3,null,true,3),
  ('STD','Standar','KS','DOC_PROCEDURE',3,null,true,4),
  ('IK','Instruksi Kerja','KS','DOC_PROCEDURE',3,'{SOP}',false,5),
  ('F','Formulir','KS','DOC_FORM',2,'{SOP,IK,MAN,STD,KBJ}',false,6),
  ('PRG','Program','KS','DOC_PROCEDURE',1,null,true,7),
  ('REK','Rekaman / Laporan','REK',null,null,null,true,8),
  ('IZN','Izin / Sertifikat / Lisensi','IZN',null,null,null,false,9),
  ('EXT','Dokumen eksternal','EXS',null,null,null,false,10),
  ('SRM','Surat masuk','EXS',null,null,null,false,11),
  ('SRK','Surat keluar','EXS','LETTER_OUT',null,null,false,12),
  ('SKP','Surat keputusan','EXS','DOC_POLICY',null,null,false,13);

-- ---------------------------------------------------------------- dokumen & versi
create table public.documents(
  id uuid primary key default gen_random_uuid(),
  registration_no text not null unique,
  document_number text unique,
  type_code text not null references public.document_types(code),
  department_id uuid not null references public.departments(id),
  section_id uuid references public.sections(id),
  parent_id uuid references public.documents(id),
  site_id uuid references public.sites(id),
  title text not null check (length(btrim(title)) >= 5),
  owner_id uuid not null references public.profiles(id),
  access_class text not null default 'internal' check (access_class in ('internal','restricted','confidential')),
  status text not null default 'draft'
    check (status in ('draft','in_process','effective','under_revision','obsolete','cancelled','expired','archived')),
  current_version_id uuid,
  effective_version_id uuid,
  effective_date date,
  next_review_at date,
  valid_until date,                 -- izin/sertifikat
  smkp_elements smallint[] not null default '{}' check (smkp_elements <@ '{1,2,3,4,5,6,7}'),
  iso_clauses text[] not null default '{}',
  issuer text,                      -- penerbit dokumen eksternal / pengirim surat
  metadata jsonb not null default '{}',
  obsolete_reason text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index documents_type_dept_idx on public.documents(type_code, department_id);
create index documents_review_idx on public.documents(next_review_at) where status in ('effective','under_revision');

create table public.document_versions(
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id),
  revision int not null check (revision >= 0),
  status text not null default 'draft'
    check (status in ('draft','in_review','pending_approval','revision_required','approved','effective','superseded','obsolete','cancelled')),
  change_summary text,
  draft_attachment_id uuid references public.attachments(id),
  draft_sha256 text,
  final_attachment_id uuid references public.attachments(id),
  final_sha256 text,
  workflow_instance_id uuid references public.workflow_instances(id),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id),
  released_at timestamptz,
  released_by uuid references public.profiles(id),
  effective_date date,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (document_id, revision)
);
alter table public.documents
  add constraint documents_current_version_fk foreign key (current_version_id) references public.document_versions(id),
  add constraint documents_effective_version_fk foreign key (effective_version_id) references public.document_versions(id);

create table public.document_distributions(
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id),
  version_id uuid not null references public.document_versions(id),
  user_id uuid not null references public.profiles(id),
  ack_required boolean not null default true,
  distributed_by uuid references public.profiles(id) default auth.uid(),
  distributed_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  unique (version_id, user_id)
);
create index document_distributions_user_idx on public.document_distributions(user_id) where acknowledged_at is null;

create trigger documents_touch before update on public.documents for each row execute function app.touch_updated_at();
do $$
declare t text;
begin
  foreach t in array array['document_types','documents','document_versions','document_distributions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------- akses baca
create or replace function app.can_read_document(p_doc public.documents) returns boolean
language sql stable security definer set search_path = public as $$
  select app.is_active_user() and (
    p_doc.access_class = 'internal'
    or p_doc.owner_id = auth.uid()
    or app.has_permission('document.read_restricted', p_doc.department_id)
    or exists(select 1 from public.document_distributions d where d.document_id = p_doc.id and d.user_id = auth.uid())
    or exists(select 1 from public.workflow_instances i join public.document_versions v on v.workflow_instance_id = i.id
               join public.approval_events e on e.instance_id = i.id
               where v.document_id = p_doc.id and e.actor_id = auth.uid()))
$$;

create policy document_types_read on public.document_types for select to authenticated using (app.is_active_user());
create policy document_types_write on public.document_types for all to authenticated
  using (app.has_permission('numbering.configure')) with check (app.has_permission('numbering.configure'));
create policy documents_read on public.documents for select to authenticated using (app.can_read_document(documents));
create policy document_versions_read on public.document_versions for select to authenticated
  using (exists(select 1 from public.documents d where d.id = document_id and app.can_read_document(d)));
create policy document_distributions_read on public.document_distributions for select to authenticated
  using (user_id = auth.uid() or app.has_permission('document.release')
         or exists(select 1 from public.documents d where d.id = document_id and d.owner_id = auth.uid()));
revoke insert, update, delete on public.documents, public.document_versions, public.document_distributions from authenticated;

-- ---------------------------------------------------------------- helper
create or replace function app.number_params(p_doc public.documents) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'D', (select code from public.departments where id = p_doc.department_id),
    'S', (select code from public.sections where id = p_doc.section_id),
    'P', (select document_number from public.documents where id = p_doc.parent_id)))
$$;

create or replace function app.notify_users(p_users uuid[], p_kind text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications(user_id, kind, title, body, link)
  select distinct u, p_kind, p_title, p_body, p_link from unnest(p_users) u where u is not null
$$;

-- ---------------------------------------------------------------- pengajuan
create or replace function public.document_request(
  p_type text, p_department uuid, p_title text, p_section uuid default null, p_parent uuid default null,
  p_access_class text default 'internal', p_smkp_elements smallint[] default '{}', p_iso_clauses text[] default '{}',
  p_idempotency_key text default null)
returns public.documents language plpgsql security definer set search_path = public as $$
declare
  v_type public.document_types;
  v_doc public.documents;
  v_reg public.registrations;
  v_ver public.document_versions;
  v_parent public.documents;
begin
  if not app.has_permission('document.request', p_department) then
    raise exception 'Tidak berwenang mengajukan dokumen untuk departemen ini' using errcode = '42501';
  end if;
  select * into v_type from public.document_types where code = p_type;
  if not found then raise exception 'Jenis dokumen tidak dikenal' using errcode = '22023'; end if;
  if v_type.workflow_code is null then
    raise exception 'Jenis % cukup diregistrasi, gunakan registrasi rekaman', p_type using errcode = '22023';
  end if;
  if v_type.needs_section and p_section is null then raise exception 'Seksi wajib dipilih untuk %', v_type.name using errcode = '22023'; end if;
  if p_section is not null and not exists(select 1 from public.sections where id = p_section and department_id = p_department) then
    raise exception 'Seksi tidak termasuk departemen yang dipilih' using errcode = '22023';
  end if;
  if v_type.parent_types is not null then
    select * into v_parent from public.documents where id = p_parent;
    if not found or v_parent.document_number is null or not (v_parent.type_code = any(v_type.parent_types)) then
      raise exception '% wajib menginduk ke dokumen % yang sudah terbit', v_type.name, array_to_string(v_type.parent_types, '/') using errcode = '22023';
    end if;
  end if;

  if p_idempotency_key is not null then
    select d.* into v_doc from public.registrations r join public.documents d on d.registration_no = r.number
     where r.idempotency_key = p_idempotency_key;
    if found then return v_doc; end if;
  end if;

  v_reg := app.allocate_number('REG_DOC', '{}', p_idempotency_key);
  insert into public.documents(registration_no, type_code, department_id, section_id, parent_id, title, owner_id,
                               access_class, status, smkp_elements, iso_clauses, site_id)
  values (v_reg.number, p_type, p_department, p_section, p_parent, btrim(p_title), auth.uid(),
          p_access_class, 'draft', p_smkp_elements, p_iso_clauses, (select id from public.sites order by created_at limit 1))
  returning * into v_doc;
  update public.registrations set ref_table = 'documents', ref_id = v_doc.id where id = v_reg.id;
  insert into public.document_versions(document_id, revision, status, change_summary)
  values (v_doc.id, 0, 'draft', 'Penerbitan awal') returning * into v_ver;
  update public.documents set current_version_id = v_ver.id where id = v_doc.id returning * into v_doc;
  return v_doc;
end $$;

-- Pemilik melampirkan berkas draf (sudah diunggah ke storage + tercatat di attachments).
create or replace function public.document_attach_draft(p_version uuid, p_attachment uuid)
returns public.document_versions language plpgsql security definer set search_path = public as $$
declare
  v_ver public.document_versions;
  v_att public.attachments;
begin
  select v.* into v_ver from public.document_versions v join public.documents d on d.id = v.document_id
   where v.id = p_version and d.owner_id = auth.uid() for update of v;
  if not found then raise exception 'Hanya pemilik dokumen yang bisa melampirkan draf' using errcode = '42501'; end if;
  if v_ver.status not in ('draft','revision_required') then raise exception 'Draf sedang diproses dan terkunci' using errcode = '22023'; end if;
  select * into v_att from public.attachments where id = p_attachment and uploaded_by = auth.uid();
  if not found then raise exception 'Lampiran tidak ditemukan' using errcode = 'P0002'; end if;
  update public.attachments set owner_table = 'document_versions', owner_id = p_version where id = p_attachment;
  update public.document_versions set draft_attachment_id = p_attachment, draft_sha256 = v_att.sha256
   where id = p_version returning * into v_ver;
  return v_ver;
end $$;

create or replace function public.document_submit(p_version uuid)
returns public.document_versions language plpgsql security definer set search_path = public as $$
declare
  v_ver public.document_versions;
  v_doc public.documents;
  v_inst public.workflow_instances;
begin
  select * into v_ver from public.document_versions where id = p_version for update;
  select * into v_doc from public.documents where id = v_ver.document_id;
  if v_doc.owner_id <> auth.uid() then raise exception 'Hanya pemilik dokumen yang bisa mengajukan' using errcode = '42501'; end if;
  if v_ver.status not in ('draft','revision_required') then raise exception 'Versi ini sudah diajukan' using errcode = '22023'; end if;
  if v_ver.draft_attachment_id is null then raise exception 'Lampirkan berkas draf terlebih dahulu' using errcode = '22023'; end if;

  v_inst := app.start_workflow((select workflow_code from public.document_types where code = v_doc.type_code),
                               'document_versions', v_ver.id, v_doc.department_id, v_ver.draft_sha256);
  update public.document_versions set status = 'in_review', workflow_instance_id = v_inst.id where id = p_version returning * into v_ver;
  update public.documents set status = case when status = 'draft' then 'in_process' else status end where id = v_doc.id;
  return v_ver;
end $$;

-- Dipanggil workflow engine saat langkah berpindah atau selesai.
create or replace function app.document_on_workflow(p_instance uuid, p_event text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_inst public.workflow_instances;
  v_doc_id uuid;
  v_new text;
begin
  select * into v_inst from public.workflow_instances where id = p_instance;
  v_new := case p_event
    when 'step:approve' then 'pending_approval'
    when 'step:review' then 'in_review'
    when 'step:verify' then 'in_review'
    when 'approved' then 'approved'
    when 'returned' then 'revision_required'
    when 'rejected' then 'cancelled'
    when 'cancelled' then 'draft'
  end;
  if v_new is null then return; end if;
  update public.document_versions
     set status = v_new,
         approved_at = case when v_new = 'approved' then now() else approved_at end,
         approved_by = case when v_new = 'approved' then auth.uid() else approved_by end
   where id = v_inst.subject_id
   returning document_id into v_doc_id;
  if v_new = 'cancelled' then
    update public.documents set status = 'cancelled' where id = v_doc_id and effective_version_id is null;
    update public.documents set status = 'effective' where id = v_doc_id and effective_version_id is not null;
  end if;
end $$;

-- ---------------------------------------------------------------- rilis terkendali
-- Dipanggil server setelah PDF final berstempel dibuat dan diunggah. Nomor resmi terbit di sini (sekali, saat rilis pertama).
create or replace function public.document_release(p_version uuid, p_effective_date date, p_final_attachment uuid)
returns public.documents language plpgsql security definer set search_path = public as $$
declare
  v_ver public.document_versions;
  v_doc public.documents;
  v_type public.document_types;
  v_att public.attachments;
  v_reg public.registrations;
  v_prev uuid;
  v_recipients uuid[];
begin
  if not app.has_permission('document.release') then raise exception 'Hanya Document Controller yang bisa menerbitkan' using errcode = '42501'; end if;
  select * into v_ver from public.document_versions where id = p_version for update;
  if v_ver.status <> 'approved' then raise exception 'Dokumen belum disetujui; tidak bisa diterbitkan sebagai controlled document' using errcode = '22023'; end if;
  select * into v_doc from public.documents where id = v_ver.document_id for update;
  select * into v_type from public.document_types where code = v_doc.type_code;
  select * into v_att from public.attachments where id = p_final_attachment;
  if not found then raise exception 'PDF final tidak ditemukan' using errcode = 'P0002'; end if;
  if p_effective_date < current_date - 30 then raise exception 'Tanggal berlaku terlalu jauh ke belakang' using errcode = '22023'; end if;

  if v_doc.document_number is null then
    v_reg := app.allocate_number(v_doc.type_code, app.number_params(v_doc), 'release:' || v_doc.id, 'documents', v_doc.id);
    v_doc.document_number := v_reg.number;
  end if;

  v_prev := v_doc.effective_version_id;
  if v_prev is not null then
    update public.document_versions set status = 'superseded', superseded_at = now() where id = v_prev;
    select array_agg(user_id) into v_recipients from public.document_distributions where version_id = v_prev;
  end if;

  update public.attachments set owner_table = 'document_versions', owner_id = p_version where id = p_final_attachment;
  update public.document_versions
     set status = 'effective', final_attachment_id = p_final_attachment, final_sha256 = v_att.sha256,
         released_at = now(), released_by = auth.uid(), effective_date = p_effective_date
   where id = p_version;
  update public.documents
     set document_number = v_doc.document_number, status = 'effective', effective_version_id = p_version,
         current_version_id = p_version, effective_date = p_effective_date,
         next_review_at = case when v_type.review_years is not null then p_effective_date + make_interval(years => v_type.review_years) end
   where id = v_doc.id returning * into v_doc;

  -- penerima versi lama otomatis menerima versi baru
  if v_recipients is not null then
    insert into public.document_distributions(document_id, version_id, user_id)
    select v_doc.id, p_version, u from unnest(v_recipients) u on conflict do nothing;
    perform app.notify_users(v_recipients, 'document.revised', 'Revisi baru berlaku: ' || v_doc.document_number,
      v_doc.title, '/dokumen/' || v_doc.id);
  end if;
  perform app.notify_users(array[v_doc.owner_id], 'document.released', 'Dokumen terbit: ' || v_doc.document_number, v_doc.title, '/dokumen/' || v_doc.id);
  perform app.log_event('document.release', 'documents', v_doc.id::text,
    jsonb_build_object('number', v_doc.document_number, 'version', p_version, 'sha256', v_att.sha256));
  return v_doc;
end $$;

-- Nomor resmi dipesan sebelum PDF distempel; idempotent sehingga rilis memakai nomor yang sama.
create or replace function public.document_reserve_number(p_version uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_ver public.document_versions;
  v_doc public.documents;
begin
  if not app.has_permission('document.release') then raise exception 'Hanya Document Controller yang bisa menerbitkan' using errcode = '42501'; end if;
  select * into v_ver from public.document_versions where id = p_version;
  if v_ver.status <> 'approved' then raise exception 'Dokumen belum disetujui' using errcode = '22023'; end if;
  select * into v_doc from public.documents where id = v_ver.document_id;
  if v_doc.document_number is not null then return v_doc.document_number; end if;
  return (app.allocate_number(v_doc.type_code, app.number_params(v_doc), 'release:' || v_doc.id, 'documents', v_doc.id)).number;
end $$;

-- Registrasi langsung untuk rekaman, izin, dokumen eksternal dan surat masuk.
create or replace function public.document_register_record(
  p_type text, p_department uuid, p_title text, p_section uuid default null, p_date date default null,
  p_attachment uuid default null, p_valid_until date default null, p_issuer text default null,
  p_access_class text default 'internal', p_smkp_elements smallint[] default '{}', p_idempotency_key text default null)
returns public.documents language plpgsql security definer set search_path = public as $$
declare
  v_type public.document_types;
  v_doc public.documents;
  v_reg public.registrations;
  v_num public.registrations;
  v_ver public.document_versions;
  v_sha text;
begin
  if not app.has_permission('document.request', p_department) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  select * into v_type from public.document_types where code = p_type;
  if v_type.workflow_code is not null then raise exception '% wajib melalui approval', v_type.name using errcode = '22023'; end if;
  if v_type.needs_section and p_section is null then raise exception 'Seksi wajib dipilih' using errcode = '22023'; end if;
  if p_idempotency_key is not null then
    select d.* into v_doc from public.registrations r join public.documents d on d.registration_no = r.number where r.idempotency_key = p_idempotency_key;
    if found then return v_doc; end if;
  end if;

  v_reg := app.allocate_number('REG_DOC', '{}', p_idempotency_key);
  insert into public.documents(registration_no, type_code, department_id, section_id, title, owner_id, access_class, status,
                               effective_date, valid_until, issuer, smkp_elements, site_id)
  values (v_reg.number, p_type, p_department, p_section, btrim(p_title), auth.uid(), p_access_class, 'effective',
          coalesce(p_date, app.site_today()), p_valid_until, p_issuer, p_smkp_elements, (select id from public.sites order by created_at limit 1))
  returning * into v_doc;
  v_num := app.allocate_number(p_type, app.number_params(v_doc) || jsonb_build_object('date', coalesce(p_date, app.site_today())),
                               null, 'documents', v_doc.id);
  select sha256 into v_sha from public.attachments where id = p_attachment and uploaded_by = auth.uid();
  insert into public.document_versions(document_id, revision, status, change_summary, final_attachment_id, final_sha256,
                                       released_at, released_by, effective_date)
  values (v_doc.id, 0, 'effective', 'Registrasi', case when v_sha is not null then p_attachment end, v_sha, now(), auth.uid(), v_doc.effective_date)
  returning * into v_ver;
  update public.registrations set ref_table = 'documents', ref_id = v_doc.id where id = v_reg.id;
  update public.documents set document_number = v_num.number, current_version_id = v_ver.id, effective_version_id = v_ver.id
   where id = v_doc.id returning * into v_doc;
  return v_doc;
end $$;

create or replace function public.document_start_revision(p_document uuid, p_change_summary text)
returns public.document_versions language plpgsql security definer set search_path = public as $$
declare
  v_doc public.documents;
  v_ver public.document_versions;
begin
  select * into v_doc from public.documents where id = p_document for update;
  if v_doc.owner_id <> auth.uid() and not app.has_permission('document.request', v_doc.department_id) then
    raise exception 'Tidak berwenang merevisi' using errcode = '42501';
  end if;
  if v_doc.status <> 'effective' then raise exception 'Hanya dokumen yang berlaku yang bisa direvisi' using errcode = '22023'; end if;
  if coalesce(btrim(p_change_summary), '') = '' then raise exception 'Ringkasan perubahan wajib diisi' using errcode = '22023'; end if;
  insert into public.document_versions(document_id, revision, status, change_summary)
  values (v_doc.id, (select max(revision) + 1 from public.document_versions where document_id = v_doc.id), 'draft', p_change_summary)
  returning * into v_ver;
  -- versi lama tetap berlaku sampai revisi diterbitkan
  update public.documents set status = 'under_revision', current_version_id = v_ver.id, owner_id = auth.uid() where id = v_doc.id;
  return v_ver;
end $$;

create or replace function public.document_obsolete(p_document uuid, p_reason text)
returns public.documents language plpgsql security definer set search_path = public as $$
declare
  v_doc public.documents;
  v_recipients uuid[];
begin
  if not app.has_permission('document.release') then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Alasan pencabutan wajib diisi' using errcode = '22023'; end if;
  select * into v_doc from public.documents where id = p_document for update;
  if v_doc.status not in ('effective','under_revision','expired') then raise exception 'Dokumen tidak sedang berlaku' using errcode = '22023'; end if;
  update public.document_versions set status = 'obsolete' where id = v_doc.effective_version_id;
  update public.document_versions set status = 'cancelled' where document_id = p_document and status in ('draft','revision_required');
  update public.workflow_tasks t set status = 'cancelled'
    from public.workflow_instances i join public.document_versions v on v.id = i.subject_id
   where t.instance_id = i.id and t.status = 'open' and v.document_id = p_document;
  update public.workflow_instances i set status = 'cancelled', completed_at = now()
    from public.document_versions v where v.id = i.subject_id and v.document_id = p_document and i.status = 'in_progress';
  update public.documents set status = 'obsolete', obsolete_reason = p_reason, next_review_at = null where id = p_document returning * into v_doc;
  select array_agg(distinct user_id) into v_recipients from public.document_distributions where document_id = p_document;
  perform app.notify_users(v_recipients, 'document.obsolete', 'Dokumen dicabut: ' || v_doc.document_number, p_reason, '/dokumen/' || v_doc.id);
  perform app.log_event('document.obsolete', 'documents', v_doc.id::text, jsonb_build_object('reason', p_reason));
  return v_doc;
end $$;

-- ---------------------------------------------------------------- distribusi
create or replace function public.document_distribute(p_version uuid, p_users uuid[] default '{}', p_departments uuid[] default '{}',
  p_ack_required boolean default true)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_ver public.document_versions;
  v_doc public.documents;
  v_users uuid[];
  n int;
begin
  if not app.has_permission('document.release') then raise exception 'Hanya Document Controller yang bisa mendistribusikan' using errcode = '42501'; end if;
  select * into v_ver from public.document_versions where id = p_version;
  if v_ver.status <> 'effective' then raise exception 'Hanya versi yang berlaku yang bisa didistribusikan' using errcode = '22023'; end if;
  select * into v_doc from public.documents where id = v_ver.document_id;
  select array_agg(distinct id) into v_users from public.profiles
   where status = 'active' and (id = any(p_users) or department_id = any(p_departments));
  with ins as (
    insert into public.document_distributions(document_id, version_id, user_id, ack_required)
    select v_doc.id, p_version, u, p_ack_required from unnest(v_users) u
    on conflict (version_id, user_id) do nothing returning user_id
  ) select count(*) into n from ins;
  perform app.notify_users(v_users, 'document.distributed', 'Dokumen untuk Anda: ' || v_doc.document_number, v_doc.title, '/dokumen/' || v_doc.id);
  return n;
end $$;

create or replace function public.document_acknowledge(p_version uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.document_distributions set acknowledged_at = now()
   where version_id = p_version and user_id = auth.uid() and acknowledged_at is null;
  if not found then raise exception 'Tidak ada distribusi yang perlu dikonfirmasi' using errcode = 'P0002'; end if;
end $$;

-- ---------------------------------------------------------------- verifikasi publik (QR pada PDF)
-- Hanya metadata status; isi dan berkas tetap privat.
create or replace function public.verify_document(p_version uuid)
returns table(document_number text, title text, revision int, version_status text, document_status text,
              effective_date date, final_sha256 text, latest_revision int)
language sql stable security definer set search_path = public as $$
  select d.document_number,
         case when d.access_class = 'internal' then d.title else '(dokumen terbatas)' end,
         v.revision, v.status, d.status, v.effective_date, v.final_sha256,
         (select max(revision) from public.document_versions x where x.document_id = d.id and x.status = 'effective')
    from public.document_versions v join public.documents d on d.id = v.document_id
   where v.id = p_version and v.released_at is not null
$$;

-- ---------------------------------------------------------------- dashboard
create or replace view public.document_register with (security_invoker = true) as
select d.id, d.registration_no, d.document_number, d.type_code, t.name as type_name, t.category,
       dep.code as department_code, sec.code as section_code, d.title, d.status, d.access_class,
       v.revision as current_revision, v.status as current_version_status,
       ev.revision as effective_revision, d.effective_date, d.next_review_at, d.valid_until,
       p.full_name as owner_name, d.smkp_elements, d.updated_at
  from public.documents d
  join public.document_types t on t.code = d.type_code
  join public.departments dep on dep.id = d.department_id
  left join public.sections sec on sec.id = d.section_id
  left join public.document_versions v on v.id = d.current_version_id
  left join public.document_versions ev on ev.id = d.effective_version_id
  left join public.profiles p on p.id = d.owner_id;
grant select on public.document_register to authenticated;
revoke all on public.document_register from anon;

revoke all on function app.document_on_workflow(uuid, text), app.notify_users(uuid[], text, text, text, text) from public, anon, authenticated;
grant execute on function public.document_reserve_number(uuid) to authenticated;
revoke execute on function public.document_reserve_number(uuid) from anon;
grant execute on function public.document_request(text, uuid, text, uuid, uuid, text, smallint[], text[], text),
  public.document_attach_draft(uuid, uuid), public.document_submit(uuid), public.document_release(uuid, date, uuid),
  public.document_register_record(text, uuid, text, uuid, date, uuid, date, text, text, smallint[], text),
  public.document_start_revision(uuid, text), public.document_obsolete(uuid, text),
  public.document_distribute(uuid, uuid[], uuid[], boolean), public.document_acknowledge(uuid) to authenticated;
revoke execute on function public.document_request(text, uuid, text, uuid, uuid, text, smallint[], text[], text),
  public.document_attach_draft(uuid, uuid), public.document_submit(uuid), public.document_release(uuid, date, uuid),
  public.document_register_record(text, uuid, text, uuid, date, uuid, date, text, text, smallint[], text),
  public.document_start_revision(uuid, text), public.document_obsolete(uuid, text),
  public.document_distribute(uuid, uuid[], uuid[], boolean), public.document_acknowledge(uuid) from anon;
grant execute on function public.verify_document(uuid) to anon, authenticated;

-- ---------------------------------------------------------------- storage (hanya di Supabase)
do $$
begin
  if exists(select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets(id, name, public, file_size_limit)
    values ('records', 'records', false, 52428800) on conflict (id) do nothing;
    execute $p$create policy records_read on storage.objects for select to authenticated
      using (bucket_id = 'records' and app.is_active_user())$p$;
    execute $p$create policy records_upload_draft on storage.objects for insert to authenticated
      with check (bucket_id = 'records' and app.is_active_user() and (storage.foldername(name))[1] = 'drafts'
                  and (storage.foldername(name))[2] = auth.uid()::text)$p$;
    execute $p$create policy records_upload_controlled on storage.objects for insert to authenticated
      with check (bucket_id = 'records' and (storage.foldername(name))[1] = 'controlled' and app.has_permission('document.release'))$p$;
  end if;
end $$;

-- Unduhan dokumen dicatat di audit trail
create or replace function public.log_download(p_version uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not app.is_active_user() then raise exception 'Tidak diizinkan' using errcode = '42501'; end if;
  perform app.log_event('document.download', 'document_versions', p_version::text, null);
end $$;
grant execute on function public.log_download(uuid) to authenticated;
revoke execute on function public.log_download(uuid) from anon;
