-- Training center internal: materi, narasumber, sasaran departemen/jabatan (checklist), notifikasi, QR kehadiran.
insert into public.permissions(code, module, description) values
  ('training.organize','hrga','Mengadakan pelatihan internal (materi, narasumber, sasaran, QR kehadiran)')
on conflict do nothing;
insert into public.role_permissions(role_code, permission_code) values
  ('DEPT_HEAD','training.organize'), ('SUPERINTENDENT','training.organize'), ('HSE_MANAGER','training.organize'), ('SUPERVISOR','training.organize')
on conflict do nothing;

alter table public.trainings
  add column description text,
  add column start_time time,
  add column speaker_org text,
  add column speaker_bio text,
  add column target_departments uuid[] not null default '{}',
  add column target_levels text[] not null default '{}',
  add column qr_token text not null default replace(gen_random_uuid()::text, '-', ''),
  add column qr_open boolean not null default true;
create unique index trainings_qr_token_uq on public.trainings(qr_token);
alter table public.training_attendees
  add column source text not null default 'hr' check (source in ('hr','qr')),
  add column checked_in_at timestamptz;

create or replace function app.training_auth(p_training uuid) returns void language plpgsql stable security definer set search_path = public as $$
begin
  if app.has_permission('hr.manage', app.hrga_dept()) then return; end if;
  if exists(select 1 from public.trainings where id = p_training and created_by = auth.uid()) then return; end if;
  raise exception 'Tidak berwenang' using errcode = '42501';
end $$;

-- penyelenggara (pembuat) boleh menambah peserta dan menutup pelatihannya
do $$
declare d text; n text; f text;
begin
  foreach f in array array['public.training_add_attendees(uuid,uuid[])', 'public.training_complete(uuid,jsonb)'] loop
    select pg_get_functiondef(f::regprocedure) into d;
    n := replace(d, E'perform app.require_hr(''hr.manage'');', E'perform app.training_auth(p_training);');
    if n = d then raise exception '% tidak berubah', f; end if;
    execute n;
  end loop;
end $$;

-- p_levels / p_departments kosong = semua
create or replace function public.training_create(p_title text, p_held_on date, p_start time, p_hours numeric, p_location text, p_description text,
  p_speaker text, p_speaker_org text, p_speaker_bio text, p_competency uuid default null, p_departments uuid[] default '{}', p_levels text[] default '{}',
  p_attachments uuid[] default '{}')
returns public.trainings language plpgsql security definer set search_path = public as $$
declare v public.trainings; v_to uuid[];
begin
  if not (app.has_permission('hr.manage', app.hrga_dept()) or app.has_permission_anywhere('training.organize')) then
    raise exception 'Tidak berwenang mengadakan pelatihan' using errcode = '42501';
  end if;
  if coalesce(p_hours, 0) <= 0 then raise exception 'Durasi wajib diisi' using errcode = '22023'; end if;
  if exists(select 1 from unnest(coalesce(p_levels, '{}')) l where l not in ('PJO','DH','SH','SPV','FOR','STAFF','OPR')) then
    raise exception 'Level jabatan tidak valid' using errcode = '22023';
  end if;
  insert into public.trainings(title, competency_id, held_on, start_time, hours, trainer, speaker_org, speaker_bio, location, description, target_departments, target_levels)
  values (app.require_text(p_title, 'Judul pelatihan'), p_competency, p_held_on, p_start, p_hours, app.require_text(p_speaker, 'Nama narasumber'),
          nullif(btrim(p_speaker_org), ''), nullif(btrim(p_speaker_bio), ''), nullif(btrim(p_location), ''), nullif(btrim(p_description), ''),
          coalesce(p_departments, '{}'), coalesce(p_levels, '{}'))
  returning * into v;
  perform app.claim_attachments(p_attachments, 'trainings', v.id);
  select coalesce(array_agg(e.profile_id), '{}') into v_to from public.employees e
    left join public.positions p on p.id = e.position_id
   where e.status = 'active' and e.profile_id is not null and e.profile_id <> auth.uid()
     and (cardinality(v.target_departments) = 0 or e.department_id = any(v.target_departments))
     and (cardinality(v.target_levels) = 0 or p.level = any(v.target_levels));
  perform app.notify_users(v_to, 'hr.training', 'Undangan pelatihan: ' || v.title,
    to_char(v.held_on, 'DD-MM-YYYY') || coalesce(' ' || to_char(v.start_time, 'HH24:MI'), '') || coalesce(' · ' || v.location, '') || ' · narasumber ' || v.trainer,
    '/pelatihan/ikut/' || v.qr_token);
  return v;
end $$;

create or replace function public.training_qr_set(p_training uuid, p_open boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  perform app.training_auth(p_training);
  update public.trainings set qr_open = coalesce(p_open, true) where id = p_training;
end $$;

-- Data ringkas untuk halaman QR (peserta tidak perlu hak baca tabel pelatihan)
create or replace function public.training_by_token(p_token text)
returns table(id uuid, title text, held_on date, start_time time, hours numeric, location text, description text, trainer text, speaker_org text, speaker_bio text,
              status text, qr_open boolean, joined boolean)
language sql stable security definer set search_path = public as $$
  select t.id, t.title, t.held_on, t.start_time, t.hours, t.location, t.description, t.trainer, t.speaker_org, t.speaker_bio, t.status, t.qr_open,
         exists(select 1 from public.training_attendees a where a.training_id = t.id and a.employee_id = app.my_employee())
    from public.trainings t where t.qr_token = p_token and app.is_active_user()
$$;

-- Kehadiran lewat QR: karyawan yang login mencatat dirinya sendiri, hanya pada hari pelatihan
create or replace function public.training_checkin(p_token text)
returns public.training_attendees language plpgsql security definer set search_path = public as $$
declare t public.trainings; v_emp uuid := app.my_employee(); a public.training_attendees;
begin
  if not app.is_active_user() then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if v_emp is null then raise exception 'Akun Anda belum terhubung ke data karyawan; hubungi HRGA' using errcode = '22023'; end if;
  select * into t from public.trainings where qr_token = p_token;
  if not found then raise exception 'QR tidak dikenal' using errcode = 'P0002'; end if;
  if t.status <> 'planned' or not t.qr_open then raise exception 'Kehadiran untuk pelatihan ini sudah ditutup' using errcode = '22023'; end if;
  if t.held_on <> app.site_today() then raise exception 'Pelatihan ini dijadwalkan %, kehadiran hanya bisa dicatat pada hari itu', to_char(t.held_on, 'DD-MM-YYYY') using errcode = '22023'; end if;
  insert into public.training_attendees(training_id, employee_id, source, checked_in_at) values (t.id, v_emp, 'qr', now())
  on conflict (training_id, employee_id) do update set checked_in_at = coalesce(public.training_attendees.checked_in_at, now())
  returning * into a;
  return a;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('training_create','training_qr_set','training_by_token','training_checkin') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
