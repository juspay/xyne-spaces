import { type ReactElement } from 'react';
import { View } from 'react-native';

import { BlurTarget } from '@/src/ui/chrome-blur';

import { ActivityFilterButton } from './activity-filter-button';
import { ActivityFilterTray } from './activity-filter-tray';
import { ActivityHeader } from './activity-header';
import { ActivityList } from './activity-list';

export function ActivityScreen(): ReactElement {
  return (
    <View className='flex-1 bg-spaces-background'>
      {/* The list is what the header and the bottom bar blur; the header floats over it. */}
      <BlurTarget style={{ flex: 1 }}>
        <ActivityList />
      </BlurTarget>
      <ActivityHeader />
      <ActivityFilterButton />
      <ActivityFilterTray />
    </View>
  );
}
