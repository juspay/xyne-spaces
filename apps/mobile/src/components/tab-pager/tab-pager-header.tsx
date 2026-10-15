import { type ReactElement } from 'react';
import type { SharedValue } from 'react-native-reanimated';

import { AppHeader } from '@/src/components/app-header';
import { TabsScreenHeader, type SearchBarTriggerProps } from '@/src/components/tabs-screen-header';
import type { TabName } from '@/src/observability/logging/navigation/tabTransition';

type TabHeaderConfig = {
  title: string;
  search: SearchBarTriggerProps | null;
};

const TAB_HEADER: Record<TabName, TabHeaderConfig> = {
  channels: {
    title: 'Channels',
    search: {
      placeholder: 'Search channels',
      sourceSurface: 'channels',
      initialTab: 'channels',
    },
  },
  dms: {
    title: 'Messages',
    search: {
      placeholder: 'Search DMs and groups',
      sourceSurface: 'dms',
      initialTab: 'chats',
    },
  },
  calls: {
    title: 'Calls',
    search: {
      placeholder: 'Search calls',
      sourceSurface: 'calls',
      initialTab: 'calls',
    },
  },
  activity: {
    title: 'Activity',
    search: null,
  },
  more: {
    title: 'More',
    search: null,
  },
};

type TabPagerHeaderProps = {
  activeTab: TabName;
  scrollY: SharedValue<number>;
};

/**
 * One header for all tab pages. It sits above the pager so workspace/profile
 * stay put while lists swipe, and above the native tab chrome so those
 * buttons actually receive taps.
 */
export function TabPagerHeader({ activeTab, scrollY }: TabPagerHeaderProps): ReactElement {
  const config = TAB_HEADER[activeTab];

  return (
    <TabsScreenHeader scrollY={scrollY}>
      <TabsScreenHeader.Leading>
        <AppHeader.WorkspaceSwitcher />
        <AppHeader.Title>{config.title}</AppHeader.Title>
      </TabsScreenHeader.Leading>
      <TabsScreenHeader.Trailing>
        <AppHeader.ConnectionStatus />
        <AppHeader.UserGuide />
        <AppHeader.UserProfile />
      </TabsScreenHeader.Trailing>
      {config.search ? <TabsScreenHeader.SearchBar {...config.search} /> : null}
    </TabsScreenHeader>
  );
}
