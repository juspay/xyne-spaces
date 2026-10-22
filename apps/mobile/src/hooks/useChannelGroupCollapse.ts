import { useSyncExternalStore } from 'react';
import {
  readGroupCollapsed,
  writeGroupCollapsed,
  type ChannelBuiltInGroup,
} from '@/src/services/channelGroupCollapseStorage';

type ChannelGroupCollapseState = {
  isStarredCollapsed: boolean;
  isChannelsCollapsed: boolean;
};

/**
 * The row builder in `useChannelList` needs this state to decide which rows to
 * emit, and `ChannelsList` needs the toggle to hand to the header. Two `useState`
 * copies would drift apart, so it lives in one module-level store — the same
 * shape as `global-search-store`, read through `useSyncExternalStore`.
 *
 * MMKV reads are synchronous, so the very first snapshot is already correct and
 * a collapsed group never flashes open on cold start.
 */
let state: ChannelGroupCollapseState | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): ChannelGroupCollapseState {
  // Cached between emits: `useSyncExternalStore` re-renders forever if the
  // snapshot is a fresh object every call.
  state ??= {
    isStarredCollapsed: readGroupCollapsed('starred'),
    isChannelsCollapsed: readGroupCollapsed('channels'),
  };
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}

export function toggleChannelGroupCollapse(group: ChannelBuiltInGroup): void {
  const current = getSnapshot();
  const next =
    group === 'starred'
      ? { ...current, isStarredCollapsed: !current.isStarredCollapsed }
      : { ...current, isChannelsCollapsed: !current.isChannelsCollapsed };

  state = next;
  writeGroupCollapsed(
    group,
    group === 'starred' ? next.isStarredCollapsed : next.isChannelsCollapsed,
  );
  listeners.forEach(listener => listener());
}

type UseChannelGroupCollapseResult = ChannelGroupCollapseState & {
  toggleGroup: (group: ChannelBuiltInGroup) => void;
};

export function useChannelGroupCollapse(): UseChannelGroupCollapseResult {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { ...snapshot, toggleGroup: toggleChannelGroupCollapse };
}

export type { ChannelBuiltInGroup };
