-- 1) Tutup hazard/temuan inspeksi: selain pengawas dept PIC dan PIC bernama, karyawan aktif dept PIC juga boleh menutup (dengan bukti perbaikan bila risiko tinggi).
do $$
declare f record; d text; n int := 0;
begin
  for f in select p.oid, p.proname from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public' and p.proname in ('hazard_close', 'finding_close') loop
    d := pg_get_functiondef(f.oid);
    if d not like '%coalesce(v.pic_user_id = auth.uid(), false)) then%' then raise exception 'Isi % tidak sesuai dugaan', f.proname; end if;
    d := replace(d, 'coalesce(v.pic_user_id = auth.uid(), false)) then',
      'coalesce(v.pic_user_id = auth.uid(), false)
       or exists(select 1 from public.employees e where e.profile_id = auth.uid() and e.department_id = v.pic_department_id and e.status = ''active'')) then');
    d := replace(d, 'Hanya PIC yang ditunjuk atau pengawas departemen PIC yang bisa menutup', 'Hanya PIC yang ditunjuk, karyawan departemen PIC, atau pengawas departemen PIC yang bisa menutup');
    execute d; n := n + 1;
  end loop;
  if n <> 2 then raise exception 'Fungsi penutupan tidak lengkap (%)', n; end if;
end $$;

-- 2) Suptend HSE memakai peran HSE Manager (level di atas supervisor)
update public.positions p set access_role = 'HSE_MANAGER'
  from public.departments d
 where d.id = p.department_id and d.code = 'HSE' and p.name = 'Suptend HSE';

-- 3) Rapikan jabatan ganda: satu "Safety Officer" (HSE); Admin Logistik dan Fuelman hanya di LOG
do $$
declare v_hse uuid; v_log uuid; keep uuid; dup uuid; nm text;
begin
  select id into v_hse from public.departments where code = 'HSE';
  select id into v_log from public.departments where code = 'LOG';
  -- Safety officer / Safety Officer: pindahkan karyawan ke yang berhuruf besar, nonaktifkan sisanya
  select id into keep from public.positions where department_id = v_hse and name = 'Safety Officer' limit 1;
  if keep is not null then
    update public.employees set position_id = keep where position_id in (select id from public.positions where department_id = v_hse and name = 'Safety officer');
    update public.positions set active = false where department_id = v_hse and name = 'Safety officer';
  end if;
  -- Admin Logistik, Fuelman: karyawan di PLT dipindah ke jabatan & departemen LOG, jabatan PLT dinonaktifkan
  foreach nm in array array['Admin Logistik', 'Fuelman'] loop
    select id into keep from public.positions where department_id = v_log and name = nm limit 1;
    for dup in select p.id from public.positions p join public.departments d on d.id = p.department_id where d.code = 'PLT' and p.name = nm loop
      if keep is not null then
        update public.employees set position_id = keep, department_id = v_log where position_id = dup;
        update public.positions set active = false where id = dup;
      end if;
    end loop;
  end loop;
end $$;
