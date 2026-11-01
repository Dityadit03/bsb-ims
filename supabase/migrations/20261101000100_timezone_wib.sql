-- Zona waktu aplikasi: WIB (Asia/Jakarta, UTC+7). Sebelumnya WITA (Asia/Makassar).
-- Waktu tersimpan sebagai timestamptz (tidak berubah); yang berubah hanya tampilan, batas hari, dan tanggal penomoran.
-- Jam shift (mis. 06:00) kini dibaca sebagai jam WIB.

update public.app_settings set value = '"Asia/Jakarta"' where key = 'timezone';
update public.sites set timezone = 'Asia/Jakarta' where timezone = 'Asia/Makassar';
alter table public.sites alter column timezone set default 'Asia/Jakarta';

-- Tanggal nomor insiden mengikuti zona site (sebelumnya tertanam 'Asia/Makassar')
do $$
declare f record;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'incident_report' and pg_get_functiondef(p.oid) like '%Asia/Makassar%' loop
    execute replace(pg_get_functiondef(f.oid), '''Asia/Makassar''', 'app.site_tz()');
  end loop;
end $$;
