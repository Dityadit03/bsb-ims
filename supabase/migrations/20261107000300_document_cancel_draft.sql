-- Batalkan usulan dokumen yang belum pernah terbit (pemilik atau Document Controller).
create or replace function public.document_cancel_draft(p_document uuid, p_reason text)
returns public.documents language plpgsql security definer set search_path = public as $$
declare
  v_doc public.documents;
begin
  select * into v_doc from public.documents where id = p_document for update;
  if v_doc.id is null then raise exception 'Dokumen tidak ditemukan' using errcode = 'P0002'; end if;
  if v_doc.owner_id <> auth.uid() and not app.has_permission('document.release') then
    raise exception 'Tidak berwenang membatalkan usulan' using errcode = '42501';
  end if;
  if v_doc.status not in ('draft','in_process') or v_doc.effective_version_id is not null then
    raise exception 'Hanya usulan yang belum terbit yang bisa dibatalkan' using errcode = '22023';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Alasan pembatalan wajib diisi' using errcode = '22023'; end if;
  update public.document_versions set status = 'cancelled'
   where document_id = p_document and status not in ('effective','superseded','obsolete','cancelled');
  update public.workflow_tasks t set status = 'cancelled'
    from public.workflow_instances i join public.document_versions v on v.id = i.subject_id
   where t.instance_id = i.id and t.status = 'open' and v.document_id = p_document;
  update public.workflow_instances i set status = 'cancelled', completed_at = now()
    from public.document_versions v where v.id = i.subject_id and v.document_id = p_document and i.status = 'in_progress';
  update public.documents set status = 'cancelled' where id = p_document returning * into v_doc;
  perform app.log_event('document.cancel_draft', 'documents', v_doc.id::text, jsonb_build_object('reason', btrim(p_reason)));
  return v_doc;
end $$;
revoke execute on function public.document_cancel_draft(uuid, text) from public, anon;
grant execute on function public.document_cancel_draft(uuid, text) to authenticated;
