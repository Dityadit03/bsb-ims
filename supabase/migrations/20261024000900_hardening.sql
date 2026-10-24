-- BSB IMS · Pengetatan hasil Supabase security advisor
-- 1) Fungsi RPC hanya untuk pengguna login: grant default PUBLIC dicabut sehingga anon tidak bisa memanggil.
--    verify_document tetap publik untuk halaman verifikasi QR.
-- 2) search_path dikunci pada fungsi pembantu.

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and p.proname <> 'verify_document' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

alter function app.touch_updated_at() set search_path = public;
alter function app.audit_logs_immutable() set search_path = public;
alter function app.guard_scheme_pattern() set search_path = public;
alter function app.guard_clause_code() set search_path = public;
alter function app.roman_month(int) set search_path = public;
alter function app.site_today() set search_path = public;
alter function app.render_pattern(text, jsonb) set search_path = public;
alter function app.apply_seq(text, int) set search_path = public;
