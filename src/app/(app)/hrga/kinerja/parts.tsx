import Link from 'next/link';
import { Pill, Table } from '@/components/ui';
import { GRADE, PERF_STATUS } from '@/lib/hrga';

export type ReviewRow = { id: string; cycle_id: string; cycle_name: string; cycle_status: string; period_start: string; period_end: string;
  kpi_weight: number; goal_due: string | null; review_due: string | null; employee_id: string; nrp: string; full_name: string; department_code: string;
  position_name: string | null; supervisor_name: string | null; status: string; return_note: string | null; goals: number; weight_total: number;
  self_submitted_at: string | null; manager_submitted_at: string | null; final_score: number | null; final_grade: string | null;
  computed_grade: string | null; calibrated_grade: string | null; acknowledged_at: string | null; is_self: boolean; is_manager: boolean;
  has_account: boolean; my_action: string | null };

export function GradePill({ grade }: { grade: string | null }) {
  if (!grade) return <span className="text-sm text-muted">–</span>;
  return <Pill tone={GRADE[grade]?.[0]}>{grade} · {GRADE[grade]?.[1]}</Pill>;
}

// daftar penilaian; dipakai di HRGA, Saya dan Kotak tugas
export function ReviewTable({ rows, cycle = false }: { rows: ReviewRow[]; cycle?: boolean }) {
  return (
    <Table head={[cycle ? 'Siklus' : 'Karyawan', 'Atasan', 'KPI', 'Status', 'Nilai', '']}>
      {rows.map(r => (
        <tr key={r.id}>
          <td>
            <Link href={`/kinerja/${r.id}`} className="grid hover:text-accent">
              <span className="text-sm font-semibold">{cycle ? r.cycle_name : r.full_name}</span>
              <span className="font-mono text-xs text-muted">{cycle ? `${r.full_name} · ${r.nrp}` : `${r.nrp} · ${r.department_code}${r.position_name ? ` · ${r.position_name}` : ''}`}</span>
            </Link>
          </td>
          <td className="text-sm">{r.supervisor_name ?? '–'}</td>
          <td className="tabular text-sm">{r.goals} <span className={r.weight_total === 100 ? 'text-muted' : 'text-warn'}>({r.weight_total}%)</span></td>
          <td><Pill tone={PERF_STATUS[r.status]?.[0]}>{PERF_STATUS[r.status]?.[1] ?? r.status}</Pill></td>
          <td className="text-sm">
            {r.final_score != null ? <span className="flex items-center gap-2"><span className="tabular">{Number(r.final_score).toFixed(2)}</span><GradePill grade={r.final_grade} /></span> : '–'}
          </td>
          <td className="text-right">{r.my_action && <Link href={`/kinerja/${r.id}`} className="text-sm font-semibold text-violet hover:underline">{r.my_action} →</Link>}</td>
        </tr>
      ))}
    </Table>
  );
}
