import { type ReactElement } from 'react';
import { View } from 'react-native';

import { ActivityFilterButton } from './activity-filter-button';
import { ActivityFilterTray } from './activity-filter-tray';
import { ActivityList } from './activity-list';
import { ScreenHeader } from '@/src/features/screen-header';
import { BlurTarget } from '@/src/ui/chrome-blur';

export function ActivityScreen(): ReactElement {
  return (
    <View className='flex-1 bg-spaces-background'>
      {/* The list is what the header and the bottom bar blur; the header floats over it. */}
      <BlurTarget style={{ flex: 1 }}>
        <ActivityList />
      </BlurTarget>
      <ScreenHeader title='Activity' searchTab='messages' />
      <ActivityFilterButton />
      <ActivityFilterTray />
    </View>
  );
}
