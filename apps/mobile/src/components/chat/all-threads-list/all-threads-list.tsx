import { useHeaderHeight } from '@/src/hooks/useHeaderHeight';
import { ListEmptyState, EMPTY_STATE_BOTTOM_INSET } from '@/src/components/ui/empty-state';
import { ActivityIndicator, View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { useAuth } from '@/src/contexts/AuthContext';
import { useAllThreadsScreenModel } from '@/src/hooks/useAllThreadsScreenModel';
import { ThreadItem } from './thread-item';
import { useCallback } from 'react';
import { ConversationParticipantRow } from '@/src/utils/threadsSnapshotCache';

export const AllThreadsList = () => {
  const { user } = useAuth();
  const currentUserId = user?.user_id ?? '';
  const { topSafeHeight, headerHeight } = useHeaderHeight();

  const listPaddingTop = topSafeHeight + headerHeight;
  const listPaddingBottom = 100;

  const { rows, loadMore, hasMore: _, isLoading } = useAllThreadsScreenModel(currentUserId);

  const keyExtractor = useCallback((item: ConversationParticipantRow) => item.id, []);

  const renderItem = useCallback(
    ({ item }: { item: ConversationParticipantRow }) => (
      <ThreadItem row={item} currentUserId={currentUserId} />
    ),
    [currentUserId],
  );

  if (isLoading) {
    return (
      <View className='flex-1 items-center justify-center'>
        <ActivityIndicator size='large' />
      </View>
    );
  }

  if (!isLoading && rows.length === 0) {
    return (
      <ListEmptyState
        illustration='threads'
        title='No threads yet'
        subtitle='Threads you participate in will appear here.'
        insetTop={listPaddingTop}
        insetBottom={EMPTY_STATE_BOTTOM_INSET}
      />
    );
  }

  return (
    <View className='flex-1'>
      <LegendList
        data={rows}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        showsVerticalScrollIndicator={false}
        className='flex-1 bg-[#F8F8F8] dark:bg-[#1C1C1E]'
        contentContainerStyle={{
          paddingTop: listPaddingTop,
          paddingBottom: listPaddingBottom,
        }}
        recycleItems
      />
    </View>
  );
};
