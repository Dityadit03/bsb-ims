import Link from 'next/link';
import { Fragment } from 'react';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { Tabs } from '@/components/tabs';
import { PageHeader, Panel, Pill, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import {
  CARD_STATUS, COMP_CATEGORY, CONTRACT, CONTRACT_STATUS, EMPLOYMENT, FITNESS, MOB, MOB_AUTO, MOVE, ORIGIN, PRIVATE_FIELDS, WORKER_CLASS, ROSTER, VALIDITY, pctTone,
} from '@/lib/hrga';
import {
  addCompetency, addContract, cancelMobilization, checkMobilization, completeMobilization, createMobilization, exitEmployee, issueIdCard,
  moveEmployee, revokeCompetency, saveClassify, saveOrg, savePrivate, setCompetencyDetail, setIdCardStatus,
} from '../actions';
import { HrTabs } from '../tabs';
import { today } from '../../she/fields';

type Emp = { id: string; nrp: string; full_name: string; department_id: string; department_code: string; position_name: string | null; employment_type: string;
  company: string | null; join_date: string | null; status: string; exit_date: string | null; email: string | null;
  required: number; compliant: number; compliance_pct: number | null };
type Org = { supervisor_id: string | null; site_id: string | null; grade: string | null; roster_pattern: string | null; point_of_hire: string | null;
  section_id: string | null; position_id: string | null; recruitment_origin: string | null; worker_class: string | null };
type Comp = { id: string; competency_code: string; competency_name: string; category: string; cert_no: string | null; issuer: string | null;
  issued_on: string; valid_until: string | null; validity: string; days_left: number | null; revoke_reason: string | null;
  fitness: string | null; fitness_note: string | null; license_class: string | null };
type Mob = { id: string; kind: string; planned_date: string; status: string; items: { key: string; label: string; done: boolean }[];
  auto: Record<string, boolean>; note: string | null; completed_at: string | null };

const TAB = [['ringkasan', 'Ringkasan'], ['pribadi', 'Data pribadi'], ['kontrak', 'Kontrak & riwayat'], ['kompetensi', 'Kompetensi'], ['akses', 'ID card & mobilisasi']] as const;

const ageOf = (birth: string, on: string) => {
  const b = new Date(birth), d = new Date(on);
  return d.getFullYear() - b.getFullYear() - (d.getMonth() < b.getMonth() || (d.getMonth() === b.getMonth() && d.getDate() < b.getDate()) ? 1 : 0);
};
const tenure = (join: string | null, exit: string | null, on: string) => {
  if (!join) return '–';
  const a = new Date(join), z = new Date(exit ?? on);
  let m = (z.getFullYear() - a.getFullYear()) * 12 + z.getMonth() - a.getMonth() - (z.getDate() < a.getDate() ? 1 : 0);
  if (m < 0) m = 0;
  return `${Math.floor(m / 12)} tahun ${m % 12} bulan`;
};

export default async function EmployeeDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const tab = (await searchParams).tab ?? 'ringkasan';
  const s = await getSession();
  const supabase = await createClient();
  const [{ data: e }, { data: org }] = await Promise.all([
    supabase.from('employee_register').select('*').eq('id', id).maybeSingle<Emp>(),
    supabase.from('employees').select('supervisor_id, site_id, grade, roster_pattern, point_of_hire, section_id, position_id, recruitment_origin, worker_class').eq('id', id).maybeSingle<Org>(),
  ]);
  if (!e || !org) notFound();
  const from = today();
  const hr = s.canIn('hr.manage', 'HRGA');
  const active = e.status === 'active';
  const link = (t: string) => `/hrga/${id}?tab=${t}`;

  const [{ data: comps }, { data: matrix }, { data: masters }, { data: roster }, { data: priv }, { data: contracts }, { data: moves },
    { data: cards }, { data: mobs }, { data: sup }, { data: people }, { data: sites }, { data: depts }, { data: sections }, { data: positions }, { data: areas }] = await Promise.all([
    supabase.from('employee_competency_view').select('*').eq('employee_id', id).order('issued_on', { ascending: false }).returns<Comp[]>(),
    supabase.from('competency_matrix').select('competency_code, competency_name, status, valid_until').eq('employee_id', id).order('competency_code'),
    supabase.from('competencies').select('id, code, name').eq('active', true).order('code'),
    supabase.from('roster_entries').select('work_date, code').eq('employee_id', id).gte('work_date', from).order('work_date').limit(14),
    supabase.from('employee_private').select('*').eq('employee_id', id).maybeSingle<Record<string, string | null>>(),
    supabase.from('employee_contracts').select('*').eq('employee_id', id).order('start_date', { ascending: false }),
    supabase.from('movement_register').select('*').eq('employee_id', id).order('effective_date', { ascending: false }).order('id'),
    supabase.from('id_card_register').select('*').eq('employee_id', id).order('issued_on', { ascending: false }),
    supabase.from('mobilization_register').select('*').eq('employee_id', id).order('created_at', { ascending: false }).returns<Mob[]>(),
    org.supervisor_id ? supabase.from('employees').select('id, nrp, full_name').eq('id', org.supervisor_id).maybeSingle() : Promise.resolve({ data: null }),
    hr ? supabase.from('employees').select('id, nrp, full_name').eq('status', 'active').neq('id', id).order('full_name').limit(2000) : Promise.resolve({ data: [] }),
    supabase.from('sites').select('id, code, name').eq('active', true),
    supabase.from('departments').select('id, code').eq('active', true).order('sort_order'),
    supabase.from('sections').select('id, code, department_id').eq('active', true),
    supabase.from('positions').select('id, name, department_id').eq('active', true).order('name'),
    supabase.from('app_settings').select('value').eq('key', 'site_access_areas').maybeSingle(),
  ]);
  const site = (sites ?? []).find(x => x.id === org.site_id);
  const openMob = (mobs ?? []).filter(m => m.status === 'open');
  const cardActive = (cards ?? []).find(c => c.status === 'active' || c.status === 'suspended');

  return (
    <>
      <PageHeader eyebrow={`${e.nrp} · ${e.department_code}${e.position_name ? ` · ${e.position_name}` : ''}`} title={e.full_name}>
        <span className="flex flex-wrap gap-2">
          {active ? (e.required ? <Pill tone={pctTone(e.compliance_pct)}>Kompetensi {e.compliance_pct}%</Pill> : null) : <Pill tone="muted">Keluar {fmtDate(e.exit_date)}</Pill>}
          {cardActive && <Pill tone={CARD_STATUS[cardActive.status][0]}>ID {cardActive.card_no}</Pill>}
        </span>
      </PageHeader>
      <HrTabs active="/hrga" />
      <Tabs items={TAB.map(([k, l]) => [link(k), l] as const)} active={link(tab)} />

      {tab === 'ringkasan' && (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="grid min-w-0 content-start gap-4">
            <Panel title="Organisasi">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm [&_dt]:text-muted sm:grid-cols-[auto_1fr_auto_1fr]">
                <dt>Status kerja</dt><dd>{EMPLOYMENT[e.employment_type]}{e.company ? ` · ${e.company}` : ''}</dd>
                <dt>Masuk</dt><dd>{fmtDate(e.join_date)}</dd>
                <dt>Atasan langsung</dt><dd>{sup ? <Link href={`/hrga/${sup.id}`} className="text-accent">{sup.full_name}</Link> : '–'}</dd>
                <dt>Site</dt><dd>{site ? `${site.code} · ${site.name}` : '–'}</dd>
                <dt>Golongan</dt><dd>{org.grade ?? '–'}</dd>
                <dt>Pola roster</dt><dd>{org.roster_pattern ?? '–'}</dd>
                <dt>Point of hire</dt><dd>{org.point_of_hire ?? '–'}</dd>
                <dt>Status penerimaan</dt><dd>{org.recruitment_origin ? ORIGIN[org.recruitment_origin] : '–'}</dd>
                <dt>Golongan karyawan</dt><dd>{org.worker_class ? WORKER_CLASS[org.worker_class] : '–'}</dd>
                <dt>Masa kerja</dt><dd>{tenure(e.join_date, e.exit_date, from)}</dd>
                <dt>Umur</dt><dd>{priv?.birth_date ? `${ageOf(priv.birth_date, from)} tahun` : '–'}</dd>
                <dt>Akun</dt><dd>{e.email ?? '–'}</dd>
              </dl>
              {hr && active && (
                <details className="border-t border-line pt-3"><summary className="cursor-pointer text-sm text-accent">Ubah data organisasi</summary>
                  <ActionForm action={saveOrg} label="Simpan" hidden={{ employee: id }} className="mt-3">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <label className="grid gap-1 text-xs">Atasan langsung
                        <select name="supervisor" defaultValue={org.supervisor_id ?? ''} className={input}><option value="">–</option>
                          {(people ?? []).map(p => <option key={p.id} value={p.id}>{p.full_name} · {p.nrp}</option>)}</select></label>
                      <label className="grid gap-1 text-xs">Site
                        <select name="site" defaultValue={org.site_id ?? ''} className={input}><option value="">–</option>
                          {(sites ?? []).map(x => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</select></label>
                      <label className="grid gap-1 text-xs">Golongan / grade<input name="grade" defaultValue={org.grade ?? ''} className={input} /></label>
                      <label className="grid gap-1 text-xs">Pola roster<input name="roster_pattern" defaultValue={org.roster_pattern ?? ''} className={input} placeholder="10/4, 14/7, 5/2" /></label>
                      <label className="grid gap-1 text-xs sm:col-span-2">Point of hire<input name="poh" defaultValue={org.point_of_hire ?? ''} className={input} placeholder="Kota asal penerimaan" /></label>
                    </div>
                  </ActionForm>
                  <ActionForm action={saveClassify} label="Simpan klasifikasi" hidden={{ employee: id }} className="mt-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="grid gap-1 text-xs">Status penerimaan
                        <select name="origin" defaultValue={org.recruitment_origin ?? ''} className={input}><option value="">–</option>
                          {Object.entries(ORIGIN).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                      <label className="grid gap-1 text-xs">Golongan karyawan
                        <select name="class" defaultValue={org.worker_class ?? ''} className={input}><option value="">–</option>
                          {Object.entries(WORKER_CLASS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                    </div>
                  </ActionForm>
                </details>
              )}
            </Panel>
            {matrix?.length ? (
              <Panel title="Kompetensi wajib jabatan" action={<Link href={link('kompetensi')} className="text-xs text-accent">Rincian →</Link>}>
                <ul className="grid gap-2 text-sm sm:grid-cols-2">{matrix.map(m => (
                  <li key={m.competency_code} className="flex items-center justify-between gap-2 border-b border-line py-1">
                    <span><span className="font-mono text-xs">{m.competency_code}</span> · {m.competency_name}</span>
                    <Pill tone={VALIDITY[m.status][0]}>{VALIDITY[m.status][1]}{m.valid_until ? ` · s.d. ${fmtDate(m.valid_until)}` : ''}</Pill>
                  </li>))}</ul>
              </Panel>
            ) : null}
          </div>
          <div className="grid content-start gap-4">
            <Panel title="Roster 14 hari" action={<Link href="/hrga/roster" className="text-xs text-accent">Ubah →</Link>}>
              {roster?.length ? <ul className="grid grid-cols-2 gap-1 text-xs">{roster.map(r => <li key={r.work_date} className="flex justify-between gap-2">
                <span>{fmtDate(r.work_date)}</span><Pill tone={ROSTER[r.code][0]}>{ROSTER[r.code][1]}</Pill></li>)}</ul>
                : <p className="text-sm text-muted">Belum ada roster.</p>}
            </Panel>
            {active && s.canIn('hr.exit', 'HRGA') && (
              <Panel title="Proses keluar">
                <ActionForm action={exitEmployee} label="Proses keluar" hidden={{ employee: e.id }}>
                  <input type="date" name="date" required max={from} defaultValue={from} className={input} aria-label="Tanggal keluar" />
                  <input name="reason" required className={input} placeholder="Alasan (resign, habis kontrak, PHK)" />
                  <p className="text-xs text-muted">Akun aplikasi dinonaktifkan, semua perannya berakhir, dan ID card ditangguhkan sampai dikembalikan.</p>
                </ActionForm>
              </Panel>
            )}
          </div>
        </div>
      )}

      {tab === 'pribadi' && (
        priv || hr ? (
          <Panel title="Data pribadi" sub="Hanya terlihat oleh HRGA dan karyawan yang bersangkutan">
            {hr ? (
              <ActionForm action={savePrivate} label="Simpan data pribadi" primary hidden={{ employee: id }}>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {PRIVATE_FIELDS.map(([k, l, type, opts]) => (
                    <label key={k} className="grid gap-1 text-xs">{l}
                      {type === 'select'
                        ? <select name={k} defaultValue={priv?.[k] ?? ''} className={input}><option value="">–</option>{opts!.map(o => <option key={o}>{o}</option>)}</select>
                        : <input name={k} type={type} min={type === 'number' ? 0 : undefined} defaultValue={priv?.[k] ?? ''} className={input} />}
                    </label>
                  ))}
                </div>
              </ActionForm>
            ) : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm [&_dt]:text-muted sm:grid-cols-[auto_1fr_auto_1fr]">
                {PRIVATE_FIELDS.map(([k, l]) => <Fragment key={k}><dt>{l}</dt><dd>{priv?.[k] ?? '–'}</dd></Fragment>)}
              </dl>
            )}
          </Panel>
        ) : <p className="text-sm text-muted">Data pribadi hanya bisa dilihat oleh HRGA dan karyawan yang bersangkutan.</p>
      )}

      {tab === 'kontrak' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Kontrak kerja" sub="Hanya HRGA dan karyawan ybs">
            {contracts?.length ? (
              <Table head={['Jenis', 'No.', 'Mulai', 'Berakhir']}>
                {contracts.map((c, i) => {
                  const st = !c.end_date ? 'permanent' : c.end_date < from ? 'expired' : (Date.parse(c.end_date) - Date.parse(from)) / 864e5 <= 30 ? 'expiring' : 'active';
                  return (
                    <tr key={c.id}>
                      <td className="text-sm">{CONTRACT[c.contract_type]}{i === 0 && <> <Pill tone={CONTRACT_STATUS[st][0]}>{CONTRACT_STATUS[st][1]}</Pill></>}</td>
                      <td className="font-mono text-xs">{c.contract_no ?? '–'}</td>
                      <td className="text-xs">{fmtDate(c.start_date)}</td>
                      <td className="text-xs">{c.end_date ? fmtDate(c.end_date) : '–'}</td>
                    </tr>
                  );
                })}
              </Table>
            ) : <p className="text-sm text-muted">Belum ada kontrak tercatat.</p>}
            {hr && active && (
              <ActionForm action={addContract} label="Catat kontrak" hidden={{ employee: id }}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <select name="type" className={input} aria-label="Jenis kontrak">{Object.entries(CONTRACT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  <input name="no" className={input} placeholder="Nomor kontrak" />
                  <label className="grid gap-1 text-xs">Mulai<input type="date" name="start" required className={input} /></label>
                  <label className="grid gap-1 text-xs">Berakhir (kosong untuk PKWTT)<input type="date" name="end" className={input} /></label>
                </div>
                <p className="text-xs text-muted">Status kerja karyawan otomatis mengikuti jenis kontrak terbaru.</p>
              </ActionForm>
            )}
          </Panel>
          <Panel title="Riwayat perubahan & mutasi">
            <ol className="grid gap-3 border-l-2 border-line pl-4">
              {(moves ?? []).map(m => (
                <li key={m.id} className="relative text-sm">
                  <span className="absolute -left-[1.4rem] top-1.5 size-2.5 rounded-full bg-violet" aria-hidden />
                  <div className="font-semibold">{MOVE[m.kind]} <span className="font-normal text-muted">· {fmtDate(m.effective_date)}</span></div>
                  <div className="text-xs text-muted">
                    {m.from_department !== m.to_department && m.from_department ? `${m.from_department} → ${m.to_department} · ` : ''}
                    {m.kind === 'join' ? `${m.to_department ?? ''} · ${m.to_position ?? '–'} · ` : m.from_position !== m.to_position ? `${m.from_position ?? '–'} → ${m.to_position ?? '–'} · ` : ''}
                    {m.from_type !== m.to_type && m.from_type ? `${EMPLOYMENT[m.from_type]} → ${EMPLOYMENT[m.to_type]} · ` : ''}
                    {m.kind === 'supervisor_change' ? `atasan: ${m.to_supervisor ?? '–'} · ` : ''}
                    {m.reason ?? ''}{m.reference_no ? ` · ${m.reference_no}` : ''}
                  </div>
                </li>
              ))}
            </ol>
            {hr && active && (
              <details className="border-t border-line pt-3"><summary className="cursor-pointer text-sm text-accent">Catat promosi / mutasi</summary>
                <ActionForm action={moveEmployee} label="Simpan perubahan" hidden={{ employee: id }} className="mt-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <select name="kind" className={input} aria-label="Jenis">{['promotion', 'demotion', 'transfer', 'position_change', 'correction'].map(k => <option key={k} value={k}>{MOVE[k]}</option>)}</select>
                    <label className="grid gap-1 text-xs">Tanggal efektif<input type="date" name="date" required defaultValue={from} className={input} /></label>
                    <select name="department" defaultValue={e.department_id} className={input} aria-label="Departemen">{(depts ?? []).map(d => <option key={d.id} value={d.id}>{d.code}</option>)}</select>
                    <select name="section" defaultValue={org.section_id ?? ''} className={input} aria-label="Seksi"><option value="">Seksi –</option>
                      {(sections ?? []).map(x => <option key={x.id} value={x.id}>{(depts ?? []).find(d => d.id === x.department_id)?.code} · {x.code}</option>)}</select>
                    <select name="position" defaultValue={org.position_id ?? ''} className={`${input} sm:col-span-2`} aria-label="Jabatan"><option value="">Jabatan –</option>
                      {(positions ?? []).map(p => <option key={p.id} value={p.id}>{p.name} ({(depts ?? []).find(d => d.id === p.department_id)?.code ?? 'semua'})</option>)}</select>
                    <input name="reason" required className={input} placeholder="Alasan / keterangan" />
                    <input name="ref" className={input} placeholder="No. SK (opsional)" />
                  </div>
                </ActionForm>
              </details>
            )}
          </Panel>
        </div>
      )}

      {tab === 'kompetensi' && (
        <Panel title="Sertifikat, lisensi & pelatihan">
          {comps?.length ? (
            <Table head={['Kompetensi', 'No.', 'Terbit', 'Berlaku s.d.', 'Status', ...(active ? [''] : [])]}>
              {comps.map(c => (
                <tr key={c.id}>
                  <td className="text-sm"><span className="font-mono text-xs">{c.competency_code}</span> · {c.competency_name}
                    <div className="text-xs text-muted">{COMP_CATEGORY[c.category]}{c.issuer ? ` · ${c.issuer}` : ''}{c.license_class ? ` · kelas ${c.license_class}` : ''}</div>
                    {c.fitness && <div className="mt-1"><Pill tone={FITNESS[c.fitness][0]}>{FITNESS[c.fitness][1]}</Pill>{c.fitness_note && <span className="ml-1 text-xs text-muted">{c.fitness_note}</span>}</div>}</td>
                  <td className="font-mono text-xs">{c.cert_no ?? '–'}</td>
                  <td className="text-xs">{fmtDate(c.issued_on)}</td>
                  <td className="text-xs">{c.valid_until ? fmtDate(c.valid_until) : 'Seumur hidup'}</td>
                  <td><Pill tone={VALIDITY[c.validity][0]}>{VALIDITY[c.validity][1]}{c.validity === 'expiring' ? ` (${c.days_left} hari)` : ''}</Pill>
                    {c.revoke_reason && <div className="text-xs text-crit">{c.revoke_reason}</div>}</td>
                  {active && <td className="min-w-32">
                    {hr && c.category === 'medical' && c.validity !== 'revoked' && (
                      <details><summary className="cursor-pointer text-xs text-accent">Hasil MCU</summary>
                        <ActionForm action={setCompetencyDetail} label="Simpan" hidden={{ id: c.id, employee: e.id }}>
                          <select name="fitness" defaultValue={c.fitness ?? 'fit'} className={input} aria-label="Kelayakan">{Object.entries(FITNESS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select>
                          <input name="note" defaultValue={c.fitness_note ?? ''} className={input} placeholder="Catatan / batasan dokter" />
                        </ActionForm></details>)}
                    {hr && c.category === 'authorization' && c.validity !== 'revoked' && (
                      <details><summary className="cursor-pointer text-xs text-accent">Kelas SIMPER</summary>
                        <ActionForm action={setCompetencyDetail} label="Simpan" hidden={{ id: c.id, employee: e.id }}>
                          <input name="class" defaultValue={c.license_class ?? ''} className={input} placeholder="mis. A / B / permanen" />
                        </ActionForm></details>)}
                    {c.validity !== 'revoked' && c.validity !== 'expired' && (
                      <details><summary className="cursor-pointer text-xs text-muted">Cabut</summary>
                        <ActionForm action={revokeCompetency} label="Cabut" hidden={{ id: c.id, employee: e.id }}>
                          <input name="reason" required className={input} placeholder="Alasan pencabutan" /></ActionForm></details>)}
                  </td>}
                </tr>
              ))}
            </Table>
          ) : <p className="text-sm text-muted">Belum ada kompetensi tercatat.</p>}
          {hr && active && (
            <ActionForm action={addCompetency} label="Catat kompetensi" primary hidden={{ employee: e.id }}>
              <div className="grid gap-2 sm:grid-cols-3">
                <select name="competency" required className={input} aria-label="Kompetensi">{(masters ?? []).map(m => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}</select>
                <input name="cert_no" className={input} placeholder="No. sertifikat / SIMPER" />
                <input name="issuer" className={input} placeholder="Penerbit / lembaga" />
                <label className="grid gap-1 text-xs">Tanggal terbit<input type="date" name="issued" required max={from} defaultValue={from} className={input} /></label>
                <label className="grid gap-1 text-xs">Berlaku s.d. (kosong = sesuai master)<input type="date" name="valid_until" className={input} /></label>
              </div>
              <p className="text-xs text-muted">SIMPER hanya bisa dicatat bila induksi dan MCU (fit) masih berlaku.</p>
            </ActionForm>
          )}
        </Panel>
      )}

      {tab === 'akses' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="ID card & akses area site">
            {cards?.length ? (
              <ul className="grid gap-2">{cards.map(c => (
                <li key={c.id} className="grid gap-1 rounded-xl border border-line p-3 text-sm">
                  <div className="flex items-center justify-between gap-2"><span className="font-mono font-semibold">{c.card_no}</span><Pill tone={CARD_STATUS[c.status][0]}>{CARD_STATUS[c.status][1]}</Pill></div>
                  <div className="text-xs text-muted">Terbit {fmtDate(c.issued_on)}{c.valid_until ? ` · s.d. ${fmtDate(c.valid_until)}` : ''} · Area: {c.access_areas.join(', ') || '–'}</div>
                  {c.status_note && <div className="text-xs text-muted">{c.status_note}</div>}
                  {hr && (c.status === 'active' || c.status === 'suspended') && (
                    <ActionForm action={setIdCardStatus} label="Ubah status" hidden={{ id: c.id, employee: id }}>
                      <div className="grid grid-cols-2 gap-2">
                        <select name="status" className={input} aria-label="Status">{['returned', 'lost', 'suspended', 'active'].filter(x => x !== c.status).map(x => <option key={x} value={x}>{CARD_STATUS[x][1]}</option>)}</select>
                        <input name="note" required className={input} placeholder="Keterangan" />
                      </div>
                    </ActionForm>
                  )}
                </li>))}</ul>
            ) : <p className="text-sm text-muted">Belum ada ID card.</p>}
            {hr && active && !cardActive && (
              <ActionForm action={issueIdCard} label="Terbitkan ID card" primary hidden={{ employee: id }}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input name="card_no" required className={`${input} uppercase`} placeholder="Nomor kartu" />
                  <label className="grid gap-1 text-xs">Berlaku s.d. (opsional)<input type="date" name="valid_until" className={input} /></label>
                </div>
                <fieldset className="flex flex-wrap gap-3 text-sm"><legend className="mb-1 text-xs text-muted">Area yang boleh dimasuki</legend>
                  {((areas?.value as string[] | undefined) ?? []).map(a => <label key={a} className="flex items-center gap-1"><input type="checkbox" name="areas" value={a} defaultChecked={a === 'OFFICE' || a === 'MESS'} />{a}</label>)}
                </fieldset>
                <p className="text-xs text-muted">Hanya bisa diterbitkan bila induksi dan MCU (fit) masih berlaku.</p>
              </ActionForm>
            )}
          </Panel>
          <Panel title="Mobilisasi & demobilisasi">
            {(mobs ?? []).map(m => (
              <div key={m.id} className="grid gap-2 rounded-xl border border-line p-3">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-semibold">{MOB[m.kind]} · {fmtDate(m.planned_date)}</span>
                  <Pill tone={m.status === 'open' ? 'warn' : m.status === 'done' ? 'ok' : 'muted'}>{m.status === 'open' ? 'Berjalan' : m.status === 'done' ? 'Selesai' : 'Batal'}</Pill>
                </div>
                <ul className="grid gap-1 text-sm">
                  {Object.entries(m.auto).map(([k, ok]) => (
                    <li key={k} className="flex items-center gap-2"><span className={ok ? 'text-ok' : 'text-crit'}>{ok ? '✓' : '✗'}</span>
                      {m.kind === 'demob' && k === 'id_card' ? 'ID card dikembalikan' : MOB_AUTO[k]} <span className="text-xs text-muted">(otomatis)</span></li>
                  ))}
                  {m.items.map(i => (
                    <li key={i.key} className="flex items-center gap-2">
                      {hr && m.status === 'open'
                        ? <ActionForm action={checkMobilization} label={i.done ? '✓' : '○'} hidden={{ id: m.id, key: i.key, done: i.done ? 'false' : 'true', employee: id }} />
                        : <span className={i.done ? 'text-ok' : 'text-muted'}>{i.done ? '✓' : '○'}</span>}
                      <span className={i.done ? '' : 'text-muted'}>{i.label}</span>
                    </li>
                  ))}
                </ul>
                {hr && m.status === 'open' && (
                  <div className="flex flex-wrap gap-2">
                    <ActionForm action={completeMobilization} label="Selesaikan" primary hidden={{ id: m.id, employee: id }} />
                    <details><summary className="cursor-pointer text-xs text-muted">Batalkan</summary>
                      <ActionForm action={cancelMobilization} label="Batalkan" hidden={{ id: m.id, employee: id }}><input name="reason" required className={input} placeholder="Alasan" /></ActionForm></details>
                  </div>
                )}
              </div>
            ))}
            {!mobs?.length && <p className="text-sm text-muted">Belum ada checklist.</p>}
            {hr && active && openMob.length < 2 && (
              <ActionForm action={createMobilization} label="Buat checklist" hidden={{ employee: id }}>
                <div className="grid grid-cols-2 gap-2">
                  <select name="kind" className={input} aria-label="Jenis">{Object.entries(MOB).filter(([k]) => !openMob.some(m => m.kind === k)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  <input type="date" name="date" required defaultValue={from} className={input} aria-label="Tanggal rencana" />
                </div>
              </ActionForm>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}
