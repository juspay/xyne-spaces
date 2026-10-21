import { DmList, DmListFloatingActions } from '@/src/components/chat/dm-list';
import { useTabHeaderScrollY } from '@/src/components/tab-pager/tab-pager-context';
import { type ReactElement } from 'react';
import { Keyboard, View } from 'react-native';

export default function DmScreen(): ReactElement {
  const headerTitleScrollY = useTabHeaderScrollY();

  return (
    <View className='flex-1 bg-tabs-screen' onTouchStart={Keyboard.dismiss}>
      <DmList headerTitleScrollY={headerTitleScrollY} />
      <DmListFloatingActions />
    </View>
  );
}
