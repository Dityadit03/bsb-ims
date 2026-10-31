-- Pengerasan hasil uji keamanan 2026-10-31.
-- 1. Beberapa view dari migrasi Plant/Logistik mewarisi hak penuh untuk anon. RLS tabel dasarnya tetap menahan data
--    (view security_invoker), tetapi aturan proyek: anon tidak boleh punya hak apa pun di tabel/view public.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- 2. search_path tetap untuk fungsi pembantu (peringatan advisor function_search_path_mutable)
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app' and p.proconfig is null and not p.prosecdef
              and p.proname in ('ter_category','ptkp_amount','pph17','ot_equivalent','mr_block_unresolved','feed_hash','raise_text','plant_dept','wa_normalize') loop
    execute format('alter function %s set search_path = public, app, pg_temp', f.sig);
  end loop;
end $$;
