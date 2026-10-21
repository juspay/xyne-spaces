import { ChannelListFloatingActions, ChannelsList } from '@/src/components/chat/channel-list';
import { useTabHeaderScrollY } from '@/src/components/tab-pager/tab-pager-context';
import { useReportTabReady } from '@/src/observability/logging/hooks/navigation/useReportTabReady';
import { type ReactElement } from 'react';
import { Keyboard, View } from 'react-native';

export default function ChannelsScreen(): ReactElement {
  const headerTitleScrollY = useTabHeaderScrollY();
  // Channels has no spinner: empty state and the list both count as ready.
  useReportTabReady('channels', true);

  return (
    <View className='flex-1 bg-tabs-screen' onTouchStart={Keyboard.dismiss}>
      <ChannelsList headerTitleScrollY={headerTitleScrollY} />
      <ChannelListFloatingActions />
    </View>
  );
}
