import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { Pill, Table } from '@/components/ui';
import { fmtDate } from '@/lib/documents';
import { DAY_TYPE, LEAVE_STATUS, OT_STATUS, fmtTime, siteToday } from '@/lib/hrga';
import { Decide } from './decide';
import { cancelLeave, cancelOvertime, decideLeave, decideOvertime } from './waktu-actions';

export type LeaveRow = { id: string; request_no: string; employee_id: string; nrp: string; full_name: string; department_code: string; leave_type: string;
  leave_name: string; paid: boolean; start_date: string; end_date: string; days: number; reason: string; status: string; decision_note: string | null;
  approver1_name: string | null; approver2_name: string | null; can_decide: boolean };
export function LeaveTable({ rows, cancel }: { rows: LeaveRow[]; cancel?: 'hr' | 'self' }) {
  return (
    <Table head={['No.', 'Karyawan', 'Jenis', 'Tanggal', 'Hari', 'Status', '']}>
      {rows.map(r => (
        <tr key={r.id}>
          <td className="font-mono text-xs">{r.request_no}</td>
          <td><Link href={`/hrga/${r.employee_id}`} className="font-medium hover:text-accent">{r.full_name}</Link>
            <span className="block text-xs text-muted">{r.nrp} · {r.department_code}</span></td>
          <td className="text-sm">{r.leave_name}{!r.paid && <span className="block text-xs text-warn">tidak dibayar</span>}
            <span className="block text-xs text-muted">{r.reason}</span></td>
          <td className="whitespace-nowrap text-sm">{fmtDate(r.start_date)}{r.end_date !== r.start_date && <> – {fmtDate(r.end_date)}</>}</td>
          <td className="tabular text-sm">{Number(r.days)}</td>
          <td><Pill tone={LEAVE_STATUS[r.status]?.[0] ?? 'muted'}>{LEAVE_STATUS[r.status]?.[1] ?? r.status}</Pill>
            {(r.approver1_name || r.decision_note) && <span className="block text-xs text-muted">
              {[r.approver1_name, r.approver2_name].filter(Boolean).join(' → ')}{r.decision_note && ` · ${r.decision_note}`}</span>}</td>
          <td>{r.can_decide ? <Decide id={r.id} action={decideLeave} approveLabel={r.status === 'approved_1' ? 'Verifikasi HRGA' : 'Setujui'} />
            : cancel && (['submitted', 'approved_1'].includes(r.status) || (cancel === 'hr' && r.status === 'approved' && r.start_date > siteToday()))
              ? <ActionForm action={cancelLeave} label="Batalkan" hidden={{ id: r.id }} /> : null}</td>
        </tr>
      ))}
    </Table>
  );
}


export type OtRow = { id: string; request_no: string; employee_id: string; nrp: string; full_name: string; department_code: string; work_date: string;
  start_at: string; end_at: string; hours: number; day_type: string; reason: string; status: string; decision_note: string | null;
  approver_name: string | null; actual_hours: number | null; can_decide: boolean };

export function OvertimeTable({ rows, canCancel }: { rows: OtRow[]; canCancel?: boolean }) {
  return (
    <Table head={['No.', 'Karyawan', 'Tanggal & jam', 'Jam SPL', 'Aktual', 'Status', '']}>
      {rows.map(r => (
        <tr key={r.id}>
          <td className="font-mono text-xs">{r.request_no}</td>
          <td><Link href={`/hrga/${r.employee_id}`} className="font-medium hover:text-accent">{r.full_name}</Link>
            <span className="block text-xs text-muted">{r.nrp} · {r.department_code}</span></td>
          <td className="whitespace-nowrap text-sm">{fmtDate(r.work_date)} · {fmtTime(r.start_at)}–{fmtTime(r.end_at)}
            <span className="block text-xs text-muted">{DAY_TYPE[r.day_type]} · {r.reason}</span></td>
          <td className="tabular text-sm">{Number(r.hours)}</td>
          <td className="tabular text-sm">{r.actual_hours == null ? '–' : <span className={Number(r.actual_hours) < Number(r.hours) ? 'text-warn' : ''}>{Number(r.actual_hours)}</span>}</td>
          <td><Pill tone={OT_STATUS[r.status]?.[0] ?? 'muted'}>{OT_STATUS[r.status]?.[1] ?? r.status}</Pill>
            {(r.approver_name || r.decision_note) && <span className="block text-xs text-muted">{r.approver_name}{r.decision_note && ` · ${r.decision_note}`}</span>}</td>
          <td>{r.can_decide ? <Decide id={r.id} action={decideOvertime} />
            : canCancel && r.status === 'submitted' ? <ActionForm action={cancelOvertime} label="Batalkan" hidden={{ id: r.id }} /> : null}</td>
        </tr>
      ))}
    </Table>
  );
}
