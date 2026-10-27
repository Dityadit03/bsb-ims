import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { ExportLinks } from '@/components/export-links';
import { Tabs } from '@/components/tabs';
import { PageHeader, Pager, Panel, Pill, Table, input, paginate } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { PAY_CALC, PAY_CATEGORY, RUN_KIND, RUN_STATUS, rp, siteToday } from '@/lib/hrga';
import { EmployeeDatalist, EmployeeInput } from '../../she/fields';
import { createRun, saveComponent, saveSetting, setPay } from './actions';
import { HrTabs } from '../tabs';

export const metadata = { title: 'Payroll' };

type Comp = { code: string; name: string; kind: string; category: string; calc: string; taxable: boolean; active: boolean; sort_order: number };

const SETTINGS: [string, string, string][] = [
  ['payroll_cutoff_day', 'Tanggal tutup absensi', '0 = bulan kalender'], ['payroll_daily_divisor', 'Pembagi upah harian', 'potongan alpa / izin'],
  ['payroll_overtime_week_days', 'Pola hari kerja/minggu', 'tarif lembur hari istirahat'],
  ['bpjs_jht_er', 'JHT perusahaan %', ''], ['bpjs_jht_ee', 'JHT karyawan %', ''], ['bpjs_jp_er', 'JP perusahaan %', ''], ['bpjs_jp_ee', 'JP karyawan %', ''],
  ['bpjs_jp_cap', 'Batas upah JP', 'diperbarui BPJS tiap Maret'], ['bpjs_jkk_er', 'JKK %', 'sesuai kelompok risiko'], ['bpjs_jkm_er', 'JKM %', ''],
  ['bpjs_kes_er', 'BPJS Kes perusahaan %', ''], ['bpjs_kes_ee', 'BPJS Kes karyawan %', ''], ['bpjs_kes_cap', 'Batas upah BPJS Kes', ''],
];

export default async function PayrollPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await getSession();
  const tab = sp.tab === 'struktur' || sp.tab === 'komponen' ? sp.tab : 'proses';
  if (!session.can('payroll.read')) {
    return (
      <>
        <PageHeader eyebrow="HRGA" title="Payroll" />
        <HrTabs active="/hrga/payroll" />
        <Panel><p className="text-sm">Data gaji hanya bisa dibuka oleh pemegang peran Payroll officer atau Penyetuju payroll.</p></Panel>
      </>
    );
  }
  const manage = session.can('payroll.manage');
  const supabase = await createClient();
  const { data: comps } = await supabase.from('pay_components').select('*').order('sort_order').returns<Comp[]>();

  return (
    <>
      <PageHeader eyebrow="HRGA · rahasia" title="Payroll">{tab === 'proses' && <ExportLinks dataset="slip_gaji" />}</PageHeader>
      <HrTabs active="/hrga/payroll" />
      <Tabs items={[['/hrga/payroll', 'Proses gaji'], ['/hrga/payroll?tab=struktur', 'Struktur gaji'], ['/hrga/payroll?tab=komponen', 'Komponen & pengaturan']]}
        active={tab === 'proses' ? '/hrga/payroll' : `/hrga/payroll?tab=${tab}`} />
      {tab === 'proses' && <Runs manage={manage} supabase={supabase} />}
      {tab === 'struktur' && <Structure sp={sp} manage={manage} comps={comps ?? []} supabase={supabase} />}
      {tab === 'komponen' && <Components manage={manage} comps={comps ?? []} supabase={supabase} />}
    </>
  );
}

type Client = Awaited<ReturnType<typeof createClient>>;

async function Runs({ manage, supabase }: { manage: boolean; supabase: Client }) {
  const [{ data: runs }, { data: recap }] = await Promise.all([
    supabase.from('payroll_runs').select('*').order('period', { ascending: false }).order('created_at', { ascending: false }).limit(60),
    supabase.from('payroll_cost_recap').select('run_id, headcount, net, employer_cost').limit(2000),
  ]);
  const tot = new Map<string, { n: number; net: number; cost: number }>();
  for (const r of recap ?? []) {
    const t = tot.get(r.run_id) ?? { n: 0, net: 0, cost: 0 };
    t.n += r.headcount; t.net += Number(r.net); t.cost += Number(r.employer_cost);
    tot.set(r.run_id, t);
  }
  const today = siteToday();
  const next = today.slice(8) > '20' ? new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7), 1)).toISOString().slice(0, 7) : today.slice(0, 7);
  return (
    <>
      <Panel title="Proses gaji" sub="Alur: buat proses → isi input (insentif, kasbon) → hitung → disetujui penyetuju payroll → terbitkan slip ke karyawan">
        {runs?.length ? (
          <Table head={['No.', 'Periode', 'Jenis', 'Absensi', 'Karyawan', 'Total gaji bersih', 'Biaya perusahaan', 'Status']}>
            {runs.map(r => {
              const t = tot.get(r.id);
              return (
                <tr key={r.id}>
                  <td><Link href={`/hrga/payroll/${r.id}`} className="font-mono text-xs font-semibold hover:text-accent">{r.run_no}</Link></td>
                  <td className="text-sm">{r.period}</td>
                  <td className="text-sm">{RUN_KIND[r.kind]}{r.parallel && <span className="ml-1"><Pill tone="accent">uji paralel</Pill></span>}</td>
                  <td className="whitespace-nowrap text-xs text-muted">{fmtDate(r.att_from)} – {fmtDate(r.att_to)}</td>
                  <td className="tabular text-sm">{t?.n ?? '–'}</td>
                  <td className="tabular text-sm">{t ? rp(t.net) : '–'}</td>
                  <td className="tabular text-sm">{t ? rp(t.cost) : '–'}</td>
                  <td><Pill tone={RUN_STATUS[r.status]?.[0] ?? 'muted'}>{RUN_STATUS[r.status]?.[1] ?? r.status}</Pill></td>
                </tr>
              );
            })}
          </Table>
        ) : <p className="text-sm text-muted">Belum ada proses gaji.</p>}
      </Panel>
      {manage && (
        <Panel title="Buat proses baru" sub="Uji paralel: dihitung dan dibandingkan dengan hasil sistem lama (impor 'Hasil gaji sistem lama'), tidak diterbitkan ke karyawan.">
          <ActionForm action={createRun} label="Buat proses" primary className="md:grid-cols-5 md:items-end">
            <label className="grid gap-1 text-sm">Periode<input type="month" name="period" required defaultValue={next} className={input} /></label>
            <label className="grid gap-1 text-sm">Jenis<select name="kind" className={input}><option value="regular">Gaji bulanan</option><option value="thr">THR</option></select></label>
            <label className="grid gap-1 text-sm">Tanggal bayar<input type="date" name="pay_date" className={input} /></label>
            <label className="grid gap-1 text-sm">Catatan<input name="note" className={input} /></label>
            <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="parallel" defaultChecked /> Uji paralel</label>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}

type Cur = { employee_id: string; nrp: string; full_name: string; department_code: string; amounts: Record<string, number> | null; fixed_wage: number; last_change: string | null };

async function Structure({ sp, manage, comps, supabase }: { sp: Record<string, string | undefined>; manage: boolean; comps: Comp[]; supabase: Client }) {
  const { data } = await supabase.from('employee_pay_current').select('*').order('full_name').limit(5000).returns<Cur[]>();
  const cols = comps.filter(c => c.active && c.calc !== 'manual');
  let rows = data ?? [];
  if (sp.dept) rows = rows.filter(r => r.department_code === sp.dept);
  if (sp.kosong === '1') rows = rows.filter(r => !r.fixed_wage);
  const pg = paginate(rows, sp.hal);
  const depts = [...new Set((data ?? []).map(r => r.department_code))].sort();
  const empty = (data ?? []).filter(r => !r.fixed_wage).length;
  return (
    <>
      <Panel title="Struktur gaji berlaku" sub={`${(data ?? []).length} karyawan BSB aktif (subkon tidak digaji BSB) · ${empty} belum punya gaji pokok`}
        action={<form className="flex gap-2"><input type="hidden" name="tab" value="struktur" />
          <select name="dept" defaultValue={sp.dept ?? ''} className={`${input} max-w-32`}><option value="">Semua dept</option>{depts.map(d => <option key={d}>{d}</option>)}</select>
          <select name="kosong" defaultValue={sp.kosong ?? ''} className={`${input} max-w-40`}><option value="">Semua</option><option value="1">Belum diisi</option></select>
          <button className="rounded-lg border border-line px-3 text-sm hover:border-violet/60">Saring</button></form>}>
        <Table head={['Karyawan', 'Dept', ...cols.map(c => c.code), 'Upah tetap', 'Perubahan terakhir']}>
          {pg.rows.map(r => (
            <tr key={r.employee_id}>
              <td><Link href={`/hrga/${r.employee_id}`} className="font-medium hover:text-accent">{r.full_name}</Link><span className="block font-mono text-xs text-muted">{r.nrp}</span></td>
              <td className="text-xs">{r.department_code}</td>
              {cols.map(c => <td key={c.code} className="tabular text-sm">{r.amounts?.[c.code] != null ? rp(r.amounts[c.code]) : '–'}</td>)}
              <td className="tabular text-sm font-semibold">{r.fixed_wage ? rp(r.fixed_wage) : <span className="text-warn">belum</span>}</td>
              <td className="text-xs text-muted">{fmtDate(r.last_change)}</td>
            </tr>
          ))}
        </Table>
        <Pager {...pg} params={{ tab: 'struktur', dept: sp.dept, kosong: sp.kosong }} />
      </Panel>
      {manage && (
        <Panel title="Ubah gaji / tunjangan" sub="Perubahan berlaku mulai tanggal yang diisi; riwayat lama tetap tersimpan. Massal: Impor data → Struktur gaji.">
          <EmployeeDatalist />
          <ActionForm action={setPay} label="Simpan" primary className="md:grid-cols-5 md:items-end">
            <EmployeeInput required />
            <label className="grid gap-1 text-sm">Komponen<select name="component" className={input}>{cols.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
            <label className="grid gap-1 text-sm">Nilai (Rp)<input name="amount" required inputMode="numeric" placeholder="8.000.000" className={input} /></label>
            <label className="grid gap-1 text-sm">Berlaku mulai<input type="date" name="effective" required defaultValue={siteToday()} className={input} /></label>
            <label className="grid gap-1 text-sm">Keterangan<input name="note" placeholder="mis. kenaikan berkala" className={input} /></label>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}

async function Components({ manage, comps, supabase }: { manage: boolean; comps: Comp[]; supabase: Client }) {
  const { data: settings } = await supabase.from('app_settings').select('key, value').in('key', SETTINGS.map(s => s[0]));
  const val = new Map((settings ?? []).map(s => [s.key, s.value]));
  return (
    <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
      <Panel title="Komponen gaji" sub="Gaji pokok + tunjangan tetap = upah tetap: dasar lembur (1/173), THR, BPJS, dan potongan alpa">
        <Table head={['Kode', 'Nama', 'Jenis', 'Cara hitung', 'Kena pajak', 'Status']}>
          {comps.map(c => (
            <tr key={c.code}>
              <td className="font-mono text-xs font-semibold">{c.code}</td>
              <td className="text-sm">{c.name}</td>
              <td className="text-sm">{PAY_CATEGORY[c.category]}</td>
              <td className="text-sm">{PAY_CALC[c.calc]}</td>
              <td className="text-sm">{c.taxable ? 'Ya' : 'Tidak'}</td>
              <td><Pill tone={c.active ? 'ok' : 'muted'}>{c.active ? 'Aktif' : 'Nonaktif'}</Pill></td>
            </tr>
          ))}
        </Table>
        {manage && (
          <ActionForm action={saveComponent} label="Simpan komponen" className="mt-3 md:grid-cols-3 md:items-end">
            <label className="grid gap-1 text-sm">Kode<input name="code" required placeholder="TKOMUNIKASI" className={input} /></label>
            <label className="grid gap-1 text-sm">Nama<input name="name" required className={input} /></label>
            <label className="grid gap-1 text-sm">Jenis<select name="category" className={input}>{Object.entries(PAY_CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="grid gap-1 text-sm">Cara hitung<select name="calc" className={input}>{Object.entries(PAY_CALC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="grid gap-1 text-sm">Kena pajak<select name="taxable" className={input}><option value="true">Ya</option><option value="false">Tidak</option></select></label>
            <label className="grid gap-1 text-sm">Urutan<input type="number" name="sort" defaultValue={30} className={input} /></label>
          </ActionForm>
        )}
      </Panel>
      <Panel title="Pengaturan payroll & BPJS" sub="PPh 21 memakai TER PP 58/2023 (Jan–Nov) dan tarif Pasal 17 untuk perhitungan setahun di Desember atau bulan terakhir bekerja">
        <div className="grid gap-2">
          {SETTINGS.map(([k, l, hint]) => manage ? (
            <ActionForm key={k} action={saveSetting} label="Simpan" hidden={{ key: k }} className="grid-cols-[1fr_8rem_auto] items-end">
              <span className="text-sm">{l}{hint && <span className="block text-xs text-muted">{hint}</span>}</span>
              <input name="value" defaultValue={String(val.get(k) ?? '')} inputMode="decimal" className={input} />
            </ActionForm>
          ) : (
            <p key={k} className="flex justify-between text-sm"><span>{l}</span><span className="tabular">{String(val.get(k) ?? '–')}</span></p>
          ))}
        </div>
      </Panel>
    </div>
  );
}
