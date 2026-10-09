import { type ReactElement } from 'react';
import { View } from 'react-native';

import { DmsHeader } from './dms-header';
import { DmsList } from './dms-list';
import { QuickActionsFab } from '@/src/features/quick-actions';

export function DmsScreen(): ReactElement {
  return (
    <View className='flex-1 bg-spaces-background'>
      <DmsHeader />
      <DmsList />
      <QuickActionsFab tab='dms' />
    </View>
  );
}
