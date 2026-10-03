import { memo, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';

/**
 * VirtualizedDropdownList — reusable results list for search/typeahead panels.
 *
 * Renders a flat item array with an optional keyboard-highlight scroll-follow. Lists at or below
 * `virtualizeThreshold` render as a plain <ul> (avoids Virtuoso's absolutely-positioned rows for
 * the common small case); larger lists are windowed with react-virtuoso so thousands of results
 * mount only a viewport's worth of rows.
 *
 * Interaction (clicks, highlight styling, Enter/Escape handling) stays with the CALLER — this
 * component owns only rendering + scrolling. Sections/headers can be passed as items via
 * renderItem (mark them non-interactive there).
 */
interface VirtualizedDropdownListProps<T> {
  items: ReadonlyArray<T>;
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  /** Caller-driven keyboard highlight; the list scrolls to keep it visible. */
  highlightedIndex?: number;
  /** Visual row height used for sizing the virtualized scroller. */
  defaultItemHeight?: number;
  /** Max height of the list before it scrolls internally. */
  maxHeightPx?: number;
  /** Lists ABOVE this many items are virtualized (matches EntitySelector's convention). */
  virtualizeThreshold?: number;
  overscan?: number;
  className?: string;
  testId?: string;
}

const VirtualizedDropdownListInner = <T,>({
  items,
  getKey,
  renderItem,
  highlightedIndex,
  defaultItemHeight = 40,
  maxHeightPx = 320,
  virtualizeThreshold = 30,
  overscan = 200,
  className,
  testId,
}: VirtualizedDropdownListProps<T>): React.ReactElement => {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const plainListRef = useRef<HTMLUListElement>(null);

  const isVirtualized = items.length > virtualizeThreshold;
  const virtualizedHeight = Math.min(items.length * defaultItemHeight, maxHeightPx);

  const itemKeys = useMemo(() => items.map((item, i) => getKey(item, i)), [items, getKey]);

  useEffect(() => {
    if (highlightedIndex === undefined || highlightedIndex < 0) return;
    if (isVirtualized) {
      virtuosoRef.current?.scrollToIndex({ index: highlightedIndex, align: 'end' });
      return;
    }
    const el = plainListRef.current?.children[highlightedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, isVirtualized]);

  if (isVirtualized) {
    return (
      <Virtuoso
        ref={virtuosoRef}
        data={items}
        data-testid={testId}
        className={className}
        style={{ height: virtualizedHeight, width: '100%', overflowX: 'hidden' }}
        defaultItemHeight={defaultItemHeight}
        overscan={overscan}
        computeItemKey={index => itemKeys[index] ?? index}
        itemContent={index => {
          const item = items[index];
          return item === undefined ? null : <>{renderItem(item, index)}</>;
        }}
      />
    );
  }

  return (
    <ul
      ref={plainListRef}
      data-testid={testId}
      className={className}
      style={{ maxHeight: maxHeightPx, overflowY: 'auto' }}
    >
      {items.map((item, index) => (
        <li key={itemKeys[index]}>{renderItem(item, index)}</li>
      ))}
    </ul>
  );
};

export const VirtualizedDropdownList = memo(
  VirtualizedDropdownListInner,
) as typeof VirtualizedDropdownListInner;
