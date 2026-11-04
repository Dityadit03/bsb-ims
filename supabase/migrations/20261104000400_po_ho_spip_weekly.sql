-- Paket C (UAT): PO lewat HO (site beli / HO beli) dan inspeksi SPIP mingguan.

-- ---------------------------------------------------------------- 1) PO diterima HO
insert into public.permissions(code, module, description) values
  ('log.ho','logistics','Menerima PO dari site di kantor pusat (HO) dan memprosesnya')
on conflict do nothing;
insert into public.roles(code, name, description, is_system) values
  ('HO_PROCUREMENT','Pengadaan HO','Menerima PO dari site; mengembalikan ke site untuk dibeli atau membeli langsung dari HO', true)
on conflict do nothing;
insert into public.role_permissions(role_code, permission_code) values ('HO_PROCUREMENT','log.ho')
on conflict do nothing;

alter table public.purchase_orders
  add column buy_at text not null default 'site' check (buy_at in ('site','ho')),
  add column ho_stage text check (ho_stage in ('sent','received','returned','ordered')),
  add column ho_sent_at timestamptz,
  add column ho_received_at timestamptz,
  add column ho_received_by uuid references public.profiles(id),
  add column ho_note text;

-- p_action: send (site kirim ke HO, p_buy_at site|ho) | receive (HO terima) | return (HO kembalikan ke site untuk dibeli) | order (HO beli langsung)
create or replace function public.po_ho_route(p_po uuid, p_action text, p_buy_at text default null, p_note text default null)
returns public.purchase_orders language plpgsql security definer set search_path = public as $$
declare v public.purchase_orders;
begin
  select * into v from public.purchase_orders where id = p_po for update;
  if not found then raise exception 'PO tidak ditemukan' using errcode = 'P0002'; end if;
  if p_action = 'send' then
    if not (app.has_permission('log.purchase', app.log_dept()) or app.has_permission('log.manage', app.log_dept())) then
      raise exception 'Tidak berwenang mengirim PO ke HO' using errcode = '42501';
    end if;
    if v.status not in ('issued','partial') then raise exception 'Hanya PO yang sudah disetujui yang dikirim ke HO' using errcode = '22023'; end if;
    if v.ho_stage is not null then raise exception 'PO sudah diproses HO' using errcode = '22023'; end if;
    if p_buy_at not in ('site','ho') then raise exception 'Pilih pembelian di site atau di HO' using errcode = '22023'; end if;
    update public.purchase_orders set buy_at = p_buy_at, ho_stage = 'sent', ho_sent_at = now(), ho_note = nullif(btrim(p_note), '')
     where id = p_po returning * into v;
    perform app.notify_users(app.users_with_permission('log.ho'), 'log.po', 'PO ' || v.po_no || ' dikirim dari site',
      case v.buy_at when 'ho' then 'Dibeli oleh HO' else 'Dibeli di site setelah diterima HO' end, '/logistik/pengadaan/' || v.pr_id);
  else
    if not app.has_permission_anywhere('log.ho') then raise exception 'Hanya pengadaan HO yang dapat memproses' using errcode = '42501'; end if;
    if p_action = 'receive' then
      if v.ho_stage is distinct from 'sent' then raise exception 'PO belum dikirim ke HO atau sudah diterima' using errcode = '22023'; end if;
      update public.purchase_orders set ho_stage = 'received', ho_received_at = now(), ho_received_by = auth.uid() where id = p_po returning * into v;
      perform app.notify_users(app.users_with_permission('log.purchase', app.log_dept()), 'log.po', 'PO ' || v.po_no || ' diterima HO', '', '/logistik/pengadaan/' || v.pr_id);
    elsif p_action = 'return' then
      if v.ho_stage is distinct from 'received' or v.buy_at <> 'site' then raise exception 'Hanya PO pembelian site yang sudah diterima HO' using errcode = '22023'; end if;
      update public.purchase_orders set ho_stage = 'returned', ho_note = coalesce(nullif(btrim(p_note), ''), ho_note) where id = p_po returning * into v;
      perform app.notify_users(app.users_with_permission('log.purchase', app.log_dept()), 'log.po', 'PO ' || v.po_no || ' dikembalikan ke site untuk dibeli',
        coalesce(p_note, ''), '/logistik/pengadaan/' || v.pr_id);
    elsif p_action = 'order' then
      if v.ho_stage is distinct from 'received' or v.buy_at <> 'ho' then raise exception 'Hanya PO pembelian HO yang sudah diterima HO' using errcode = '22023'; end if;
      update public.purchase_orders set ho_stage = 'ordered', ho_note = coalesce(nullif(btrim(p_note), ''), ho_note) where id = p_po returning * into v;
      perform app.notify_users(app.users_with_permission('log.purchase', app.log_dept()), 'log.po', 'PO ' || v.po_no || ' dibeli oleh HO',
        'Barang akan dikirim ke site; terima lewat GR seperti biasa', '/logistik/pengadaan/' || v.pr_id);
    else raise exception 'Aksi tidak dikenal' using errcode = '22023';
    end if;
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------- 2) inspeksi SPIP mingguan
create table public.spip_check_items(
  id uuid primary key default gen_random_uuid(),
  object_type text check (object_type in ('unit','tool','installation')),
  text text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.spip_check_items(object_type, text, sort_order) values
  (null, 'Stiker / sertifikat komisioning terpasang dan terbaca', 1),
  (null, 'Kondisi fisik baik, tidak ada kerusakan yang membahayakan', 2),
  (null, 'Perlengkapan keselamatan (APAR, rambu, pengaman) lengkap dan berfungsi', 3);

create table public.spip_inspections(
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.commissioning_records(id),
  week_start date not null,
  inspected_on date not null default app.site_today(),
  inspector_id uuid not null references public.profiles(id) default auth.uid(),
  result text not null check (result in ('ok','attention')),
  note text,
  created_at timestamptz not null default now(),
  unique (record_id, week_start)
);
create table public.spip_inspection_items(
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.spip_inspections(id) on delete cascade,
  item_text text not null,
  result text not null check (result in ('ok','tidak','na')),
  note text
);
create index spip_inspections_week on public.spip_inspections(week_start);

do $$
declare t text;
begin
  foreach t in array array['spip_check_items','spip_inspections','spip_inspection_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
    execute format('create policy %I_read on public.%I for select to authenticated using (app.is_active_user())', t, t);
  end loop;
end $$;

create or replace function app.spip_auth() returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not (app.has_permission('spip.manage', app.dept_by_code('PLT')) or app.has_permission('spip.manage', app.dept_by_code('HSE'))) then
    raise exception 'Inspeksi SPIP dilakukan Plant atau HSE' using errcode = '42501';
  end if;
end $$;

create or replace function public.spip_item_save(p_id uuid, p_object_type text, p_text text, p_sort int default 0, p_active boolean default true)
returns public.spip_check_items language plpgsql security definer set search_path = public as $$
declare v public.spip_check_items;
begin
  perform app.spip_auth();
  if p_id is null then
    insert into public.spip_check_items(object_type, text, sort_order, active) values (nullif(p_object_type, ''), app.require_text(p_text, 'Butir periksa'), coalesce(p_sort, 0), coalesce(p_active, true)) returning * into v;
  else
    update public.spip_check_items set object_type = nullif(p_object_type, ''), text = app.require_text(p_text, 'Butir periksa'), sort_order = coalesce(p_sort, 0), active = coalesce(p_active, true)
     where id = p_id returning * into v;
    if not found then raise exception 'Butir tidak ditemukan' using errcode = 'P0002'; end if;
  end if;
  return v;
end $$;

-- p_items: [{"text": "...", "result": "ok|tidak|na", "note": "..."}]. Satu inspeksi per objek per minggu (Senin-Minggu WIB).
create or replace function public.spip_inspect(p_record uuid, p_items jsonb, p_note text default null, p_attachments uuid[] default '{}')
returns public.spip_inspections language plpgsql security definer set search_path = public as $$
declare v public.spip_inspections; r public.commissioning_records; it jsonb; v_bad int := 0; v_wk date := date_trunc('week', app.site_today())::date;
begin
  perform app.spip_auth();
  select * into r from public.commissioning_records where id = p_record;
  if not found then raise exception 'Objek komisioning tidak ditemukan' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Isi butir pemeriksaan' using errcode = '22023'; end if;
  if exists(select 1 from public.spip_inspections where record_id = p_record and week_start = v_wk) then
    raise exception 'Objek ini sudah diinspeksi minggu ini' using errcode = '22023';
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if it->>'result' not in ('ok','tidak','na') then raise exception 'Hasil butir tidak valid' using errcode = '22023'; end if;
    if it->>'result' = 'tidak' then
      v_bad := v_bad + 1;
      if nullif(btrim(it->>'note'), '') is null then raise exception 'Butir yang tidak sesuai wajib diberi catatan' using errcode = '22023'; end if;
    end if;
  end loop;
  insert into public.spip_inspections(record_id, week_start, result, note) values (p_record, v_wk, case when v_bad > 0 then 'attention' else 'ok' end, nullif(btrim(p_note), ''))
    returning * into v;
  insert into public.spip_inspection_items(inspection_id, item_text, result, note)
  select v.id, app.require_text(x->>'text', 'Butir'), x->>'result', nullif(btrim(x->>'note'), '') from jsonb_array_elements(p_items) x;
  perform app.claim_attachments(p_attachments, 'spip_inspections', v.id);
  if v_bad > 0 then
    perform app.notify_users(app.users_with_permission('spip.manage', app.dept_by_code('PLT')), 'spip', 'Inspeksi SPIP ' || r.ref_code || ': ' || v_bad || ' butir tidak sesuai',
      left(coalesce(p_note, r.name), 140), '/plant/spip/inspeksi');
  end if;
  return v;
end $$;

create view public.spip_weekly with (security_invoker = true) as
select r.id as record_id, r.object_type, r.ref_code, r.name, r.unit_id,
       i.inspected_on as this_week_on, i.result as this_week_result, i.id as this_week_id,
       (select max(x.inspected_on) from public.spip_inspections x where x.record_id = r.id) as last_inspected_on,
       i.id is null as due
  from public.commissioning_records r
  left join public.spip_inspections i on i.record_id = r.id and i.week_start = date_trunc('week', app.site_today())::date;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('po_ho_route','spip_item_save','spip_inspect') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
revoke all on public.spip_weekly from anon;
grant select on public.spip_weekly to authenticated;
