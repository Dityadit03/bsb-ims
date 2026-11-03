-- BSB IMS · Logistik: pengisian BBM / oli "Lainnya" (di luar unit terdaftar) wajib disetujui PJO.
-- Petugas gudang mengajukan (pihak penerima + keperluan); stok baru berkurang setelah PJO menyetujui.
-- Bila diambil dari tangki, isi tangki dan buku tangki ikut tercatat saat disetujui.

insert into public.permissions(code, module, description) values
  ('log.approve_fuel_other','logistics','Menyetujui pengisian BBM / oli di luar unit terdaftar (Lainnya)');
insert into public.role_permissions(role_code, permission_code) values ('PJO','log.approve_fuel_other');

insert into public.numbering_schemes(code, name, pattern, module) values
  ('FO','Pengisian BBM lainnya','FO-BSB-{YYYY}-{N4}','logistics');

-- Pergerakan BBM tanpa unit boleh asal tujuan lain tercatat.
alter table public.stock_movements add column other_to text;
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.stock_movements'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%movement_type <> ''fuel''%unit_id IS NOT NULL%';
  if c is not null then execute format('alter table public.stock_movements drop constraint %I', c); end if;
end $$;
alter table public.stock_movements add constraint stock_movements_fuel_target
  check (movement_type <> 'fuel' or unit_id is not null or other_to is not null);

create table public.fuel_other_requests(
  id uuid primary key default gen_random_uuid(),
  request_no text unique,
  material_id uuid not null references public.materials(id),
  tank_id uuid references public.fuel_tanks(id),
  liters numeric not null check (liters > 0),
  recipient text not null check (btrim(recipient) <> ''),
  purpose text not null check (btrim(purpose) <> ''),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  requested_by uuid not null references public.profiles(id) default auth.uid(),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text,
  movement_id uuid references public.stock_movements(id)
);
create index fuel_other_requests_idx on public.fuel_other_requests(status, requested_at desc);

alter table public.fuel_other_requests enable row level security;
revoke all on public.fuel_other_requests from anon;
revoke insert, update, delete on public.fuel_other_requests from authenticated;
create policy fuel_other_requests_read on public.fuel_other_requests for select to authenticated
  using (requested_by = auth.uid() or app.has_permission_anywhere('log.warehouse') or app.has_permission_anywhere('log.approve_fuel_other'));
create trigger fuel_other_requests_audit after insert or update or delete on public.fuel_other_requests for each row execute function app.audit_row();

create view public.fuel_other_view with (security_invoker = true) as
select f.*, m.code as material_code, m.name as material_name, m.uom, t.code as tank_code,
       rp.full_name as requested_name, dp.full_name as decided_name
  from public.fuel_other_requests f join public.materials m on m.id = f.material_id
  left join public.fuel_tanks t on t.id = f.tank_id
  left join public.profiles rp on rp.id = f.requested_by left join public.profiles dp on dp.id = f.decided_by;
revoke all on public.fuel_other_view from anon;
grant select on public.fuel_other_view to authenticated;

create or replace function public.fuel_other_request(p_material uuid, p_liters numeric, p_recipient text, p_purpose text,
  p_tank uuid default null, p_idempotency_key text default null)
returns public.fuel_other_requests language plpgsql security definer set search_path = public as $$
declare v public.fuel_other_requests; v_reg public.registrations; m public.materials; t public.fuel_tanks;
begin
  perform app.require_log('log.warehouse');
  if p_idempotency_key is not null then
    select f.* into v from public.registrations r join public.fuel_other_requests f on f.id = r.ref_id where r.idempotency_key = p_idempotency_key;
    if found then return v; end if;
  end if;
  select * into m from public.materials where id = p_material;
  if not found or m.category not in ('fuel','lubricant') then raise exception 'Hanya BBM / oli yang bisa diajukan' using errcode = '22023'; end if;
  if p_liters is null or p_liters <= 0 then raise exception 'Jumlah liter tidak valid' using errcode = '22023'; end if;
  if coalesce(btrim(p_recipient), '') = '' then raise exception 'Penerima (nama pihak / kendaraan / alat) wajib diisi' using errcode = '22023'; end if;
  if coalesce(btrim(p_purpose), '') = '' then raise exception 'Keperluan wajib diisi' using errcode = '22023'; end if;
  if p_tank is not null then
    select * into t from public.fuel_tanks where id = p_tank;
    if not found or not t.active then raise exception 'Tangki tidak aktif' using errcode = '22023'; end if;
    if t.material_id <> p_material then raise exception 'Tangki % bukan untuk barang ini', t.code using errcode = '22023'; end if;
  end if;
  v_reg := app.allocate_number('FO', '{}', p_idempotency_key);
  insert into public.fuel_other_requests(request_no, material_id, tank_id, liters, recipient, purpose)
  values (v_reg.number, p_material, p_tank, p_liters, btrim(p_recipient), btrim(p_purpose)) returning * into v;
  update public.registrations set ref_table = 'fuel_other_requests', ref_id = v.id where id = v_reg.id;
  perform app.notify_users(app.users_with_permission('log.approve_fuel_other'), 'log.fuel_other',
    'Pengisian ' || v.request_no || ' menunggu persetujuan PJO',
    m.code || ' ' || p_liters || ' L untuk ' || v.recipient || ' (' || v.purpose || ')', '/logistik#bbm-lainnya');
  return v;
end $$;

create or replace function public.fuel_other_decide(p_id uuid, p_approve boolean, p_note text default null)
returns public.fuel_other_requests language plpgsql security definer set search_path = public as $$
declare v public.fuel_other_requests; m public.materials; t public.fuel_tanks; mv public.stock_movements; v_reg public.registrations;
begin
  if not app.has_permission_anywhere('log.approve_fuel_other') then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  select * into v from public.fuel_other_requests where id = p_id for update;
  if not found then raise exception 'Pengajuan tidak ditemukan' using errcode = 'P0002'; end if;
  if v.status <> 'pending' then raise exception 'Pengajuan sudah diputuskan (%)', v.status using errcode = '22023'; end if;
  if v.requested_by = auth.uid() then raise exception 'Pengaju tidak boleh menyetujui pengajuannya sendiri' using errcode = '42501'; end if;
  if not p_approve then
    if coalesce(btrim(p_note), '') = '' then raise exception 'Alasan penolakan wajib diisi' using errcode = '22023'; end if;
    update public.fuel_other_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = btrim(p_note)
     where id = p_id returning * into v;
  else
    if v.tank_id is not null then
      select * into t from public.fuel_tanks where id = v.tank_id for update;
      if not t.active or not t.opened then raise exception 'Tangki % belum siap dipakai', t.code using errcode = '22023'; end if;
      if t.level_l < v.liters then raise exception 'Isi tangki % hanya % L', t.code, t.level_l using errcode = '22023'; end if;
    end if;
    m := app.stock_out(v.material_id, v.liters);
    v_reg := app.allocate_number('GI', '{}');
    insert into public.stock_movements(movement_no, movement_type, material_id, qty, unit_cost, other_to, note, moved_by)
    values (v_reg.number, 'fuel', v.material_id, -v.liters, m.avg_cost, v.recipient, 'Lainnya ' || v.request_no || ': ' || v.purpose, v.requested_by)
    returning * into mv;
    update public.registrations set ref_table = 'stock_movements', ref_id = mv.id where id = v_reg.id;
    if v.tank_id is not null then
      update public.fuel_tanks set level_l = level_l - v.liters where id = v.tank_id;
      insert into public.fuel_tank_logs(tank_id, kind, liters, level_after, movement_id, note, created_by)
      values (v.tank_id, 'issue', -v.liters, t.level_l - v.liters, mv.id, 'Lainnya: ' || v.recipient || ' · ' || v.purpose, v.requested_by);
    end if;
    update public.fuel_other_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), ''), movement_id = mv.id
     where id = p_id returning * into v;
  end if;
  perform app.notify_users(array[v.requested_by], 'log.fuel_other',
    'Pengisian ' || v.request_no || case when p_approve then ' disetujui PJO' else ' ditolak PJO' end,
    coalesce(v.decision_note, v.recipient), '/logistik#bbm-lainnya');
  return v;
end $$;

create or replace function public.fuel_other_cancel(p_id uuid)
returns public.fuel_other_requests language plpgsql security definer set search_path = public as $$
declare v public.fuel_other_requests;
begin
  select * into v from public.fuel_other_requests where id = p_id for update;
  if not found then raise exception 'Pengajuan tidak ditemukan' using errcode = 'P0002'; end if;
  if v.requested_by <> auth.uid() then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if v.status <> 'pending' then raise exception 'Pengajuan sudah diputuskan (%)', v.status using errcode = '22023'; end if;
  update public.fuel_other_requests set status = 'cancelled', decided_at = now() where id = p_id returning * into v;
  return v;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('fuel_other_request', 'fuel_other_decide', 'fuel_other_cancel') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
