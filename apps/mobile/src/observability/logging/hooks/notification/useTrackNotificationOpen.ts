import { useEffect, useRef, useSyncExternalStore } from 'react';
import { usePathname } from 'expo-router';

import { getNavIntentSnapshot, subscribeNavIntent } from '@/src/notifications/tapNavigation';

import { appLifecycle } from '../../appLogger';
import { emitNotificationOpenCompleted } from '../../notification/emitNotificationOpenCompleted';
import { emitNotificationHeaderResolved } from '../../notification/emitNotificationHeaderResolved';
import {
  createNotificationIntentStartGate,
  isChatNotificationIntent,
  runLatestNotificationIntentStart,
} from '../../notification/notificationIntentStartGate';
import { surfaceFromTarget } from '../../notification/notificationPath';
import {
  abandonNotificationOpen,
  beginNotificationOpen,
  getNotificationOpenJourneyId,
  markNotificationPhase,
  resolveNotificationOpenClock,
  subscribeNotificationOpenCompleted,
  subscribeNotificationOpenJourney,
} from '../../notification/notificationOpen';
import {
  abandonNotificationHeaderResolve,
  beginNotificationHeaderResolve,
  subscribeNotificationHeaderResolveCompleted,
} from '../../notification/notificationHeaderResolve';
import { resolveLaunchBaseline } from '../../startup/coldStart';
import { ReactNativeStartupClock } from '../../startup/reactNativeColdStart';

const startupClock = new ReactNativeStartupClock();

export function useTrackNotificationOpen(input: {
  hasSplashHidden: boolean;
  isProtectedStartupReady: boolean;
}): void {
  const pathname = usePathname();
  const inputRef = useRef(input);
  const pathnameRef = useRef(pathname);
  const intentStartGateRef = useRef(createNotificationIntentStartGate());
  inputRef.current = input;
  pathnameRef.current = pathname;

  const journeyId = useSyncExternalStore(
    subscribeNotificationOpenJourney,
    getNotificationOpenJourneyId,
    getNotificationOpenJourneyId,
  );

  useEffect(() => {
    const unsubscribeCompleted = subscribeNotificationOpenCompleted(emitNotificationOpenCompleted);
    const unsubscribeHeaderCompleted = subscribeNotificationHeaderResolveCompleted(
      emitNotificationHeaderResolved,
    );

    const startFromIntent = async (): Promise<void> => {
      const intent = getNavIntentSnapshot();
      if (!isChatNotificationIntent(intent)) {
        return;
      }

      // Capture before native awaits. consumeIntent navigates during those
      // reads, so a later pathname would skip DMs and look like a chat-only open.
      const pathAtIntent = pathnameRef.current;
      const { hasSplashHidden, isProtectedStartupReady } = inputRef.current;

      await runLatestNotificationIntentStart({
        gate: intentStartGateRef.current,
        intent,
        getCurrentIntent: getNavIntentSnapshot,
        prepare: async () => {
          const [launchTimes, now] = await Promise.all([
            startupClock.getLaunchTimes(),
            startupClock.nowUptimeMs(),
          ]);
          if (!launchTimes || now === null) {
            return null;
          }

          const baseline = resolveLaunchBaseline(launchTimes);
          if (baseline === null) {
            return null;
          }

          return { launchTimes, now, baseline };
        },
        commit: ({ launchTimes, now, baseline }) => {
          const clock = resolveNotificationOpenClock({
            hasSplashHidden,
            isProtectedStartupReady,
            launchCause: launchTimes.launchCause,
            nativeBaselineUptimeMs: baseline.uptimeMs,
            nowUptimeMs: now,
            processBaselineUptimeMs: launchTimes.appUptimeMs,
          });

          beginNotificationOpen({
            target: {
              channelId: intent.channelId,
              ...(intent.messageId ? { messageId: intent.messageId } : {}),
              ...(intent.threadId ? { threadId: intent.threadId } : {}),
            },
            surface: surfaceFromTarget(intent),
            appState: clock.appState,
            baselineUptimeMs: clock.baselineUptimeMs,
            nativeAnchor: baseline.nativeAnchor,
            already: {
              nowUptimeMs: now,
              splashHidden: hasSplashHidden,
              dmsVisible: pathAtIntent.includes('/dms'),
              chatVisible: pathAtIntent.includes('/chat/'),
            },
          });
          beginNotificationHeaderResolve({
            target: {
              channelId: intent.channelId,
              ...(intent.messageId ? { messageId: intent.messageId } : {}),
              ...(intent.threadId ? { threadId: intent.threadId } : {}),
            },
            surface: surfaceFromTarget(intent),
            baselineUptimeMs: clock.baselineUptimeMs,
            nativeAnchor: baseline.nativeAnchor,
            ...(intent.notificationId ? { notificationId: intent.notificationId } : {}),
            ...(intent.notificationType ? { notificationType: intent.notificationType } : {}),
            ...(intent.metadata ? { metadata: intent.metadata } : {}),
          });
        },
      });
    };

    void startFromIntent();
    const unsubscribeNavIntent = subscribeNavIntent(() => {
      void startFromIntent();
    });

    const lifecycleSubscription = appLifecycle.subscribe(state => {
      if (state !== 'background') {
        return;
      }

      void startupClock.nowUptimeMs().then(now => {
        if (now !== null) {
          abandonNotificationOpen(now);
          abandonNotificationHeaderResolve(now);
        }
      });
    });

    return (): void => {
      unsubscribeCompleted();
      unsubscribeHeaderCompleted();
      unsubscribeNavIntent();
      lifecycleSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!input.hasSplashHidden) {
      return;
    }

    void startupClock.nowUptimeMs().then(now => {
      if (now === null) {
        return;
      }

      markNotificationPhase('splash_hidden', now);
    });
  }, [input.hasSplashHidden, journeyId]);
}
