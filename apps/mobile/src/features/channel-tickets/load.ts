import { lazy, useEffect, useMemo, type ComponentType } from 'react';

import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { useUserChannelStatuses } from '@/src/hooks/useChannels';
import { queries } from '@/src/zero/queries';

import { buildChannelTicketsPageArgs } from './query-args';

/**
 * Deferred entry point for the channel tickets feature.
 *
 * This is the only file outside the feature that route / Info screens import
 * eagerly (besides `gate.ts`). It must not statically import `components/`,
 * `hooks/` or `utils/`: the dynamic `import()` below is the single edge into the
 * rest of the feature, which keeps the table, cells, filter overlays and their
 * transitive imports off the startup graph and off the chat screen's graph.
 *
 * Mirrors `ProfileModalContext.tsx` (memoised module promise + `lazy`).
 */
type ScreenModule = { default: ComponentType };

let screenModulePromise: Promise<ScreenModule> | null = null;

export function loadChannelTicketsScreen(): Promise<ScreenModule> {
  screenModulePromise ??= import('./components/channel-tickets-screen')
    .then(module => ({ default: module.default }))
    .catch(error => {
      // Allow a retry after a transient failure (e.g. dev bundler hiccup).
      screenModulePromise = null;
      throw error;
    });
  return screenModulePromise;
}

export const LazyChannelTicketsScreen = lazy(loadChannelTicketsScreen);

/** Membership from channel_user_status; required by TicketsACL. */
export function useIsChannelMember(channelId: string): boolean {
  const userChannelStatuses = useUserChannelStatuses();
  return useMemo(
    () => Boolean(channelId) && userChannelStatuses.some(s => s.channelId === channelId),
    [userChannelStatuses, channelId],
  );
}

/**
 * Warm the feature from the channel Info screen so the Tickets row opens instantly:
 * 1. evaluate the screen module while the user is still reading Info;
 * 2. subscribe the unfiltered first page with a TTL, so the screen's identical
 *    query resolves from Zero's local store.
 *
 * Runs only when `enabled` (the gate passed). Costs nothing otherwise.
 */
export function useChannelTicketsWarmup(channelId: string, enabled: boolean): void {
  const isMember = useIsChannelMember(channelId);

  useEffect(() => {
    if (!enabled) return;
    void loadChannelTicketsScreen().catch(() => {
      // Non-fatal: the route's Suspense boundary retries on navigation.
    });
  }, [enabled]);

  const args = useMemo(
    () => buildChannelTicketsPageArgs(channelId, isMember, {}, 1),
    [channelId, isMember],
  );

  useCachedQuery(queries.supportTicketsPageV3(args), {
    enabled: enabled && Boolean(channelId),
    ttl: '10m',
  });
}
