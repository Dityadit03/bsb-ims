-- BSB IMS · M0 · Row Level Security
-- Semua tabel tertutup secara default; akses dibuka per kebutuhan dan dicek di database.

do $$
declare t text;
begin
  foreach t in array array['app_settings','sites','departments','sections','positions','work_areas',
    'allowed_domains','allowed_emails','profiles','roles','permissions','role_permissions','user_roles',
    'audit_logs','attachments','numbering_schemes','numbering_counters','registrations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Master data: dibaca semua pengguna aktif, diubah oleh pemegang master.manage
do $$
declare t text;
begin
  foreach t in array array['sites','departments','sections','positions','work_areas','roles','permissions','role_permissions'] loop
    execute format('create policy %I_read on public.%I for select to authenticated using (app.is_active_user())', t, t);
    execute format('create policy %I_write on public.%I for all to authenticated using (app.has_permission(''master.manage'')) with check (app.has_permission(''master.manage''))', t, t);
  end loop;
end $$;

create policy app_settings_read on public.app_settings for select to authenticated using (app.is_active_user());
create policy app_settings_write on public.app_settings for all to authenticated
  using (app.has_permission('system.configure')) with check (app.has_permission('system.configure'));

create policy allowed_domains_admin on public.allowed_domains for all to authenticated
  using (app.has_permission('user.manage')) with check (app.has_permission('user.manage'));
create policy allowed_emails_admin on public.allowed_emails for all to authenticated
  using (app.has_permission('user.manage')) with check (app.has_permission('user.manage'));

-- Profil: diri sendiri selalu bisa dibaca (termasuk status pending); profil lain untuk pengguna aktif.
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or app.is_active_user());
create policy profiles_admin_update on public.profiles for update to authenticated
  using (app.has_permission('user.manage')) with check (app.has_permission('user.manage'));

-- Peran: pengguna melihat perannya sendiri; pengelola melihat dan mengatur semua,
-- tetapi tidak boleh memberi atau mencabut peran untuk dirinya sendiri.
create policy user_roles_read on public.user_roles for select to authenticated
  using (user_id = auth.uid() or app.has_permission('user.manage'));
create policy user_roles_insert on public.user_roles for insert to authenticated
  with check (app.has_permission('user.manage') and user_id <> auth.uid());
create policy user_roles_update on public.user_roles for update to authenticated
  using (app.has_permission('user.manage') and user_id <> auth.uid())
  with check (app.has_permission('user.manage') and user_id <> auth.uid());
create policy user_roles_delete on public.user_roles for delete to authenticated
  using (app.has_permission('user.manage') and user_id <> auth.uid());

create policy audit_logs_read on public.audit_logs for select to authenticated
  using (app.has_permission('audit.read'));
revoke insert, update, delete, truncate on public.audit_logs from authenticated;

create policy attachments_read on public.attachments for select to authenticated
  using (app.is_active_user() and (classification = 'internal' or uploaded_by = auth.uid() or app.has_permission('records.read_restricted')));
create policy attachments_insert on public.attachments for insert to authenticated
  with check (app.is_active_user() and uploaded_by = auth.uid());
revoke update, delete on public.attachments from authenticated;

create policy numbering_schemes_read on public.numbering_schemes for select to authenticated using (app.is_active_user());
create policy numbering_schemes_write on public.numbering_schemes for all to authenticated
  using (app.has_permission('numbering.configure')) with check (app.has_permission('numbering.configure'));
create policy numbering_counters_read on public.numbering_counters for select to authenticated using (app.is_active_user());
revoke insert, update, delete on public.numbering_counters from authenticated;
create policy registrations_read on public.registrations for select to authenticated using (app.is_active_user());
revoke insert, update, delete on public.registrations from authenticated;

grant execute on function app.is_active_user(), app.has_permission(text, uuid, uuid) to authenticated;
grant execute on function public.my_permissions(), public.preview_number(text, jsonb), public.issue_number(text, jsonb, text),
  public.void_number(uuid, text), public.import_legacy_number(text, text, jsonb, int) to authenticated;
revoke execute on function public.preview_number(text, jsonb), public.issue_number(text, jsonb, text),
  public.void_number(uuid, text), public.import_legacy_number(text, text, jsonb, int) from anon;

-- Aktivasi pengguna pending + pemberian peran awal dalam satu langkah
create or replace function public.activate_user(p_user uuid, p_role text, p_department uuid default null, p_basis text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not app.has_permission('user.manage') then raise exception 'Tidak berwenang' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'Tidak bisa mengaktifkan akun sendiri' using errcode = '42501'; end if;
  update public.profiles set status = 'active' where id = p_user;
  if p_role is not null then
    insert into public.user_roles(user_id, role_code, department_id, basis, granted_by)
    values (p_user, p_role, p_department, p_basis, auth.uid())
    on conflict do nothing;
  end if;
  perform app.log_event('user.activate', 'profiles', p_user::text, jsonb_build_object('role', p_role));
end $$;
grant execute on function public.activate_user(uuid, text, uuid, text) to authenticated;
revoke execute on function public.activate_user(uuid, text, uuid, text) from anon;
