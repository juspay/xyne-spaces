import { type ReactElement } from 'react';
import { View } from 'react-native';

import { DmsHeader } from './dms-header';
import { DmsList } from './dms-list';
import { DmsFab } from './fab';

export function DmsScreen(): ReactElement {
  return (
    <View className='flex-1 bg-spaces-background'>
      <DmsHeader />
      <DmsList />
      <DmsFab />
    </View>
  );
}
