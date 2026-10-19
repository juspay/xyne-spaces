import { useEffect } from 'react';

import type { LandingTarget, OpenState } from '../machine/openState';

export type ExpansionEdge = 'older' | 'newer';

type ExpandInput = {
  status: OpenState['status'];
  target: LandingTarget;
  containsTarget: boolean;
  isInitialLoadComplete: boolean;
  hasReachedStart: boolean;
  oldestCreatedAt: number | null;
  newestCreatedAt: number | null;
};

/** Which page to request while hunting an around-cursor target. */
export const nextExpansion = ({
  status,
  target,
  containsTarget,
  isInitialLoadComplete,
  hasReachedStart,
  oldestCreatedAt,
  newestCreatedAt,
}: ExpandInput): ExpansionEdge | null => {
  if ((status !== 'loading' && status !== 'placing') || target.kind !== 'anchor') {
    return null;
  }
  if (!isInitialLoadComplete || containsTarget) {
    return null;
  }
  // Dummy `createdAt: 0` means the cursor is still resolving. Paginating
  // older from 0 would walk the whole history in a loop.
  if (target.createdAt <= 0) {
    return null;
  }
  if (oldestCreatedAt === null || newestCreatedAt === null) {
    return hasReachedStart ? null : 'older';
  }
  if (target.createdAt < oldestCreatedAt) {
    return hasReachedStart ? null : 'older';
  }
  if (target.createdAt > newestCreatedAt) {
    return 'newer';
  }
  return hasReachedStart ? 'newer' : 'older';
};

export const createdAtBounds = (
  rows: readonly { createdAt?: number }[],
): { oldest: number; newest: number } | null => {
  let oldest = Number.POSITIVE_INFINITY;
  let newest = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const at = row.createdAt;
    if (typeof at !== 'number') {
      continue;
    }
    if (at < oldest) oldest = at;
    if (at > newest) newest = at;
  }
  return Number.isFinite(oldest) ? { oldest, newest } : null;
};

/**
 * Short lists often never fire `onStartReached` / `onEndReached`. While hunting
 * an around-cursor, request the page that still contains the target.
 */
export const useExpandTowardTarget = ({
  status,
  target,
  containsTarget,
  isInitialLoadComplete,
  hasReachedStart,
  conversations,
  loadOlder,
  loadNewer,
}: {
  status: OpenState['status'];
  target: LandingTarget;
  containsTarget: boolean;
  isInitialLoadComplete: boolean;
  hasReachedStart: boolean;
  conversations: readonly { createdAt?: number }[];
  loadOlder: () => void;
  loadNewer: () => void;
}): void => {
  const bounds = createdAtBounds(conversations);
  const edge = nextExpansion({
    status,
    target,
    containsTarget,
    isInitialLoadComplete,
    hasReachedStart,
    oldestCreatedAt: bounds?.oldest ?? null,
    newestCreatedAt: bounds?.newest ?? null,
  });

  useEffect(() => {
    if (edge === 'older') {
      loadOlder();
      return;
    }
    if (edge === 'newer') {
      loadNewer();
    }
  }, [edge, bounds?.oldest, bounds?.newest, loadNewer, loadOlder]);
};
