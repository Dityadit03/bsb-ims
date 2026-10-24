import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Table, input } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { ton } from '@/lib/production';
import { saveRoute, setTarget } from '../actions';
import { today } from '../../she/fields';

export const metadata = { title: 'Rute & target produksi' };

export default async function MasterPage() {
  const manage = (await getSession()).can('prod.manage');
  const supabase = await createClient();
  const [{ data: routes }, { data: targets }] = await Promise.all([
    supabase.from('haul_routes').select('id, code, name, from_point, to_point, distance_km, active').order('code'),
    supabase.from('production_targets').select('id, month, tonnage_target, note').order('month', { ascending: false }).limit(12),
  ]);

  return (
    <>
      <PageHeader eyebrow="Produksi · Master" title="Rute hauling & target" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Rute hauling">
          {routes?.length ? (
            <Table head={['Kode', 'Nama', 'Muat → bongkar', 'Jarak', 'Aktif']}>
              {routes.map(r => (
                <tr key={r.id}><td className="font-mono text-xs">{r.code}</td><td className="text-sm">{r.name}</td>
                  <td className="text-xs">{r.from_point} → {r.to_point}</td><td className="tabular text-xs">{r.distance_km} km</td>
                  <td className="text-xs">{r.active ? 'Ya' : 'Tidak'}</td></tr>
              ))}
            </Table>
          ) : <p className="text-sm text-muted">Belum ada rute.</p>}
          {manage && <ActionForm action={saveRoute} label="Simpan rute">
            <div className="grid gap-2 sm:grid-cols-2">
              <input name="code" required className={`${input} uppercase`} placeholder="Kode, mis. PIT1-JT" />
              <input name="name" required className={input} placeholder="Nama rute" />
              <input name="from" required className={input} placeholder="Titik muat" />
              <input name="to" required className={input} placeholder="Titik bongkar" />
              <input type="number" name="distance" required min={0.1} step="0.1" className={input} placeholder="Jarak (km)" />
              <select name="active" className={input} aria-label="Aktif"><option value="true">Aktif</option><option value="false">Tidak aktif</option></select>
            </div>
            <p className="text-xs text-muted">Kode yang sudah ada akan diperbarui.</p>
          </ActionForm>}
        </Panel>
        <Panel title="Target tonase bulanan">
          {targets?.length ? (
            <ul className="grid gap-1 text-sm">{targets.map(t => <li key={t.id} className="flex justify-between border-b border-line py-1">
              <span>{t.month.slice(0, 7)}</span><span className="tabular">{ton(t.tonnage_target)} ton</span></li>)}</ul>
          ) : <p className="text-sm text-muted">Belum ada target.</p>}
          {manage && <ActionForm action={setTarget} label="Simpan target">
            <div className="grid grid-cols-2 gap-2">
              <input type="month" name="month" required defaultValue={today().slice(0, 7)} className={input} aria-label="Bulan" />
              <input type="number" name="tonnage" required min={1} className={input} placeholder="Target ton" />
            </div>
            <input name="note" className={input} placeholder="Catatan" />
          </ActionForm>}
        </Panel>
      </div>
    </>
  );
}
