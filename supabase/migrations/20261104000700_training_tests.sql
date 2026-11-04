-- Pra-tes, pasca-tes, dan umpan balik peserta untuk training internal (lewat QR). Training eksternal tidak berubah.
alter table public.trainings add column kind text not null default 'external' check (kind in ('internal','external'));

create or replace function app.can_manage_training(p_training uuid) returns boolean language sql stable security definer set search_path = public as $$
  select app.has_permission('hr.manage', app.hrga_dept()) or exists(select 1 from public.trainings where id = p_training and created_by = auth.uid())
$$;

create table public.training_questions(
  id uuid primary key default gen_random_uuid(),
  training_id uuid not null references public.trainings(id) on delete cascade,
  sort_order int not null default 0,
  question text not null,
  options jsonb not null,
  correct smallint not null check (correct >= 0 and correct <= 5)
);
create table public.training_tests(
  id uuid primary key default gen_random_uuid(),
  training_id uuid not null references public.trainings(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  phase text not null check (phase in ('pre','post')),
  score numeric not null check (score between 0 and 100),
  correct_count int not null,
  total int not null,
  submitted_at timestamptz not null default now(),
  unique (training_id, employee_id, phase)
);
create table public.training_feedback(
  id uuid primary key default gen_random_uuid(),
  training_id uuid not null references public.trainings(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  rating_material smallint not null check (rating_material between 1 and 5),
  rating_speaker smallint not null check (rating_speaker between 1 and 5),
  rating_organization smallint not null check (rating_organization between 1 and 5),
  comment text,
  submitted_at timestamptz not null default now(),
  unique (training_id, employee_id)
);

do $$
declare t text;
begin
  foreach t in array array['training_questions','training_tests','training_feedback'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
  end loop;
end $$;
-- kunci jawaban hanya untuk penyelenggara; hasil tes/umpan balik untuk penyelenggara dan pemiliknya
create policy training_questions_read on public.training_questions for select to authenticated using (app.can_manage_training(training_id));
create policy training_tests_read on public.training_tests for select to authenticated using (app.can_manage_training(training_id) or employee_id = app.my_employee());
create policy training_feedback_read on public.training_feedback for select to authenticated using (app.can_manage_training(training_id) or employee_id = app.my_employee());

-- training_create menandai pelatihan internal
do $$
declare d text; n text;
begin
  select pg_get_functiondef('public.training_create(text,date,time,numeric,text,text,text,text,text,uuid,uuid[],text[],uuid[])'::regprocedure) into d;
  n := replace(d, 'target_departments, target_levels)', 'target_departments, target_levels, kind)');
  n := replace(n, E'coalesce(p_departments, ''{}''), coalesce(p_levels, ''{}''))', E'coalesce(p_departments, ''{}''), coalesce(p_levels, ''{}''), ''internal'')');
  if n = d then raise exception 'training_create tidak berubah'; end if;
  execute n;
end $$;

-- p_questions: [{"question": "...", "options": ["a","b",...], "correct": 0}]; mengganti bank soal selama belum ada yang mengerjakan
create or replace function public.training_questions_save(p_training uuid, p_questions jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare t public.trainings; q jsonb; i int := 0;
begin
  perform app.training_auth(p_training);
  select * into t from public.trainings where id = p_training;
  if t.kind <> 'internal' then raise exception 'Pra/pasca-tes hanya untuk training internal' using errcode = '22023'; end if;
  if exists(select 1 from public.training_tests where training_id = p_training) then raise exception 'Soal tidak bisa diubah setelah ada peserta mengerjakan' using errcode = '22023'; end if;
  if jsonb_typeof(p_questions) is distinct from 'array' then raise exception 'Format soal tidak valid' using errcode = '22023'; end if;
  if jsonb_array_length(p_questions) > 50 then raise exception 'Maksimal 50 soal' using errcode = '22023'; end if;
  delete from public.training_questions where training_id = p_training;
  for q in select * from jsonb_array_elements(p_questions) loop
    if jsonb_typeof(q->'options') is distinct from 'array' or jsonb_array_length(q->'options') not between 2 and 6 then
      raise exception 'Setiap soal butuh 2 sampai 6 pilihan' using errcode = '22023';
    end if;
    if (q->>'correct')::int not between 0 and jsonb_array_length(q->'options') - 1 then raise exception 'Kunci jawaban tidak valid' using errcode = '22023'; end if;
    insert into public.training_questions(training_id, sort_order, question, options, correct)
    values (p_training, i, app.require_text(q->>'question', 'Pertanyaan'), q->'options', (q->>'correct')::smallint);
    i := i + 1;
  end loop;
  return i;
end $$;

-- Soal untuk peserta (tanpa kunci)
create or replace function public.training_test_questions(p_token text)
returns table(id uuid, question text, options jsonb) language plpgsql stable security definer set search_path = public as $$
declare t public.trainings;
begin
  select * into t from public.trainings where qr_token = p_token and kind = 'internal';
  if not found or not app.is_active_user() then return; end if;
  if not exists(select 1 from public.training_attendees a where a.training_id = t.id and a.employee_id = app.my_employee()) then return; end if;
  return query select q.id, q.question, q.options from public.training_questions q where q.training_id = t.id order by q.sort_order;
end $$;

-- Kirim jawaban: p_answers {"<id soal>": indeks}. Sekali per fase; pasca-tes setelah pra-tes (bila ada soal).
create or replace function public.training_test_submit(p_token text, p_phase text, p_answers jsonb)
returns public.training_tests language plpgsql security definer set search_path = public as $$
declare t public.trainings; v_emp uuid := app.my_employee(); v_total int; v_ok int; r public.training_tests;
begin
  if p_phase not in ('pre','post') then raise exception 'Fase tidak valid' using errcode = '22023'; end if;
  select * into t from public.trainings where qr_token = p_token and kind = 'internal';
  if not found then raise exception 'Pelatihan tidak ditemukan' using errcode = 'P0002'; end if;
  if v_emp is null or not exists(select 1 from public.training_attendees a where a.training_id = t.id and a.employee_id = v_emp) then
    raise exception 'Catat kehadiran dulu dengan QR' using errcode = '22023';
  end if;
  if t.status <> 'planned' then raise exception 'Pelatihan sudah ditutup' using errcode = '22023'; end if;
  select count(*) into v_total from public.training_questions where training_id = t.id;
  if v_total = 0 then raise exception 'Belum ada soal' using errcode = '22023'; end if;
  if exists(select 1 from public.training_tests where training_id = t.id and employee_id = v_emp and phase = p_phase) then
    raise exception 'Tes ini sudah Anda kerjakan' using errcode = '22023';
  end if;
  if p_phase = 'post' and not exists(select 1 from public.training_tests where training_id = t.id and employee_id = v_emp and phase = 'pre') then
    raise exception 'Kerjakan pra-tes dulu' using errcode = '22023';
  end if;
  select count(*) into v_ok from public.training_questions q where (p_answers->>(q.id::text)) is not null and (p_answers->>(q.id::text))::int = q.correct and q.training_id = t.id;
  insert into public.training_tests(training_id, employee_id, phase, score, correct_count, total)
  values (t.id, v_emp, p_phase, round(v_ok * 100.0 / v_total, 1), v_ok, v_total) returning * into r;
  return r;
end $$;

create or replace function public.training_feedback_submit(p_token text, p_material int, p_speaker int, p_organization int, p_comment text default null)
returns public.training_feedback language plpgsql security definer set search_path = public as $$
declare t public.trainings; v_emp uuid := app.my_employee(); r public.training_feedback;
begin
  select * into t from public.trainings where qr_token = p_token and kind = 'internal';
  if not found then raise exception 'Pelatihan tidak ditemukan' using errcode = 'P0002'; end if;
  if v_emp is null or not exists(select 1 from public.training_attendees a where a.training_id = t.id and a.employee_id = v_emp) then
    raise exception 'Catat kehadiran dulu dengan QR' using errcode = '22023';
  end if;
  if exists(select 1 from public.training_questions where training_id = t.id)
     and not exists(select 1 from public.training_tests where training_id = t.id and employee_id = v_emp and phase = 'post') then
    raise exception 'Kerjakan pasca-tes dulu' using errcode = '22023';
  end if;
  if exists(select 1 from public.training_feedback where training_id = t.id and employee_id = v_emp) then raise exception 'Umpan balik sudah dikirim' using errcode = '22023'; end if;
  insert into public.training_feedback(training_id, employee_id, rating_material, rating_speaker, rating_organization, comment)
  values (t.id, v_emp, p_material, p_speaker, p_organization, nullif(btrim(p_comment), '')) returning * into r;
  return r;
end $$;

-- Status saya untuk halaman QR (peserta tidak butuh hak baca tabel hasil)
create or replace function public.training_my_progress(p_token text)
returns table(kind text, attended boolean, questions int, pre_score numeric, post_score numeric, feedback_done boolean)
language sql stable security definer set search_path = public as $$
  select t.kind,
    exists(select 1 from public.training_attendees a where a.training_id = t.id and a.employee_id = app.my_employee()),
    (select count(*)::int from public.training_questions q where q.training_id = t.id),
    (select x.score from public.training_tests x where x.training_id = t.id and x.employee_id = app.my_employee() and x.phase = 'pre'),
    (select x.score from public.training_tests x where x.training_id = t.id and x.employee_id = app.my_employee() and x.phase = 'post'),
    exists(select 1 from public.training_feedback f where f.training_id = t.id and f.employee_id = app.my_employee())
   from public.trainings t where t.qr_token = p_token and app.is_active_user()
$$;

-- Rekap untuk penyelenggara
create view public.training_result_view with (security_invoker = true) as
select a.training_id, a.employee_id, e.nrp, e.full_name,
       pre.score as pre_score, post.score as post_score, post.score - pre.score as gain,
       f.rating_material, f.rating_speaker, f.rating_organization, f.comment
  from public.training_attendees a
  join public.employees e on e.id = a.employee_id
  left join public.training_tests pre on pre.training_id = a.training_id and pre.employee_id = a.employee_id and pre.phase = 'pre'
  left join public.training_tests post on post.training_id = a.training_id and post.employee_id = a.employee_id and post.phase = 'post'
  left join public.training_feedback f on f.training_id = a.training_id and f.employee_id = a.employee_id
 where app.can_manage_training(a.training_id) or a.employee_id = app.my_employee();

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('training_questions_save','training_test_questions','training_test_submit','training_feedback_submit','training_my_progress') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
revoke execute on function app.can_manage_training(uuid) from public, anon;
grant execute on function app.can_manage_training(uuid) to authenticated;
revoke all on public.training_result_view from anon;
grant select on public.training_result_view to authenticated;
