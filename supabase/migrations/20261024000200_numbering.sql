-- BSB IMS · M0 · Numbering service
-- Pola memakai token: {D} dept, {S} seksi, {P} nomor induk, {SHIFT}, {Y}/{YYYY}, {MM}, {ROMAN_MM}, {YYYYMMDD}, {N2}..{N6}.
-- Kunci urutan (scope) = nilai token non-tanggal; periode = nilai token tanggal ('ALL' bila tidak ada).
-- Jadi SOP-BSB-{D}-{S}-{N3} berurut per dept+seksi tanpa reset, REK-BSB-{D}-{S}-{Y}-{N4} reset tiap tahun.

create table public.numbering_schemes(
  code text primary key check (code ~ '^[A-Z_]{1,20}$'),
  name text not null,
  pattern text not null check (pattern ~ '\{N[2-6]\}'),
  module text not null default 'document',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.numbering_counters(
  scheme_code text not null references public.numbering_schemes(code),
  scope_key text not null,
  period text not null,
  last_value int not null check (last_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (scheme_code, scope_key, period)
);

create table public.registrations(
  id uuid primary key default gen_random_uuid(),
  scheme_code text not null references public.numbering_schemes(code),
  number text not null unique,
  seq int not null,
  scope_key text not null,
  period text not null,
  params jsonb not null default '{}',
  ref_table text,
  ref_id uuid,
  idempotency_key text unique,
  status text not null default 'issued' check (status in ('issued','void','legacy')),
  void_reason text,
  issued_by uuid default auth.uid(),
  issued_at timestamptz not null default now(),
  check (status <> 'void' or void_reason is not null)
);
create index registrations_ref_idx on public.registrations(ref_table, ref_id);

create or replace function app.roman_month(p_month int) returns text
language sql immutable as $$
  select (array['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'])[p_month]
$$;

create or replace function app.site_today() returns date
language sql stable as $$
  select (now() at time zone coalesce(
    (select value #>> '{}' from public.app_settings where key = 'timezone'), 'Asia/Makassar'))::date
$$;

-- Hasil render pola tanpa nomor urut: (scope_key, period, template dengan {N..} tersisa).
create or replace function app.render_pattern(p_pattern text, p_params jsonb, out scope_key text, out period text, out template text)
language plpgsql stable as $$
declare
  v_date date := coalesce((p_params->>'date')::date, app.site_today());
  v_tok text;
  v_val text;
  v_scope text[] := '{}';
  v_period text[] := '{}';
begin
  template := p_pattern;
  for v_tok in select (regexp_matches(p_pattern, '\{([A-Z_]+[0-9]?)\}', 'g'))[1] loop
    continue when v_tok ~ '^N[2-6]$';
    v_val := case v_tok
      when 'Y'        then to_char(v_date, 'YYYY')
      when 'YYYY'     then to_char(v_date, 'YYYY')
      when 'MM'       then to_char(v_date, 'MM')
      when 'ROMAN_MM' then app.roman_month(extract(month from v_date)::int)
      when 'YYYYMMDD' then to_char(v_date, 'YYYYMMDD')
      else upper(nullif(btrim(p_params->>v_tok), ''))
    end;
    if v_val is null then
      raise exception 'Parameter {%} wajib diisi untuk pola %', v_tok, p_pattern using errcode = '22023';
    end if;
    if v_tok in ('Y','YYYY','MM','ROMAN_MM','YYYYMMDD') then
      v_period := v_period || (v_tok || '=' || v_val);
    else
      if v_val !~ '^[A-Z0-9][A-Z0-9./-]*$' then
        raise exception 'Nilai {%} tidak valid: %', v_tok, v_val using errcode = '22023';
      end if;
      v_scope := v_scope || (v_tok || '=' || v_val);
    end if;
    template := replace(template, '{' || v_tok || '}', v_val);
  end loop;
  scope_key := coalesce(nullif(array_to_string(v_scope, '|'), ''), 'ALL');
  period := coalesce(nullif(array_to_string(v_period, '|'), ''), 'ALL');
end $$;

create or replace function app.apply_seq(p_template text, p_seq int) returns text
language plpgsql immutable as $$
declare
  v_width int := (regexp_match(p_template, '\{N([2-6])\}'))[1]::int;
begin
  return regexp_replace(p_template, '\{N[2-6]\}', lpad(p_seq::text, greatest(v_width, length(p_seq::text)), '0'));
end $$;

-- Pratinjau nomor berikutnya (tidak mengalokasikan apa pun).
create or replace function public.preview_number(p_scheme text, p_params jsonb default '{}')
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_s public.numbering_schemes;
  r record;
  v_last int;
begin
  if not app.is_active_user() then raise exception 'Tidak diizinkan' using errcode = '42501'; end if;
  select * into v_s from public.numbering_schemes where code = p_scheme;
  if not found then raise exception 'Skema % tidak ada', p_scheme using errcode = '22023'; end if;
  select * into r from app.render_pattern(v_s.pattern, p_params);
  select last_value into v_last from public.numbering_counters
   where scheme_code = p_scheme and scope_key = r.scope_key and period = r.period;
  return app.apply_seq(r.template, coalesce(v_last, 0) + 1);
end $$;

-- Inti alokasi: atomik per (skema, scope, periode); dipanggil di dalam transaksi pemanggil.
create or replace function app.allocate_number(
  p_scheme text, p_params jsonb, p_idem text default null,
  p_ref_table text default null, p_ref_id uuid default null)
returns public.registrations
language plpgsql security definer set search_path = public as $$
declare
  v_s public.numbering_schemes;
  v_reg public.registrations;
  r record;
  v_seq int;
  v_number text;
  v_try int := 0;
begin
  if p_idem is not null then
    select * into v_reg from public.registrations where idempotency_key = p_idem;
    if found then return v_reg; end if;
  end if;

  select * into v_s from public.numbering_schemes where code = p_scheme;
  if not found or not v_s.active then
    raise exception 'Skema penomoran % tidak aktif', p_scheme using errcode = '22023';
  end if;
  select * into r from app.render_pattern(v_s.pattern, p_params);

  loop
    v_try := v_try + 1;
    insert into public.numbering_counters as c (scheme_code, scope_key, period, last_value)
    values (p_scheme, r.scope_key, r.period, 1)
    on conflict (scheme_code, scope_key, period)
    do update set last_value = c.last_value + 1, updated_at = now()
    returning last_value into v_seq;

    v_number := app.apply_seq(r.template, v_seq);
    -- nomor lama hasil migrasi bisa sudah terpakai: lompati, jangan pernah menimpa
    exit when not exists(select 1 from public.registrations where number = v_number);
    if v_try > 10000 then raise exception 'Gagal mengalokasikan nomor untuk %', p_scheme; end if;
  end loop;

  begin
    insert into public.registrations(scheme_code, number, seq, scope_key, period, params, ref_table, ref_id, idempotency_key)
    values (p_scheme, v_number, v_seq, r.scope_key, r.period, coalesce(p_params, '{}'), p_ref_table, p_ref_id, p_idem)
    returning * into v_reg;
  exception when unique_violation then
    -- request kembar dengan idempotency key sama yang datang bersamaan
    if p_idem is not null then
      select * into v_reg from public.registrations where idempotency_key = p_idem;
      if found then
        raise exception 'idempotent_retry' using errcode = '40001';
      end if;
    end if;
    raise;
  end;

  perform app.log_event('numbering.issue', 'registrations', v_reg.id::text,
    jsonb_build_object('number', v_reg.number, 'scheme', p_scheme));
  return v_reg;
end $$;

-- RPC untuk klien (mis. nomor surat/rekaman langsung). Modul lain memanggil app.allocate_number dari fungsinya sendiri.
create or replace function public.issue_number(
  p_scheme text, p_params jsonb default '{}', p_idempotency_key text default null)
returns public.registrations
language plpgsql security definer set search_path = public as $$
declare
  v_dept uuid;
begin
  select id into v_dept from public.departments where code = upper(p_params->>'D');
  if not app.has_permission('numbering.issue', v_dept) then
    raise exception 'Tidak berwenang menerbitkan nomor' using errcode = '42501';
  end if;
  return app.allocate_number(p_scheme, p_params, p_idempotency_key);
end $$;

-- Nomor yang dibatalkan tetap tercatat dan tidak dipakai ulang.
create or replace function public.void_number(p_registration uuid, p_reason text)
returns public.registrations
language plpgsql security definer set search_path = public as $$
declare v_reg public.registrations;
begin
  if not app.has_permission('numbering.void') then
    raise exception 'Tidak berwenang membatalkan nomor' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Alasan pembatalan wajib diisi' using errcode = '22023';
  end if;
  update public.registrations set status = 'void', void_reason = p_reason
   where id = p_registration and status = 'issued'
   returning * into v_reg;
  if not found then raise exception 'Nomor tidak ditemukan atau sudah dibatalkan' using errcode = 'P0002'; end if;
  perform app.log_event('numbering.void', 'registrations', v_reg.id::text, jsonb_build_object('reason', p_reason));
  return v_reg;
end $$;

-- Migrasi: daftarkan nomor dari Document Control v4 dan majukan counter bila perlu.
create or replace function public.import_legacy_number(
  p_scheme text, p_number text, p_params jsonb, p_seq int)
returns public.registrations
language plpgsql security definer set search_path = public as $$
declare
  v_s public.numbering_schemes;
  v_reg public.registrations;
  r record;
begin
  if not app.has_permission('numbering.configure') then
    raise exception 'Tidak berwenang' using errcode = '42501';
  end if;
  select * into v_s from public.numbering_schemes where code = p_scheme;
  select * into r from app.render_pattern(v_s.pattern, p_params);
  insert into public.registrations(scheme_code, number, seq, scope_key, period, params, status)
  values (p_scheme, p_number, p_seq, r.scope_key, r.period, p_params, 'legacy')
  on conflict (number) do nothing
  returning * into v_reg;
  insert into public.numbering_counters as c (scheme_code, scope_key, period, last_value)
  values (p_scheme, r.scope_key, r.period, p_seq)
  on conflict (scheme_code, scope_key, period)
  do update set last_value = greatest(c.last_value, excluded.last_value), updated_at = now();
  return v_reg;
end $$;

create trigger numbering_schemes_touch before update on public.numbering_schemes
  for each row execute function app.touch_updated_at();
create trigger numbering_schemes_audit after insert or update or delete on public.numbering_schemes
  for each row execute function app.audit_row();

-- Pola yang sudah punya nomor terbit tidak boleh diubah; buat skema baru.
create or replace function app.guard_scheme_pattern() returns trigger
language plpgsql as $$
begin
  if new.pattern <> old.pattern and exists(select 1 from public.registrations where scheme_code = old.code) then
    raise exception 'Pola % sudah dipakai; buat skema baru agar nomor lama tidak rusak', old.code using errcode = '42501';
  end if;
  return new;
end $$;
create trigger numbering_schemes_guard before update on public.numbering_schemes
  for each row execute function app.guard_scheme_pattern();

revoke all on function app.allocate_number(text, jsonb, text, text, uuid) from public, anon, authenticated;
