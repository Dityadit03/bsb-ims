-- HRIS tahap F: penilaian kinerja dan e-learning (LMS).
-- Kinerja: siklus penilaian → karyawan menyusun KPI (bobot 100%) → atasan menyetujui → penilaian diri → nilai atasan
--          (KPI + perilaku kerja) → kalibrasi HRGA → hasil diterbitkan dan dikonfirmasi karyawan.
-- LMS: kursus berisi materi + bank soal; karyawan menyelesaikan materi lalu kuis; lulus → sertifikat kompetensi (nomor LMS)
--      yang langsung dipakai matriks kompetensi & kesiapan kerja. Kunci jawaban tidak pernah terbaca peserta.

insert into public.permissions(code, module, description) values
  ('lms.manage','hrga','Menyusun kursus e-learning departemennya dan menugaskan peserta');
insert into public.role_permissions(role_code, permission_code) values
  ('SUPERINTENDENT','lms.manage'), ('DEPT_HEAD','lms.manage'), ('HSE_MANAGER','lms.manage');

insert into public.numbering_schemes(code, name, pattern, module) values
  ('LMS','Sertifikat kelulusan e-learning','LMS-BSB-{YYYY}-{N5}','hrga');

insert into public.app_settings(key, value, description) values
  ('perf_grade_a', '4.5', 'Nilai akhir minimum predikat A (Istimewa), skala 1-5'),
  ('perf_grade_b', '3.5', 'Nilai akhir minimum predikat B (Baik)'),
  ('perf_grade_c', '2.5', 'Nilai akhir minimum predikat C (Cukup)'),
  ('perf_grade_d', '1.5', 'Nilai akhir minimum predikat D (Kurang); di bawahnya E');

-- ================================================================ penilaian kinerja
create table public.perf_cycles(
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  period_start date not null,
  period_end date not null,
  kpi_weight int not null default 70 check (kpi_weight between 0 and 100),
  goal_due date,
  review_due date,
  status text not null default 'draft' check (status in ('draft','goal_setting','review','calibration','closed')),
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (period_end > period_start)
);

-- perilaku kerja / nilai budaya yang dinilai di setiap siklus (bobot = 100 - bobot KPI)
create table public.perf_behaviors(
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_]+$'),
  name text not null,
  description text,
  sort_order int not null default 50,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.perf_behaviors(code, name, description, sort_order) values
  ('K3', 'Keselamatan & kepatuhan K3', 'Mematuhi SOP/IK, P2H, APD dan aturan lalu lintas tambang; aktif melapor hazard', 10),
  ('INTEGRITAS', 'Integritas', 'Jujur, dapat dipercaya, tidak memanipulasi data atau laporan', 20),
  ('DISIPLIN', 'Disiplin', 'Hadir tepat waktu sesuai roster, menyelesaikan tugas sesuai tenggat', 30),
  ('KERJASAMA', 'Kerja sama', 'Mendukung rekan dan departemen lain, berkomunikasi dengan baik', 40),
  ('INISIATIF', 'Inisiatif & perbaikan', 'Mengusulkan dan menjalankan perbaikan cara kerja', 50);

create table public.perf_reviews(
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.perf_cycles(id),
  employee_id uuid not null references public.employees(id),
  status text not null default 'goal_draft'
    check (status in ('goal_draft','goal_submitted','goal_approved','self_done','manager_done','done','acknowledged')),
  return_note text,
  self_comment text,
  self_submitted_at timestamptz,
  goals_approved_by uuid references public.profiles(id),
  goals_approved_at timestamptz,
  employee_comment text,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (cycle_id, employee_id)
);
create index on public.perf_reviews(employee_id);

create table public.perf_goals(
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.perf_reviews(id) on delete cascade,
  sort_order int not null default 0,
  title text not null,
  measure text,
  target text not null,
  weight int not null check (weight between 1 and 100),
  actual text,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index on public.perf_goals(review_id);

-- nilai 1-5 per KPI / perilaku, terpisah antara penilaian diri dan atasan
create table public.perf_ratings(
  review_id uuid not null references public.perf_reviews(id) on delete cascade,
  rater text not null check (rater in ('self','manager')),
  kind text not null check (kind in ('goal','behavior')),
  item_id uuid not null,
  score smallint not null check (score between 1 and 5),
  note text,
  rated_by uuid not null references public.profiles(id) default auth.uid(),
  rated_at timestamptz not null default now(),
  primary key (review_id, rater, kind, item_id)
);

-- hasil atasan & kalibrasi: terbaca karyawan hanya setelah siklus ditutup
create table public.perf_results(
  review_id uuid primary key references public.perf_reviews(id) on delete cascade,
  kpi_score numeric(4,2),
  behavior_score numeric(4,2),
  final_score numeric(4,2) not null,
  computed_grade text not null check (computed_grade in ('A','B','C','D','E')),
  calibrated_grade text check (calibrated_grade in ('A','B','C','D','E')),
  calibration_note text,
  calibrated_by uuid references public.profiles(id),
  manager_comment text,
  development_plan text,
  scored_by uuid not null references public.profiles(id) default auth.uid(),
  scored_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (calibrated_grade is null or calibration_note is not null)
);

-- ================================================================ e-learning
create table public.courses(
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9][A-Z0-9./-]*$'),
  title text not null,
  description text,
  department_id uuid not null references public.departments(id),
  competency_id uuid references public.competencies(id),
  pass_score int not null default 70 check (pass_score between 1 and 100),
  question_count int check (question_count is null or question_count >= 1),
  max_attempts int check (max_attempts is null or max_attempts >= 1),
  duration_minutes int check (duration_minutes is null or duration_minutes > 0),
  open_enroll boolean not null default true,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.course_materials(
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  sort_order int not null default 0,
  title text not null,
  kind text not null check (kind in ('text','link','video','file')),
  body text,
  url text check (url is null or url ~* '^https://'),
  attachment_id uuid references public.attachments(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (kind <> 'text' or body is not null),
  check (kind not in ('link','video') or url is not null),
  check (kind <> 'file' or attachment_id is not null)
);
create index on public.course_materials(course_id);

create table public.course_questions(
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  sort_order int not null default 0,
  question text not null,
  options text[] not null check (cardinality(options) between 2 and 6),
  answer smallint not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (answer >= 1 and answer <= cardinality(options))
);
create index on public.course_questions(course_id);

create table public.course_assignments(
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id),
  employee_id uuid not null references public.employees(id),
  due_on date,
  assigned_by uuid not null references public.profiles(id) default auth.uid(),
  assigned_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (course_id, employee_id)
);
create index on public.course_assignments(employee_id);

create table public.course_progress(
  material_id uuid not null references public.course_materials(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  done_at timestamptz not null default now(),
  primary key (material_id, employee_id)
);

create table public.course_attempts(
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id),
  employee_id uuid not null references public.employees(id),
  question_ids uuid[] not null,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  answers smallint[],
  correct int,
  score numeric(5,1),
  passed boolean,
  employee_competency_id uuid references public.employee_competencies(id),
  cert_no text
);
create index on public.course_attempts(course_id, employee_id);

do $$
declare t text;
begin
  foreach t in array array['perf_cycles','perf_behaviors','perf_reviews','perf_goals','perf_results','courses','course_materials','course_questions'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['perf_cycles','perf_behaviors','perf_reviews','perf_goals','perf_ratings','perf_results',
                           'courses','course_materials','course_questions','course_assignments','course_progress','course_attempts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------- akses kinerja
-- atasan penilai: atasan langsung atau atasan departemen (hr.roster); tidak pernah dirinya sendiri
create or replace function app.perf_is_manager(p_employee uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.employees e where e.id = p_employee and e.profile_id is distinct from auth.uid()
                  and (e.supervisor_id = app.my_employee() or app.has_permission('hr.roster', e.department_id)))
$$;
create or replace function app.perf_is_self(p_employee uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.employees e where e.id = p_employee and e.profile_id = auth.uid())
$$;
create or replace function app.perf_can_view(p_employee uuid) returns boolean language sql stable security definer set search_path = public as $$
  select app.is_active_user() and (app.is_hr() or app.perf_is_self(p_employee) or app.perf_is_manager(p_employee))
$$;
-- nilai atasan & hasil: HRGA dan atasan selalu, karyawan setelah hasil diterbitkan
create or replace function app.perf_can_see_result(p_review uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.perf_reviews r where r.id = p_review
                  and (app.is_hr() or app.perf_is_manager(r.employee_id)
                       or (app.perf_is_self(r.employee_id) and r.status in ('done','acknowledged'))))
$$;

create policy perf_cycles_read on public.perf_cycles for select to authenticated using (app.is_active_user() and (status <> 'draft' or app.is_hr()));
create policy perf_behaviors_read on public.perf_behaviors for select to authenticated using (app.is_active_user());
create policy perf_reviews_read on public.perf_reviews for select to authenticated using (app.perf_can_view(employee_id));
create policy perf_goals_read on public.perf_goals for select to authenticated using (
  exists(select 1 from public.perf_reviews r where r.id = review_id));
create policy perf_ratings_read on public.perf_ratings for select to authenticated using (
  case when rater = 'self' then exists(select 1 from public.perf_reviews r where r.id = review_id) else app.perf_can_see_result(review_id) end);
create policy perf_results_read on public.perf_results for select to authenticated using (app.perf_can_see_result(review_id));

create or replace function app.perf_grade(p_score numeric) returns text language sql stable set search_path = public as $$
  select case when p_score >= app.setting_num('perf_grade_a', 4.5) then 'A'
              when p_score >= app.setting_num('perf_grade_b', 3.5) then 'B'
              when p_score >= app.setting_num('perf_grade_c', 2.5) then 'C'
              when p_score >= app.setting_num('perf_grade_d', 1.5) then 'D' else 'E' end
$$;

create or replace function app.perf_review_lock(p_review uuid, out r public.perf_reviews, out c public.perf_cycles, out e public.employees)
language plpgsql security definer set search_path = public as $$
begin
  select * into r from public.perf_reviews where id = p_review for update;
  if r.id is null or not app.perf_can_view(r.employee_id) then raise exception 'Penilaian tidak ditemukan' using errcode = 'P0002'; end if;
  select * into c from public.perf_cycles where id = r.cycle_id;
  select * into e from public.employees where id = r.employee_id;
end $$;

-- ---------------------------------------------------------------- siklus
create or replace function public.perf_cycle_save(p_id uuid, p_name text, p_start date, p_end date, p_kpi_weight int,
  p_goal_due date default null, p_review_due date default null)
returns public.perf_cycles language plpgsql security definer set search_path = public as $$
declare v public.perf_cycles;
begin
  perform app.require_hr('hr.manage');
  if p_id is null then
    insert into public.perf_cycles(name, period_start, period_end, kpi_weight, goal_due, review_due)
    values (app.require_text(p_name, 'Nama siklus'), p_start, p_end, coalesce(p_kpi_weight, 70), p_goal_due, p_review_due) returning * into v;
  else
    update public.perf_cycles set name = app.require_text(p_name, 'Nama siklus'), period_start = p_start, period_end = p_end,
           kpi_weight = case when status = 'draft' then coalesce(p_kpi_weight, kpi_weight) else kpi_weight end,
           goal_due = p_goal_due, review_due = p_review_due, updated_by = auth.uid()
     where id = p_id and status <> 'closed' returning * into v;
    if v.id is null then raise exception 'Siklus tidak ditemukan atau sudah ditutup' using errcode = '22023'; end if;
  end if;
  return v;
end $$;

-- peserta: karyawan aktif (bukan subkon) yang bergabung sebelum akhir periode
create or replace function public.perf_cycle_enroll(p_cycle uuid, p_employee uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform app.require_hr('hr.manage');
  if not exists(select 1 from public.perf_cycles where id = p_cycle and status in ('draft','goal_setting','review')) then
    raise exception 'Siklus tidak bisa menerima peserta baru' using errcode = '22023';
  end if;
  insert into public.perf_reviews(cycle_id, employee_id)
  select p_cycle, e.id from public.employees e, public.perf_cycles c
   where c.id = p_cycle and e.status = 'active' and e.employment_type <> 'subcon'
     and (e.join_date is null or e.join_date <= c.period_end) and (p_employee is null or e.id = p_employee)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.perf_cycle_advance(p_cycle uuid) returns public.perf_cycles
language plpgsql security definer set search_path = public as $$
declare
  v public.perf_cycles;
  v_users uuid[];
begin
  perform app.require_hr('hr.manage');
  select * into v from public.perf_cycles where id = p_cycle for update;
  if v.id is null then raise exception 'Siklus tidak ditemukan' using errcode = 'P0002'; end if;
  case v.status
  when 'draft' then
    perform public.perf_cycle_enroll(v.id);
    update public.perf_cycles set status = 'goal_setting', updated_by = auth.uid() where id = v.id returning * into v;
    select array_agg(e.profile_id) into v_users from public.perf_reviews r join public.employees e on e.id = r.employee_id where r.cycle_id = v.id;
    perform app.notify_users(coalesce(v_users, '{}'), 'hr.perf', 'Susun KPI ' || v.name,
      'Isi sasaran kerja (KPI) dengan total bobot 100% lalu kirim ke atasan' || coalesce(' sebelum ' || to_char(v.goal_due, 'DD-MM-YYYY'), '') || '.', '/saya?tab=kinerja');
  when 'goal_setting' then
    update public.perf_cycles set status = 'review', updated_by = auth.uid() where id = v.id returning * into v;
    select array_agg(e.profile_id) into v_users from public.perf_reviews r join public.employees e on e.id = r.employee_id
     where r.cycle_id = v.id and r.status = 'goal_approved';
    perform app.notify_users(coalesce(v_users, '{}'), 'hr.perf', 'Penilaian diri ' || v.name,
      'Isi realisasi dan nilai diri untuk setiap KPI' || coalesce(' sebelum ' || to_char(v.review_due, 'DD-MM-YYYY'), '') || '.', '/saya?tab=kinerja');
  when 'review' then
    update public.perf_cycles set status = 'calibration', updated_by = auth.uid() where id = v.id returning * into v;
  when 'calibration' then
    update public.perf_reviews set status = 'done', updated_by = auth.uid() where cycle_id = v.id and status = 'manager_done';
    update public.perf_cycles set status = 'closed', updated_by = auth.uid() where id = v.id returning * into v;
    select array_agg(e.profile_id) into v_users from public.perf_reviews r join public.employees e on e.id = r.employee_id
     where r.cycle_id = v.id and r.status = 'done';
    perform app.notify_users(coalesce(v_users, '{}'), 'hr.perf', 'Hasil penilaian ' || v.name || ' terbit',
      'Lihat nilai dan catatan atasan, lalu konfirmasi.', '/saya?tab=kinerja');
  else
    raise exception 'Siklus sudah ditutup' using errcode = '22023';
  end case;
  return v;
end $$;

-- ---------------------------------------------------------------- KPI
create or replace function app.perf_can_edit_goals(r public.perf_reviews, c public.perf_cycles) returns boolean
language sql stable security definer set search_path = public as $$
  select c.status in ('goal_setting','review') and r.status in ('goal_draft','goal_submitted')
     and (app.perf_is_self(r.employee_id) or app.perf_is_manager(r.employee_id) or (app.is_hr() and not app.perf_is_self(r.employee_id)))
$$;

create or replace function public.perf_goal_save(p_review uuid, p_id uuid, p_title text, p_measure text, p_target text, p_weight int,
  p_sort int default null)
returns public.perf_goals language plpgsql security definer set search_path = public as $$
declare
  l record;
  v public.perf_goals;
begin
  l := app.perf_review_lock(p_review);
  if not app.perf_can_edit_goals(l.r, l.c) then raise exception 'KPI tidak bisa diubah pada tahap ini' using errcode = '42501'; end if;
  if p_weight is null or p_weight not between 1 and 100 then raise exception 'Bobot 1-100%%' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.perf_goals(review_id, sort_order, title, measure, target, weight)
    values (p_review, coalesce(p_sort, (select coalesce(max(sort_order), 0) + 1 from public.perf_goals where review_id = p_review)),
            app.require_text(p_title, 'KPI'), nullif(btrim(p_measure), ''), app.require_text(p_target, 'Target'), p_weight)
    returning * into v;
  else
    update public.perf_goals set title = app.require_text(p_title, 'KPI'), measure = nullif(btrim(p_measure), ''),
           target = app.require_text(p_target, 'Target'), weight = p_weight, sort_order = coalesce(p_sort, sort_order), updated_by = auth.uid()
     where id = p_id and review_id = p_review returning * into v;
    if v.id is null then raise exception 'KPI tidak ditemukan' using errcode = 'P0002'; end if;
  end if;
  -- perubahan setelah dikirim mengembalikan ke draf bila dilakukan karyawan
  if (l.r).status = 'goal_submitted' and app.perf_is_self((l.r).employee_id) then
    update public.perf_reviews set status = 'goal_draft', updated_by = auth.uid() where id = p_review;
  end if;
  return v;
end $$;

create or replace function public.perf_goal_delete(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare
  l record;
  v_review uuid := (select review_id from public.perf_goals where id = p_id);
begin
  if v_review is null then raise exception 'KPI tidak ditemukan' using errcode = 'P0002'; end if;
  l := app.perf_review_lock(v_review);
  if not app.perf_can_edit_goals(l.r, l.c) then raise exception 'KPI tidak bisa diubah pada tahap ini' using errcode = '42501'; end if;
  delete from public.perf_goals where id = p_id;
end $$;

create or replace function app.perf_check_weights(p_review uuid) returns void language plpgsql stable set search_path = public as $$
declare n int; w int;
begin
  select count(*), coalesce(sum(weight), 0) into n, w from public.perf_goals where review_id = p_review;
  if n = 0 then raise exception 'Isi minimal satu KPI' using errcode = '22023'; end if;
  if w <> 100 then raise exception 'Total bobot KPI harus 100%% (sekarang %%%)', w using errcode = '22023'; end if;
end $$;

create or replace function public.perf_goals_submit(p_review uuid) returns public.perf_reviews
language plpgsql security definer set search_path = public as $$
declare l record; v public.perf_reviews;
begin
  l := app.perf_review_lock(p_review);
  if not app.perf_is_self((l.r).employee_id) then raise exception 'Hanya karyawan yang bersangkutan' using errcode = '42501'; end if;
  if (l.c).status not in ('goal_setting','review') or (l.r).status <> 'goal_draft' then
    raise exception 'KPI tidak bisa dikirim pada tahap ini' using errcode = '22023';
  end if;
  perform app.perf_check_weights(p_review);
  update public.perf_reviews set status = 'goal_submitted', return_note = null, updated_by = auth.uid() where id = p_review returning * into v;
  perform app.notify_users(app.approvers_of((l.e).id), 'hr.perf', 'KPI ' || (l.e).full_name || ' menunggu persetujuan', (l.c).name, '/kinerja/' || v.id);
  return v;
end $$;

-- atasan menyetujui KPI (juga langsung dari draf untuk karyawan tanpa akun) atau mengembalikan dengan catatan
create or replace function public.perf_goals_decide(p_review uuid, p_approve boolean, p_note text default null) returns public.perf_reviews
language plpgsql security definer set search_path = public as $$
declare l record; v public.perf_reviews;
begin
  l := app.perf_review_lock(p_review);
  if not app.perf_is_manager((l.r).employee_id) then raise exception 'Hanya atasan karyawan' using errcode = '42501'; end if;
  if (l.c).status not in ('goal_setting','review') or (l.r).status not in ('goal_draft','goal_submitted') then
    raise exception 'KPI tidak menunggu persetujuan' using errcode = '22023';
  end if;
  if p_approve then
    perform app.perf_check_weights(p_review);
    update public.perf_reviews set status = 'goal_approved', return_note = null, goals_approved_by = auth.uid(), goals_approved_at = now(),
           updated_by = auth.uid() where id = p_review returning * into v;
    perform app.notify_users(array[(l.e).profile_id], 'hr.perf', 'KPI ' || (l.c).name || ' disetujui atasan', p_note, '/kinerja/' || v.id);
  else
    if (l.r).status <> 'goal_submitted' then raise exception 'KPI belum dikirim karyawan' using errcode = '22023'; end if;
    update public.perf_reviews set status = 'goal_draft', return_note = app.require_text(p_note, 'Catatan perbaikan'), updated_by = auth.uid()
     where id = p_review returning * into v;
    perform app.notify_users(array[(l.e).profile_id], 'hr.perf', 'KPI ' || (l.c).name || ' perlu diperbaiki', p_note, '/kinerja/' || v.id);
  end if;
  return v;
end $$;

-- nilai: p_items = [{"kind":"goal"|"behavior","id":uuid,"score":1-5,"note":text,"actual":text}]
create or replace function app.perf_save_ratings(p_review uuid, p_rater text, p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  it jsonb;
  v_missing int;
begin
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    if (it->>'score') is null then continue; end if;
    if (it->>'kind') = 'goal' then
      if not exists(select 1 from public.perf_goals where id = (it->>'id')::uuid and review_id = p_review) then
        raise exception 'KPI tidak dikenal' using errcode = '22023';
      end if;
      if it ? 'actual' then
        update public.perf_goals set actual = nullif(btrim(it->>'actual'), ''), updated_by = auth.uid() where id = (it->>'id')::uuid;
      end if;
    elsif (it->>'kind') = 'behavior' then
      if not exists(select 1 from public.perf_behaviors where id = (it->>'id')::uuid and active) then
        raise exception 'Perilaku kerja tidak dikenal' using errcode = '22023';
      end if;
    else
      raise exception 'Jenis nilai tidak dikenal' using errcode = '22023';
    end if;
    if (it->>'score')::int not between 1 and 5 then raise exception 'Nilai harus 1-5' using errcode = '22023'; end if;
    insert into public.perf_ratings(review_id, rater, kind, item_id, score, note)
    values (p_review, p_rater, it->>'kind', (it->>'id')::uuid, (it->>'score')::smallint, nullif(btrim(it->>'note'), ''))
    on conflict (review_id, rater, kind, item_id) do update set score = excluded.score, note = excluded.note, rated_by = auth.uid(), rated_at = now();
  end loop;
  select (select count(*) from public.perf_goals g where g.review_id = p_review
            and not exists(select 1 from public.perf_ratings x where x.review_id = p_review and x.rater = p_rater and x.kind = 'goal' and x.item_id = g.id))
       + (select count(*) from public.perf_behaviors b where b.active
            and not exists(select 1 from public.perf_ratings x where x.review_id = p_review and x.rater = p_rater and x.kind = 'behavior' and x.item_id = b.id))
    into v_missing;
  if v_missing > 0 then raise exception 'Semua KPI dan perilaku kerja wajib dinilai (% belum)', v_missing using errcode = '22023'; end if;
end $$;

create or replace function public.perf_self_review(p_review uuid, p_items jsonb, p_comment text default null) returns public.perf_reviews
language plpgsql security definer set search_path = public as $$
declare l record; v public.perf_reviews;
begin
  l := app.perf_review_lock(p_review);
  if not app.perf_is_self((l.r).employee_id) then raise exception 'Hanya karyawan yang bersangkutan' using errcode = '42501'; end if;
  if (l.c).status <> 'review' or (l.r).status not in ('goal_approved','self_done') then
    raise exception 'Penilaian diri dibuka setelah KPI disetujui dan siklus masuk tahap penilaian' using errcode = '22023';
  end if;
  perform app.perf_save_ratings(p_review, 'self', p_items);
  update public.perf_reviews set status = 'self_done', self_comment = nullif(btrim(p_comment), ''), self_submitted_at = now(), updated_by = auth.uid()
   where id = p_review returning * into v;
  if (l.r).status = 'goal_approved' then
    perform app.notify_users(app.approvers_of((l.e).id), 'hr.perf', 'Penilaian diri ' || (l.e).full_name || ' selesai',
      'Beri nilai atasan untuk ' || (l.c).name, '/kinerja/' || v.id);
  end if;
  return v;
end $$;

create or replace function public.perf_manager_review(p_review uuid, p_items jsonb, p_comment text, p_development text default null)
returns public.perf_results language plpgsql security definer set search_path = public as $$
declare
  l record;
  v public.perf_results;
  v_kpi numeric;
  v_beh numeric;
  v_final numeric;
begin
  l := app.perf_review_lock(p_review);
  if not app.perf_is_manager((l.r).employee_id) then raise exception 'Hanya atasan karyawan' using errcode = '42501'; end if;
  if (l.c).status not in ('review','calibration') or (l.r).status not in ('goal_approved','self_done','manager_done') then
    raise exception 'Penilaian atasan dibuka setelah KPI disetujui dan siklus masuk tahap penilaian' using errcode = '22023';
  end if;
  -- karyawan yang punya akun menilai diri lebih dulu
  if (l.r).status = 'goal_approved' and (l.e).profile_id is not null and (l.c).status = 'review' then
    raise exception 'Tunggu penilaian diri karyawan' using errcode = '22023';
  end if;
  perform app.perf_save_ratings(p_review, 'manager', p_items);
  select sum(g.weight * x.score)::numeric / nullif(sum(g.weight), 0) into v_kpi
    from public.perf_goals g join public.perf_ratings x on x.review_id = g.review_id and x.rater = 'manager' and x.kind = 'goal' and x.item_id = g.id
   where g.review_id = p_review;
  select avg(x.score) into v_beh from public.perf_ratings x join public.perf_behaviors b on b.id = x.item_id and b.active
   where x.review_id = p_review and x.rater = 'manager' and x.kind = 'behavior';
  v_final := round(case when v_beh is null then v_kpi else v_kpi * (l.c).kpi_weight / 100.0 + v_beh * (100 - (l.c).kpi_weight) / 100.0 end, 2);
  insert into public.perf_results(review_id, kpi_score, behavior_score, final_score, computed_grade, manager_comment, development_plan)
  values (p_review, round(v_kpi, 2), round(v_beh, 2), v_final, app.perf_grade(v_final),
          app.require_text(p_comment, 'Catatan atasan'), nullif(btrim(p_development), ''))
  on conflict (review_id) do update set kpi_score = excluded.kpi_score, behavior_score = excluded.behavior_score, final_score = excluded.final_score,
     computed_grade = excluded.computed_grade, manager_comment = excluded.manager_comment, development_plan = excluded.development_plan,
     scored_by = auth.uid(), scored_at = now(), updated_by = auth.uid()
  returning * into v;
  update public.perf_reviews set status = 'manager_done', updated_by = auth.uid() where id = p_review;
  return v;
end $$;

-- kalibrasi HRGA: ubah predikat dengan alasan (kosongkan predikat untuk kembali ke hasil hitung)
create or replace function public.perf_calibrate(p_review uuid, p_grade text, p_note text default null) returns public.perf_results
language plpgsql security definer set search_path = public as $$
declare l record; v public.perf_results;
begin
  perform app.require_hr('hr.manage');
  l := app.perf_review_lock(p_review);
  if app.perf_is_self((l.r).employee_id) then raise exception 'Tidak bisa mengkalibrasi penilaian sendiri' using errcode = '42501'; end if;
  if (l.c).status <> 'calibration' or (l.r).status <> 'manager_done' then
    raise exception 'Kalibrasi hanya pada tahap kalibrasi setelah atasan menilai' using errcode = '22023';
  end if;
  if nullif(p_grade, '') is not null and p_grade not in ('A','B','C','D','E') then raise exception 'Predikat tidak dikenal' using errcode = '22023'; end if;
  update public.perf_results set calibrated_grade = nullif(p_grade, ''),
         calibration_note = case when nullif(p_grade, '') is null then null else app.require_text(p_note, 'Alasan kalibrasi') end,
         calibrated_by = case when nullif(p_grade, '') is null then null else auth.uid() end, updated_by = auth.uid()
   where review_id = p_review returning * into v;
  return v;
end $$;

create or replace function public.perf_acknowledge(p_review uuid, p_comment text default null) returns public.perf_reviews
language plpgsql security definer set search_path = public as $$
declare l record; v public.perf_reviews;
begin
  l := app.perf_review_lock(p_review);
  if not app.perf_is_self((l.r).employee_id) then raise exception 'Hanya karyawan yang bersangkutan' using errcode = '42501'; end if;
  if (l.r).status <> 'done' then raise exception 'Hasil belum terbit' using errcode = '22023'; end if;
  update public.perf_reviews set status = 'acknowledged', employee_comment = nullif(btrim(p_comment), ''), acknowledged_at = now(), updated_by = auth.uid()
   where id = p_review returning * into v;
  return v;
end $$;

-- data pendukung penilaian selama periode: absensi, pelanggaran K3, kontribusi SHE, sertifikat baru
create or replace function public.perf_evidence(p_review uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r public.perf_reviews;
  c public.perf_cycles;
  v_to date;
begin
  select * into r from public.perf_reviews where id = p_review;
  if r.id is null or not app.perf_can_view(r.employee_id) then raise exception 'Penilaian tidak ditemukan' using errcode = 'P0002'; end if;
  select * into c from public.perf_cycles where id = r.cycle_id;
  v_to := least(c.period_end, app.site_today());
  return jsonb_build_object(
    'hadir', (select count(*) from public.attendance_daily a where a.employee_id = r.employee_id and a.work_date between c.period_start and v_to
               and a.status in ('hadir','terlambat','masuk_off')),
    'terlambat', (select count(*) from public.attendance_daily a where a.employee_id = r.employee_id and a.work_date between c.period_start and v_to
               and a.status = 'terlambat'),
    'alpa', (select count(*) from public.attendance_daily a where a.employee_id = r.employee_id and a.work_date between c.period_start and v_to
               and a.status = 'alpa'),
    'pelanggaran', (select count(*) from public.violations x where x.employee_id = r.employee_id and x.occurred_on between c.period_start and c.period_end),
    'hazard', (select count(*) from public.hazard_reports x where x.employee_id = r.employee_id and x.reported_on between c.period_start and c.period_end),
    'observasi', (select count(*) from public.observations x where x.employee_id = r.employee_id and x.observed_on between c.period_start and c.period_end),
    'inspeksi', (select count(*) from public.inspections x where x.employee_id = r.employee_id and x.inspected_on between c.period_start and c.period_end),
    'sertifikat', (select count(*) from public.employee_competencies x where x.employee_id = r.employee_id and x.status = 'valid'
                     and x.issued_on between c.period_start and c.period_end));
end $$;

create view public.perf_review_register with (security_invoker = true) as
select r.id, r.cycle_id, c.name as cycle_name, c.status as cycle_status, c.period_start, c.period_end, c.kpi_weight, c.goal_due, c.review_due,
       r.employee_id, e.nrp, e.full_name, e.department_id, d.code as department_code, p.name as position_name, s.full_name as supervisor_name,
       r.status, r.return_note, coalesce(g.goals, 0) as goals, coalesce(g.weight_total, 0) as weight_total,
       r.self_submitted_at, x.scored_at as manager_submitted_at, x.final_score, coalesce(x.calibrated_grade, x.computed_grade) as final_grade,
       x.computed_grade, x.calibrated_grade, r.acknowledged_at,
       (e.profile_id = auth.uid()) as is_self, app.perf_is_manager(e.id) as is_manager, (e.profile_id is not null) as has_account,
       case
         when e.profile_id = auth.uid() then case
           when c.status in ('goal_setting','review') and r.status = 'goal_draft' then 'Susun KPI'
           when c.status = 'review' and r.status = 'goal_approved' then 'Isi penilaian diri'
           when r.status = 'done' then 'Konfirmasi hasil' end
         when app.perf_is_manager(e.id) then case
           when c.status in ('goal_setting','review') and r.status = 'goal_submitted' then 'Setujui KPI'
           when c.status in ('goal_setting','review') and r.status = 'goal_draft' and e.profile_id is null then 'Susun KPI'
           when c.status = 'review' and (r.status = 'self_done' or (r.status = 'goal_approved' and e.profile_id is null)) then 'Beri nilai' end
       end as my_action
  from public.perf_reviews r
  join public.perf_cycles c on c.id = r.cycle_id
  join public.employees e on e.id = r.employee_id
  join public.departments d on d.id = e.department_id
  left join public.positions p on p.id = e.position_id
  left join public.employees s on s.id = e.supervisor_id
  left join public.perf_results x on x.review_id = r.id
  left join lateral (select count(*)::int goals, sum(weight)::int weight_total from public.perf_goals where review_id = r.id) g on true;

-- ---------------------------------------------------------------- akses LMS
create or replace function app.lms_can_manage(p_dept uuid) returns boolean language sql stable security definer set search_path = public as $$
  select app.is_hr() or app.has_permission('lms.manage', p_dept)
$$;

create policy courses_read on public.courses for select to authenticated using (
  app.is_active_user() and (status = 'published' or app.lms_can_manage(department_id)));
create policy course_materials_read on public.course_materials for select to authenticated using (
  exists(select 1 from public.courses c where c.id = course_id));
-- kunci jawaban: hanya penyusun kursus
create policy course_questions_read on public.course_questions for select to authenticated using (
  exists(select 1 from public.courses c where c.id = course_id and app.lms_can_manage(c.department_id)));
create policy course_assignments_read on public.course_assignments for select to authenticated using (
  app.can_view_employee(employee_id) or exists(select 1 from public.courses c where c.id = course_id and app.lms_can_manage(c.department_id)));
create policy course_progress_read on public.course_progress for select to authenticated using (
  app.can_view_employee(employee_id) or exists(select 1 from public.course_materials m join public.courses c on c.id = m.course_id
                                                where m.id = material_id and app.lms_can_manage(c.department_id)));
create policy course_attempts_read on public.course_attempts for select to authenticated using (
  app.can_view_employee(employee_id) or exists(select 1 from public.courses c where c.id = course_id and app.lms_can_manage(c.department_id)));

create or replace function app.lms_require(p_course uuid) returns public.courses language plpgsql security definer set search_path = public as $$
declare v public.courses;
begin
  select * into v from public.courses where id = p_course;
  if v.id is null then raise exception 'Kursus tidak ditemukan' using errcode = 'P0002'; end if;
  if not app.lms_can_manage(v.department_id) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  return v;
end $$;

-- ---------------------------------------------------------------- penyusunan kursus
create or replace function public.course_save(p_id uuid, p_data jsonb) returns public.courses
language plpgsql security definer set search_path = public as $$
declare
  v public.courses;
  v_dept uuid := nullif(p_data->>'department_id', '')::uuid;
begin
  if p_id is not null then
    v := app.lms_require(p_id);
    v_dept := coalesce(v_dept, v.department_id);
  end if;
  if v_dept is null then raise exception 'Departemen pemilik wajib diisi' using errcode = '22023'; end if;
  if not app.lms_can_manage(v_dept) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if p_id is null then
    insert into public.courses(code, title, description, department_id, competency_id, pass_score, question_count, max_attempts, duration_minutes, open_enroll)
    values (upper(app.require_text(p_data->>'code', 'Kode kursus')), app.require_text(p_data->>'title', 'Judul'), nullif(btrim(p_data->>'description'), ''),
            v_dept, nullif(p_data->>'competency_id', '')::uuid, coalesce(nullif(p_data->>'pass_score', '')::int, 70),
            nullif(p_data->>'question_count', '')::int, nullif(p_data->>'max_attempts', '')::int, nullif(p_data->>'duration_minutes', '')::int,
            coalesce((p_data->>'open_enroll')::boolean, true))
    returning * into v;
  else
    update public.courses set title = app.require_text(p_data->>'title', 'Judul'), description = nullif(btrim(p_data->>'description'), ''),
           department_id = v_dept, competency_id = nullif(p_data->>'competency_id', '')::uuid,
           pass_score = coalesce(nullif(p_data->>'pass_score', '')::int, pass_score), question_count = nullif(p_data->>'question_count', '')::int,
           max_attempts = nullif(p_data->>'max_attempts', '')::int, duration_minutes = nullif(p_data->>'duration_minutes', '')::int,
           open_enroll = coalesce((p_data->>'open_enroll')::boolean, open_enroll), updated_by = auth.uid()
     where id = p_id returning * into v;
  end if;
  return v;
end $$;

create or replace function public.course_material_save(p_course uuid, p_id uuid, p_title text, p_kind text, p_body text, p_url text,
  p_attachment uuid default null, p_sort int default null)
returns public.course_materials language plpgsql security definer set search_path = public as $$
declare v public.course_materials;
begin
  perform app.lms_require(p_course);
  if p_attachment is not null then perform app.claim_attachments(array[p_attachment], 'course_materials', p_course); end if;
  if p_id is null then
    insert into public.course_materials(course_id, sort_order, title, kind, body, url, attachment_id)
    values (p_course, coalesce(p_sort, (select coalesce(max(sort_order), 0) + 1 from public.course_materials where course_id = p_course)),
            app.require_text(p_title, 'Judul materi'), p_kind, nullif(btrim(p_body), ''), nullif(btrim(p_url), ''), p_attachment)
    returning * into v;
  else
    update public.course_materials set title = app.require_text(p_title, 'Judul materi'), kind = p_kind, body = nullif(btrim(p_body), ''),
           url = nullif(btrim(p_url), ''), attachment_id = coalesce(p_attachment, attachment_id), sort_order = coalesce(p_sort, sort_order),
           updated_by = auth.uid()
     where id = p_id and course_id = p_course returning * into v;
    if v.id is null then raise exception 'Materi tidak ditemukan' using errcode = 'P0002'; end if;
  end if;
  return v;
end $$;

create or replace function public.course_material_delete(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  perform app.lms_require((select course_id from public.course_materials where id = p_id));
  delete from public.course_materials where id = p_id;
end $$;

create or replace function public.course_question_save(p_course uuid, p_id uuid, p_question text, p_options text[], p_answer int,
  p_active boolean default true)
returns public.course_questions language plpgsql security definer set search_path = public as $$
declare
  v public.course_questions;
  v_opts text[];
begin
  perform app.lms_require(p_course);
  select array_agg(btrim(o) order by n) into v_opts from unnest(p_options) with ordinality t(o, n) where coalesce(btrim(o), '') <> '';
  if coalesce(cardinality(v_opts), 0) < 2 then raise exception 'Isi minimal dua pilihan jawaban' using errcode = '22023'; end if;
  if p_answer is null or p_answer < 1 or p_answer > cardinality(v_opts) then raise exception 'Kunci jawaban tidak valid' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.course_questions(course_id, sort_order, question, options, answer, active)
    values (p_course, (select coalesce(max(sort_order), 0) + 1 from public.course_questions where course_id = p_course),
            app.require_text(p_question, 'Pertanyaan'), v_opts, p_answer, coalesce(p_active, true))
    returning * into v;
  else
    update public.course_questions set question = app.require_text(p_question, 'Pertanyaan'), options = v_opts, answer = p_answer,
           active = coalesce(p_active, active), updated_by = auth.uid()
     where id = p_id and course_id = p_course returning * into v;
    if v.id is null then raise exception 'Soal tidak ditemukan' using errcode = 'P0002'; end if;
  end if;
  return v;
end $$;

create or replace function public.course_question_delete(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  perform app.lms_require((select course_id from public.course_questions where id = p_id));
  -- soal yang sudah pernah keluar di kuis dinonaktifkan saja supaya riwayat nilai tetap utuh
  if exists(select 1 from public.course_attempts where p_id = any(question_ids)) then
    update public.course_questions set active = false, updated_by = auth.uid() where id = p_id;
  else
    delete from public.course_questions where id = p_id;
  end if;
end $$;

create or replace function public.course_set_status(p_id uuid, p_status text) returns public.courses
language plpgsql security definer set search_path = public as $$
declare
  v public.courses := app.lms_require(p_id);
  n int;
begin
  if p_status not in ('draft','published','archived') then raise exception 'Status tidak dikenal' using errcode = '22023'; end if;
  if p_status = 'published' then
    select count(*) into n from public.course_questions where course_id = p_id and active;
    if n = 0 then raise exception 'Tambahkan soal kuis sebelum menerbitkan' using errcode = '22023'; end if;
    if v.question_count is not null and v.question_count > n then
      raise exception 'Jumlah soal per kuis (%) melebihi soal aktif (%)', v.question_count, n using errcode = '22023';
    end if;
  end if;
  update public.courses set status = p_status, updated_by = auth.uid() where id = p_id returning * into v;
  return v;
end $$;

-- tugaskan ke karyawan terpilih dan/atau seluruh karyawan aktif satu departemen / jabatan
create or replace function public.course_assign(p_course uuid, p_employees uuid[], p_department uuid default null, p_position uuid default null,
  p_due date default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v public.courses := app.lms_require(p_course);
  v_ids uuid[];
  v_users uuid[];
begin
  if v.status <> 'published' then raise exception 'Terbitkan kursus sebelum menugaskan' using errcode = '22023'; end if;
  if coalesce(cardinality(p_employees), 0) = 0 and p_department is null and p_position is null then
    raise exception 'Pilih peserta' using errcode = '22023';
  end if;
  with ins as (
    insert into public.course_assignments(course_id, employee_id, due_on)
    select p_course, e.id, p_due from public.employees e
     where e.status = 'active' and (e.id = any(coalesce(p_employees, '{}')) or e.department_id = p_department or e.position_id = p_position)
    -- penugasan ulang (penyegaran) membuka kembali penugasan yang sudah selesai
    on conflict (course_id, employee_id) do update set due_on = excluded.due_on, assigned_by = auth.uid(), assigned_at = now(), completed_at = null
    returning employee_id)
  select array_agg(employee_id) into v_ids from ins;
  select array_agg(profile_id) into v_users from public.employees where id = any(coalesce(v_ids, '{}'));
  perform app.notify_users(coalesce(v_users, '{}'), 'hr.lms', 'Kursus baru: ' || v.title,
    'Selesaikan materi dan kuis' || coalesce(' sebelum ' || to_char(p_due, 'DD-MM-YYYY'), '') || '.', '/belajar/' || v.id);
  return coalesce(cardinality(v_ids), 0);
end $$;

create or replace function public.course_unassign(p_course uuid, p_employee uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.lms_require(p_course);
  delete from public.course_assignments where course_id = p_course and employee_id = p_employee and completed_at is null;
end $$;

-- ---------------------------------------------------------------- belajar
create or replace function app.lms_learner(p_course uuid, out c public.courses, out emp uuid)
language plpgsql security definer set search_path = public as $$
begin
  emp := app.my_employee();
  if emp is null then raise exception 'Akun Anda belum ditautkan ke data karyawan' using errcode = '42501'; end if;
  select * into c from public.courses where id = p_course;
  if c.id is null or c.status <> 'published' then raise exception 'Kursus tidak tersedia' using errcode = 'P0002'; end if;
  if not c.open_enroll and not exists(select 1 from public.course_assignments where course_id = p_course and employee_id = emp) then
    raise exception 'Kursus ini hanya untuk peserta yang ditugaskan' using errcode = '42501';
  end if;
end $$;

create or replace function public.course_material_done(p_material uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l record;
begin
  l := app.lms_learner((select course_id from public.course_materials where id = p_material));
  insert into public.course_progress(material_id, employee_id) values (p_material, l.emp) on conflict do nothing;
end $$;

-- mulai (atau lanjutkan) kuis; soal diacak dan dikirim tanpa kunci jawaban
create or replace function public.course_start(p_course uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l record;
  a public.course_attempts;
  n int;
begin
  l := app.lms_learner(p_course);
  perform pg_advisory_xact_lock(hashtext('course_start'), hashtext(l.emp::text || p_course::text));
  select * into a from public.course_attempts where course_id = p_course and employee_id = l.emp and submitted_at is null
     and started_at > now() - interval '1 day' order by started_at desc limit 1;
  if a.id is null then
    if exists(select 1 from public.course_materials m where m.course_id = p_course
                and not exists(select 1 from public.course_progress p where p.material_id = m.id and p.employee_id = l.emp)) then
      raise exception 'Selesaikan semua materi sebelum kuis' using errcode = '22023';
    end if;
    select count(*) into n from public.course_attempts where course_id = p_course and employee_id = l.emp and submitted_at is not null
       and started_at >= coalesce((select assigned_at from public.course_assignments where course_id = p_course and employee_id = l.emp), '-infinity');
    if (l.c).max_attempts is not null and n >= (l.c).max_attempts then
      raise exception 'Batas % kali percobaan sudah habis; hubungi penyusun kursus', (l.c).max_attempts using errcode = '22023';
    end if;
    insert into public.course_attempts(course_id, employee_id, question_ids)
    select p_course, l.emp, array_agg(id order by random()) from (
      select id from public.course_questions where course_id = p_course and active order by random() limit (l.c).question_count) q
    returning * into a;
    if a.question_ids is null then raise exception 'Kursus belum punya soal' using errcode = '22023'; end if;
  end if;
  return jsonb_build_object('attempt_id', a.id, 'started_at', a.started_at, 'duration_minutes', (l.c).duration_minutes,
    'questions', (select jsonb_agg(jsonb_build_object('id', q.id, 'question', q.question, 'options', q.options) order by t.n)
                    from unnest(a.question_ids) with ordinality t(qid, n) join public.course_questions q on q.id = t.qid));
end $$;

-- p_answers: nomor pilihan (1..n) sesuai urutan soal pada percobaan; 0/null = tidak dijawab
create or replace function public.course_submit(p_attempt uuid, p_answers int[]) returns public.course_attempts
language plpgsql security definer set search_path = public as $$
declare
  a public.course_attempts;
  c public.courses;
  comp public.competencies;
  v_correct int;
  v_score numeric;
  v_reg public.registrations;
  v_ec uuid;
begin
  select * into a from public.course_attempts where id = p_attempt for update;
  if a.id is null or a.employee_id is distinct from app.my_employee() then raise exception 'Percobaan tidak ditemukan' using errcode = 'P0002'; end if;
  if a.submitted_at is not null then raise exception 'Kuis sudah dikumpulkan' using errcode = '22023'; end if;
  select * into c from public.courses where id = a.course_id;
  select count(*) filter (where q.answer = coalesce(p_answers[t.n::int], 0)) into v_correct
    from unnest(a.question_ids) with ordinality t(qid, n) join public.course_questions q on q.id = t.qid;
  v_score := round(100.0 * v_correct / cardinality(a.question_ids), 1);
  update public.course_attempts set submitted_at = now(), answers = p_answers::smallint[], correct = v_correct, score = v_score,
         passed = v_score >= c.pass_score
   where id = a.id returning * into a;
  if a.passed then
    update public.course_assignments set completed_at = now() where course_id = c.id and employee_id = a.employee_id and completed_at is null;
    v_reg := app.allocate_number('LMS', jsonb_build_object('date', app.site_today()), 'lms:' || a.id, 'course_attempts', a.id);
    if c.competency_id is not null then
      select * into comp from public.competencies where id = c.competency_id;
      insert into public.employee_competencies(employee_id, competency_id, cert_no, issuer, issued_on, valid_until)
      values (a.employee_id, c.competency_id, v_reg.number, 'E-learning BSB', app.site_today(),
              case when comp.validity_months is not null then (app.site_today() + make_interval(months => comp.validity_months))::date - 1 end)
      returning id into v_ec;
    end if;
    update public.course_attempts set cert_no = v_reg.number, employee_competency_id = v_ec where id = a.id returning * into a;
  end if;
  return a;
end $$;

create view public.course_register with (security_invoker = true) as
select c.id, c.code, c.title, c.description, c.department_id, d.code as department_code, c.competency_id, k.code as competency_code,
       k.name as competency_name, c.pass_score, c.question_count, c.max_attempts, c.duration_minutes, c.open_enroll, c.status, c.updated_at,
       (select count(*)::int from public.course_materials m where m.course_id = c.id) as materials,
       app.lms_can_manage(c.department_id) as can_manage,
       s.assigned, s.completed, s.overdue,
       ma.id is not null as my_assigned, ma.due_on as my_due_on, ma.completed_at as my_completed_at,
       (select count(*)::int from public.course_progress p join public.course_materials m on m.id = p.material_id
         where m.course_id = c.id and p.employee_id = app.my_employee()) as my_materials_done,
       (select max(score) from public.course_attempts x where x.course_id = c.id and x.employee_id = app.my_employee()) as my_best_score,
       (select bool_or(passed) from public.course_attempts x where x.course_id = c.id and x.employee_id = app.my_employee()) as my_passed
  from public.courses c
  join public.departments d on d.id = c.department_id
  left join public.competencies k on k.id = c.competency_id
  left join public.course_assignments ma on ma.course_id = c.id and ma.employee_id = app.my_employee()
  left join lateral (select count(*)::int assigned, count(*) filter (where a.completed_at is not null)::int completed,
                            count(*) filter (where a.completed_at is null and a.due_on < app.site_today())::int overdue
                       from public.course_assignments a where a.course_id = c.id) s on true;

create view public.course_assignment_register with (security_invoker = true) as
select a.id, a.course_id, c.code as course_code, c.title as course_title, a.employee_id, e.nrp, e.full_name, d.code as department_code,
       p.name as position_name, a.due_on, a.assigned_at, a.completed_at,
       case when a.completed_at is not null then 'completed' when a.due_on < app.site_today() then 'overdue'
            when x.attempts > 0 then 'failed' when coalesce(pg.done, 0) > 0 then 'in_progress' else 'assigned' end as status,
       coalesce(x.attempts, 0) as attempts, x.best_score, x.cert_no
  from public.course_assignments a
  join public.courses c on c.id = a.course_id
  join public.employees e on e.id = a.employee_id
  join public.departments d on d.id = e.department_id
  left join public.positions p on p.id = e.position_id
  left join lateral (select count(*) filter (where submitted_at is not null)::int attempts, max(score) best_score,
                            max(cert_no) cert_no from public.course_attempts t where t.course_id = a.course_id and t.employee_id = a.employee_id) x on true
  left join lateral (select count(*)::int done from public.course_progress cp join public.course_materials m on m.id = cp.material_id
                      where m.course_id = a.course_id and cp.employee_id = a.employee_id) pg on true;

do $$
declare v text;
begin
  foreach v in array array['perf_review_register','course_register','course_assignment_register'] loop
    execute format('revoke all on public.%I from anon', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;

-- ---------------------------------------------------------------- impor (KPI massal, bank soal)
create or replace function app.import_row_ext(p_dataset text, r jsonb) returns boolean
language plpgsql set search_path = public as $$
declare
  v_id uuid;
  t text;
  v_run uuid;
  num numeric;
  v_rev uuid;
  v_course uuid;
  v_opts text[];
begin
  if p_dataset in ('data_pribadi', 'kontrak', 'idcard', 'organisasi', 'absensi', 'saldo_cuti', 'gaji', 'input_gaji', 'saldo_pajak', 'gaji_lama', 'kasbon_awal', 'kpi') then
    select id into v_id from public.employees where nrp = upper(btrim(r->>'nrp'));
    if v_id is null then raise exception 'NRP "%" tidak ditemukan', r->>'nrp'; end if;
  end if;
  case p_dataset
  when 'data_pribadi' then
    t := upper(left(coalesce(r->>'jenis_kelamin', ''), 1));
    perform public.employee_private_save(v_id, jsonb_strip_nulls(jsonb_build_object(
      'nik', nullif(regexp_replace(coalesce(r->>'nik', ''), '\D', '', 'g'), ''), 'birth_place', nullif(r->>'tempat_lahir', ''),
      'birth_date', nullif(r->>'tgl_lahir', ''), 'gender', case t when 'L' then 'L' when 'P' then 'P' when 'W' then 'P' end,
      'religion', nullif(r->>'agama', ''), 'ptkp_status', nullif(upper(replace(coalesce(r->>'ptkp', ''), ' ', '')), ''),
      'address_ktp', nullif(r->>'alamat', ''), 'phone', nullif(r->>'no_hp', ''), 'education_level', case when upper(coalesce(r->>'pendidikan', '')) in ('SMK','STM','SLTA','MA','SMU') then 'SMA' else nullif(upper(coalesce(r->>'pendidikan', '')), '') end,
      'npwp', nullif(r->>'npwp', ''), 'bpjs_tk_no', nullif(r->>'bpjs_tk', ''), 'bpjs_kes_no', nullif(r->>'bpjs_kes', ''),
      'bank_name', nullif(r->>'bank', ''), 'bank_account', nullif(regexp_replace(coalesce(r->>'no_rekening', ''), '[^0-9]', '', 'g'), ''),
      'bank_holder', nullif(r->>'nama_rekening', ''), 'emergency_name', nullif(r->>'kontak_darurat', ''),
      'emergency_phone', nullif(r->>'hp_darurat', ''))));
  when 'kontrak' then
    t := lower(coalesce(r->>'jenis', ''));
    perform public.contract_add(v_id,
      case when t in ('pkwt', 'kontrak') then 'pkwt' when t in ('pkwtt', 'tetap') then 'pkwtt' when t in ('percobaan', 'probation') then 'probation'
           when t in ('subkon', 'subcon') then 'subcon' else t end,
      nullif(r->>'no_kontrak', ''), (r->>'mulai')::date, (nullif(r->>'berakhir', ''))::date, nullif(r->>'catatan', ''));
  when 'organisasi' then
    perform public.employee_org_save(v_id,
      case when coalesce(r->>'atasan', '') = '' then null
           else coalesce((select id from public.employees where nrp = upper(btrim(r->>'atasan'))),
                         app.raise_text('NRP atasan "' || (r->>'atasan') || '" tidak ditemukan')::uuid) end,
      (select id from public.sites where code = upper(nullif(btrim(r->>'site'), ''))), nullif(r->>'golongan', ''), nullif(r->>'pola_roster', ''),
      nullif(r->>'poh', ''));
  when 'idcard' then
    perform public.id_card_issue(v_id, r->>'no_kartu',
      coalesce(array(select upper(btrim(a)) from unnest(regexp_split_to_array(coalesce(nullif(r->>'area', ''), 'OFFICE,MESS'), '[,;/ ]+')) a where btrim(a) <> ''), '{}'),
      (nullif(r->>'berlaku_sampai', ''))::date);
  when 'absensi' then
    -- Mesin fingerprint: satu baris = satu sentuhan. Jenis kosong = ditentukan otomatis (pertama masuk, terakhir pulang).
    -- waktu lengkap, atau kolom tanggal + jam terpisah (format umum ekspor mesin)
    perform app.attendance_import(v_id, (coalesce(nullif(r->>'waktu', ''), nullif(btrim(coalesce(r->>'tanggal', '') || ' ' || coalesce(r->>'jam', '')), ''))::timestamp)
      at time zone app.site_tz(), r->>'jenis', nullif(r->>'mesin', ''));
  when 'saldo_cuti' then
    perform public.leave_adjust(v_id, coalesce((nullif(r->>'tahun', ''))::int, extract(year from app.site_today())::int),
      coalesce(upper(nullif(r->>'jenis', '')), 'CT'), (r->>'hari')::numeric, coalesce(nullif(r->>'keterangan', ''), 'Saldo awal dari sistem lama'));
  when 'gaji' then
    num := nullif(regexp_replace(coalesce(r->>'nilai', ''), '[^0-9]', '', 'g'), '')::numeric;
    perform public.employee_pay_set(v_id, upper(btrim(r->>'komponen')), num, (r->>'berlaku_mulai')::date, nullif(r->>'keterangan', ''));
  when 'input_gaji' then
    v_run := app.payroll_run_for(r->>'periode');
    if v_run is null then raise exception 'Belum ada proses gaji periode % yang bisa diisi', r->>'periode'; end if;
    perform public.payroll_input_add(v_run, v_id, upper(btrim(r->>'komponen')),
      nullif(regexp_replace(coalesce(r->>'nilai', ''), '[^0-9]', '', 'g'), '')::numeric, nullif(r->>'keterangan', ''));
  when 'saldo_pajak' then
    perform public.payroll_ytd_set(v_id, (r->>'tahun')::int,
      nullif(regexp_replace(coalesce(r->>'bruto', ''), '[^0-9]', '', 'g'), '')::numeric,
      nullif(regexp_replace(coalesce(r->>'pph21', ''), '[^0-9]', '', 'g'), '')::numeric,
      nullif(regexp_replace(coalesce(r->>'iuran_pensiun', ''), '[^0-9]', '', 'g'), '')::numeric,
      nullif(r->>'bulan', '')::int, nullif(r->>'keterangan', ''));
  when 'gaji_lama' then
    perform app.payroll_legacy_set(r->>'periode', v_id,
      nullif(regexp_replace(coalesce(r->>'bruto', ''), '[^0-9]', '', 'g'), '')::numeric,
      nullif(regexp_replace(coalesce(r->>'pph21', ''), '[^0-9]', '', 'g'), '')::numeric,
      nullif(regexp_replace(coalesce(r->>'gaji_bersih', ''), '[^0-9]', '', 'g'), '')::numeric, nullif(r->>'keterangan', ''));
  when 'kasbon_awal' then
    perform app.advance_opening(v_id,
      nullif(regexp_replace(coalesce(r->>'sisa', ''), '[^0-9]', '', 'g'), '')::numeric,
      nullif(regexp_replace(coalesce(r->>'cicilan', ''), '[^0-9]', '', 'g'), '')::numeric, nullif(r->>'keterangan', ''));
  when 'kandidat' then
    -- bank kandidat dari Excel (walk-in / job fair); NIK sama diperbarui
    perform public.candidate_save((select id from public.candidates where nik = nullif(regexp_replace(coalesce(r->>'nik', ''), '\D', '', 'g'), '')),
      jsonb_strip_nulls(jsonb_build_object('full_name', nullif(r->>'nama', ''), 'nik', nullif(r->>'nik', ''), 'phone', nullif(r->>'no_hp', ''),
        'email', nullif(r->>'email', ''), 'birth_date', nullif(r->>'tgl_lahir', ''),
        'gender', case upper(left(coalesce(r->>'jenis_kelamin', ''), 1)) when 'L' then 'L' when 'P' then 'P' when 'W' then 'P' end,
        'domicile', nullif(r->>'domisili', ''), 'education_level', case when upper(coalesce(r->>'pendidikan', '')) in ('SMK','STM','SLTA','MA','SMU') then 'SMA' else nullif(upper(coalesce(r->>'pendidikan', '')), '') end,
        'education_major', nullif(r->>'jurusan', ''), 'experience_years', nullif(regexp_replace(coalesce(r->>'pengalaman', ''), '[^0-9.]', '', 'g'), ''),
        'last_employer', nullif(r->>'perusahaan_terakhir', ''),
        'is_local', case lower(coalesce(r->>'lokal', '')) when 'ya' then 'true' when 'y' then 'true' when 'tidak' then 'false' when 'n' then 'false' end,
        'note', nullif(r->>'keterangan', ''))));
  when 'kpi' then
    -- KPI massal ke siklus yang sedang menyusun KPI (atau siklus bernama di kolom siklus)
    select r2.id into v_rev from public.perf_reviews r2 join public.perf_cycles c2 on c2.id = r2.cycle_id
     where r2.employee_id = v_id and c2.status in ('goal_setting','review')
       and (nullif(btrim(r->>'siklus'), '') is null or lower(c2.name) = lower(btrim(r->>'siklus')))
     order by c2.period_start desc limit 1;
    if v_rev is null then raise exception 'NRP "%" belum terdaftar di siklus penilaian yang terbuka', r->>'nrp'; end if;
    perform public.perf_goal_save(v_rev, null, r->>'kpi', r->>'indikator', r->>'target',
      nullif(regexp_replace(coalesce(r->>'bobot', ''), '[^0-9]', '', 'g'), '')::int);
  when 'soal_kursus' then
    select id into v_course from public.courses where code = upper(btrim(r->>'kode_kursus'));
    if v_course is null then raise exception 'Kode kursus "%" tidak ditemukan', r->>'kode_kursus'; end if;
    v_opts := array[r->>'opsi_a', r->>'opsi_b', r->>'opsi_c', r->>'opsi_d', r->>'opsi_e'];
    perform public.course_question_save(v_course, null, r->>'pertanyaan', v_opts,
      position(upper(left(btrim(coalesce(r->>'jawaban', '')), 1)) in 'ABCDE'));
  else
    return false;
  end case;
  return true;
end $$;
revoke all on function app.import_row_ext(text, jsonb) from public, anon;
grant execute on function app.import_row_ext(text, jsonb) to authenticated;

revoke all on function app.perf_is_manager(uuid), app.perf_is_self(uuid), app.perf_can_view(uuid), app.perf_can_see_result(uuid),
  app.lms_can_manage(uuid), app.perf_grade(numeric) from public, anon;
grant execute on function app.perf_is_manager(uuid), app.perf_is_self(uuid), app.perf_can_view(uuid), app.perf_can_see_result(uuid),
  app.lms_can_manage(uuid), app.perf_grade(numeric) to authenticated;
-- pembantu internal: hanya dipanggil fungsi lain
revoke all on function app.perf_review_lock(uuid), app.perf_can_edit_goals(public.perf_reviews, public.perf_cycles), app.perf_check_weights(uuid),
  app.perf_save_ratings(uuid, text, jsonb), app.lms_require(uuid), app.lms_learner(uuid) from public, anon, authenticated;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and p.proname not in ('verify_document', 'feed_rows') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
