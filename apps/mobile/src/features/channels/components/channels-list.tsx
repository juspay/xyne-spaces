import { useObserve, useValue } from '@legendapp/state/react';
import { useRef, type ReactElement } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { useFabClearance } from '@/src/features/quick-actions';
import { useReportTabReady } from '@/src/observability/logging/hooks/navigation/useReportTabReady';

import { useChannelRows } from '../hooks/use-channel-rows';
import { channelFilter$ } from '../state/filter-store';
import { channelGroups$ } from '../state/rows-store';
import { ChannelGroupView } from './channel-group';
import { ChannelsFilterBar } from './channels-filter-bar';

function EmptyState({ isFiltering }: { isFiltering: boolean }): ReactElement {
  return (
    <View className='items-center justify-center px-8 py-16'>
      <Text className='text-base font-medium text-spaces-foreground mb-1'>
        {isFiltering ? 'Nothing here' : 'No channels yet'}
      </Text>
      <Text className='text-sm text-spaces-muted text-center'>
        {isFiltering ? 'No channels match this filter.' : 'Channels you join will show up here.'}
      </Text>
    </View>
  );
}

/**
 * The list is a plain scroller of groups rather than a virtualised flat list.
 *
 * A group folds by animating its own height, which needs the group to be a
 * component of its own with its rows inside it; a recycling list only knows
 * flat items. The set is the channels a person has joined, not the unbounded
 * conversation history DMs pages through, and collapsed groups mount no rows.
 */
export function ChannelsList(): ReactElement {
  const { isEmpty, isFiltering } = useChannelRows();
  const groups = useValue(channelGroups$);
  const bottomInset = useFabClearance();

  const scrollRef = useRef<ScrollView>(null);

  // A new filter is a new list, so it starts at the top.
  useObserve(channelFilter$, () => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  });

  // Channels has no spinner: empty and populated both count as ready.
  useReportTabReady('channels', true);

  const hasRows = groups.some(group => group.channelIds.length > 0 || group.kind === 'section');

  return (
    <ScrollView
      ref={scrollRef}
      keyboardDismissMode='on-drag'
      keyboardShouldPersistTaps='handled'
      showsVerticalScrollIndicator={false}
      className='flex-1 bg-spaces-background'
      contentContainerStyle={{ paddingBottom: bottomInset }}
    >
      <ChannelsFilterBar />
      {groups.map(group => (
        <ChannelGroupView key={group.id} group={group} />
      ))}
      {isEmpty || !hasRows ? <EmptyState isFiltering={isFiltering} /> : null}
    </ScrollView>
  );
}
