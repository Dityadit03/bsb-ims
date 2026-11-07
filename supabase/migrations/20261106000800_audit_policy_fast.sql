-- Audit trail: cek izin audit.read sekali per kueri (initplan), bukan sekali per baris (7.800+ baris = 1,4 dtk).
alter policy audit_logs_read on public.audit_logs using ((select app.has_permission('audit.read')));
