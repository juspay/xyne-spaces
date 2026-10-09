import { type ReactElement } from 'react';
import { View } from 'react-native';

// import { DmListFloatingActions } from '@/src/components/chat/dm-list';

import { DmsHeader } from './dms-header';
import { DmsList } from './dms-list';

export function DmsScreen(): ReactElement {
  return (
    <View className='flex-1 bg-spaces-background'>
      <DmsHeader />
      <DmsList />
      {/* <DmListFloatingActions /> */}
    </View>
  );
}
