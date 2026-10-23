import { type ReactElement } from 'react';
import { View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import { QuickActionsFab } from '@/src/features/quick-actions';
import { PullDownSearchShell, ScreenHeader } from '@/src/features/screen-header';

import { ChannelActionsProvider } from '../hooks/use-channel-actions';
import { ChannelsList } from './channels-list';
import { SectionTray } from './section-tray';

export function ChannelsScreen(): ReactElement {
  const scrollOffset = useSharedValue(0);

  return (
    <ChannelActionsProvider>
      <PullDownSearchShell tab='channels' scrollOffset={scrollOffset}>
        <View className='flex-1 bg-spaces-background'>
          <ScreenHeader title='Channels' searchTab='channels' />
          <ChannelsList scrollOffset={scrollOffset} />
          <QuickActionsFab tab='channels' />
          <SectionTray />
        </View>
      </PullDownSearchShell>
    </ChannelActionsProvider>
  );
}
