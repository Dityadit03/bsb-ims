-- Analitik HR memindai attendance_daily setahun penuh; RLS per baris (app.can_view_employee) membuat satu pemanggilan
-- bisa memakan lebih dari 100 detik. Otorisasi sudah diperiksa di dalam fungsi (app.is_hr / app.is_payroll),
-- sehingga fungsi dijalankan sebagai pemilik agar RLS per baris tidak dievaluasi ribuan kali.
alter function public.hr_analytics(int, uuid) security definer;
alter function public.hr_analytics(int, uuid) set search_path = public;
