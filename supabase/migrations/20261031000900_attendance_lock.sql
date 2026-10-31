-- Kunci absen: karyawan hanya bisa absen di dalam radius lokasi yang ditetapkan administrator.
-- Mode 'reject' (kunci): koordinat wajib, akurasi GPS harus <= 100 m, minimal satu lokasi aktif, di luar radius ditolak, absen tanpa GPS ditolak.
-- Mode 'flag' (longgar, bawaan lama): tetap diterima dan ditandai. Administrator sistem (user.manage) atau HRGA yang mengatur lokasi & mode.

create or replace function public.attendance_location_save(p_id uuid, p_name text, p_lat numeric, p_lng numeric, p_radius int, p_active boolean default true)
returns public.attendance_locations language plpgsql security definer set search_path = public as $$
declare v public.attendance_locations;
begin
  if not app.has_permission_anywhere('user.manage') then perform app.require_hr('hr.manage'); end if;
  if p_id is null then
    insert into public.attendance_locations(name, lat, lng, radius_m, active) values (app.require_text(p_name, 'Nama lokasi'), p_lat, p_lng, coalesce(p_radius, 300), coalesce(p_active, true))
    returning * into v;
  else
    update public.attendance_locations set name = app.require_text(p_name, 'Nama lokasi'), lat = p_lat, lng = p_lng, radius_m = coalesce(p_radius, radius_m),
      active = coalesce(p_active, active) where id = p_id returning * into v;
    if not found then raise exception 'Lokasi tidak ditemukan' using errcode = 'P0002'; end if;
  end if;
  return v;
end $$;

create function public.attendance_policy_set(p_mode text, p_require_photo boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app.has_permission_anywhere('user.manage') then perform app.require_hr('hr.manage'); end if;
  if p_mode not in ('flag', 'reject') then raise exception 'Mode harus flag atau reject' using errcode = '22023'; end if;
  if p_mode = 'reject' and not exists(select 1 from public.attendance_locations where active) then
    raise exception 'Tambahkan minimal satu lokasi absen aktif sebelum mengunci absen' using errcode = '22023';
  end if;
  update public.app_settings set value = to_jsonb(p_mode) where key = 'attendance_geofence_mode';
  update public.app_settings set value = to_jsonb(coalesce(p_require_photo, true)) where key = 'attendance_require_photo';
  perform app.log_event('attendance.policy', 'app_settings', 'attendance', jsonb_build_object('mode', p_mode, 'photo', coalesce(p_require_photo, true)));
end $$;

create or replace function public.attendance_clock(p_kind text, p_lat numeric, p_lng numeric, p_accuracy numeric, p_photo uuid,
                                        p_device text default null, p_at timestamptz default null, p_note text default null)
returns public.attendance_logs language plpgsql security definer set search_path = public as $$
declare
  v public.attendance_logs;
  v_emp uuid := app.my_employee();
  v_at timestamptz := coalesce(p_at, now());
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_lock boolean := coalesce((select value #>> '{}' from public.app_settings where key = 'attendance_geofence_mode'), 'flag') = 'reject';
  loc_id uuid; loc_dist int; loc_radius int; loc_ok boolean;
begin
  if v_emp is null or not app.is_active_user() then raise exception 'Akun Anda belum ditautkan ke data karyawan; hubungi HRGA' using errcode = '42501'; end if;
  if not exists(select 1 from public.employees where id = v_emp and status = 'active') then raise exception 'Karyawan tidak aktif' using errcode = '42501'; end if;
  if p_kind not in ('in','out') then raise exception 'Jenis absen tidak dikenal' using errcode = '22023'; end if;
  if v_at > now() + interval '5 minutes' or v_at < now() - interval '3 days' then
    raise exception 'Waktu absen tidak wajar (maksimal 3 hari ke belakang); hubungi atasan untuk koreksi' using errcode = '22023';
  end if;
  if v_lock then
    if p_lat is null or p_lng is null then raise exception 'Absen terkunci ke lokasi: GPS wajib aktif (absen tanpa GPS dinonaktifkan)' using errcode = '22023'; end if;
    if p_accuracy is null or p_accuracy > 100 then raise exception 'Akurasi GPS kurang (±% m). Pindah ke tempat terbuka lalu coba lagi', coalesce(p_accuracy::int::text, '?') using errcode = '22023'; end if;
    if not exists(select 1 from public.attendance_locations where active) then raise exception 'Belum ada lokasi absen aktif; hubungi administrator' using errcode = '22023'; end if;
  elsif (p_lat is null or p_lng is null) and v_note is null then
    raise exception 'Lokasi belum terbaca; aktifkan GPS atau isi alasan absen tanpa GPS' using errcode = '22023';
  end if;
  if p_photo is null and coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'attendance_require_photo'), true) then
    raise exception 'Ambil selfie terlebih dahulu' using errcode = '22023';
  end if;
  if p_photo is not null then perform app.claim_attachments(array[p_photo], 'attendance_logs', v_emp); end if;
  if exists(select 1 from public.attendance_logs where employee_id = v_emp and kind = p_kind and abs(extract(epoch from at - v_at)) < 120) then
    raise exception 'Absen % sudah tercatat barusan', case p_kind when 'in' then 'masuk' else 'pulang' end using errcode = '22023';
  end if;
  if p_lat is not null and p_lng is not null then
    select l.id, l.radius_m, round(2 * 6371000 * asin(sqrt(power(sin(radians(l.lat - p_lat) / 2), 2)
             + cos(radians(p_lat)) * cos(radians(l.lat)) * power(sin(radians(l.lng - p_lng) / 2), 2))))::int as dist
      into loc_id, loc_radius, loc_dist from public.attendance_locations l where l.active order by 3 limit 1;
    if loc_id is not null then
      loc_ok := loc_dist <= loc_radius + least(coalesce(p_accuracy, 0), case when v_lock then 30 else 100 end);
      if not loc_ok and v_lock then
        raise exception 'Anda berada % m dari lokasi absen terdekat (radius % m). Absen hanya bisa di dalam lokasi', loc_dist, loc_radius using errcode = '22023';
      end if;
    end if;
  end if;
  insert into public.attendance_logs(employee_id, at, kind, source, lat, lng, accuracy_m, location_id, distance_m, in_geofence, photo_id, device, note)
  values (v_emp, v_at, p_kind, 'app', p_lat, p_lng, p_accuracy, loc_id, loc_dist, loc_ok, p_photo, left(p_device, 200),
          case when p_lat is null then 'TANPA GPS: ' || v_note
               when p_at is not null and p_at < now() - interval '5 minutes' then 'Dikirim terlambat dari antrean offline' || coalesce(' · ' || v_note, '')
               else v_note end)
  returning * into v;
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
