import { Tabs } from '@/components/tabs';

const TABS = [['/manajemen', 'Dashboard'], ['/manajemen/audit', 'Audit internal'], ['/manajemen/tinjauan', 'Tinjauan manajemen']] as const;

export function MgmtTabs({ active }: { active: string }) {
  return <Tabs items={TABS} active={active} />;
}
