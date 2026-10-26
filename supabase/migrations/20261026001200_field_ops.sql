-- Pack lapangan: toolbox talk (safety briefing awal shift) dan serah terima shift.
create table public.toolbox_talks(
  id uuid primary key default gen_random_uuid(),
  talk_date date not null,
  shift smallint not null check (shift in (1, 2)),
  department_id uuid not null references public.departments(id),
  topic text not null check (btrim(topic) <> ''),
  notes text,
  led_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index toolbox_talks_date_idx on public.toolbox_talks(talk_date desc, department_id);

create table public.toolbox_attendees(
  talk_id uuid not null references public.toolbox_talks(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  primary key (talk_id, employee_id)
);
create index toolbox_attendees_emp_idx on public.toolbox_attendees(employee_id);

create table public.shift_handovers(
  id uuid primary key default gen_random_uuid(),
  handover_date date not null,
  shift smallint not null check (shift in (1, 2)),          -- shift yang menyerahkan
  department_id uuid not null references public.departments(id),
  area text,
  summary text not null check (btrim(summary) <> ''),
  pending_work text,
  hazards text,
  units_note text,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  received_by uuid references public.profiles(id),
  received_at timestamptz,
  check ((received_by is null) = (received_at is null))
);
create index shift_handovers_date_idx on public.shift_handovers(handover_date desc, department_id);

do $$
declare t text;
begin
  foreach t in array array['toolbox_talks','toolbox_attendees','shift_handovers'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create policy %I_read on public.%I for select to authenticated using (app.is_active_user())', t, t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
  end loop;
end $$;

-- p_nrps: daftar NRP peserta; NRP yang tidak dikenal / tidak aktif membatalkan seluruh catatan
create or replace function public.toolbox_record(p_date date, p_shift int, p_department uuid, p_topic text, p_notes text, p_nrps text[])
returns public.toolbox_talks language plpgsql security definer set search_path = public as $$
declare v public.toolbox_talks; v_ids uuid[]; v_nrps text[];
begin
  if not app.has_permission('she.report', p_department) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if p_date is null or p_date > current_date + 1 then raise exception 'Tanggal tidak valid' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct upper(btrim(n))), '{}') into v_nrps from unnest(coalesce(p_nrps, '{}')) n where btrim(n) <> '';
  if coalesce(array_length(v_nrps, 1), 0) = 0 then raise exception 'Peserta wajib diisi' using errcode = '22023'; end if;
  select array_agg(id) into v_ids from public.employees where upper(nrp) = any(v_nrps) and status = 'active';
  if coalesce(array_length(v_ids, 1), 0) <> array_length(v_nrps, 1) then
    raise exception 'NRP tidak dikenal atau tidak aktif: %', (select string_agg(n, ', ') from unnest(v_nrps) n
      where not exists(select 1 from public.employees e where upper(e.nrp) = n and e.status = 'active')) using errcode = '22023';
  end if;
  insert into public.toolbox_talks(talk_date, shift, department_id, topic, notes)
  values (p_date, p_shift, p_department, app.require_text(p_topic, 'Topik'), nullif(btrim(coalesce(p_notes, '')), '')) returning * into v;
  insert into public.toolbox_attendees(talk_id, employee_id) select v.id, unnest(v_ids);
  return v;
end $$;

create or replace function public.handover_submit(p_date date, p_shift int, p_department uuid, p_area text, p_summary text,
  p_pending text default null, p_hazards text default null, p_units text default null)
returns public.shift_handovers language plpgsql security definer set search_path = public as $$
declare v public.shift_handovers;
begin
  if not app.has_permission('she.report', p_department) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if p_date is null or p_date > current_date + 1 then raise exception 'Tanggal tidak valid' using errcode = '22023'; end if;
  insert into public.shift_handovers(handover_date, shift, department_id, area, summary, pending_work, hazards, units_note)
  values (p_date, p_shift, p_department, nullif(btrim(coalesce(p_area, '')), ''), app.require_text(p_summary, 'Ringkasan'),
          nullif(btrim(coalesce(p_pending, '')), ''), nullif(btrim(coalesce(p_hazards, '')), ''), nullif(btrim(coalesce(p_units, '')), ''))
  returning * into v;
  return v;
end $$;

-- penerima adalah orang lain di departemen yang sama (bukan yang menyerahkan)
create or replace function public.handover_ack(p_id uuid)
returns public.shift_handovers language plpgsql security definer set search_path = public as $$
declare v public.shift_handovers;
begin
  select * into v from public.shift_handovers where id = p_id for update;
  if not found then raise exception 'Serah terima tidak ditemukan' using errcode = 'P0002'; end if;
  if not app.has_permission('she.report', v.department_id) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if v.created_by = auth.uid() then raise exception 'Penerima harus orang lain' using errcode = '42501'; end if;
  if v.received_by is not null then raise exception 'Sudah diterima' using errcode = '23505'; end if;
  update public.shift_handovers set received_by = auth.uid(), received_at = now() where id = p_id returning * into v;
  perform app.log_event('handover.ack', 'shift_handovers', p_id::text, null);
  return v;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and p.proname not in ('verify_document','feed_rows') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
