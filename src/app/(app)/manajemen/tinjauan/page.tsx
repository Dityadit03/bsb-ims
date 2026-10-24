import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/documents';
import { REVIEW_STATUS } from '@/lib/management';
import { createReview } from '../actions';
import { MgmtTabs } from '../tabs';
import { today } from '../../she/fields';

export const metadata = { title: 'Tinjauan manajemen' };

type Row = { id: string; review_no: string; title: string; meeting_date: string; status: string; chair_name: string; items: number; required_topics: number; actions: number };

export default async function ReviewsPage() {
  const s = await getSession();
  const supabase = await createClient();
  const [{ data: rows }, { data: people }] = await Promise.all([
    supabase.from('mgmt_review_register').select('*').order('meeting_date', { ascending: false }).returns<Row[]>(),
    supabase.from('profiles').select('id, full_name, email').eq('status', 'active').order('full_name'),
  ]);

  return (
    <>
      <PageHeader eyebrow="SMKP elemen 7 · Tinjauan manajemen" title="Tinjauan manajemen" />
      <MgmtTabs active="/manajemen/tinjauan" />
      {rows?.length ? (
        <Table head={['Nomor', 'Judul', 'Tanggal rapat', 'Pimpinan', 'Masukan dibahas', 'Keputusan bertindak', 'Status']}>
          {rows.map(r => (
            <tr key={r.id}>
              <td className="whitespace-nowrap font-mono text-xs"><Link href={`/manajemen/tinjauan/${r.id}`} className="font-medium hover:text-accent">{r.review_no}</Link></td>
              <td className="text-sm"><Link href={`/manajemen/tinjauan/${r.id}`} className="hover:text-accent">{r.title}</Link></td>
              <td className="text-xs">{fmtDate(r.meeting_date)}</td>
              <td className="text-xs">{r.chair_name}</td>
              <td className="tabular text-xs">{r.items}/{r.required_topics}</td>
              <td className="tabular text-xs">{r.actions}</td>
              <td><Pill tone={REVIEW_STATUS[r.status][0]}>{REVIEW_STATUS[r.status][1]}</Pill></td>
            </tr>
          ))}
        </Table>
      ) : <p className="text-sm text-muted">Belum ada tinjauan manajemen.</p>}
      {s.can('mgmt.review') && (
        <Panel title="Jadwalkan tinjauan manajemen">
          <ActionForm action={createReview} label="Simpan & terbitkan nomor RTM" primary hidden={{ idem: randomUUID() }} className="max-w-3xl">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm sm:col-span-3">Judul<input name="title" required className={input} placeholder="mis. Tinjauan manajemen SMKP semester II 2026" /></label>
              <label className="grid gap-1 text-sm">Tanggal rapat<input type="date" name="date" required defaultValue={today()} className={input} /></label>
              <label className="grid gap-1 text-sm sm:col-span-2">Pimpinan rapat
                <select name="chair" required className={input} defaultValue={s.profile.id}>{(people ?? []).map(p => <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>)}</select></label>
            </div>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
