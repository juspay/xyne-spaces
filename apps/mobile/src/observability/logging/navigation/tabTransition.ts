import { beginCriticalWindow, endCriticalWindow } from '@/src/utils/interactionCriticalWindow';

export const TAB_SCREEN_NAMES = ['channels', 'dms', 'calls', 'activity', 'more'] as const;

export type TabName = (typeof TAB_SCREEN_NAMES)[number];

export type CompletedTabTransition = Readonly<{
  fromTab: TabName;
  toTab: TabName;
  durationMs: number;
}>;

type PendingTabTransition = {
  fromTab: TabName;
  toTab: TabName;
  startedAt: number;
};

const TAB_CRITICAL_WINDOW_TIMEOUT_MS = 1_500;
const tabCriticalWindowTags = new Map<TabName, string>();

let pendingTabTransition: PendingTabTransition | null = null;

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function isTabName(value: string | null | undefined): value is TabName {
  return (
    value !== null && value !== undefined && (TAB_SCREEN_NAMES as readonly string[]).includes(value)
  );
}

const beginTabCriticalWindow = (routeName: TabName): void => {
  for (const previousTag of tabCriticalWindowTags.values()) {
    endCriticalWindow(previousTag);
  }
  tabCriticalWindowTags.clear();

  const tag = `tab:${routeName}:${Date.now()}`;
  tabCriticalWindowTags.set(routeName, tag);
  beginCriticalWindow(tag, TAB_CRITICAL_WINDOW_TIMEOUT_MS);
};

const endTabCriticalWindow = (routeName: TabName): void => {
  const tag = tabCriticalWindowTags.get(routeName);
  if (!tag) return;

  tabCriticalWindowTags.delete(routeName);
  endCriticalWindow(tag);
};

const abandonPendingTabTransition = (): void => {
  if (pendingTabTransition === null) {
    return;
  }

  endTabCriticalWindow(pendingTabTransition.toTab);
  pendingTabTransition = null;
};

export type BeginTabTransitionOptions = Readonly<{
  nowMs?: number;
}>;

/**
 * Starts one in-flight tab switch. T0 is the press of a *different* tab.
 * A second press to the same destination is ignored. A press to a new
 * destination replaces the unfinished one.
 *
 * The pending switch stays until the destination reports ready. A slow first
 * paint (Calls spinner, empty Zero cache) must still be able to log.
 */
export function beginTabTransition(
  fromTab: string | null,
  toTab: string,
  options: BeginTabTransitionOptions = {},
): boolean {
  if (!isTabName(fromTab) || !isTabName(toTab) || fromTab === toTab) {
    return false;
  }

  if (pendingTabTransition?.toTab === toTab) {
    return false;
  }

  abandonPendingTabTransition();
  beginTabCriticalWindow(toTab);

  pendingTabTransition = {
    fromTab,
    toTab,
    startedAt: options.nowMs ?? nowMs(),
  };

  return true;
}

/**
 * Completes the in-flight switch only when the destination tab reports ready.
 * Returns null if this tab is not the pending destination.
 */
export function completeTabTransition(
  tabName: string,
  completedAtMs = nowMs(),
): CompletedTabTransition | null {
  if (
    !isTabName(tabName) ||
    pendingTabTransition === null ||
    pendingTabTransition.toTab !== tabName
  ) {
    return null;
  }

  const completed: CompletedTabTransition = {
    fromTab: pendingTabTransition.fromTab,
    toTab: pendingTabTransition.toTab,
    durationMs: Math.max(0, Math.round(completedAtMs - pendingTabTransition.startedAt)),
  };

  endTabCriticalWindow(pendingTabTransition.toTab);
  pendingTabTransition = null;
  return completed;
}

export function cancelPendingTabTransition(): void {
  abandonPendingTabTransition();
}

export function getPendingTabTransition(): CompletedTabTransition | null {
  if (pendingTabTransition === null) {
    return null;
  }

  return {
    fromTab: pendingTabTransition.fromTab,
    toTab: pendingTabTransition.toTab,
    durationMs: 0,
  };
}
