import { PageHeader, Panel, Pill, Table } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Organisasi' };

type Dept = { id: string; code: string; name: string; active: boolean; sections: { code: string; name: string; active: boolean }[] };

export default async function OrganisasiPage() {
  await getSession();
  const supabase = await createClient();
  const [{ data: sites }, { data: depts }] = await Promise.all([
    supabase.from('sites').select('code, name, client_company, timezone, active').order('code'),
    supabase.from('departments').select('id, code, name, active, sections(code, name, active)').order('sort_order').returns<Dept[]>(),
  ]);

  return (
    <>
      <PageHeader eyebrow="Master data" title="Organisasi" />
      <Panel title="Site">
        <Table head={['Kode', 'Nama', 'Pemilik IUP', 'Zona waktu', 'Status']}>
          {(sites ?? []).map(s => (
            <tr key={s.code}>
              <td className="font-mono">{s.code}</td><td>{s.name}</td><td>{s.client_company ?? '–'}</td>
              <td className="font-mono text-xs">{s.timezone}</td><td>{s.active ? <Pill tone="ok">Aktif</Pill> : <Pill>Nonaktif</Pill>}</td>
            </tr>
          ))}
        </Table>
      </Panel>
      <Panel title="Departemen & seksi">
        <p className="text-sm text-muted">Kode ini dipakai langsung di nomor dokumen, mis. <code className="font-mono">SOP-BSB-HSE-SFT-018</code>. Kode yang sudah dipakai tidak boleh diubah.</p>
        <Table head={['Kode', 'Departemen', 'Seksi']}>
          {(depts ?? []).map(d => (
            <tr key={d.id}>
              <td className="font-mono font-medium">{d.code}</td>
              <td>{d.name}</td>
              <td>
                <div className="flex flex-wrap gap-1.5">
                  {d.sections.map(sec => (
                    <span key={sec.code} className="rounded border border-line px-1.5 py-0.5 text-xs"><b className="font-mono">{sec.code}</b> {sec.name}</span>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}
