-- Impor data pribadi: kolom profil lengkap (alamat terpisah, SIM, anak, lokal/non lokal, staff/non staff, dll.)

create or replace function app.import_row_ext(p_dataset text, r jsonb) returns boolean
language plpgsql set search_path = public as $$
declare
  v_id uuid;
  t text;
  v_run uuid;
  num numeric;
  v_rev uuid;
  v_course uuid;
  v_opts text[];
begin
  if p_dataset in ('data_pribadi', 'kontrak', 'idcard', 'organisasi', 'absensi', 'saldo_cuti', 'gaji', 'input_gaji', 'saldo_pajak', 'gaji_lama', 'kasbon_awal', 'kpi') then
    select id into v_id from public.employees where nrp = upper(btrim(r->>'nrp'));
    if v_id is null then raise exception 'NRP "%" tidak ditemukan', r->>'nrp'; end if;
  end if;
  case p_dataset
  when 'data_pribadi' then
    t := upper(left(coalesce(r->>'jenis_kelamin', ''), 1));
    perform public.employee_private_save(v_id, jsonb_strip_nulls(jsonb_build_object(
      'nik', nullif(regexp_replace(coalesce(r->>'nik', ''), '\D', '', 'g'), ''), 'birth_place', nullif(r->>'tempat_lahir', ''),
      'birth_date', nullif(r->>'tgl_lahir', ''), 'gender', case t when 'L' then 'L' when 'P' then 'P' when 'W' then 'P' end,
      'religion', nullif(r->>'agama', ''), 'ptkp_status', nullif(upper(replace(coalesce(r->>'ptkp', ''), ' ', '')), ''),
      'address_ktp', nullif(r->>'alamat', ''), 'phone', nullif(r->>'no_hp', ''), 'education_level', case when upper(coalesce(r->>'pendidikan', '')) in ('SMK','STM','SLTA','MA','SMU') then 'SMA' else nullif(upper(coalesce(r->>'pendidikan', '')), '') end,
      'npwp', nullif(r->>'npwp', ''), 'bpjs_tk_no', nullif(r->>'bpjs_tk', ''), 'bpjs_kes_no', nullif(r->>'bpjs_kes', ''),
      'bank_name', nullif(r->>'bank', ''), 'bank_account', nullif(regexp_replace(coalesce(r->>'no_rekening', ''), '[^0-9]', '', 'g'), ''),
      'bank_holder', nullif(r->>'nama_rekening', ''), 'emergency_name', nullif(r->>'kontak_darurat', ''),
      'emergency_phone', nullif(r->>'hp_darurat', ''),
      'kk_no', nullif(regexp_replace(coalesce(r->>'no_kk', ''), '\D', '', 'g'), ''), 'blood_type', nullif(upper(replace(coalesce(r->>'gol_darah', ''), ' ', '')), ''),
      'marital_status', case lower(coalesce(r->>'status_nikah', '')) when 'menikah' then 'married' when 'kawin' then 'married' when 'married' then 'married'
        when 'belum menikah' then 'single' when 'lajang' then 'single' when 'single' then 'single' when 'cerai' then 'divorced' when 'janda' then 'widowed'
        when 'duda' then 'widowed' else null end,
      'children_count', nullif(regexp_replace(coalesce(r->>'jumlah_anak', ''), '\D', '', 'g'), ''),
      'kelurahan', nullif(r->>'kelurahan', ''), 'kecamatan', nullif(r->>'kecamatan', ''), 'kabupaten', nullif(r->>'kabupaten', ''),
      'provinsi', nullif(r->>'provinsi', ''), 'sim_no', nullif(r->>'no_sim', ''), 'emergency_relation', nullif(r->>'hubungan_darurat', ''))));
    -- status penerimaan & golongan karyawan (kolom organisasi, bukan data pribadi)
    if coalesce(r->>'penerimaan', '') <> '' or coalesce(r->>'golongan_karyawan', '') <> '' then
      perform public.employee_classify(v_id,
        case lower(coalesce(r->>'penerimaan', '')) when 'lokal' then 'local' when 'local' then 'local' when 'non lokal' then 'non_local'
          when 'non-lokal' then 'non_local' when 'nonlokal' then 'non_local' when 'non_local' then 'non_local'
          else coalesce(nullif(r->>'penerimaan', ''), (select recruitment_origin from public.employees where id = v_id)) end,
        case lower(coalesce(r->>'golongan_karyawan', '')) when 'staff' then 'staff' when 'staf' then 'staff' when 'non staff' then 'non_staff'
          when 'non-staff' then 'non_staff' when 'nonstaff' then 'non_staff' when 'non_staff' then 'non_staff'
          else coalesce(nullif(r->>'golongan_karyawan', ''), (select worker_class from public.employees where id = v_id)) end);
    end if;
  when 'kontrak' then
    t := lower(coalesce(r->>'jenis', ''));
    perform public.contract_add(v_id,
      case when t in ('pkwt', 'kontrak') then 'pkwt' when t in ('pkwtt', 'tetap') then 'pkwtt' when t in ('percobaan', 'probation') then 'probation'
           when t in ('subkon', 'subcon') then 'subcon' else t end,
      nullif(r->>'no_kontrak', ''), (r->>'mulai')::date, (nullif(r->>'berakhir', ''))::date, nullif(r->>'catatan', ''));
  when 'organisasi' then
    perform public.employee_org_save(v_id,
      case when coalesce(r->>'atasan', '') = '' then null
           else coalesce((select id from public.employees where nrp = upper(btrim(r->>'atasan'))),
                         app.raise_text('NRP atasan "' || (r->>'atasan') || '" tidak ditemukan')::uuid) end,
      (select id from public.sites where code = upper(nullif(btrim(r->>'site'), ''))), nullif(r->>'golongan', ''), nullif(r->>'pola_roster', ''),
      nullif(r->>'poh', ''));
  when 'idcard' then
    perform public.id_card_issue(v_id, r->>'no_kartu',
      coalesce(array(select upper(btrim(a)) from unnest(regexp_split_to_array(coalesce(nullif(r->>'area', ''), 'OFFICE,MESS'), '[,;/ ]+')) a where btrim(a) <> ''), '{}'),
      (nullif(r->>'berlaku_sampai', ''))::date);
  when 'absensi' then
    -- Mesin fingerprint: satu baris = satu sentuhan. Jenis kosong = ditentukan otomatis (pertama masuk, terakhir pulang).
    -- waktu lengkap, atau kolom tanggal + jam terpisah (format umum ekspor mesin)
    perform app.attendance_import(v_id, (coalesce(nullif(r->>'waktu', ''), nullif(btrim(coalesce(r->>'tanggal', '') || ' ' || coalesce(r->>'jam', '')), ''))::timestamp)
      at time zone app.site_tz(), r->>'jenis', nullif(r->>'mesin', ''));
  when 'saldo_cuti' then
    perform public.leave_adjust(v_id, coalesce((nullif(r->>'tahun', ''))::int, extract(year from app.site_today())::int),
      coalesce(upper(nullif(r->>'jenis', '')), 'CT'), (r->>'hari')::numeric, coalesce(nullif(r->>'keterangan', ''), 'Saldo awal dari sistem lama'));
  when 'gaji' then
    num := nullif(regexp_replace(coalesce(r->>'nilai', ''), '[^0-9]', '', 'g'), '')::numeric;
    perform public.employee_pay_set(v_id, upper(btrim(r->>'komponen')), num, (r->>'berlaku_mulai')::date, nullif(r->>'keterangan', ''));
  when 'input_gaji' then
    v_run := app.payroll_run_for(r->>'periode');
    if v_run is null then raise exception 'Belum ada proses gaji periode % yang bisa diisi', r->>'periode'; end if;
    perform public.payroll_input_add(v_run, v_id, upper(btrim(r->>'komponen')),
      nullif(regexp_replace(coalesce(r->>'nilai', ''), '[^0-9]', '', 'g'), '')::numeric, nullif(r->>'keterangan', ''));
  when 'saldo_pajak' then
    perform public.payroll_ytd_set(v_id, (r->>'tahun')::int,
      nullif(regexp_replace(coalesce(r->>'bruto', ''), '[^0-9]', '', 'g'), '')::numeric,
      nullif(regexp_replace(coalesce(r->>'pph21', ''), '[^0-9]', '', 'g'), '')::numeric,
      nullif(regexp_replace(coalesce(r->>'iuran_pensiun', ''), '[^0-9]', '', 'g'), '')::numeric,
      nullif(r->>'bulan', '')::int, nullif(r->>'keterangan', ''));
  when 'gaji_lama' then
    perform app.payroll_legacy_set(r->>'periode', v_id,
      nullif(regexp_replace(coalesce(r->>'bruto', ''), '[^0-9]', '', 'g'), '')::numeric,
      nullif(regexp_replace(coalesce(r->>'pph21', ''), '[^0-9]', '', 'g'), '')::numeric,
      nullif(regexp_replace(coalesce(r->>'gaji_bersih', ''), '[^0-9]', '', 'g'), '')::numeric, nullif(r->>'keterangan', ''));
  when 'kasbon_awal' then
    perform app.advance_opening(v_id,
      nullif(regexp_replace(coalesce(r->>'sisa', ''), '[^0-9]', '', 'g'), '')::numeric,
      nullif(regexp_replace(coalesce(r->>'cicilan', ''), '[^0-9]', '', 'g'), '')::numeric, nullif(r->>'keterangan', ''));
  when 'kandidat' then
    -- bank kandidat dari Excel (walk-in / job fair); NIK sama diperbarui
    perform public.candidate_save((select id from public.candidates where nik = nullif(regexp_replace(coalesce(r->>'nik', ''), '\D', '', 'g'), '')),
      jsonb_strip_nulls(jsonb_build_object('full_name', nullif(r->>'nama', ''), 'nik', nullif(r->>'nik', ''), 'phone', nullif(r->>'no_hp', ''),
        'email', nullif(r->>'email', ''), 'birth_date', nullif(r->>'tgl_lahir', ''),
        'gender', case upper(left(coalesce(r->>'jenis_kelamin', ''), 1)) when 'L' then 'L' when 'P' then 'P' when 'W' then 'P' end,
        'domicile', nullif(r->>'domisili', ''), 'education_level', case when upper(coalesce(r->>'pendidikan', '')) in ('SMK','STM','SLTA','MA','SMU') then 'SMA' else nullif(upper(coalesce(r->>'pendidikan', '')), '') end,
        'education_major', nullif(r->>'jurusan', ''), 'experience_years', nullif(regexp_replace(coalesce(r->>'pengalaman', ''), '[^0-9.]', '', 'g'), ''),
        'last_employer', nullif(r->>'perusahaan_terakhir', ''),
        'is_local', case lower(coalesce(r->>'lokal', '')) when 'ya' then 'true' when 'y' then 'true' when 'tidak' then 'false' when 'n' then 'false' end,
        'note', nullif(r->>'keterangan', ''))));
  when 'kpi' then
    -- KPI massal ke siklus yang sedang menyusun KPI (atau siklus bernama di kolom siklus)
    select r2.id into v_rev from public.perf_reviews r2 join public.perf_cycles c2 on c2.id = r2.cycle_id
     where r2.employee_id = v_id and c2.status in ('goal_setting','review')
       and (nullif(btrim(r->>'siklus'), '') is null or lower(c2.name) = lower(btrim(r->>'siklus')))
     order by c2.period_start desc limit 1;
    if v_rev is null then raise exception 'NRP "%" belum terdaftar di siklus penilaian yang terbuka', r->>'nrp'; end if;
    perform public.perf_goal_save(v_rev, null, r->>'kpi', r->>'indikator', r->>'target',
      nullif(regexp_replace(coalesce(r->>'bobot', ''), '[^0-9]', '', 'g'), '')::int);
  when 'soal_kursus' then
    select id into v_course from public.courses where code = upper(btrim(r->>'kode_kursus'));
    if v_course is null then raise exception 'Kode kursus "%" tidak ditemukan', r->>'kode_kursus'; end if;
    v_opts := array[r->>'opsi_a', r->>'opsi_b', r->>'opsi_c', r->>'opsi_d', r->>'opsi_e'];
    perform public.course_question_save(v_course, null, r->>'pertanyaan', v_opts,
      position(upper(left(btrim(coalesce(r->>'jawaban', '')), 1)) in 'ABCDE'));
  else
    return false;
  end case;
  return true;
end $$;

revoke all on function app.import_row_ext(text, jsonb) from public, anon;
