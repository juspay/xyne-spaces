import { useRef } from 'react';

/**
 * The same items, in the order each was first seen rather than the order given.
 *
 * A browser renders its pages this way: a <webview> moved in the document is
 * loaded afresh, and React moves keyed elements to follow their list's order — so
 * pages rendered in tab order reload whenever their tabs are rearranged. In this
 * order a tab moved, or another closed, moves no page; a new one goes last.
 */
export function useFirstSeenOrder<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const seen = useRef(new Map<string, number>());
  const order = seen.current;
  for (const item of items) {
    const key = keyOf(item);
    if (!order.has(key)) order.set(key, order.size);
  }
  return [...items].sort((a, b) => (order.get(keyOf(a)) ?? 0) - (order.get(keyOf(b)) ?? 0));
}
