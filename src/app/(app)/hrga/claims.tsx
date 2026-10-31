import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { DropZone } from '@/components/drop-zone';
import { Pill, Table, input } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { ADV_KIND, ADV_STATUS, CLAIM_STATUS, PAY_METHOD, rp, siteToday } from '@/lib/hrga';
import { EmployeeDatalist, EmployeeInput } from '../she/fields';
import {
  cancelAdvance, cancelClaim, createAdvance, createClaim, decideAdvance, decideClaim, disburseAdvance, markClaimPaid, repayAdvance, reportAdvance,
} from './klaim-actions';

export type ClaimRow = { id: string; claim_no: string; employee_id: string; nrp: string; full_name: string; department_code: string;
  claim_type_name: string; taxable: boolean; expense_date: string; amount: number; approved_amount: number | null; description: string; status: string;
  pay_method: string | null; decision_note: string | null; paid_on: string | null; paid_run_no: string | null; advance_no: string | null;
  approver1_name: string | null; approver2_name: string | null; can_decide: boolean; created_at: string };
export type AdvanceRow = { id: string; advance_no: string; employee_id: string; nrp: string; full_name: string; department_code: string; kind: string;
  purpose: string; amount: number; installments: number; installment_amount: number; status: string; decision_note: string | null; disbursed_on: string | null;
  actual_amount: number | null; reported_at: string | null; repaid: number; balance: number; report_overdue: boolean; opening: boolean;
  approver1_name: string | null; approver2_name: string | null; can_decide: boolean; created_at: string };

const Who = ({ r }: { r: { employee_id: string; full_name: string; nrp: string; department_code: string } }) => (
  <td><Link href={`/hrga/${r.employee_id}`} className="font-medium hover:text-accent">{r.full_name}</Link>
    <span className="block text-xs text-muted">{r.nrp} · {r.department_code}</span></td>
);
const Trail = ({ a, b, note }: { a: string | null; b: string | null; note: string | null }) =>
  (a || note) ? <span className="block text-xs text-muted">{[a, b].filter(Boolean).join(' → ')}{note && ` · ${note}`}</span> : null;

// Setujui / tolak; tahap payroll juga menetapkan nominal disetujui dan cara bayar
function ClaimDecide({ r }: { r: ClaimRow }) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      {r.status === 'submitted'
        ? <ActionForm action={decideClaim} label="Setujui" primary hidden={{ id: r.id, approve: '1' }} />
        : (
          <details className="text-sm" open>
            <summary className="cursor-pointer text-xs text-muted">Verifikasi payroll</summary>
            <ActionForm action={decideClaim} label="Setujui" primary hidden={{ id: r.id, approve: '1' }} className="mt-1 w-56">
              <input name="amount" inputMode="numeric" defaultValue={rp(r.amount)} aria-label="Nominal disetujui" className={input} />
              <select aria-label="Cara bayar" name="pay_method" className={input}><option value="payroll">Bayar bersama gaji</option><option value="transfer">Transfer langsung</option></select>
              <input name="note" placeholder="Catatan (wajib bila nominal dikurangi)" className={input} />
            </ActionForm>
          </details>
        )}
      <details className="text-sm">
        <summary className="cursor-pointer rounded-lg border border-line px-3.5 py-2 hover:border-crit/60">Tolak</summary>
        <ActionForm action={decideClaim} label="Kirim penolakan" hidden={{ id: r.id, approve: '0' }} className="mt-2 w-60">
          <input name="note" required placeholder="Alasan penolakan" className={input} />
        </ActionForm>
      </details>
    </div>
  );
}

export async function ClaimTable({ rows, mode, payroll = false }: { rows: ClaimRow[]; mode: 'self' | 'manage'; payroll?: boolean }) {
  const supabase = await createClient();
  const { data: atts } = rows.length
    ? await supabase.from('attachments').select('id, owner_id, file_name').eq('owner_table', 'expense_claims').in('owner_id', rows.map(r => r.id))
    : { data: [] };
  return (
    <Table head={['No.', ...(mode === 'manage' ? ['Karyawan'] : []), 'Jenis & keterangan', 'Tgl biaya', 'Diajukan', 'Disetujui', 'Status', '']}>
      {rows.map(r => (
        <tr key={r.id}>
          <td className="font-mono text-xs">{r.claim_no}</td>
          {mode === 'manage' && <Who r={r} />}
          <td className="text-sm">{r.claim_type_name}<span className="block text-xs text-muted">{r.description}{r.advance_no && ` · uang muka ${r.advance_no}`}</span>
            <span className="mt-0.5 flex flex-wrap gap-1">{(atts ?? []).filter(a => a.owner_id === r.id).map(a =>
              <a key={a.id} href={`/api/lampiran/${a.id}`} target="_blank" className="rounded border border-line px-1.5 font-mono text-xs hover:border-accent">📎 {a.file_name}</a>)}</span></td>
          <td className="whitespace-nowrap text-sm">{fmtDate(r.expense_date)}</td>
          <td className="tabular text-sm">{rp(r.amount)}</td>
          <td className="tabular text-sm">{r.approved_amount == null ? '–' : <span className={Number(r.approved_amount) < Number(r.amount) ? 'text-warn' : ''}>{rp(r.approved_amount)}</span>}
            {r.pay_method && <span className="block text-xs text-muted">{PAY_METHOD[r.pay_method]}</span>}</td>
          <td><Pill tone={CLAIM_STATUS[r.status]?.[0] ?? 'muted'}>{CLAIM_STATUS[r.status]?.[1] ?? r.status}</Pill>
            {r.status === 'paid' && <span className="block text-xs text-muted">{fmtDate(r.paid_on)}{r.paid_run_no && ` · ${r.paid_run_no}`}</span>}
            <Trail a={r.approver1_name} b={r.approver2_name} note={r.decision_note} /></td>
          <td>{r.can_decide ? <ClaimDecide r={r} />
            : payroll && r.status === 'approved' && r.pay_method === 'transfer'
              ? <ActionForm action={markClaimPaid} label="Sudah ditransfer" hidden={{ id: r.id }} />
              : ['submitted', 'approved_1'].includes(r.status) && (mode === 'self' || payroll)
                ? <ActionForm action={cancelClaim} label="Batalkan" hidden={{ id: r.id }} /> : null}</td>
        </tr>
      ))}
    </Table>
  );
}

function AdvanceDecide({ id }: { id: string }) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      <ActionForm action={decideAdvance} label="Setujui" primary hidden={{ id, approve: '1' }} />
      <details className="text-sm">
        <summary className="cursor-pointer rounded-lg border border-line px-3.5 py-2 hover:border-crit/60">Tolak</summary>
        <ActionForm action={decideAdvance} label="Kirim penolakan" hidden={{ id, approve: '0' }} className="mt-2 w-60">
          <input name="note" required placeholder="Alasan penolakan" className={input} />
        </ActionForm>
      </details>
    </div>
  );
}

export function AdvanceTable({ rows, mode, payroll = false }: { rows: AdvanceRow[]; mode: 'self' | 'manage'; payroll?: boolean }) {
  return (
    <Table head={['No.', ...(mode === 'manage' ? ['Karyawan'] : []), 'Jenis & keperluan', 'Nominal', 'Potong gaji', 'Sisa', 'Status', '']}>
      {rows.map(r => (
        <tr key={r.id}>
          <td className="font-mono text-xs">{r.advance_no}</td>
          {mode === 'manage' && <Who r={r} />}
          <td className="text-sm">{ADV_KIND[r.kind]}{r.opening && <span className="ml-1"><Pill tone="muted">saldo awal</Pill></span>}
            <span className="block text-xs text-muted">{r.purpose}</span></td>
          <td className="tabular text-sm">{rp(r.amount)}
            {r.actual_amount != null && <span className="block text-xs text-muted">terpakai {rp(r.actual_amount)}</span>}</td>
          <td className="tabular text-sm">{r.kind === 'loan' ? `${rp(r.installment_amount)} × ${r.installments}` : 'sisa saja'}</td>
          <td className="tabular text-sm font-semibold">{['active', 'settled'].includes(r.status) ? rp(r.balance) : '–'}</td>
          <td><Pill tone={ADV_STATUS[r.status]?.[0] ?? 'muted'}>{ADV_STATUS[r.status]?.[1] ?? r.status}</Pill>
            {r.disbursed_on && <span className="block text-xs text-muted">cair {fmtDate(r.disbursed_on)}</span>}
            {r.report_overdue && <span className="block text-xs font-semibold text-crit">belum dipertanggungjawabkan</span>}
            <Trail a={r.approver1_name} b={r.approver2_name} note={r.decision_note} /></td>
          <td className="min-w-40">
            {r.can_decide && <AdvanceDecide id={r.id} />}
            {payroll && r.status === 'approved' && (
              <ActionForm action={disburseAdvance} label="Catat pencairan" primary hidden={{ id: r.id }}>
                <input type="date" name="date" defaultValue={siteToday()} aria-label="Tanggal cair" className={input} />
              </ActionForm>
            )}
            {r.kind === 'advance' && r.status === 'active' && r.actual_amount == null && (mode === 'self' || payroll) && (
              <details className="text-sm">
                <summary className="cursor-pointer rounded-lg border border-line px-3 py-1.5 hover:border-violet/60">Pertanggungjawaban</summary>
                <ActionForm action={reportAdvance} label="Simpan" primary hidden={{ id: r.id }} className="mt-2 w-64">
                  <input name="actual" required inputMode="numeric" placeholder="Biaya sebenarnya (Rp)" className={input} />
                  <input name="note" placeholder="Rincian singkat" className={input} />
                  <DropZone label="Kuitansi / bukti" accept="image/*,application/pdf" />
                  <span className="text-xs text-muted">Sisa uang muka dipotong gaji berikutnya. Biaya lebih dari uang muka: ajukan klaim Perjalanan dinas.</span>
                </ActionForm>
              </details>
            )}
            {payroll && r.status === 'active' && Number(r.balance) > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-xs text-muted hover:text-accent">Pengembalian di luar gaji</summary>
                <ActionForm action={repayAdvance} label="Catat" hidden={{ id: r.id }} className="mt-1 w-56">
                  <input name="amount" required inputMode="numeric" defaultValue={rp(r.balance)} className={input} />
                  <input type="date" name="date" defaultValue={siteToday()} className={input} />
                  <input name="note" placeholder="mis. transfer ke rekening perusahaan" className={input} />
                </ActionForm>
              </details>
            )}
            {!r.can_decide && (mode === 'self' || payroll) && ['submitted', 'approved_1'].includes(r.status) && (
              <ActionForm action={cancelAdvance} label="Batalkan" hidden={{ id: r.id }} />
            )}
          </td>
        </tr>
      ))}
    </Table>
  );
}

export async function ClaimForm({ forOther = false, employeeId }: { forOther?: boolean; employeeId?: string }) {
  const supabase = await createClient();
  const [{ data: types }, { data: advs }] = await Promise.all([
    supabase.from('claim_types').select('code, name, per_claim_limit, annual_limit').eq('active', true).order('sort_order'),
    employeeId
      ? supabase.from('cash_advances').select('id, advance_no, purpose').eq('employee_id', employeeId).eq('kind', 'advance').in('status', ['active', 'settled'])
        .order('created_at', { ascending: false }).limit(10)
      : Promise.resolve({ data: [] as { id: string; advance_no: string; purpose: string }[] }),
  ]);
  return (
    <>
      {forOther && <EmployeeDatalist />}
      <ActionForm action={createClaim} label="Ajukan klaim" primary hidden={{ idem: crypto.randomUUID() }} className="md:grid-cols-3 md:items-end">
        {forOther && <EmployeeInput required />}
        <label className="grid gap-1 text-sm">Jenis
          <select name="type" required className={input}>
            {(types ?? []).map(t => <option key={t.code} value={t.code}>{t.name}{t.annual_limit ? ` (plafon ${rp(t.annual_limit)}/thn)` : ''}</option>)}
          </select></label>
        <label className="grid gap-1 text-sm">Tanggal biaya<input type="date" name="date" required max={siteToday()} defaultValue={siteToday()} className={input} /></label>
        <label className="grid gap-1 text-sm">Nominal (Rp)<input name="amount" required inputMode="numeric" placeholder="250.000" className={input} /></label>
        <label className="grid gap-1 text-sm md:col-span-2">Keterangan<input name="description" required placeholder="mis. berobat ke klinik, tiket bus Samarinda" className={input} /></label>
        {!!advs?.length && (
          <label className="grid gap-1 text-sm">Kelebihan biaya uang muka<select name="advance" className={input}><option value="">–</option>
            {advs.map(a => <option key={a.id} value={a.id}>{a.advance_no} · {a.purpose}</option>)}</select></label>
        )}
        <div className="md:col-span-3"><DropZone label="Kuitansi / bukti bayar" accept="image/*,application/pdf" /></div>
      </ActionForm>
      <p className="text-xs text-muted">Persetujuan: atasan, lalu payroll. Klaim paling lambat 90 hari setelah tanggal biaya. Dibayar bersama gaji berikutnya atau ditransfer.</p>
    </>
  );
}

export function AdvanceForm({ forOther = false }: { forOther?: boolean }) {
  return (
    <>
      {forOther && <EmployeeDatalist />}
      <ActionForm action={createAdvance} label="Ajukan" primary hidden={{ idem: crypto.randomUUID() }} className="md:grid-cols-4 md:items-end">
        {forOther && <EmployeeInput required />}
        <label className="grid gap-1 text-sm">Jenis<select name="kind" className={input}><option value="loan">Kasbon pribadi (potong gaji)</option>
          <option value="advance">Uang muka dinas</option></select></label>
        <label className="grid gap-1 text-sm">Nominal (Rp)<input name="amount" required inputMode="numeric" placeholder="2.000.000" className={input} /></label>
        <label className="grid gap-1 text-sm">Cicilan (bulan)<input type="number" name="installments" min={1} max={12} defaultValue={1} className={input} /></label>
        <label className={`grid gap-1 text-sm ${forOther ? 'md:col-span-4' : ''}`}>Keperluan<input name="purpose" required placeholder="mis. biaya sekolah anak, dinas ke Balikpapan" className={input} /></label>
      </ActionForm>
      <p className="text-xs text-muted">Kasbon pribadi: maksimal 1× upah tetap, satu kasbon berjalan, dipotong gaji tiap bulan. Uang muka dinas: dipertanggungjawabkan setelah kegiatan; sisanya dipotong gaji.</p>
    </>
  );
}
