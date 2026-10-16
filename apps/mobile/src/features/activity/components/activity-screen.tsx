import { type ReactElement } from 'react';
import { View } from 'react-native';

import { ActivityFilterButton } from './activity-filter-button';
import { ActivityFilterTray } from './activity-filter-tray';
import { ActivityHeader } from './activity-header';
import { ActivityList } from './activity-list';

export function ActivityScreen(): ReactElement {
  return (
    <View className='flex-1 bg-spaces-background'>
      <ActivityHeader />
      <ActivityList />
      <ActivityFilterButton />
      <ActivityFilterTray />
    </View>
  );
}
