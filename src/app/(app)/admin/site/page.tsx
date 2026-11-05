import { ActionForm } from '@/components/action-form';
import { PageHeader, Panel, Pill, input } from '@/components/ui';
import { requirePermission } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { saveSite } from './actions';

export const metadata = { title: 'Daftar site' };

type Site = { id: string; code: string; name: string; kind: string; email_domain: string | null; active: boolean };

export default async function SitePage() {
  await requirePermission('user.manage');
  const supabase = await createClient();
  const { data } = await supabase.from('sites').select('id, code, name, kind, email_domain, active').order('code').returns<Site[]>();

  return (
    <>
      <PageHeader eyebrow="Administrasi" title="Daftar site" />
      <Panel title="Site di halaman login" sub="Hanya admin sistem yang menambah atau menonaktifkan site. Data tiap site terpisah. Karyawan hanya bisa masuk ke site asalnya; admin sistem dan akun HO bisa berpindah site.">
        <ul className="grid gap-2 text-sm">
          {(data ?? []).map(x => (
            <li key={x.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line px-3 py-2 ${x.active ? '' : 'opacity-50'}`}>
              <span className="font-mono text-xs">{x.code}</span><span className="font-medium">{x.name}</span>
              <Pill tone={x.kind === 'ho' ? 'accent' : 'muted'}>{x.kind === 'ho' ? 'Kantor pusat' : 'Site'}</Pill>
              <span className="text-xs text-muted">{x.email_domain ? `Domain email: ${x.email_domain}` : 'Tanpa domain email'}{x.active ? '' : ' · nonaktif'}</span>
            </li>))}
        </ul>
      </Panel>
      <Panel title="Tambah / ubah site" sub="Kode yang sama memperbarui site yang ada. Domain email dipakai untuk menempatkan akun Google baru ke site ini dan membatasi akun Google di halaman login.">
        <ActionForm action={saveSite} label="Simpan site" primary className="max-w-3xl sm:grid-cols-3 sm:items-end">
          <label className="grid gap-1 text-sm">Kode (2-10 huruf/angka)<input name="code" required pattern="[A-Za-z0-9]{2,10}" className={`${input} uppercase`} /></label>
          <label className="grid gap-1 text-sm">Nama<input name="name" required className={input} placeholder="mis. Site Kalimantan Timur" /></label>
          <label className="grid gap-1 text-sm">Domain email<input name="email_domain" className={input} placeholder="mis. bsb-mine.id" /></label>
          <label className="grid gap-1 text-sm">Jenis
            <select name="kind" className={input} defaultValue="site"><option value="site">Site</option><option value="ho">Kantor pusat (HO)</option></select></label>
          <label className="grid gap-1 text-sm">Status
            <select name="active" className={input} defaultValue="yes"><option value="yes">Aktif</option><option value="no">Nonaktif</option></select></label>
        </ActionForm>
      </Panel>
    </>
  );
}
