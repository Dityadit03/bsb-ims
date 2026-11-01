-- PIC bernama untuk temuan SHE: selain departemen PIC, pengawas menunjuk SATU orang. Orang itu langsung dinotifikasi
-- (in-app, push, WhatsApp bila aktif), melihat temuannya di lonceng, dan boleh menutup dengan bukti perbaikan.

alter table public.hazard_reports add column pic_user_id uuid references public.profiles(id);
alter table public.inspection_findings add column pic_user_id uuid references public.profiles(id);
create index hazard_reports_pic_user_idx on public.hazard_reports(pic_user_id) where status = 'open';
create index inspection_findings_pic_user_idx on public.inspection_findings(pic_user_id) where status = 'open';

create function public.set_pic_person(p_table text, p_id uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_dept uuid; v_no text; v_status text; v_link text;
begin
  if p_table = 'hazard_reports' then
    select pic_department_id, hazard_no, status, '/she/hazard/' || id into v_dept, v_no, v_status, v_link from public.hazard_reports where id = p_id;
  elsif p_table = 'inspection_findings' then
    select f.pic_department_id, i.inspection_no || '-' || f.seq, f.status, '/she/inspeksi/' || f.inspection_id
      into v_dept, v_no, v_status, v_link from public.inspection_findings f join public.inspections i on i.id = f.inspection_id where f.id = p_id;
  else
    raise exception 'Jenis rekaman tidak didukung' using errcode = '22023';
  end if;
  if v_dept is null then raise exception 'Rekaman tidak ditemukan' using errcode = 'P0002'; end if;
  if not (app.has_permission('she.followup', v_dept) or app.has_permission_anywhere('user.manage')) then
    raise exception 'Hanya pengawas departemen PIC yang bisa menunjuk PIC' using errcode = '42501';
  end if;
  if v_status <> 'open' then raise exception 'Rekaman sudah ditutup' using errcode = '22023'; end if;
  if p_user is not null and not (
       exists(select 1 from public.profiles pr where pr.id = p_user and pr.status = 'active')
       and (exists(select 1 from public.employees e where e.profile_id = p_user and e.department_id = v_dept and e.status = 'active')
            or p_user = any(app.users_with_permission('she.followup', v_dept)))) then
    raise exception 'Orang yang dipilih harus pengguna aktif dari departemen PIC' using errcode = '22023';
  end if;
  if p_table = 'hazard_reports' then update public.hazard_reports set pic_user_id = p_user where id = p_id;
  else update public.inspection_findings set pic_user_id = p_user where id = p_id; end if;
  if p_user is not null and p_user <> auth.uid() then
    perform app.notify_users(array[p_user], 'she.pic', 'Anda ditunjuk sebagai PIC: ' || v_no, 'Segera tindak lanjuti dan tutup dengan bukti perbaikan', v_link);
  end if;
  perform app.log_event('she.set_pic_person', p_table, p_id::text, jsonb_build_object('user', p_user));
end $$;

-- PIC bernama boleh menutup temuannya (selain pengawas departemen PIC)
do $$
declare f record; d text; n int := 0;
begin
  for f in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('hazard_close', 'finding_close') loop
    d := pg_get_functiondef(f.oid);
    if d not like '%if not app.has_permission(''she.followup'', v.pic_department_id) then%' then raise exception 'Isi % tidak sesuai dugaan', f.proname; end if;
    d := replace(d, 'if not app.has_permission(''she.followup'', v.pic_department_id) then',
                    'if not (app.has_permission(''she.followup'', v.pic_department_id) or coalesce(v.pic_user_id = auth.uid(), false)) then');
    d := replace(d, 'Hanya pengawas departemen PIC yang bisa menutup', 'Hanya PIC yang ditunjuk atau pengawas departemen PIC yang bisa menutup');
    execute d; n := n + 1;
  end loop;
  if n <> 2 then raise exception 'Fungsi penutupan tidak lengkap (%)', n; end if;
end $$;

-- Temuan terbuka yang menjadi tanggung jawab saya: ditunjuk langsung, atau belum ada PIC bernama dan saya pengawas departemen PIC
create function public.my_pic_items() returns table(kind text, id uuid, ref_no text, title text, due_date date, overdue boolean, assigned boolean, link text)
language sql stable set search_path = public as $$
  select 'hazard', h.id, h.hazard_no, left(h.description, 100), h.due_date, h.due_date < current_date, h.pic_user_id is not null, '/she/hazard/' || h.id
    from public.hazard_reports h
   where h.status = 'open' and (h.pic_user_id = auth.uid() or (h.pic_user_id is null and app.has_permission('she.followup', h.pic_department_id)))
  union all
  select 'temuan', f.id, i.inspection_no || '-' || f.seq, left(f.description, 100), f.due_date, f.due_date < current_date, f.pic_user_id is not null, '/she/inspeksi/' || f.inspection_id
    from public.inspection_findings f join public.inspections i on i.id = f.inspection_id
   where f.status = 'open' and (f.pic_user_id = auth.uid() or (f.pic_user_id is null and app.has_permission('she.followup', f.pic_department_id)))
$$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('set_pic_person', 'my_pic_items') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
