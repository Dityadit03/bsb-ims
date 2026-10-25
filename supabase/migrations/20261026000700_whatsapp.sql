-- Pemberitahuan WhatsApp (Meta Cloud API) lewat antrean yang sama dengan push.
-- Keamanan: nomor tujuan SELALU diambil dari data HRGA (employee_private.phone) milik karyawan yang tertaut akun,
-- bukan dari isian pengguna, sehingga tidak bisa dipakai mengirim pesan ke nomor orang lain. Wajib persetujuan (opt-in) per orang.
-- Isi pesan hanya judul pendek lewat template yang disetujui Meta. Token Meta hanya ada di rahasia Edge Function.

alter table public.notification_outbox add column provider_id text;
alter table public.notification_prefs alter column whatsapp set default false;
alter table public.notification_prefs add column whatsapp_opt_in_at timestamptz;
update public.notification_prefs set whatsapp = false where whatsapp_opt_in_at is null;

insert into public.app_settings(key, value, description) values
  ('whatsapp_enabled', 'false'::jsonb, 'Saklar utama WhatsApp. Nyalakan setelah akun Meta, template, dan rahasia Edge Function siap'),
  ('whatsapp_kinds', '["workflow.task","workflow.overdue"]'::jsonb, 'Jenis pemberitahuan yang boleh dikirim lewat WhatsApp (selebihnya hanya di aplikasi/push)')
on conflict (key) do nothing;

-- nomor HP -> format internasional tanpa plus (628...). Null bila tidak masuk akal.
create or replace function app.wa_normalize(p text) returns text
language sql immutable as $$
  select case when d ~ '^62[0-9]{8,13}$' then d end
  from (select case when regexp_replace(coalesce(p,''), '[^0-9]', '', 'g') like '0%' then '62' || substr(regexp_replace(p, '[^0-9]', '', 'g'), 2)
                    else regexp_replace(coalesce(p,''), '[^0-9]', '', 'g') end as d) x
$$;

create or replace function app.enqueue_notification() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pref public.notification_prefs; v_n int := 0;
begin
  select * into v_pref from public.notification_prefs where user_id = new.user_id;
  if coalesce(v_pref.push, true) and exists(select 1 from public.push_subscriptions where user_id = new.user_id) then
    insert into public.notification_outbox(notification_id, user_id, channel) values (new.id, new.user_id, 'push') on conflict do nothing;
    v_n := v_n + 1;
  end if;
  if coalesce(v_pref.whatsapp, false) and v_pref.whatsapp_opt_in_at is not null
     and coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'whatsapp_enabled'), false)
     and exists(select 1 from public.app_settings where key = 'whatsapp_kinds' and value ? new.kind) then
    insert into public.notification_outbox(notification_id, user_id, channel) values (new.id, new.user_id, 'whatsapp') on conflict do nothing;
    v_n := v_n + 1;
  end if;
  if v_n > 0 then perform app.kick_dispatch(); end if;
  return new;
end $$;

-- ------------------------------------------------------------ RPC pengguna
create or replace function public.whatsapp_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'enabled', coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'whatsapp_enabled'), false),
    'opted_in', coalesce((select whatsapp and whatsapp_opt_in_at is not null from public.notification_prefs where user_id = auth.uid()), false),
    -- hanya 3 digit terakhir agar pengguna tahu nomor mana yang dipakai
    'number_hint', (select case when app.wa_normalize(p.phone) is not null then '…' || right(app.wa_normalize(p.phone), 3) end
                      from public.employees e join public.employee_private p on p.employee_id = e.id where e.profile_id = auth.uid() limit 1))
$$;

create or replace function public.whatsapp_optin() returns void
language plpgsql security definer set search_path = public as $$
declare v_phone text;
begin
  if auth.uid() is null then raise exception 'Belum masuk' using errcode = '42501'; end if;
  select app.wa_normalize(p.phone) into v_phone from public.employees e
    join public.employee_private p on p.employee_id = e.id where e.profile_id = auth.uid() limit 1;
  if v_phone is null then
    raise exception 'Nomor HP Anda belum terisi atau tidak valid di data karyawan. Minta HRGA memperbaikinya dulu.' using errcode = '22023';
  end if;
  insert into public.notification_prefs(user_id, whatsapp, whatsapp_opt_in_at) values (auth.uid(), true, now())
  on conflict (user_id) do update set whatsapp = true, whatsapp_opt_in_at = now(), updated_at = now();
end $$;

create or replace function public.whatsapp_optout() returns void
language sql security definer set search_path = public as $$
  update public.notification_prefs set whatsapp = false, updated_at = now() where user_id = auth.uid()
$$;

-- ------------------------------------------------------------ RPC pengirim (hanya service_role)
create or replace function public.dispatch_claim_whatsapp(p_limit int default 30) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'Hanya untuk pengirim' using errcode = '42501'; end if;
  with c as (
    select o.id from public.notification_outbox o
     where o.channel = 'whatsapp' and o.attempts < 3
       and (o.status = 'pending' or (o.status = 'sending' and o.claimed_at < now() - interval '5 minutes'))
     order by o.created_at limit greatest(1, least(p_limit, 100)) for update skip locked),
  u as (
    update public.notification_outbox o set status = 'sending', attempts = attempts + 1, claimed_at = now()
      from c where o.id = c.id returning o.*)
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', u.id, 'title', n.title,
      -- opt-in dicabut setelah antre -> phone null -> pengirim menandai skipped
      'phone', case when pr.whatsapp and pr.whatsapp_opt_in_at is not null then
                 (select app.wa_normalize(p.phone) from public.employees e join public.employee_private p on p.employee_id = e.id
                   where e.profile_id = u.user_id and e.status = 'active' limit 1) end)), '[]'::jsonb)
    into v from u join public.notifications n on n.id = u.notification_id
    left join public.notification_prefs pr on pr.user_id = u.user_id;
  return v;
end $$;

create or replace function public.dispatch_complete_whatsapp(p_id uuid, p_ok boolean, p_error text default null, p_provider_id text default null, p_skip boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Hanya untuk pengirim' using errcode = '42501'; end if;
  update public.notification_outbox
     set status = case when p_skip then 'skipped' when p_ok then 'sent' when attempts >= 3 then 'failed' else 'pending' end,
         sent_at = case when p_ok then now() end, last_error = left(p_error, 300), provider_id = p_provider_id
   where id = p_id;
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
grant execute on function public.dispatch_claim_whatsapp(int), public.dispatch_complete_whatsapp(uuid, boolean, text, text, boolean) to service_role;
