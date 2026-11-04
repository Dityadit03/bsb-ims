-- BSB IMS · Paket A hasil UAT:
--  1) Temuan P2H (unit masih layak tetapi ada item tidak OK) otomatis jadi WO perbaikan, bukan hanya P2H "tidak layak".
--  2) Lapor breakdown unscheduled di jalan oleh operator / driver (lokasi, HM, KM, foto) → WO breakdown langsung terbuka,
--     diverifikasi Plant (tolak wajib alasan dan membatalkan WO yang belum dikerjakan).
--  3) Barang di gudang yang stoknya cukup dikeluarkan langsung dengan nomor WO (tanpa MR); stok kurang tetap lewat MR.
--  4) Pemeriksaan selfie absensi oleh HRGA (valid / tidak valid dengan alasan).

insert into public.numbering_schemes(code, name, pattern, module) values
  ('BDR','Laporan breakdown di lapangan','BDR-BSB-{YYYY}-{N4}','plant');

alter table public.work_orders drop constraint work_orders_source_table_check;
alter table public.work_orders add constraint work_orders_source_table_check
  check (source_table in ('p2h_checks','inspection_findings','hazard_reports','breakdown_reports'));

-- ---------------------------------------------------------------- 1) P2H: temuan → WO
do $$
declare d text; n text;
begin
  select pg_get_functiondef('public.p2h_submit(date,int,uuid,text,text,jsonb,text,numeric,text,uuid[])'::regprocedure) into d;
  n := replace(d, E'  if v_concl = ''unfit'' then\n    perform app.notify_users(',
$r$  if u.id is not null and v_concl <> 'unfit' and v_bad > 0 then
    perform app.wo_open(u.id, 'repair', case when v_bad >= 3 then 'high' else 'medium' end,
      'P2H ' || v.p2h_no || ' temuan: ' || coalesce((select string_agg(i.label, ', ') from public.p2h_items i where p_items->>i.code = 'not_ok'), '-')
        || '. ' || coalesce(p_notes, ''), p_hour_meter, 'p2h_checks', v.id);
  end if;
  if v_concl = 'unfit' then
    perform app.notify_users($r$);
  if n = d then raise exception 'p2h_submit tidak berubah: pola tidak ditemukan'; end if;
  execute n;
end $$;

-- ---------------------------------------------------------------- 2) lapor breakdown di jalan
create table public.breakdown_reports(
  id uuid primary key default gen_random_uuid(),
  report_no text not null unique,
  unit_id uuid not null references public.units(id),
  wo_id uuid references public.work_orders(id),
  reported_by uuid not null references public.profiles(id) default auth.uid(),
  reported_at timestamptz not null default now(),
  lat numeric check (lat is null or lat between -90 and 90),
  lng numeric check (lng is null or lng between -180 and 180),
  accuracy_m numeric,
  location_note text,
  hm numeric not null check (hm >= 0),
  km numeric check (km is null or km >= 0),
  description text not null check (btrim(description) <> ''),
  need_tow boolean not null default false,
  status text not null default 'reported' check (status in ('reported','verified','rejected')),
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  verify_note text,
  check ((lat is null) = (lng is null)),
  check (lat is not null or coalesce(btrim(location_note), '') <> '')
);
create index breakdown_reports_idx on public.breakdown_reports(status, reported_at desc);
create index breakdown_reports_unit_idx on public.breakdown_reports(unit_id, reported_at desc);

alter table public.breakdown_reports enable row level security;
revoke all on public.breakdown_reports from anon;
revoke insert, update, delete on public.breakdown_reports from authenticated;
create policy breakdown_reports_read on public.breakdown_reports for select to authenticated using (app.is_active_user());
create trigger breakdown_reports_audit after insert or update or delete on public.breakdown_reports for each row execute function app.audit_row();

create or replace function public.breakdown_report(p_unit_no text, p_description text, p_hm numeric, p_km numeric default null,
  p_lat numeric default null, p_lng numeric default null, p_accuracy numeric default null, p_location_note text default null,
  p_need_tow boolean default false, p_attachments uuid[] default '{}')
returns public.breakdown_reports language plpgsql security definer set search_path = public as $$
declare u public.units; v public.breakdown_reports; w public.work_orders; v_reg public.registrations; v_plt uuid;
begin
  if not (app.has_permission_anywhere('plant.report') or app.has_permission_anywhere('she.report')) then
    raise exception 'Tidak berwenang' using errcode = '42501';
  end if;
  select * into u from public.units where unit_no = upper(btrim(coalesce(p_unit_no, '')));
  if not found or u.status = 'retired' then raise exception 'Unit % tidak ditemukan di register', coalesce(p_unit_no, '') using errcode = '22023'; end if;
  if p_hm is null then raise exception 'HM wajib diisi' using errcode = '22023'; end if;
  if p_hm < u.current_hm then raise exception 'HM % lebih kecil dari HM terakhir unit (%)', p_hm, u.current_hm using errcode = '22023'; end if;
  if (p_lat is null) <> (p_lng is null) then raise exception 'Koordinat tidak lengkap' using errcode = '22023'; end if;
  if p_lat is null and coalesce(btrim(p_location_note), '') = '' then
    raise exception 'Lokasi wajib: ambil koordinat GPS atau tulis keterangan lokasi (mis. KM 12 jalan hauling)' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_attachments), 0) = 0 then raise exception 'Foto kerusakan wajib dilampirkan' using errcode = '22023'; end if;
  perform app.require_text(p_description, 'Uraian kerusakan');
  v_reg := app.allocate_number('BDR', '{}', null);
  insert into public.breakdown_reports(report_no, unit_id, lat, lng, accuracy_m, location_note, hm, km, description, need_tow)
  values (v_reg.number, u.id, p_lat, p_lng, p_accuracy, nullif(btrim(p_location_note), ''), p_hm, p_km, btrim(p_description), coalesce(p_need_tow, false))
  returning * into v;
  update public.registrations set ref_table = 'breakdown_reports', ref_id = v.id where id = v_reg.id;
  perform app.claim_attachments(p_attachments, 'breakdown_reports', v.id);
  perform app.unit_hm(u.id, p_hm);
  select * into w from public.work_orders where unit_id = u.id and wo_type = 'breakdown' and status in ('open','in_progress','waiting_part') order by reported_at limit 1;
  if not found then
    w := app.wo_open(u.id, 'breakdown', 'urgent',
      'Breakdown di lapangan ' || v.report_no || ': ' || v.description || coalesce(' · Lokasi: ' || v.location_note, '') || case when v.need_tow then ' · PERLU DITARIK' else '' end,
      p_hm, 'breakdown_reports', v.id);
  end if;
  update public.breakdown_reports set wo_id = w.id where id = v.id returning * into v;
  select id into v_plt from public.departments where code = 'PLT';
  perform app.notify_users(app.users_with_permission('plant.work', v_plt) || app.users_with_permission('plant.work', u.department_id),
    'plant.breakdown', 'Breakdown ' || u.unit_no || case when v.need_tow then ' · perlu ditarik' else '' end,
    left(v.description, 140) || coalesce(' · ' || v.location_note, ''), '/plant/breakdown');
  return v;
end $$;

create or replace function public.breakdown_verify(p_id uuid, p_ok boolean, p_note text default null)
returns public.breakdown_reports language plpgsql security definer set search_path = public as $$
declare v public.breakdown_reports; u public.units; w public.work_orders;
begin
  select * into v from public.breakdown_reports where id = p_id for update;
  if not found then raise exception 'Laporan tidak ditemukan' using errcode = 'P0002'; end if;
  select * into u from public.units where id = v.unit_id;
  if not app.has_permission('plant.work', u.department_id) then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if v.reported_by = auth.uid() then raise exception 'Pelapor tidak boleh memverifikasi laporannya sendiri' using errcode = '42501'; end if;
  if v.status <> 'reported' then raise exception 'Laporan sudah diverifikasi (%)', v.status using errcode = '22023'; end if;
  if not p_ok then
    if coalesce(btrim(p_note), '') = '' then raise exception 'Alasan penolakan wajib diisi' using errcode = '22023'; end if;
    select * into w from public.work_orders where id = v.wo_id for update;
    if w.id is not null and w.status = 'open' and w.source_id = v.id then
      update public.work_orders set status = 'cancelled', cancel_reason = 'Laporan breakdown ditolak: ' || btrim(p_note) where id = w.id;
      if not exists(select 1 from public.work_orders where unit_id = v.unit_id and wo_type = 'breakdown' and status in ('open','in_progress','waiting_part')) then
        update public.units set status = 'ready' where id = v.unit_id and status = 'breakdown';
      end if;
    end if;
  end if;
  update public.breakdown_reports set status = case when p_ok then 'verified' else 'rejected' end, verified_by = auth.uid(), verified_at = now(),
    verify_note = nullif(btrim(p_note), '') where id = p_id returning * into v;
  perform app.notify_users(array[v.reported_by], 'plant.breakdown', 'Laporan ' || v.report_no || case when p_ok then ' diverifikasi Plant' else ' ditolak Plant' end,
    coalesce(v.verify_note, u.unit_no), '/plant/breakdown');
  return v;
end $$;

create view public.breakdown_report_view with (security_invoker = true) as
select b.*, u.unit_no, u.unit_type, w.wo_no, w.status as wo_status, rp.full_name as reporter_name, vp.full_name as verifier_name,
       coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.file_name) order by a.file_name) from public.attachments a
                  where a.owner_table = 'breakdown_reports' and a.owner_id = b.id), '[]'::jsonb) as photos
  from public.breakdown_reports b join public.units u on u.id = b.unit_id
  left join public.work_orders w on w.id = b.wo_id
  left join public.profiles rp on rp.id = b.reported_by left join public.profiles vp on vp.id = b.verified_by;

-- ---------------------------------------------------------------- 3) pengeluaran langsung dari WO
create or replace function public.wo_issue(p_wo uuid, p_material uuid, p_qty numeric, p_note text default null)
returns public.stock_movements language plpgsql security definer set search_path = public as $$
declare w public.work_orders; m public.materials; v public.stock_movements; v_reg public.registrations; v_free numeric;
begin
  perform app.require_log('log.warehouse');
  select * into w from public.work_orders where id = p_wo for update;
  if not found then raise exception 'WO tidak ditemukan' using errcode = 'P0002'; end if;
  if w.status not in ('open','in_progress','waiting_part') then raise exception 'WO % sudah ditutup', w.wo_no using errcode = '22023'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Jumlah tidak valid' using errcode = '22023'; end if;
  select * into m from public.materials where id = p_material;
  if not found or not m.active then raise exception 'Barang tidak ditemukan' using errcode = '22023'; end if;
  if m.category = 'fuel' then raise exception 'BBM dikeluarkan lewat Stasiun BBM atau pengisian unit' using errcode = '22023'; end if;
  v_free := m.stock_qty - coalesce((select reserved_qty from public.material_reservation where material_id = p_material), 0);
  if v_free < p_qty then
    raise exception 'Stok % tersedia % % (sudah dikurangi pesanan MR lain); kurang dari %. Barang yang tidak cukup harus lewat MR (Minta suku cadang di WO)',
      m.code, v_free, m.uom, p_qty using errcode = '22023';
  end if;
  m := app.stock_out(p_material, p_qty);
  v_reg := app.allocate_number('GI', '{}', null);
  insert into public.stock_movements(movement_no, movement_type, material_id, qty, unit_cost, wo_id, unit_id, note)
  values (v_reg.number, 'issue', p_material, -p_qty, m.avg_cost, w.id, w.unit_id, coalesce(nullif(btrim(p_note), ''), 'Pengeluaran langsung dari WO ' || w.wo_no))
  returning * into v;
  update public.registrations set ref_table = 'stock_movements', ref_id = v.id where id = v_reg.id;
  return v;
end $$;

create view public.wo_issue_view with (security_invoker = true) as
select s.id, s.movement_no, s.moved_at, s.wo_id, w.wo_no, u.unit_no, m.code as material_code, m.name as material_name, m.uom, -s.qty as qty,
       -s.qty * s.unit_cost as value, p.full_name as issued_by_name, s.note
  from public.stock_movements s join public.work_orders w on w.id = s.wo_id join public.units u on u.id = w.unit_id
  join public.materials m on m.id = s.material_id left join public.profiles p on p.id = s.moved_by
 where s.movement_type = 'issue' and s.mr_id is null;

-- ---------------------------------------------------------------- 4) pemeriksaan selfie absensi
create table public.attendance_photo_reviews(
  log_id uuid primary key references public.attendance_logs(id),
  status text not null check (status in ('valid','invalid')),
  note text,
  reviewed_by uuid not null references public.profiles(id) default auth.uid(),
  reviewed_at timestamptz not null default now(),
  check (status = 'valid' or coalesce(btrim(note), '') <> '')
);
alter table public.attendance_photo_reviews enable row level security;
revoke all on public.attendance_photo_reviews from anon;
revoke insert, update, delete on public.attendance_photo_reviews from authenticated;
create policy attendance_photo_reviews_read on public.attendance_photo_reviews for select to authenticated using (app.is_hr());
create trigger attendance_photo_reviews_audit after insert or update or delete on public.attendance_photo_reviews for each row execute function app.audit_row();

create or replace function public.attendance_photo_review(p_log uuid, p_valid boolean, p_note text default null)
returns public.attendance_photo_reviews language plpgsql security definer set search_path = public as $$
declare l public.attendance_logs; v public.attendance_photo_reviews; e public.employees;
begin
  if not app.is_hr() then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  select * into l from public.attendance_logs where id = p_log;
  if not found or l.photo_id is null then raise exception 'Absen tidak ditemukan atau tanpa foto' using errcode = '22023'; end if;
  if not p_valid and coalesce(btrim(p_note), '') = '' then raise exception 'Alasan wajib diisi bila foto tidak valid' using errcode = '22023'; end if;
  insert into public.attendance_photo_reviews(log_id, status, note) values (p_log, case when p_valid then 'valid' else 'invalid' end, nullif(btrim(p_note), ''))
  on conflict (log_id) do update set status = excluded.status, note = excluded.note, reviewed_by = auth.uid(), reviewed_at = now()
  returning * into v;
  if not p_valid then
    select * into e from public.employees where id = l.employee_id;
    if e.profile_id is not null then
      perform app.notify_users(array[e.profile_id], 'hr.attendance_photo', 'Foto absen tanggal ' || to_char(l.at at time zone app.site_tz(), 'DD-MM-YYYY') || ' tidak valid',
        v.note, '/absen');
    end if;
  end if;
  return v;
end $$;

create view public.attendance_photo_view with (security_invoker = true) as
select l.id as log_id, l.employee_id, e.nrp, e.full_name, d.code as department_code, l.at, l.kind, l.source, l.photo_id, l.in_geofence, l.distance_m,
       r.status as review_status, r.note as review_note, rv.full_name as reviewer_name, r.reviewed_at
  from public.attendance_logs l join public.employees e on e.id = l.employee_id left join public.departments d on d.id = e.department_id
  left join public.attendance_photo_reviews r on r.log_id = l.id left join public.profiles rv on rv.id = r.reviewed_by
 where l.photo_id is not null;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('breakdown_report','breakdown_verify','wo_issue','attendance_photo_review') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
revoke all on public.breakdown_report_view, public.wo_issue_view, public.attendance_photo_view from anon;
grant select on public.breakdown_report_view, public.wo_issue_view, public.attendance_photo_view to authenticated;
