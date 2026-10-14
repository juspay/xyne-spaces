import { ActivityTab } from '@/src/types/activity';

interface ActivityTabsProps {
  activeTab: ActivityTab;
  onTabChange: (tab: ActivityTab) => void;
  activityCounts: Record<ActivityTab, number>;
  showActionableTabs?: boolean;
}

export type { ActivityTabsProps };
