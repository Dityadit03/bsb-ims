import { Tabs } from '@/components/tabs';

const TABS = [['/data', 'Unduh & Google Sheets'], ['/data/impor', 'Impor data']] as const;

export function DataTabs({ active }: { active: string }) {
  return <Tabs items={TABS} active={active} />;
}
