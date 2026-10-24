import { Tabs } from '@/components/tabs';

const TABS = [['/logistik', 'Stok & gudang'], ['/logistik/mr', 'Material request'], ['/logistik/pengadaan', 'Pengadaan'], ['/logistik/mutasi', 'Mutasi stok'], ['/logistik/supplier', 'Supplier']] as const;

export function LogTabs({ active }: { active: string }) {
  return <Tabs items={TABS} active={active} />;
}
