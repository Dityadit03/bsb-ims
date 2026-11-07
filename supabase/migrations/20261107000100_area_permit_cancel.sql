-- Pemohon dapat menarik (membatalkan) izin masuk area yang belum diputuskan. Dicatat sebagai ditolak dengan alasan.
create or replace function public.area_permit_cancel(p_id uuid, p_reason text)
returns public.area_permits language plpgsql security definer set search_path = public as $$
declare v public.area_permits;
begin
  select * into v from public.area_permits where id = p_id for update;
  if not found then raise exception 'Izin tidak ditemukan' using errcode = 'P0002'; end if;
  if v.requested_by <> auth.uid() and not app.has_permission('she.permit', app.dept_by_code('HSE')) then
    raise exception 'Tidak berwenang' using errcode = '42501';
  end if;
  if v.status <> 'submitted' then raise exception 'Hanya izin yang menunggu keputusan bisa dibatalkan' using errcode = '22023'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Isi alasan pembatalan' using errcode = '22023'; end if;
  update public.area_permits set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
    decision_note = 'Dibatalkan pemohon: ' || btrim(p_reason) where id = p_id returning * into v;
  return v;
end $$;
revoke execute on function public.area_permit_cancel(uuid, text) from public, anon;
grant execute on function public.area_permit_cancel(uuid, text) to authenticated;
