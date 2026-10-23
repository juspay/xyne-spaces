import { type ReactElement } from 'react';
import { View } from 'react-native';

import { DmsList } from './dms-list';
import { QuickActionsFab } from '@/src/features/quick-actions';
import { ScreenHeader } from '@/src/features/screen-header';

export function DmsScreen(): ReactElement {
  return (
    <View className='flex-1 bg-spaces-background'>
      <ScreenHeader title='DMs' searchTab='chats' />
      <DmsList />
      <QuickActionsFab tab='dms' />
    </View>
  );
}
