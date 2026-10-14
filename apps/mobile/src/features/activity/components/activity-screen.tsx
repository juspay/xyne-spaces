import { type ReactElement } from 'react';
import { View } from 'react-native';

import { QuickActionsFab } from '@/src/features/quick-actions';

import { ActivityHeader } from './activity-header';
import { ActivityList } from './activity-list';

export function ActivityScreen(): ReactElement {
  return (
    <View className='flex-1 bg-spaces-background'>
      <ActivityHeader />
      <ActivityList />
      <QuickActionsFab tab='activity' />
    </View>
  );
}
