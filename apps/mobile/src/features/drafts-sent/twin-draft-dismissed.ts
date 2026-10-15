import { useSyncExternalStore } from 'react';

/**
 * Twin approve/decline is HTTP, not a Zero mutator. Until Zero syncs the
 * deletion, `userDrafts` can keep the row — so the dock and Drafts & Sent Twin
 * list would still show a zombie draft. This module hides handled ids for the
 * current workspace/user session across both surfaces.
 *
 * Do not prune when a row disappears from Zero: empty snapshots are often
 * reloads, and handled rows can briefly leave then reappear. Pruning would
 * resurface zombies and Send/Reject would 404 while dashboard stays empty.
 *
 * Clear on workspace switch / sign-out (`clearDismissedTwinDrafts`) so ids do
 * not leak across sessions or grow unbounded for the JS process lifetime.
 */
let dismissedIds = new Set<string>();
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) listener();
};

export const getDismissedTwinDraftIds = (): ReadonlySet<string> => dismissedIds;

export const subscribeTwinDraftDismissed = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
};

export const dismissTwinDraftLocally = (draftId: string): void => {
  const id = draftId.trim();
  if (!id || dismissedIds.has(id)) return;
  dismissedIds = new Set(dismissedIds);
  dismissedIds.add(id);
  emit();
};

export const undismissTwinDraftLocally = (draftId: string): void => {
  const id = draftId.trim();
  if (!id || !dismissedIds.has(id)) return;
  dismissedIds = new Set(dismissedIds);
  dismissedIds.delete(id);
  emit();
};

/**
 * Session boundary: workspace switch or sign-out. Does not run on Zero
 * reload/empty snapshots — those must keep hides until sync settles.
 */
export const clearDismissedTwinDrafts = (): void => {
  if (dismissedIds.size === 0) return;
  dismissedIds = new Set();
  emit();
};

export const filterDismissedTwinDrafts = <T extends { id: string }>(
  drafts: readonly T[],
  dismissedIdsSet: ReadonlySet<string>,
): T[] => {
  if (dismissedIdsSet.size === 0) return [...drafts];
  return drafts.filter(draft => !dismissedIdsSet.has(draft.id));
};

export const useDismissedTwinDraftIds = (): ReadonlySet<string> =>
  useSyncExternalStore(
    subscribeTwinDraftDismissed,
    getDismissedTwinDraftIds,
    getDismissedTwinDraftIds,
  );

/** Test-only. */
export const __resetDismissedTwinDraftsForTests = (): void => {
  clearDismissedTwinDrafts();
};
