import Link from 'next/link';
import { PageHeader, Panel, Pill, Stat } from '@/components/ui';
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { clauseHealth } from '@/lib/compliance';

export const metadata = { title: 'Matriks SMKP' };

type Clause = {
  id: string; parent_id: string | null; code: string; level: string; title: string; applicability: string; sort_order: number;
  controls: number; evidence_accepted: number; evidence_pending: number; capa_open: number; capa_overdue: number;
};

export default async function SmkpPage() {
  await getSession();
  const supabase = await createClient();
  const [{ data: clauses }, { data: maps }] = await Promise.all([
    supabase.from('compliance_clause_status').select('*').eq('framework_code', 'SMKP').order('sort_order').returns<Clause[]>(),
    supabase.from('clause_mappings').select('clause_id, mapped:mapped_clause_id(framework_code, code)')
      .returns<{ clause_id: string; mapped: { framework_code: string; code: string } }[]>(),
  ]);
  const all = clauses ?? [];
  const elements = all.filter(c => c.level === 'element');
  const subs = all.filter(c => c.level !== 'element');
  const applicable = subs.filter(c => c.applicability === 'applicable');
  const fulfilled = applicable.filter(c => clauseHealth(c)[0] === 'ok').length;
  const overdue = subs.reduce((n, c) => n + c.capa_overdue, 0);
  const pending = subs.reduce((n, c) => n + c.evidence_pending, 0);

  return (
    <>
      <PageHeader eyebrow="SMKP Minerba · Kepmen ESDM 1827 K/30/MEM/2018" title="Matriks 7 elemen">
        <Link href="/legal" className="text-sm text-accent hover:underline">Legal register →</Link>
      </PageHeader>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Subelemen terpenuhi" value={`${fulfilled}/${applicable.length}`} note="Ada bukti diterima, tanpa action plan lewat target" />
        <Stat label="Pemenuhan" value={applicable.length ? `${Math.round((fulfilled / applicable.length) * 100)}%` : '–'} />
        <Stat label="Bukti menunggu penilaian" value={pending} />
        <Stat label="Action plan lewat target" value={overdue} href="/capa?terlambat=1" />
      </div>
      <p className="text-xs text-muted">
        Rincian subelemen disusun dari Lampiran IV dan masih perlu divalidasi terhadap Kepdirjen Minerba 185.K/30/DJB/2019
        sebelum dipakai untuk penilaian resmi. Bobot penilaian belum diisi.
      </p>
      {elements.map(el => {
        const children = subs.filter(s => s.parent_id === el.id);
        const iso = (maps ?? []).filter(m => m.clause_id === el.id).map(m => `${m.mapped.framework_code.replace('ISO', 'ISO ')} §${m.mapped.code}`);
        return (
          <Panel key={el.id} title={`Elemen ${el.code} · ${el.title}`}
            action={<span className="hidden font-mono text-xs text-muted md:inline">{[...new Set(iso)].join(' · ')}</span>}>
            <ul className="grid gap-1">
              {children.map(c => {
                const [tone, label] = clauseHealth(c);
                return (
                  <li key={c.id}>
                    <Link href={`/smkp/${c.id}`} className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-3 rounded px-2 py-2 hover:bg-ground">
                      <span className="font-mono text-xs text-muted">{c.code}</span>
                      <span className="text-sm">{c.title}
                        <span className="ml-2 font-mono text-xs text-muted">
                          {c.controls} kontrol · {c.evidence_accepted} bukti{c.capa_open ? ` · ${c.capa_open} action plan` : ''}
                        </span>
                      </span>
                      <Pill tone={tone}>{label}</Pill>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Panel>
        );
      })}
    </>
  );
}
