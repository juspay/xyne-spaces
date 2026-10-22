import { type ReactElement } from 'react';
import { View } from 'react-native';

import { ActivityFilterButton } from './activity-filter-button';
import { ActivityFilterTray } from './activity-filter-tray';
import { ActivityList } from './activity-list';
import { ScreenHeader } from '@/src/features/screen-header';

export function ActivityScreen(): ReactElement {
  return (
    <View className='flex-1 bg-spaces-background'>
      <ScreenHeader title='Activity' searchTab='messages' />
      <ActivityList />
      <ActivityFilterButton />
      <ActivityFilterTray />
    </View>
  );
}
