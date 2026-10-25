import { Tabs } from '@/components/tabs';

const TABS = [['/plant', 'Unit'], ['/plant/wo', 'Work order'], ['/plant/keandalan', 'Keandalan & biaya'], ['/plant/komponen', 'Umur komponen'], ['/plant/ban', 'Ban'], ['/plant/produktivitas', 'Produktivitas'], ['/plant/spip', 'SPIP']] as const;

export function PlantTabs({ active }: { active: string }) {
  return <Tabs items={TABS} active={active} />;
}
