-- Pemisahan data HO dan site (tahap 1: pengadaan). Site lain tinggal ditambah baris di public.sites.
alter table public.sites add column kind text not null default 'site' check (kind in ('site','ho'));
insert into public.sites(code, name, kind, client_company, timezone) values ('HO', 'Kantor Pusat (HO)', 'ho', null, 'Asia/Jakarta');

create or replace function app.default_site() returns uuid language sql stable security definer set search_path = public as $$
  select id from public.sites where code = 'BDA'
$$;

update public.profiles set site_id = app.default_site() where site_id is null;
alter table public.profiles alter column site_id set not null, alter column site_id set default app.default_site();

create or replace function app.my_site() returns uuid language sql stable security definer set search_path = public as $$
  select coalesce((select site_id from public.profiles where id = auth.uid()), app.default_site())
$$;

-- pengadaan per site
alter table public.purchase_requisitions add column site_id uuid references public.sites(id);
alter table public.purchase_orders add column site_id uuid references public.sites(id);
update public.purchase_requisitions set site_id = app.default_site();
update public.purchase_orders set site_id = app.default_site();
alter table public.purchase_requisitions alter column site_id set not null, alter column site_id set default app.my_site();
alter table public.purchase_orders alter column site_id set not null, alter column site_id set default app.my_site();

-- Baca: site sendiri; pengadaan HO juga melihat PO (dan PR/baris terkait) yang sudah dikirim ke HO dari site mana pun.
create or replace function app.can_see_po(p_site uuid, p_ho_stage text) returns boolean language sql stable security definer set search_path = public as $$
  select app.is_active_user() and (p_site = app.my_site() or (p_ho_stage is not null and app.has_permission_anywhere('log.ho')))
$$;
create or replace function app.can_see_pr(p_pr uuid) returns boolean language sql stable security definer set search_path = public as $$
  select app.is_active_user() and exists(
    select 1 from public.purchase_requisitions r where r.id = p_pr and (r.site_id = app.my_site()
      or (app.has_permission_anywhere('log.ho') and exists(select 1 from public.purchase_orders o where o.pr_id = r.id and o.ho_stage is not null))))
$$;

drop policy purchase_requisitions_read on public.purchase_requisitions;
drop policy purchase_requisition_lines_read on public.purchase_requisition_lines;
drop policy supplier_quotes_read on public.supplier_quotes;
drop policy purchase_orders_read on public.purchase_orders;
drop policy purchase_order_lines_read on public.purchase_order_lines;
create policy purchase_requisitions_read on public.purchase_requisitions for select to authenticated using (app.can_see_pr(id));
create policy purchase_requisition_lines_read on public.purchase_requisition_lines for select to authenticated using (app.can_see_pr(pr_id));
create policy supplier_quotes_read on public.supplier_quotes for select to authenticated
  using (app.can_see_pr((select l.pr_id from public.purchase_requisition_lines l where l.id = pr_line_id)));
create policy purchase_orders_read on public.purchase_orders for select to authenticated using (app.can_see_po(site_id, ho_stage));
create policy purchase_order_lines_read on public.purchase_order_lines for select to authenticated
  using (exists(select 1 from public.purchase_orders o where o.id = po_id and app.can_see_po(o.site_id, o.ho_stage)));

-- Akun diarahkan ke site oleh pengelola pengguna
create or replace function public.profile_site_set(p_user uuid, p_site text) returns void
language plpgsql security definer set search_path = public as $$
declare s uuid;
begin
  if not app.has_permission_anywhere('user.manage') then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  select id into s from public.sites where code = upper(btrim(p_site)) and active;
  if s is null then raise exception 'Site tidak dikenal' using errcode = '22023'; end if;
  update public.profiles set site_id = s where id = p_user;
  if not found then raise exception 'Pengguna tidak ditemukan' using errcode = 'P0002'; end if;
end $$;
revoke execute on function public.profile_site_set(uuid, text) from public, anon;
grant execute on function public.profile_site_set(uuid, text) to authenticated;
revoke execute on function app.default_site(), app.my_site(), app.can_see_po(uuid, text), app.can_see_pr(uuid) from public, anon;
grant execute on function app.default_site(), app.my_site(), app.can_see_po(uuid, text), app.can_see_pr(uuid) to authenticated;
