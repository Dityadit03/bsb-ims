-- Foto temuan dan foto perbaikan ikut ke Excel / Google Sheets sebagai TAUTAN (bukan gambar tertanam),
-- agar berkas tetap ringan. Tautan membuka foto lewat aplikasi, jadi hanya pengguna yang sudah masuk dan berwenang yang bisa melihatnya.

-- Tahap foto pada lampiran hazard: temuan (saat dilapor) atau perbaikan (saat ditutup)
alter table public.attachments add column phase text check (phase in ('temuan','perbaikan'));

-- Data lama: lampiran yang diunggah lebih dari 5 menit setelah laporan dibuat berasal dari penutupan/tindak lanjut
update public.attachments a set phase = case when a.uploaded_at > h.created_at + interval '5 minutes' then 'perbaikan' else 'temuan' end
  from public.hazard_reports h where a.owner_table = 'hazard_reports' and a.owner_id = h.id;

create or replace function public.hazard_close(p_id uuid, p_note text, p_attachments uuid[] default '{}')
returns public.hazard_reports language plpgsql security definer set search_path = public as $$
declare v public.hazard_reports;
begin
  select * into v from public.hazard_reports where id = p_id for update;
  if not found then raise exception 'Hazard report tidak ditemukan' using errcode = 'P0002'; end if;
  if not app.has_permission('she.followup', v.pic_department_id) then
    raise exception 'Hanya pengawas departemen PIC yang bisa menutup' using errcode = '42501';
  end if;
  if v.status <> 'open' then raise exception 'Hazard report tidak berstatus open' using errcode = '22023'; end if;
  if v.risk_level in ('high','extreme') and coalesce(cardinality(p_attachments), 0) = 0 then
    raise exception 'Temuan risiko tinggi/ekstrem wajib dilampiri bukti perbaikan' using errcode = '22023';
  end if;
  perform app.claim_attachments(p_attachments, 'hazard_reports', v.id);
  update public.attachments set phase = 'perbaikan' where id = any(p_attachments);
  update public.hazard_reports set status = 'closed', close_note = app.require_text(p_note, 'Tindakan perbaikan'),
         closed_by = auth.uid(), closed_at = now()
   where id = p_id returning * into v;
  return v;
end $$;

-- Foto laporan baru otomatis bertahap "temuan"
create function app.attachment_default_phase() returns trigger language plpgsql set search_path = public as $$
begin
  if new.owner_table = 'hazard_reports' and new.phase is null and (tg_op = 'INSERT' or old.owner_id is null) then new.phase := 'temuan'; end if;
  return new;
end $$;
create trigger attachments_default_phase before insert or update of owner_table, owner_id on public.attachments
  for each row execute function app.attachment_default_phase();

-- Tampilan: daftar id lampiran (maksimum 3 pertama, urut unggah) dan jumlahnya; aplikasi mengubahnya menjadi tautan
create or replace view public.she_hazard_register with (security_invoker = true) as
select h.*, d.code as department_code, pd.code as pic_department_code, w.name as work_area_name, p.full_name as reporter_name,
       (h.status = 'open' and h.due_date < current_date) as is_overdue,
       (select count(*) from public.corrective_actions a where a.source_table = 'hazard_reports' and a.source_id = h.id)::int as capa_count,
       pt.name as pic_partner_name,
       (select array_agg(x.id order by x.uploaded_at) from (select id, uploaded_at from public.attachments
          where owner_table = 'hazard_reports' and owner_id = h.id and phase = 'temuan' order by uploaded_at limit 3) x) as photo_temuan,
       (select count(*)::int from public.attachments where owner_table = 'hazard_reports' and owner_id = h.id and phase = 'temuan') as photo_temuan_count,
       (select array_agg(x.id order by x.uploaded_at) from (select id, uploaded_at from public.attachments
          where owner_table = 'hazard_reports' and owner_id = h.id and phase = 'perbaikan' order by uploaded_at limit 3) x) as photo_perbaikan,
       (select count(*)::int from public.attachments where owner_table = 'hazard_reports' and owner_id = h.id and phase = 'perbaikan') as photo_perbaikan_count
  from public.hazard_reports h
  join public.departments d on d.id = h.department_id
  join public.departments pd on pd.id = h.pic_department_id
  left join public.work_areas w on w.id = h.work_area_id
  join public.profiles p on p.id = h.reporter_id
  left join public.partners pt on pt.id = h.pic_partner_id;

-- Temuan inspeksi: foto temuan = lampiran inspeksinya; foto perbaikan = lampiran penutupan temuan
create or replace view public.she_finding_register with (security_invoker = true) as
select f.*, i.inspection_no, i.inspected_on, i.inspection_type, i.object, pd.code as pic_department_code,
       (f.status = 'open' and f.due_date < current_date) as is_overdue, pt.name as pic_partner_name,
       (select array_agg(x.id order by x.uploaded_at) from (select id, uploaded_at from public.attachments
          where owner_table = 'inspections' and owner_id = f.inspection_id order by uploaded_at limit 3) x) as photo_temuan,
       (select count(*)::int from public.attachments where owner_table = 'inspections' and owner_id = f.inspection_id) as photo_temuan_count,
       (select array_agg(x.id order by x.uploaded_at) from (select id, uploaded_at from public.attachments
          where owner_table = 'inspection_findings' and owner_id = f.id order by uploaded_at limit 3) x) as photo_perbaikan,
       (select count(*)::int from public.attachments where owner_table = 'inspection_findings' and owner_id = f.id) as photo_perbaikan_count
  from public.inspection_findings f
  join public.inspections i on i.id = f.inspection_id
  join public.departments pd on pd.id = f.pic_department_id
  left join public.partners pt on pt.id = f.pic_partner_id;

-- CAPA: foto perbaikan = bukti penyelesaian; foto temuan = foto hazard asalnya (bila bersumber dari hazard)
create or replace view public.capa_register with (security_invoker = true) as
select a.*, c.code as clause_code, c.title as clause_title, c.framework_code,
       d.code as department_code, pic.full_name as pic_name, ver.full_name as verifier_name,
       (a.status in ('open','in_progress') and a.due_date < current_date) as is_overdue,
       (select array_agg(x.id order by x.uploaded_at) from (select id, uploaded_at from public.attachments
          where owner_table = 'hazard_reports' and owner_id = a.source_id and phase = 'temuan' and a.source_table = 'hazard_reports'
          order by uploaded_at limit 3) x) as photo_temuan,
       (select count(*)::int from public.attachments where owner_table = 'hazard_reports' and owner_id = a.source_id
          and phase = 'temuan' and a.source_table = 'hazard_reports') as photo_temuan_count,
       (select array_agg(x.id order by x.uploaded_at) from (select id, uploaded_at from public.attachments
          where owner_table = 'corrective_actions' and owner_id = a.id order by uploaded_at limit 3) x) as photo_perbaikan,
       (select count(*)::int from public.attachments where owner_table = 'corrective_actions' and owner_id = a.id) as photo_perbaikan_count
  from public.corrective_actions a
  join public.compliance_clauses c on c.id = a.clause_id
  join public.departments d on d.id = a.department_id
  join public.profiles pic on pic.id = a.pic_id
  join public.profiles ver on ver.id = a.verifier_id;

grant select on public.she_hazard_register, public.she_finding_register, public.capa_register to authenticated;
revoke all on public.she_hazard_register, public.she_finding_register, public.capa_register from anon;


-- Observasi dan inspeksi (SAP): register dengan tautan foto, dan ikut ke feed Google Sheets
create view public.she_observation_register with (security_invoker = true) as
select o.id, o.obs_no, o.observed_on, d.code as department_code, w.name as work_area_name, o.activity, o.worker_name, o.worker_count,
       o.result, o.unsafe_behaviour, o.coaching, o.status, o.closed_at, p.full_name as observer_name, o.created_at,
       (select array_agg(x.id order by x.uploaded_at) from (select id, uploaded_at from public.attachments
          where owner_table = 'observations' and owner_id = o.id order by uploaded_at limit 3) x) as photo_temuan,
       (select count(*)::int from public.attachments where owner_table = 'observations' and owner_id = o.id) as photo_temuan_count
  from public.observations o
  join public.departments d on d.id = o.department_id
  left join public.work_areas w on w.id = o.work_area_id
  join public.profiles p on p.id = o.observer_id;

create view public.she_inspection_register with (security_invoker = true) as
select i.id, i.inspection_no, i.inspected_on, i.inspection_type, d.code as department_code, w.name as work_area_name, i.object, i.note,
       p.full_name as inspector_name, i.created_at,
       (select count(*)::int from public.inspection_findings f where f.inspection_id = i.id) as findings,
       (select count(*)::int from public.inspection_findings f where f.inspection_id = i.id and f.status = 'open') as findings_open,
       (select array_agg(x.id order by x.uploaded_at) from (select id, uploaded_at from public.attachments
          where owner_table = 'inspections' and owner_id = i.id order by uploaded_at limit 3) x) as photo_temuan,
       (select count(*)::int from public.attachments where owner_table = 'inspections' and owner_id = i.id) as photo_temuan_count
  from public.inspections i
  join public.departments d on d.id = i.department_id
  left join public.work_areas w on w.id = i.work_area_id
  join public.profiles p on p.id = i.inspector_id;

grant select on public.she_observation_register, public.she_inspection_register to authenticated;
revoke all on public.she_observation_register, public.she_inspection_register from anon;

create or replace function public.feed_rows(p_token text, p_dataset text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.feed_tokens;
  v_view text;
  v_order text;
  v_rows jsonb;
begin
  select * into t from public.feed_tokens where token_hash = app.feed_hash(coalesce(p_token, '')) and revoked_at is null;
  if not found or not exists(select 1 from public.profiles where id = t.user_id and status = 'active') then
    raise exception 'Token tidak berlaku' using errcode = '42501';
  end if;
  select x.v, x.o into v_view, v_order from (values
    ('hazard', 'she_hazard_register', 'created_at desc'),
    ('temuan', 'she_finding_register', 'inspected_on desc'),
    ('insiden', 'incident_register', 'occurred_at desc'),
    ('capa', 'capa_register', 'created_at desc'),
    ('risiko', 'risk_register_view', 'risk_no'),
    ('unit', 'unit_availability', 'unit_no'),
    ('wo', 'work_order_register', 'reported_at desc'),
    ('pm', 'pm_due', 'unit_no'),
    ('spip', 'commissioning_register', 'ref_code'),
    ('produksi', 'production_summary', 'report_date desc'),
    ('stok', 'material_stock', 'code'),
    ('mutasi', 'stock_ledger', 'moved_at desc'),
    ('mr', 'mr_register', 'created_at desc'),
    ('tracking', 'mr_tracking', 'mr_no desc'),
    ('pr', 'pr_register', 'created_at desc'),
    ('po', 'po_register', 'created_at desc'),
    ('sap', 'sap_weekly', 'week_start desc'),
    ('observasi', 'she_observation_register', 'observed_on desc'),
    ('inspeksi', 'she_inspection_register', 'inspected_on desc')
  ) as x(k, v, o) where x.k = p_dataset;
  if v_view is null then raise exception 'Dataset tidak tersedia untuk feed' using errcode = '22023'; end if;
  update public.feed_tokens set last_used_at = now() where id = t.id;
  -- satu nilai jsonb (bukan setof) agar tidak terpotong batas baris API
  execute format('select coalesce(jsonb_agg(to_jsonb(r)), ''[]'') from (select * from public.%I order by %s limit 20000) r', v_view, v_order) into v_rows;
  return v_rows;
end $$;
revoke all on function public.feed_rows(text, text) from public;
grant execute on function public.feed_rows(text, text) to anon, authenticated;
