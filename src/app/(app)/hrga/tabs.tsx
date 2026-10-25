import { Tabs } from '@/components/tabs';

const TABS = [['/hrga', 'Karyawan'], ['/hrga/kesiapan', 'Kesiapan'], ['/hrga/organisasi', 'Organisasi & MPP'], ['/hrga/kompetensi', 'Kompetensi & SIMPER'], ['/hrga/pelatihan', 'Pelatihan'], ['/hrga/roster', 'Roster'], ['/hrga/ga', 'Permintaan GA']] as const;

export function HrTabs({ active }: { active: string }) {
  return <Tabs items={TABS} active={active} />;
}
