-- BSB IMS · Paket lapangan: kiriman dari antrean offline harus aman bila terkirim dua kali, dan absen tetap bisa saat GPS tidak tersedia.
-- 1) client_requests: penanda kiriman (UUID dari perangkat) agar ulang-kirim tidak menggandakan P2H/absen.
-- 2) attendance_clock: waktu rekam dari perangkat (antrean offline) dan absen tanpa GPS dengan alasan (ditandai untuk ditinjau atasan/HRGA).

create table public.client_requests(
  id uuid primary key,
  user_id uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.client_requests enable row level security;
revoke all on public.client_requests from anon, authenticated;
create trigger client_requests_audit after insert or update or delete on public.client_requests for each row execute function app.audit_row();

-- true bila kiriman baru (silakan diproses), false bila sudah pernah diterima
create function public.client_request_claim(p_id uuid) returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Belum masuk' using errcode = '42501'; end if;
  insert into public.client_requests(id) values (p_id) on conflict do nothing;
  return found;
end $$;

-- dilepas bila pemrosesan gagal, supaya percobaan berikutnya boleh jalan
create function public.client_request_release(p_id uuid) returns void language sql security definer set search_path = public as $$
  delete from public.client_requests where id = p_id and user_id = auth.uid();
$$;

drop function public.attendance_clock(text, numeric, numeric, numeric, uuid, text);
create function public.attendance_clock(p_kind text, p_lat numeric, p_lng numeric, p_accuracy numeric, p_photo uuid,
                                        p_device text default null, p_at timestamptz default null, p_note text default null)
returns public.attendance_logs language plpgsql security definer set search_path = public as $$
declare
  v public.attendance_logs;
  v_emp uuid := app.my_employee();
  v_at timestamptz := coalesce(p_at, now());
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  loc_id uuid; loc_dist int; loc_radius int; loc_ok boolean;
begin
  if v_emp is null or not app.is_active_user() then raise exception 'Akun Anda belum ditautkan ke data karyawan; hubungi HRGA' using errcode = '42501'; end if;
  if not exists(select 1 from public.employees where id = v_emp and status = 'active') then raise exception 'Karyawan tidak aktif' using errcode = '42501'; end if;
  if p_kind not in ('in','out') then raise exception 'Jenis absen tidak dikenal' using errcode = '22023'; end if;
  if v_at > now() + interval '5 minutes' or v_at < now() - interval '3 days' then
    raise exception 'Waktu absen tidak wajar (maksimal 3 hari ke belakang); hubungi atasan untuk koreksi' using errcode = '22023';
  end if;
  if (p_lat is null or p_lng is null) and v_note is null then
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
      loc_ok := loc_dist <= loc_radius + least(coalesce(p_accuracy, 0), 100);
      if not loc_ok and coalesce((select value #>> '{}' from public.app_settings where key = 'attendance_geofence_mode'), 'flag') = 'reject' then
        raise exception 'Anda berada % m dari lokasi absen terdekat (radius % m)', loc_dist, loc_radius using errcode = '22023';
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
