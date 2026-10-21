import { Suspense, type ReactElement } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChannelTicketsSkeleton } from '@/src/features/channel-tickets/components/channel-tickets-skeleton';
import { CHANNEL_TICKETS_HEADER_HEIGHT } from '@/src/features/channel-tickets/constants';
import { LazyChannelTicketsScreen } from '@/src/features/channel-tickets/load';

/**
 * Per-channel tickets table. The screen module is loaded through `load.ts` (memoised
 * `import()`), normally already warm from the Info screen; the skeleton only shows
 * on a cold deep link.
 */
const ChannelTicketsFallback = (): ReactElement => {
  const insets = useSafeAreaInsets();
  return (
    <View className='flex-1 bg-settings-bg'>
      <View style={{ height: insets.top + CHANNEL_TICKETS_HEADER_HEIGHT }} />
      <ChannelTicketsSkeleton />
    </View>
  );
};

export default function ChannelTicketsRoute(): ReactElement {
  return (
    <Suspense fallback={<ChannelTicketsFallback />}>
      <LazyChannelTicketsScreen />
    </Suspense>
  );
}
