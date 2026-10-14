import { useCallback, useMemo } from 'react';
import { Text, View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';

import { useHeaderHeight } from '@/src/hooks/useHeaderHeight';

import {
  DESK_LIST_ESTIMATED_ITEM_SIZE,
  DESK_LIST_ROW_HEIGHT,
  DESKS_LIST_DRAW_DISTANCE,
} from '../../constants';
import type { DeskListItemData } from '../../types';
import { DesksListItem } from './desks-list-item';
import { useJoinDeskChannel } from '../../hooks';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type DesksListProps = {
  items: DeskListItemData[];
  isEmpty: boolean;
};

export function DesksList({ items, isEmpty }: DesksListProps) {
  const { headerHeight, topSafeHeight } = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { joiningIds, joinDesk } = useJoinDeskChannel();

  const renderItem = useCallback(
    ({ item }: { item: DeskListItemData }) => {
      return <DesksListItem data={item} isJoining={joiningIds.has(item.id)} onJoin={joinDesk} />;
    },
    [joiningIds, joinDesk],
  );

  const keyExtractor = useCallback((item: DeskListItemData) => item.id, []);
  const getFixedItemSize = useCallback(() => DESK_LIST_ROW_HEIGHT, []);

  const ListFooter = useMemo(() => {
    if (isEmpty) {
      return (
        <View className='items-center px-3 py-10'>
          <Text className='text-[15px] text-muted-foreground'>No desk channels</Text>
        </View>
      );
    }
    return <View className='h-2' />;
  }, [isEmpty]);

  const ListHeader = useMemo(
    () => (
      <View>
        <View style={{ height: topSafeHeight + headerHeight }} className='bg-primary-bg' />
        <View className='px-4 pb-3 pt-1'>
          <Text className='mt-1.5 text-[14px] leading-5 text-foreground'>
            Join a desk to view and work on its tickets. It can take a moment for membership to sync
            across devices.
          </Text>
        </View>
      </View>
    ),
    [headerHeight, topSafeHeight],
  );

  return (
    <LegendList
      data={items}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      recycleItems
      getFixedItemSize={getFixedItemSize}
      estimatedItemSize={DESK_LIST_ESTIMATED_ITEM_SIZE}
      drawDistance={DESKS_LIST_DRAW_DISTANCE}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={ListHeader}
      ListFooterComponent={ListFooter}
      contentContainerStyle={{
        paddingBottom: insets.bottom,
      }}
    />
  );
}
