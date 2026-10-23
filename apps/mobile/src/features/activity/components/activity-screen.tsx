import { type ReactElement } from 'react';
import { View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import { PullDownSearchShell, ScreenHeader } from '@/src/features/screen-header';

import { ActivityFilterButton } from './activity-filter-button';
import { ActivityFilterTray } from './activity-filter-tray';
import { ActivityList } from './activity-list';

export function ActivityScreen(): ReactElement {
  const scrollOffset = useSharedValue(0);

  return (
    <PullDownSearchShell tab='messages' scrollOffset={scrollOffset}>
      <View className='flex-1 bg-spaces-background'>
        <ScreenHeader title='Activity' searchTab='messages' />
        <ActivityList scrollOffset={scrollOffset} />
        <ActivityFilterButton />
        <ActivityFilterTray />
      </View>
    </PullDownSearchShell>
  );
}
