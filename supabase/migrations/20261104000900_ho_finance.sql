-- Keuangan HO (Finance & Accounting): melihat PR/PO semua site dan menyetujui PO.
insert into public.permissions(code, module, description) values
  ('log.ho_approve','logistics','Menyetujui PO dari semua site (Finance / Accounting HO)')
on conflict do nothing;
insert into public.roles(code, name, description, is_system) values
  ('HO_FINANCE','Keuangan HO','Finance / Accounting HO: melihat PR dan PO semua site, menyetujui PO', true)
on conflict do nothing;
insert into public.role_permissions(role_code, permission_code) values ('HO_FINANCE','log.ho_approve') on conflict do nothing;

create or replace function app.can_see_po(p_site uuid, p_ho_stage text) returns boolean language sql stable security definer set search_path = public as $$
  select app.is_active_user() and (p_site = app.my_site() or app.has_permission_anywhere('log.ho_approve')
    or (p_ho_stage is not null and app.has_permission_anywhere('log.ho')))
$$;
create or replace function app.can_see_pr(p_pr uuid) returns boolean language sql stable security definer set search_path = public as $$
  select app.is_active_user() and exists(
    select 1 from public.purchase_requisitions r where r.id = p_pr and (r.site_id = app.my_site() or app.has_permission_anywhere('log.ho_approve')
      or (app.has_permission_anywhere('log.ho') and exists(select 1 from public.purchase_orders o where o.pr_id = r.id and o.ho_stage is not null))))
$$;

do $$
declare d text; n text;
begin
  select pg_get_functiondef('public.po_approve(uuid,boolean,text)'::regprocedure) into d;
  n := replace(d, E'perform app.require_log(''log.approve_high'');', E'if not app.has_permission_anywhere(''log.ho_approve'') then perform app.require_log(''log.approve_high''); end if;');
  if n = d then raise exception 'po_approve tidak berubah'; end if;
  execute n;
end $$;
