-- Login per site: akun baru ditempatkan di site sesuai domain emailnya.
alter table public.sites add column email_domain text;
create unique index sites_email_domain_uq on public.sites(lower(email_domain)) where email_domain is not null;
update public.sites set email_domain = 'bsb-mine.id' where code = 'HO';

do $$
declare d text; n text;
begin
  select pg_get_functiondef('app.handle_new_user()'::regprocedure) into d;
  n := replace(d, 'insert into public.profiles(id, email, full_name, status)', 'insert into public.profiles(id, email, full_name, status, site_id)');
  n := replace(n, E'case when v_active then ''active'' else ''pending'' end)', E'case when v_active then ''active'' else ''pending'' end,\n          coalesce((select s.id from public.sites s where lower(s.email_domain) = v_domain and s.active), app.default_site()))');
  if n = d then raise exception 'handle_new_user tidak berubah'; end if;
  execute n;
end $$;
