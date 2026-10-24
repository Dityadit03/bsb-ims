import { PageHeader, Panel, Table } from '@/components/ui';
import { requirePermission } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Audit trail' };

type Log = { id: number; occurred_at: string; action: string; table_name: string | null; record_id: string | null; profiles: { email: string } | null };

export default async function AuditPage() {
  await requirePermission('audit.read');
  const supabase = await createClient();
  const { data } = await supabase.from('audit_logs')
    .select('id, occurred_at, action, table_name, record_id, profiles:actor_id(email)')
    .order('id', { ascending: false }).limit(200).returns<Log[]>();

  return (
    <>
      <PageHeader eyebrow="Administrasi" title="Audit trail" />
      <p className="text-sm text-muted">Catatan ini tidak bisa diubah atau dihapus oleh siapa pun, termasuk administrator. Ditampilkan 200 kejadian terakhir.</p>
      <Panel>
        <Table head={['Waktu (WITA)', 'Pelaku', 'Aksi', 'Objek']}>
          {(data ?? []).map(l => (
            <tr key={l.id}>
              <td className="tabular whitespace-nowrap text-xs">{new Date(l.occurred_at).toLocaleString('id-ID', { timeZone: 'Asia/Makassar' })}</td>
              <td className="text-sm">{l.profiles?.email ?? 'sistem'}</td>
              <td className="font-mono text-xs">{l.action}</td>
              <td className="font-mono text-xs">{l.table_name}{l.record_id ? ` · ${l.record_id.slice(0, 8)}` : ''}</td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}
