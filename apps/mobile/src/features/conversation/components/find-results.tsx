import { LegendList } from '@legendapp/list/react-native';
import { useCallback, useMemo, type ReactElement } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { useCSSVariable } from 'uniwind';

import type { DisplaySearchResult } from '@/src/types/search';

import {
  FIND_COUNT_PADDING_X,
  FIND_COUNT_PADDING_Y,
  FIND_LOAD_MORE_THRESHOLD,
  FIND_NOTE_PADDING_TOP,
  FIND_NOTE_PADDING_X,
  FIND_RESULT_ESTIMATED_HEIGHT,
} from '../constants';
import { useChannelFindMatches, type ChannelFindMatches } from '../hooks/use-channel-find';
import { findCountLabel, findViewOf, type FindView } from '../model/channel-find';
import { colorOf } from '../model/token-color';
import { FindResultRow } from './find-result-row';
import { RoomNotice } from './room-notice';

const keyOf = (result: DisplaySearchResult): string => result.id;

type FindResultsProps = {
  currentUserId: string | undefined;
  /** The typing bar stays under the results (Figma); they end where it starts. */
  composerHeight: SharedValue<number>;
  /** The bottom inset the dock already stands on, so the keyboard lift is not counted twice. */
  keyboardListOffset: number;
};

/**
 * "Find in this channel" results, over the room's messages and under the
 * header and typing bar (Figma screen 8): a count row, then each match as a
 * message. The room's list stays mounted beneath, so Cancel shows it as it
 * was. Nothing draws until there is a query.
 */
export function FindResults(props: FindResultsProps): ReactElement | null {
  const matches = useChannelFindMatches();
  const view = findViewOf(matches.query, matches.results.status, matches.results.data.length);
  if (view === 'hidden') return null;
  return <FindResultsPanel {...props} {...matches} view={view} />;
}

type FindResultsPanelProps = FindResultsProps &
  ChannelFindMatches & {
    view: Exclude<FindView, 'hidden'>;
  };

function FindResultsPanel({
  currentUserId,
  composerHeight,
  keyboardListOffset,
  query,
  results,
  openResult,
  view,
}: FindResultsPanelProps): ReactElement {
  const subtle = colorOf(useCSSVariable('--color-spaces-subtle'));
  const keyboard = useReanimatedKeyboardAnimation();

  // The dock rides the keyboard by its height less the inset it already stands on.
  const bottomStyle = useAnimatedStyle(() => ({
    paddingBottom: composerHeight.get() + Math.max(0, -keyboard.height.get() - keyboardListOffset),
  }));

  const renderItem = useCallback(
    ({ item }: { item: DisplaySearchResult }) => (
      <FindResultRow result={item} currentUserId={currentUserId} onPress={openResult} />
    ),
    [currentUserId, openResult],
  );

  const isSearching = results.status === 'loading';
  const header = useMemo(
    () => (
      <Text
        accessibilityLiveRegion='polite'
        className='text-[12px] leading-4 text-spaces-subtle'
        style={styles.count}
      >
        {isSearching ? 'Searching…' : findCountLabel(results.data.length, results.hasMore)}
      </Text>
    ),
    [isSearching, results.data.length, results.hasMore],
  );
  const footer = useMemo(
    () =>
      results.isFetchingMore ? <ActivityIndicator color={subtle} style={styles.more} /> : null,
    [results.isFetchingMore, subtle],
  );

  return (
    <Animated.View className='bg-spaces-background' style={[StyleSheet.absoluteFill, bottomStyle]}>
      {view === 'results' ? (
        <LegendList
          // A new query starts at the top, not where the last one's rows were scrolled to.
          key={query}
          data={results.data as DisplaySearchResult[]}
          keyExtractor={keyOf}
          renderItem={renderItem}
          estimatedItemSize={FIND_RESULT_ESTIMATED_HEIGHT}
          ListHeaderComponent={header}
          ListFooterComponent={footer}
          onEndReached={results.loadMore}
          onEndReachedThreshold={FIND_LOAD_MORE_THRESHOLD}
          keyboardDismissMode='on-drag'
          keyboardShouldPersistTaps='handled'
          showsVerticalScrollIndicator={false}
          style={styles.list}
        />
      ) : view === 'loading' ? (
        header
      ) : (
        <View style={styles.note}>
          {view === 'empty' ? (
            <RoomNotice title='No messages match' detail={`Nothing here says “${query.trim()}”.`} />
          ) : (
            <RoomNotice
              title='Couldn’t search this channel'
              detail={results.error?.message ?? 'Something went wrong while searching.'}
              onRetry={results.error?.retryable ? results.retry : undefined}
            />
          )}
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  count: { paddingHorizontal: FIND_COUNT_PADDING_X, paddingVertical: FIND_COUNT_PADDING_Y },
  more: { paddingVertical: FIND_COUNT_PADDING_Y },
  note: { paddingTop: FIND_NOTE_PADDING_TOP, paddingHorizontal: FIND_NOTE_PADDING_X },
});
