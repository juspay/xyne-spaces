import { NativeModules } from 'react-native';
import * as Linking from 'expo-linking';
import { parseCallDeepLink } from '@/src/utils/callDeepLink';
import { parseMessageDeepLink } from '@/src/utils/messageDeepLink';
import { parseTicketDeepLink } from '@/src/utils/ticketDeepLink';
import { ShareTargetNative } from '@/src/features/share-target';
import {
  getCachedColdStartCall,
  initializeColdStartDetection,
} from '@/src/services/ColdStartCallDetector';
import {
  getBookmarkNavIntentSnapshot,
  getNavIntentSnapshot,
} from '@/src/notifications/tapNavigation';

import type {
  CollectedLaunchSignals,
  LaunchCause,
  LaunchSignals,
  LaunchTimes,
  StartupClock,
} from './coldStart';

type AppStartupNativeModule = {
  getLaunchTimes: () => Promise<Record<string, unknown>>;
  nowUptimeMs: () => Promise<number>;
};

type LaunchIntentNativeModule = {
  getLaunchIntent: () => Promise<{ extras?: Record<string, unknown> } | null>;
};

const LAUNCH_CAUSES: readonly LaunchCause[] = [
  'direct',
  'notification',
  'call',
  'deeplink',
  'share',
];

function getLaunchIntentModule(): LaunchIntentNativeModule | null {
  const candidate = (NativeModules as Record<string, unknown>)['LotusLaunchIntentModule'];

  if (
    candidate !== null &&
    typeof candidate === 'object' &&
    typeof (candidate as LaunchIntentNativeModule).getLaunchIntent === 'function'
  ) {
    return candidate as LaunchIntentNativeModule;
  }

  return null;
}

function getNativeModule(): AppStartupNativeModule | null {
  const candidate = (NativeModules as Record<string, unknown>)['AppStartupModule'];

  if (
    candidate !== null &&
    typeof candidate === 'object' &&
    typeof (candidate as AppStartupNativeModule).getLaunchTimes === 'function' &&
    typeof (candidate as AppStartupNativeModule).nowUptimeMs === 'function'
  ) {
    return candidate as AppStartupNativeModule;
  }

  return null;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readLaunchCause(value: unknown): LaunchCause | undefined {
  return typeof value === 'string' && (LAUNCH_CAUSES as readonly string[]).includes(value)
    ? (value as LaunchCause)
    : undefined;
}

function toLaunchTimes(raw: Record<string, unknown>): LaunchTimes | null {
  const platform =
    raw['platform'] === 'ios' || raw['platform'] === 'android' ? raw['platform'] : null;

  if (platform === null) {
    return null;
  }

  const launchCause = readLaunchCause(raw['launchCause']);
  const appUptimeMs = readFiniteNumber(raw['appUptimeMs']);
  const activityUptimeMs = readFiniteNumber(raw['activityUptimeMs']);

  return {
    platform,
    isBackgrounded: raw['isBackgrounded'] === true,
    ...(appUptimeMs !== undefined ? { appUptimeMs } : {}),
    ...(activityUptimeMs !== undefined ? { activityUptimeMs } : {}),
    ...(launchCause !== undefined ? { launchCause } : {}),
  };
}

export class ReactNativeStartupClock implements StartupClock {
  async getLaunchTimes(): Promise<LaunchTimes | null> {
    const nativeModule = getNativeModule();

    if (!nativeModule) {
      return null;
    }

    try {
      return toLaunchTimes(await nativeModule.getLaunchTimes());
    } catch {
      return null;
    }
  }

  async nowUptimeMs(): Promise<number | null> {
    const nativeModule = getNativeModule();

    if (!nativeModule) {
      return null;
    }

    try {
      const value = await nativeModule.nowUptimeMs();
      return Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  }
}

function looksLikeShare(url: string | null): boolean {
  if (!url) return false;

  try {
    const parsed = Linking.parse(url);
    return parsed.hostname === 'share-target' || parsed.path === 'share-target';
  } catch {
    return false;
  }
}

function looksLikeCall(url: string | null): boolean {
  return url !== null && parseCallDeepLink(url) !== null;
}

function looksLikeChat(url: string | null): boolean {
  return url !== null && (parseMessageDeepLink(url) !== null || parseTicketDeepLink(url) !== null);
}

function looksLikeDeepLink(url: string | null): boolean {
  if (!url) {
    return false;
  }

  return looksLikeCall(url) || looksLikeChat(url) || looksLikeShare(url) || url.includes('://');
}

async function readNotificationLaunchExtras(): Promise<boolean> {
  const launchIntentModule = getLaunchIntentModule();
  if (!launchIntentModule) {
    return false;
  }

  try {
    const launchIntent = await launchIntentModule.getLaunchIntent();
    const extras = launchIntent?.extras;
    if (extras === null || extras === undefined || typeof extras !== 'object') {
      return false;
    }

    if (Object.keys(extras).length === 0) {
      return false;
    }

    const callAction = extras['callAction'];
    const callId = extras['callId'];
    if (
      (typeof callAction === 'string' && callAction.length > 0) ||
      (typeof callId === 'string' && callId.length > 0)
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export class ReactNativeLaunchSignals implements LaunchSignals {
  async collect(): Promise<CollectedLaunchSignals> {
    const [, initialUrl, initialShare, hasNotificationIntentExtras] = await Promise.all([
      initializeColdStartDetection(),
      Linking.getInitialURL().catch(() => null),
      ShareTargetNative.getInitialShare(null).catch(() => null),
      readNotificationLaunchExtras(),
    ]);

    const hasQueuedNotificationIntent =
      getBookmarkNavIntentSnapshot() !== null || getNavIntentSnapshot() !== null;

    return {
      initialUrl,
      hasInitialNotification: hasQueuedNotificationIntent,
      hasNotificationIntentExtras,
      hasInitialShare: initialShare !== null,
      hasColdStartCall: getCachedColdStartCall() !== null,
      urlLooksLikeCall: looksLikeCall(initialUrl),
      urlLooksLikeShare: looksLikeShare(initialUrl),
      urlLooksLikeDeepLink: looksLikeDeepLink(initialUrl),
    };
  }
}
