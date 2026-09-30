/** How the merchant page's ticket list is sorted: a first key, then a second one. */

export type OrderKey = 'oldest' | 'newest' | 'priority' | 'stale' | 'recent';

export interface Order {
  by: OrderKey;
  then: OrderKey;
}

export const ORDER_KEYS: OrderKey[] = ['oldest', 'newest', 'priority', 'stale', 'recent'];
export const DEFAULT_ORDER: Order = { by: 'oldest', then: 'priority' };

/** Wording as the subtitle reads: "<first>, then <then>". */
export const ORDER_TEXT: Record<OrderKey, { first: string; then: string }> = {
  oldest: { first: 'Oldest first', then: 'oldest' },
  newest: { first: 'Newest first', then: 'newest' },
  priority: { first: 'Highest priority first', then: 'highest priority' },
  stale: { first: 'Least recently updated', then: 'least recently updated' },
  recent: { first: 'Most recently updated', then: 'most recently updated' },
};
