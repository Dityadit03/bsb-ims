import { PageHeader, Panel } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { RequestForm } from './request-form';

export const metadata = { title: 'Ajukan dokumen' };

export default async function AjukanPage() {
  const s = await getSession();
  const supabase = await createClient();
  const [{ data: types }, { data: depts }, { data: parents }] = await Promise.all([
    supabase.from('document_types').select('code, name, category, workflow_code, needs_section, parent_types').order('sort_order'),
    supabase.from('departments').select('id, code, name, sections(id, code, name)').eq('active', true).order('sort_order'),
    supabase.from('documents').select('id, document_number, title, type_code').not('document_number', 'is', null)
      .in('status', ['effective', 'under_revision']).in('type_code', ['SOP', 'IK', 'MAN', 'STD', 'KBJ']).order('document_number'),
  ]);
  return (
    <>
      <PageHeader eyebrow="Document Control" title="Ajukan dokumen" />
      <Panel>
        <RequestForm types={types ?? []} departments={depts ?? []} parents={parents ?? []} defaultDepartment={s.profile.department_id} />
      </Panel>
      <p className="max-w-3xl text-sm text-muted">
        Kebijakan, manual, SOP, standar, IK, formulir, program, surat keluar dan SK melewati review, verifikasi Document Control dan approval.
        Nomor resmi baru terbit saat dokumen dirilis. Rekaman, izin, dokumen eksternal dan surat masuk langsung mendapat nomor saat diregistrasi.
      </p>
    </>
  );
}
