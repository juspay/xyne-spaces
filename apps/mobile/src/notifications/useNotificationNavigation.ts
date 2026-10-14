import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useLocalSearchParams, usePathname, useRootNavigationState } from 'expo-router';

import { useStartupPhase } from '@/src/providers/StartupPhaseProvider';
import { ensureQueryCacheStorageReady } from '@/src/machines/queryCacheMachine';
import { emitStartupCompleted } from '@/src/observability/logging/startup/emitStartupCompleted';
import { markColdStartLaunchIntentSettled } from '@/src/observability/logging/startup/coldStart';

import { extractMessageContext, normalizeData } from './message/messageContext';
import {
  getChatRouteIdentity,
  isShellReadyForNotificationNav,
  matchesChatRouteTarget,
  type ChatRouteParams,
} from './navigation/navReadiness';
import {
  clearBookmarkNavIntent,
  clearNavIntent,
  getBookmarkNavIntentSnapshot,
  getNavIntentSnapshot,
  performBookmarkNavigation,
  performChatNavigation,
  persistBookmarkNavIntent,
  persistNavIntent,
  queueTapNavigation,
  queueNonChatNotificationNavigationFromData,
  recoverInitialTap,
  retryRecoverInitialTap,
  resetNavDedup,
  shouldSuppressNav,
  subscribeNavIntent,
  type BookmarkRouteTarget,
} from './tapNavigation';
import type { ChatRouteTarget } from './types';

const getPendingNotificationIntentSnapshot = (): BookmarkRouteTarget | ChatRouteTarget | null =>
  getBookmarkNavIntentSnapshot() ?? getNavIntentSnapshot();

export function useNotificationNavigation(): void {
  ensureQueryCacheStorageReady();
  const rootNavigationState = useRootNavigationState();
  const pathname = usePathname();
  const routeParams = useLocalSearchParams() as ChatRouteParams;
  const { isProtectedStartupReady } = useStartupPhase();
  const recoverAttemptedRef = useRef(false);

  const pendingIntent = useSyncExternalStore(
    subscribeNavIntent,
    getPendingNotificationIntentSnapshot,
    getPendingNotificationIntentSnapshot,
  );
  const routeIdentity = getChatRouteIdentity(pathname, routeParams);

  const consumeIntent = useCallback(() => {
    const intent = getNavIntentSnapshot();
    const bookmarkIntent = getBookmarkNavIntentSnapshot();
    const rootKey = rootNavigationState?.key;
    const shellReady = isShellReadyForNotificationNav(pathname, isProtectedStartupReady);

    if (!intent && !bookmarkIntent) return;

    if (AppState.currentState !== 'active') {
      return;
    }

    if (!rootKey || !shellReady) {
      return;
    }

    if (bookmarkIntent) {
      clearBookmarkNavIntent();
      try {
        performBookmarkNavigation(bookmarkIntent);
      } catch {
        persistBookmarkNavIntent(bookmarkIntent);
      }
      return;
    }

    if (!intent) return;

    if (matchesChatRouteTarget(pathname, intent, routeParams)) {
      clearNavIntent();
      return;
    }

    if (shouldSuppressNav(intent, routeIdentity)) {
      clearNavIntent();
      return;
    }

    clearNavIntent();

    try {
      performChatNavigation(intent);
    } catch {
      resetNavDedup();
      persistNavIntent(intent);
    }
  }, [isProtectedStartupReady, pathname, routeParams, routeIdentity, rootNavigationState?.key]);

  const previousRouteIdentityRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      previousRouteIdentityRef.current !== null &&
      previousRouteIdentityRef.current !== routeIdentity
    ) {
      resetNavDedup();
    }
    previousRouteIdentityRef.current = routeIdentity;
  }, [routeIdentity]);

  useEffect(() => {
    consumeIntent();
  }, [pendingIntent, consumeIntent, pathname, isProtectedStartupReady, rootNavigationState?.key]);

  useEffect(() => {
    if (!rootNavigationState?.key || recoverAttemptedRef.current) return;
    recoverAttemptedRef.current = true;

    void (async (): Promise<void> => {
      try {
        const didRecover = await recoverInitialTap();

        const completed = markColdStartLaunchIntentSettled();
        emitStartupCompleted(completed);

        // Some iOS opens deliver initial-notification payloads a bit after the
        // first recovery pass; run a bounded second-chance retry before giving up.
        if (!didRecover && !getPendingNotificationIntentSnapshot()) {
          const didRetryRecover = await retryRecoverInitialTap({ ignoreCooldown: true });
          if (!didRetryRecover && !getPendingNotificationIntentSnapshot()) {
            await new Promise<void>(resolve => setTimeout(resolve, 350));
            await retryRecoverInitialTap({ ignoreCooldown: true });
          }
        }

        consumeIntent();
      } catch {
        emitStartupCompleted(markColdStartLaunchIntentSettled());
      }
    })();
  }, [rootNavigationState?.key, consumeIntent]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response): void => {
      const data = normalizeData(
        response.notification.request.content.data as Record<string, unknown> | undefined,
      );

      const message = extractMessageContext(data);
      if (!message) {
        if (queueNonChatNotificationNavigationFromData(data)) return;
        return;
      }

      void queueTapNavigation(message);
    });

    return (): void => sub.remove();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state): void => {
      if (state === 'active') {
        void (async (): Promise<void> => {
          if (!getPendingNotificationIntentSnapshot()) {
            await retryRecoverInitialTap();
          }
          consumeIntent();
        })();
      }
    });
    return (): void => sub.remove();
  }, [consumeIntent]);
}
