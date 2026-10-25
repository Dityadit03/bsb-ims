import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { RUN_KIND, rp } from '@/lib/hrga';
import { PrintButton } from './print-button';

export const metadata = { title: 'Slip gaji' };

type Line = { section: string; code: string; label: string; qty: number | null; rate: number | null; amount: number; sort_order: number };

// Slip gaji siap cetak. RLS: pemegang peran payroll, atau karyawan sendiri setelah slip diterbitkan.
export default async function SlipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: s } = await supabase.from('payroll_slips')
    .select('*, run:run_id(run_no, period, kind, pay_date, att_from, att_to, parallel, status), dept:department_id(code, name)').eq('id', id).maybeSingle();
  if (!s) notFound();
  const { data: lines } = await supabase.from('payroll_lines').select('section, code, label, qty, rate, amount, sort_order').eq('slip_id', id)
    .order('sort_order').returns<Line[]>();
  const run = s.run as unknown as { run_no: string; period: string; kind: string; pay_date: string; att_from: string; att_to: string; parallel: boolean; status: string };
  const dept = s.dept as unknown as { code: string; name: string };
  const by = (sec: string) => (lines ?? []).filter(l => l.section === sec);
  const [y, m] = run.period.split('-').map(Number);
  const periodName = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const draft = run.status !== 'published';

  const Section = ({ title, rows, total }: { title: string; rows: Line[]; total?: number }) => (
    <section>
      <h2 className="mb-1 border-b border-neutral-300 pb-1 text-xs font-bold uppercase tracking-wide text-neutral-600">{title}</h2>
      <table className="w-full text-sm">
        <tbody>
          {rows.map(l => (
            <tr key={l.code + l.label}>
              <td className="py-0.5">{l.label}{l.qty != null ? <span className="text-xs text-neutral-500"> · {Number(l.qty)}{l.rate != null && ` × ${rp(l.rate)}`}</span>
                : l.rate != null && l.code !== 'PPH21' && <span className="text-xs text-neutral-500"> · dasar {rp(l.rate)}</span>}</td>
              <td className="py-0.5 text-right tabular-nums">{rp(l.amount)}</td>
            </tr>
          ))}
          {!rows.length && <tr><td className="py-0.5 text-neutral-400">–</td><td /></tr>}
          {total != null && <tr className="border-t border-neutral-300 font-semibold"><td className="py-1">Jumlah</td><td className="py-1 text-right tabular-nums">{rp(total)}</td></tr>}
        </tbody>
      </table>
    </section>
  );

  return (
    <main className="min-h-dvh bg-neutral-100 py-6 text-neutral-900 print:bg-white print:py-0" style={{ colorScheme: 'light' }}>
      <div className="mx-auto mb-3 flex max-w-3xl items-center justify-between px-4 print:hidden">
        <Link href="/saya?tab=gaji" className="text-sm text-neutral-600 hover:underline">← Slip gaji saya</Link>
        <PrintButton />
      </div>
      <article className="mx-auto max-w-3xl bg-white p-8 shadow-sm print:max-w-none print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-4 border-b-2 border-[#5b21b6] pb-3">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" className="h-12 w-auto" />
            <div>
              <p className="text-base font-extrabold">PT Berkarya Sejahtera Bersama</p>
              <p className="text-xs text-neutral-500">Site BDA · Rahasia, hanya untuk karyawan yang bersangkutan</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-extrabold">{run.kind === 'thr' ? 'SLIP THR' : 'SLIP GAJI'}</p>
            <p className="text-sm">{periodName}</p>
            <p className="font-mono text-[11px] text-neutral-500">{run.run_no}</p>
          </div>
        </header>
        {draft && <p className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">{run.parallel ? 'UJI PARALEL · bukan slip resmi' : 'DRAF · belum diterbitkan'}</p>}

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr_auto_1fr] [&_dt]:text-neutral-500">
          <dt>Nama</dt><dd className="font-semibold">{s.full_name}</dd>
          <dt>NRP</dt><dd className="font-mono">{s.nrp}</dd>
          <dt>Jabatan</dt><dd>{s.position_name ?? '–'}</dd>
          <dt>Departemen</dt><dd>{dept.code} · {dept.name}</dd>
          <dt>Status PTKP</dt><dd>{s.ptkp_status}</dd>
          <dt>NPWP</dt><dd>{s.npwp ?? '–'}</dd>
          <dt>Periode absensi</dt><dd>{fmtDate(run.att_from)} – {fmtDate(run.att_to)}</dd>
          <dt>Tanggal bayar</dt><dd>{fmtDate(run.pay_date)}</dd>
          {run.kind === 'regular' && <>
            <dt>Kehadiran</dt><dd>{s.days_present} hari{s.days_absent > 0 && ` · alpa ${s.days_absent}`}{s.days_unpaid > 0 && ` · izin tdk dibayar ${s.days_unpaid}`}</dd>
            <dt>Lembur</dt><dd>{Number(s.overtime_hours) ? `${Number(s.overtime_hours)} jam` : '–'}</dd>
          </>}
        </dl>

        <div className="mt-5 grid gap-6 sm:grid-cols-2">
          <Section title="Pendapatan" rows={by('earning')} total={Number(s.earnings)} />
          <Section title="Potongan" rows={by('deduction')} total={by('deduction').reduce((a, l) => a + Number(l.amount), 0)} />
        </div>

        <div className="mt-5 flex items-center justify-between rounded-lg bg-[#5b21b6]/10 px-4 py-3">
          <span className="text-sm font-semibold">{run.kind === 'thr' ? 'THR diterima' : 'Gaji bersih diterima'}</span>
          <span className="text-2xl font-extrabold tabular-nums">Rp {rp(s.net)}</span>
        </div>
        <p className="mt-1 text-xs text-neutral-500">Ditransfer ke {s.bank_name ?? '–'} {s.bank_account ?? ''}{s.bank_holder && ` a.n. ${s.bank_holder}`}</p>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <Section title="Dibayar perusahaan (tidak dipotong)" rows={by('employer')} />
          <Section title="Keterangan" rows={by('info')} />
        </div>
        <p className="mt-6 text-[11px] text-neutral-500">
          PPh 21 {s.annualized ? 'dihitung setahun (tarif Pasal 17)' : s.ter_rate != null ? `memakai tarif efektif bulanan kategori ${s.ter_category} ${s.ter_rate}%` : ''} sesuai PP 58/2023.
          Slip ini dibuat oleh sistem BSB IMS dan sah tanpa tanda tangan. Pertanyaan tentang gaji hubungi HRGA.
        </p>
      </article>
    </main>
  );
}
