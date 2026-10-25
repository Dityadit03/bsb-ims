-- Pemberitahuan dorong (web push) dan antrean kirim bersama untuk kanal lain (WhatsApp menyusul).
-- Alur: baris baru di notifications -> trigger memasukkan notification_outbox -> Edge Function notify-dispatch
-- mengambil antrean (hanya service_role), mengirim, lalu menandai hasilnya.
-- Kunci langganan (p256dh/auth) tidak boleh masuk audit_logs, jadi audit dicatat lewat app.log_event di RPC, bukan app.audit_row().

do $$ begin create extension if not exists pg_net; exception when others then raise notice 'pg_net tidak tersedia: %', sqlerrm; end $$;

create table public.push_subscriptions(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

create table public.notification_prefs(
  user_id uuid primary key references public.profiles(id) on delete cascade,
  push boolean not null default true,
  whatsapp boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.notification_prefs enable row level security;
revoke all on public.notification_prefs from anon, authenticated;
create trigger notification_prefs_audit after insert or update or delete on public.notification_prefs
  for each row execute function app.audit_row();

create table public.notification_outbox(
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null check (channel in ('push','whatsapp')),
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','skipped')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  unique (notification_id, channel)
);
create index notification_outbox_todo_idx on public.notification_outbox(created_at) where status in ('pending','sending');
alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from anon, authenticated;

insert into public.app_settings(key, value, description) values
  ('vapid_public_key', to_jsonb('BBm-wRICFnFNRp6v9fwDxWV6KDoHz8P40FF6S70qie_1LRFxbQRT7Kg9c7bfJZPK9glWjfuzQ6SkkcnY5O8snQU'::text), 'Kunci publik VAPID untuk web push (kunci privat ada di rahasia Edge Function)'),
  ('dispatch_url', to_jsonb('https://ayxsyyqyjsubwwtrprtn.supabase.co/functions/v1/notify-dispatch'::text), 'Alamat Edge Function pengirim pemberitahuan')
on conflict (key) do nothing;

-- Bangunkan pengirim. Gagal tidak boleh menggagalkan transaksi yang membuat pemberitahuan.
create or replace function app.kick_dispatch() returns void
language plpgsql security definer set search_path = public as $$
declare v_url text;
begin
  select value #>> '{}' into v_url from public.app_settings where key = 'dispatch_url';
  if v_url is null or to_regproc('net.http_post') is null then return; end if;
  execute 'select net.http_post(url := $1, body := ''{}''::jsonb, headers := ''{"Content-Type":"application/json"}''::jsonb)' using v_url;
exception when others then null;
end $$;

create or replace function app.enqueue_notification() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pref public.notification_prefs; v_n int := 0;
begin
  select * into v_pref from public.notification_prefs where user_id = new.user_id;
  if coalesce(v_pref.push, true) and exists(select 1 from public.push_subscriptions where user_id = new.user_id) then
    insert into public.notification_outbox(notification_id, user_id, channel) values (new.id, new.user_id, 'push')
    on conflict do nothing;
    v_n := v_n + 1;
  end if;
  if v_n > 0 then perform app.kick_dispatch(); end if;
  return new;
end $$;
create trigger notifications_enqueue after insert on public.notifications
  for each row execute function app.enqueue_notification();

-- ------------------------------------------------------------ RPC pengguna
create or replace function public.push_public_key() returns text
language sql stable security definer set search_path = public as $$
  select value #>> '{}' from public.app_settings where key = 'vapid_public_key'
$$;

-- Satu perangkat satu pemilik: bila endpoint yang sama sudah dipakai akun lain (HP bergantian), dipindahkan ke akun yang sedang masuk.
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_ua text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Belum masuk' using errcode = '42501'; end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 or coalesce(p_p256dh,'') = '' or coalesce(p_auth,'') = '' then
    raise exception 'Langganan tidak valid' using errcode = '22023';
  end if;
  insert into public.push_subscriptions(user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_ua, 200))
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth,
    user_agent = excluded.user_agent, created_at = now();
  perform app.log_event('push.subscribe', 'push_subscriptions', auth.uid()::text);
end $$;

create or replace function public.push_unsubscribe(p_endpoint text) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
  perform app.log_event('push.unsubscribe', 'push_subscriptions', auth.uid()::text);
end $$;

-- Dipanggil saat keluar: langganan perangkat ini dilepas dari akun agar pesan akun lama tidak muncul di HP berikutnya.
create or replace function public.push_forget_device(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()
$$;

create or replace function public.push_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'push', coalesce((select push from public.notification_prefs where user_id = auth.uid()), true),
    'devices', (select count(*) from public.push_subscriptions where user_id = auth.uid()))
$$;

create or replace function public.push_set_pref(p_push boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Belum masuk' using errcode = '42501'; end if;
  insert into public.notification_prefs(user_id, push) values (auth.uid(), p_push)
  on conflict (user_id) do update set push = excluded.push, updated_at = now();
end $$;

-- ------------------------------------------------------------ RPC pengirim (hanya service_role)
-- Loop grant di akhir migrasi memberi execute ke authenticated, jadi penjagaan ada di dalam fungsi.
create or replace function public.dispatch_claim_push(p_limit int default 50) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'Hanya untuk pengirim' using errcode = '42501'; end if;
  with c as (
    select o.id from public.notification_outbox o
     where o.channel = 'push' and o.attempts < 3
       and (o.status = 'pending' or (o.status = 'sending' and o.claimed_at < now() - interval '5 minutes'))
     order by o.created_at limit greatest(1, least(p_limit, 200)) for update skip locked),
  u as (
    update public.notification_outbox o set status = 'sending', attempts = attempts + 1, claimed_at = now()
      from c where o.id = c.id returning o.*)
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', u.id, 'title', n.title, 'body', left(coalesce(n.body, ''), 140), 'link', n.link,
      'subs', coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                          from public.push_subscriptions s where s.user_id = u.user_id), '[]'::jsonb))), '[]'::jsonb)
    into v from u join public.notifications n on n.id = u.notification_id;
  return v;
end $$;

create or replace function public.dispatch_complete_push(p_id uuid, p_ok boolean, p_error text default null, p_dead text[] default '{}')
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Hanya untuk pengirim' using errcode = '42501'; end if;
  if cardinality(p_dead) > 0 then delete from public.push_subscriptions where endpoint = any(p_dead); end if;
  update public.notification_outbox
     set status = case when p_ok then 'sent' when attempts >= 3 then 'failed' else 'pending' end,
         sent_at = case when p_ok then now() end, last_error = left(p_error, 300)
   where id = p_id;
  if p_ok then
    update public.push_subscriptions set last_ok_at = now()
     where user_id = (select user_id from public.notification_outbox where id = p_id) and endpoint <> all(p_dead);
  end if;
end $$;

-- Cadangan bila panggilan pg_net hilang: tiap menit. Dilewati bila pg_cron tidak ada.
do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.unschedule('notify-dispatch') where exists(select 1 from cron.job where jobname = 'notify-dispatch');
    perform cron.schedule('notify-dispatch', '* * * * *',
      $q$select app.kick_dispatch() where exists(select 1 from public.notification_outbox where status in ('pending','sending'))$q$);
  end if;
exception when others then raise notice 'pg_cron dilewati: %', sqlerrm;
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
-- Edge Function memakai peran service_role; izinkan eksplisit.
grant execute on function public.dispatch_claim_push(int), public.dispatch_complete_push(uuid, boolean, text, text[]) to service_role;
