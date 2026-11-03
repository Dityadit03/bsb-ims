import { ActionForm } from '@/components/action-form';
import { Panel, Pill, Table, input } from '@/components/ui';
import { fmtDateTime } from '@/lib/documents';
import { createClient } from '@/lib/supabase/server';
import { cancelFuelOther, decideFuelOther } from './actions';

type Req = { id: string; request_no: string; material_code: string; uom: string; tank_code: string | null; liters: number; recipient: string; purpose: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'; requested_by: string; requested_name: string | null; requested_at: string;
  decided_name: string | null; decision_note: string | null };

const TONE = { pending: 'warn', approved: 'ok', rejected: 'crit', cancelled: 'muted' } as const;
const LABEL = { pending: 'Menunggu PJO', approved: 'Disetujui', rejected: 'Ditolak', cancelled: 'Dibatalkan' } as const;

// Pengisian di luar unit terdaftar ("Lainnya"): diajukan gudang, diputuskan PJO.
export async function FuelOtherPanel({ approver, userId }: { approver: boolean; userId: string }) {
  const supabase = await createClient();
  const { data } = await supabase.from('fuel_other_view').select('*').order('requested_at', { ascending: false }).limit(30).returns<Req[]>();
  const rows = data ?? [];
  if (!rows.length) return null;
  return (
    <div id="bbm-lainnya">
      <Panel title="Pengisian BBM / oli Lainnya" sub="Di luar unit terdaftar. Stok baru berkurang setelah PJO menyetujui.">
        <Table head={['No.', 'Barang', 'Liter', 'Penerima / keperluan', 'Pengaju', 'Status', '']}>
          {rows.map(r => (
            <tr key={r.id}>
              <td className="font-mono text-xs">{r.request_no}<br /><span className="text-muted">{fmtDateTime(r.requested_at)}</span></td>
              <td className="text-xs">{r.material_code}{r.tank_code && <> · {r.tank_code}</>}</td>
              <td className="tabular text-xs">{r.liters} {r.uom}</td>
              <td className="text-xs">{r.recipient}<br /><span className="text-muted">{r.purpose}</span></td>
              <td className="text-xs">{r.requested_name ?? '–'}</td>
              <td><Pill tone={TONE[r.status]}>{LABEL[r.status]}</Pill>{r.decided_name && <span className="block text-xs text-muted">{r.decided_name}{r.decision_note && ` · ${r.decision_note}`}</span>}</td>
              <td>
                {r.status === 'pending' && approver && r.requested_by !== userId && (
                  <ActionForm action={decideFuelOther} label="Setujui" primary hidden={{ id: r.id, decision: 'approve' }}>
                    <input name="note" className={input} placeholder="Catatan (wajib bila menolak)" />
                  </ActionForm>
                )}
                {r.status === 'pending' && approver && r.requested_by !== userId && (
                  <ActionForm action={decideFuelOther} label="Tolak" hidden={{ id: r.id, decision: 'reject' }}>
                    <input name="note" required className={input} placeholder="Alasan penolakan" />
                  </ActionForm>
                )}
                {r.status === 'pending' && r.requested_by === userId && (
                  <ActionForm action={cancelFuelOther} label="Batalkan" hidden={{ id: r.id }} confirm="Batalkan pengajuan ini?" />
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}
