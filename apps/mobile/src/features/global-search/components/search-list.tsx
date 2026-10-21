import { memo, useCallback, useMemo, type ReactElement } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { KeyboardAwareLegendList } from '@legendapp/list/keyboard';
import type { SharedValue } from 'react-native-reanimated';

import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { haptics } from '@/src/utils/haptics';
import type { SearchResults } from '../hooks/use-search-results';
import { SearchResultsShimmer } from './search-results-shimmer';

export type SectionAction = {
  label: string;
  onPress: () => void;
};

export type SearchSection<T> = {
  id: string;
  title: string;
  items: readonly T[];
  /** Optional trailing affordance in the header, e.g. "Show 12 more". */
  action?: SectionAction;
};

type SearchRow<T> =
  | { kind: 'header'; key: string; title: string; action?: SectionAction }
  | { kind: 'item'; key: string; item: T };

/** Layout the screen owns and every list needs. */
export type ListChrome = {
  /** Space reserved under the floating toolbar. Always its EXPANDED height. */
  listContentTop: number;
  bottomContentInset: number;
  /** Written on the UI thread; drives the toolbar collapse. */
  scrollOffset: SharedValue<number>;
};

export type EmptyCopy = {
  /** Shown before the user has asked for anything. */
  idleTitle: string;
  idleSubtitle: string;
  /** Shown when a query returned nothing. */
  emptyTitle: string;
  emptySubtitle: string;
};

export type ListStatus = Pick<SearchResults, 'status' | 'error'> & { retry?: () => void };

/** Lists searched on-device have nothing to load and nothing to fail. */
export const LOCAL_STATUS: ListStatus = { status: 'success', error: null };

export type SearchListProps<T> = ListChrome & {
  sections: readonly SearchSection<T>[];
  status: ListStatus;
  /** True when the user has typed or picked a filter — decides idle vs empty copy. */
  hasQuery: boolean;
  renderItem: (item: T) => ReactElement | null;
  itemKey: (item: T) => string;
  estimatedItemSize: number;
  empty: EmptyCopy;
  skeletonVariant?: 'default' | 'call';
  skeletonTitle?: string;
};

/** Sections with no items are dropped, so callers can declare theirs unconditionally. */
function toRows<T>(
  sections: readonly SearchSection<T>[],
  itemKey: (item: T) => string,
): SearchRow<T>[] {
  const rows: SearchRow<T>[] = [];

  for (const { id, title, items, action } of sections) {
    if (items.length === 0) continue;

    rows.push({ kind: 'header', key: `header-${id}`, title, ...(action ? { action } : {}) });
    for (const item of items) {
      rows.push({ kind: 'item', key: itemKey(item), item });
    }
  }

  return rows;
}

/**
 * The one list every search tab renders through.
 *
 * It stays mounted across query changes: loading, empty and error all render inside
 * it, and the previous rows stay while the next query loads. Swapping the list out
 * per keystroke tore down native keyboard handling while the user was typing.
 */
export function SearchList<T>({
  sections,
  status,
  hasQuery,
  renderItem,
  itemKey,
  estimatedItemSize,
  empty,
  skeletonVariant = 'default',
  skeletonTitle,
  listContentTop,
  bottomContentInset,
  scrollOffset,
}: SearchListProps<T>): ReactElement {
  const rows = useMemo(() => toRows(sections, itemKey), [itemKey, sections]);

  const renderRow = useCallback(
    (row: SearchRow<T>): ReactElement | null =>
      row.kind === 'header' ? (
        <SectionHeader title={row.title} {...(row.action ? { action: row.action } : {})} />
      ) : (
        renderItem(row.item)
      ),
    [renderItem],
  );

  // Only rendered when there are no rows, so a skeleton never replaces results.
  const emptyComponent = useMemo(() => {
    if (status.status === 'loading') {
      return (
        <SearchResultsShimmer
          variant={skeletonVariant}
          {...(skeletonTitle ? { sectionTitle: skeletonTitle } : {})}
        />
      );
    }

    if (status.status === 'error' && status.error) {
      return (
        <StateMessage
          title="Couldn't complete this search"
          subtitle={status.error.message}
          {...(status.error.retryable && status.retry
            ? { action: { label: 'Try again', onPress: status.retry } }
            : {})}
        />
      );
    }

    return (
      <StateMessage
        title={hasQuery ? empty.emptyTitle : empty.idleTitle}
        subtitle={hasQuery ? empty.emptySubtitle : empty.idleSubtitle}
      />
    );
  }, [empty, hasQuery, skeletonTitle, skeletonVariant, status]);

  return (
    <VirtualList
      rows={rows}
      renderRow={renderRow}
      estimatedItemSize={estimatedItemSize}
      listContentTop={listContentTop}
      bottomContentInset={bottomContentInset}
      scrollOffset={scrollOffset}
      emptyComponent={emptyComponent}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
});

type VirtualListProps<T> = ListChrome & {
  rows: readonly SearchRow<T>[];
  renderRow: (row: SearchRow<T>) => ReactElement | null;
  estimatedItemSize: number;
  emptyComponent: ReactElement;
};

function VirtualListImpl<T>({
  rows,
  renderRow,
  estimatedItemSize,
  listContentTop,
  bottomContentInset,
  scrollOffset,
  emptyComponent,
}: VirtualListProps<T>): ReactElement {
  // Every prop below keeps its identity between renders; a recycling list treats a
  // new style object or `renderItem` as a reason to re-render every mounted cell.
  const contentContainerStyle = useMemo(
    () => ({ paddingTop: listContentTop, paddingBottom: bottomContentInset }),
    [bottomContentInset, listContentTop],
  );
  const sharedValues = useMemo(() => ({ scrollOffset }), [scrollOffset]);
  const renderItem = useCallback(
    ({ item }: { item: SearchRow<T> }) => renderRow(item),
    [renderRow],
  );

  return (
    <KeyboardAwareLegendList
      data={rows as SearchRow<T>[]}
      keyExtractor={rowKey}
      renderItem={renderItem}
      estimatedItemSize={estimatedItemSize}
      recycleItems
      ListEmptyComponent={emptyComponent}
      // RN 0.81+ stops delivering touches inside a ScrollView's contentInset region
      // (facebook/react-native#54123), which the inset under the floating toolbar
      // triggers: the list scrolls but rows cannot be tapped. iOS only.
      applyWorkaroundForContentInsetHitTestBug={Platform.OS === 'ios'}
      keyboardDismissMode='on-drag'
      keyboardLiftBehavior='whenAtEnd'
      keyboardShouldPersistTaps='handled'
      showsVerticalScrollIndicator={false}
      sharedValues={sharedValues}
      contentContainerStyle={contentContainerStyle}
      style={styles.list}
    />
  );
}

const VirtualList = memo(VirtualListImpl) as typeof VirtualListImpl;

function rowKey<T>(row: SearchRow<T>): string {
  return row.key;
}

function SectionHeader({ title, action }: { title: string; action?: SectionAction }): ReactElement {
  const { accentText } = useBubbleAccent();

  return (
    <View className='flex-row items-center justify-between px-3 pb-2 pt-4'>
      <Text className='text-[13px] font-semibold uppercase tracking-wide text-secondary-foreground'>
        {title}
      </Text>
      {action ? (
        <Pressable
          hitSlop={8}
          onPress={action.onPress}
          onPressIn={(): void => {
            void haptics.buttonTap();
          }}
        >
          <Text className='text-[13px] font-medium' style={{ color: accentText }}>
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Insets are already applied by the list's content container. */
function StateMessage({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: { label: string; onPress: () => void };
}): ReactElement {
  return (
    <View className='flex-1 items-center justify-center px-8 py-16'>
      <Text className='text-center text-base font-semibold text-foreground'>{title}</Text>
      <Text className='mt-2 text-center text-sm text-secondary-foreground'>{subtitle}</Text>
      {action ? (
        <Pressable
          accessibilityRole='button'
          hitSlop={8}
          className='mt-4 rounded-full bg-foreground/10 px-4 py-2 active:opacity-70'
          onPress={() => {
            void haptics.buttonTap();
            action.onPress();
          }}
        >
          <Text className='text-sm font-medium text-foreground'>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
