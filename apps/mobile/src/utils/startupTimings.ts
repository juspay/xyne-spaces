import { NativeModules, Platform, AppState } from 'react-native';
import Constants from 'expo-constants';
import { Event } from '@/src/utils/logger';
import { logger } from '@/src/utils/logger';
import { getBoolean, getString, setString } from '@/src/services/localStorage';
import { enqueueStartupMetrics } from '@/src/services/metrics/metricsQueue';

type LaunchTimes = {
  platform: 'android' | 'ios';
  appUptimeMs: number;
  activityUptimeMs?: number;
  airborneInitStartUptimeMs?: number;
  airborneInitEndUptimeMs?: number;
  airborneStartAppUptimeMs?: number;
  processUptimeMs?: number;
  firstNativeFrameUptimeMs?: number;
  jsCallUptimeMs: number;
  isBackgrounded?: boolean;
};

type StartupClockModule = {
  getLaunchTimes: () => Promise<LaunchTimes>;
  nowUptimeMs: () => Promise<number>;
};

type MilestoneKey =
  | 'root_navigation_state_ready'
  | 'root_first_frame_painted'
  | 'enrollment_check_start'
  | 'enrollment_check_end'
  | 'auth_loading_start'
  | 'auth_loading_end'
  | 'splash_hidden'
  | 'splash_hide_call'
  | 'splash_hide_done'
  | 'presence_setup_start'
  | 'presence_setup_end'
  | 'query_cache_setup_start'
  | 'query_cache_setup_end'
  | 'query_cache_hydration_fallback_ready'
  | 'query_cache_hydration_start'
  | 'query_cache_hydration_end'
  | 'zero_users_load_start'
  | 'zero_users_loaded'
  | 'zero_channels_load_start'
  | 'zero_channels_loaded'
  | 'zero_visible_channels_load_start'
  | 'zero_visible_channels_loaded'
  | 'zero_visible_channels_state_sent';

export type StartupTimingsPayload = {
  startupRunId: string;
  coldStart: boolean;
  native_anchor: 'activity' | 'app' | 'process';
  logKind: 'checkpoint' | 'final';
  checkpoint?: string;
  final_reason?: 'complete' | 'fallback_after_splash' | 'watchdog';
  durations_ms: Record<string, number>;
  spans_ms?: Record<string, number>;
  query_statuses?: Record<string, string>;
  query_counts?: Record<string, number>;
  screen: string;
  initial_route_segments?: string[];
  isEnrolled: boolean | null;
  isLoggedIn: boolean | null;
  first_launch_after_update?: boolean;
};

const getModule = (): StartupClockModule | null => {
  const mod = (NativeModules as Record<string, unknown>)?.['AppStartupModule'] as
    StartupClockModule | undefined;
  return mod ?? null;
};

let cachedLaunchTimes: LaunchTimes | null = null;
let cachedClockDomain: 'native' | 'date' | null = null;
let initSegments: string[] | undefined;
const milestones = new Map<MilestoneKey, number>();
const queryStatuses = new Map<string, string>();
const queryCounts = new Map<string, number>();
let didLog = false;
let warnedMissingBaseline = false;
let hasEverLogged = false;
let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
let lastAppState: string | null = AppState.currentState;
let finalLogFallback: ReturnType<typeof setTimeout> | null = null;
let coldStartLogWatchdog: ReturnType<typeof setTimeout> | null = null;
const pendingFinalScreen = 'root';

const LAST_SEEN_VERSION_KEY = '@lotus_last_seen_version';
let firstLaunchAfterUpdate: boolean | null = null;

function checkFirstLaunchAfterUpdate(): boolean {
  if (firstLaunchAfterUpdate !== null) return firstLaunchAfterUpdate;

  const currentVersion = Constants.expoConfig?.version ?? 'unknown';
  const lastSeen = getString(LAST_SEEN_VERSION_KEY);

  if (lastSeen === null) {
    setString(LAST_SEEN_VERSION_KEY, currentVersion);
    firstLaunchAfterUpdate = false;
    return false;
  }

  if (lastSeen !== currentVersion) {
    setString(LAST_SEEN_VERSION_KEY, currentVersion);
    firstLaunchAfterUpdate = true;
    return true;
  }

  firstLaunchAfterUpdate = false;
  return false;
}

const FINAL_LOG_FALLBACK_MS = 3000;
const COLD_START_LOG_WATCHDOG_MS = 10000;
const startupRunId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

async function ensureLaunchTimes(): Promise<LaunchTimes> {
  if (cachedLaunchTimes) {
    return cachedLaunchTimes;
  }
  const mod = getModule();
  if (!mod) {
    if (!__DEV__) {
      logger.warn(Event.LOTUS_STARTUP_DIAGNOSTIC, {
        reason: 'startup_clock_fallback',
        message: 'AppStartupModule unavailable; falling back to Date.now()',
      });
    }
    cachedClockDomain = 'date';
    const now = Date.now();
    cachedLaunchTimes = {
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      appUptimeMs: now,
      jsCallUptimeMs: now,
    };
    return cachedLaunchTimes;
  }
  cachedClockDomain = 'native';
  cachedLaunchTimes = await mod.getLaunchTimes();
  return cachedLaunchTimes;
}

async function nowUptimeMs(): Promise<number> {
  // If the baseline was established with Date.now(), all subsequent timestamps
  // must use the same clock domain to avoid subtracting across incompatible epochs.
  if (cachedClockDomain === 'date') return Date.now();
  const mod = getModule();
  if (!mod) return Date.now();
  return mod.nowUptimeMs();
}

function setMilestoneIfMissing(key: MilestoneKey, value: number): void {
  if (milestones.has(key)) return;
  milestones.set(key, value);
}

const addDuration = (
  durations: Record<string, number>,
  name: string,
  value: number | undefined,
): void => {
  if (value !== undefined && Number.isFinite(value)) {
    durations[name] = Math.round(value);
  }
};

const computeDuration = (
  end: number | undefined,
  start: number | undefined,
): number | undefined => {
  if (end === undefined || start === undefined) return undefined;
  const elapsed = end - start;
  if (!Number.isFinite(elapsed)) return undefined;
  return Math.max(0, elapsed);
};

const addSpan = (
  spans: Record<string, number>,
  name: string,
  startKey: MilestoneKey,
  endKey: MilestoneKey,
): void => {
  addDuration(spans, name, computeDuration(milestones.get(endKey), milestones.get(startKey)));
};

async function buildStartupPayload(params: {
  screen: string;
  logKind: StartupTimingsPayload['logKind'];
  checkpoint?: string;
  finalReason?: StartupTimingsPayload['final_reason'];
}): Promise<StartupTimingsPayload | null> {
  const launchTimes = await ensureLaunchTimes();
  // iOS: activityUptimeMs is captured at UIApplication.didBecomeActiveNotification,
  // which fires AFTER didFinishLaunchingWithOptions returns. It is NOT equivalent
  // to Android's Activity.onCreate() and using it as baseline under-reports all
  // durations by the time spent in didFinishLaunchingWithOptions. Use appUptimeMs
  // (beginning of didFinishLaunchingWithOptions) as the earliest reliable baseline.
  // Android: processUptimeMs captures Process.getStartUptimeMillis() which reflects
  // OS process fork time. Android forks processes for background reasons (FCM pushes,
  // scheduled jobs, broadcast receivers). Using processUptimeMs as baseline inflates
  // all durations when the user opens the app minutes/hours later on the same process.
  // activityUptimeMs (MainActivity.onCreate) only fires on user-visible launches.
  const base =
    Platform.OS === 'ios'
      ? launchTimes.appUptimeMs
      : launchTimes.activityUptimeMs !== undefined
        ? launchTimes.activityUptimeMs
        : launchTimes.appUptimeMs;

  // RC7: If baseline was never captured, don't emit garbage data
  if (base === undefined) {
    if (!warnedMissingBaseline) {
      warnedMissingBaseline = true;
      logger.warn(Event.LOTUS_STARTUP_DIAGNOSTIC, {
        reason: 'startup_baseline_missing',
        message: 'Neither appUptimeMs nor activityUptimeMs available; startup timings skipped',
      });
    }
    return null;
  }

  // Abort if the native layer detected the app was backgrounded before ReactContext was ready.
  // This prevents inflated durations when the user switches apps during early startup.
  if (launchTimes.isBackgrounded) {
    abortStartupTracking('native_lifecycle_backgrounded');
    return null;
  }

  const nativeAnchor: StartupTimingsPayload['native_anchor'] =
    Platform.OS === 'ios' ? 'app' : launchTimes.activityUptimeMs !== undefined ? 'activity' : 'app';

  const rootNavigationStateReady = milestones.get('root_navigation_state_ready');
  const splashHidden = milestones.get('splash_hidden');
  const zeroUsersLoadStart = milestones.get('zero_users_load_start');
  const zeroUsersLoaded = milestones.get('zero_users_loaded');
  const zeroChannelsLoadStart = milestones.get('zero_channels_load_start');
  const zeroChannelsLoaded = milestones.get('zero_channels_loaded');
  const zeroVisibleChannelsLoadStart = milestones.get('zero_visible_channels_load_start');
  const zeroVisibleChannelsLoaded = milestones.get('zero_visible_channels_loaded');
  const durations: Record<string, number> = {};
  const spans: Record<string, number> = {};

  addDuration(
    durations,
    'airborne_init_ms',
    computeDuration(launchTimes.airborneInitEndUptimeMs, launchTimes.airborneInitStartUptimeMs),
  );
  addDuration(
    durations,
    'native_to_airborne_start_app_ms',
    computeDuration(launchTimes.airborneStartAppUptimeMs, base),
  );
  addSpan(spans, 'enrollment_check_ms', 'enrollment_check_start', 'enrollment_check_end');
  addSpan(spans, 'auth_loading_ms', 'auth_loading_start', 'auth_loading_end');
  addSpan(spans, 'presence_setup_ms', 'presence_setup_start', 'presence_setup_end');
  addSpan(spans, 'query_cache_setup_ms', 'query_cache_setup_start', 'query_cache_setup_end');
  addSpan(
    spans,
    'query_cache_hydration_ms',
    'query_cache_hydration_start',
    'query_cache_hydration_end',
  );
  addSpan(
    spans,
    'visible_channels_state_send_ms',
    'zero_visible_channels_loaded',
    'zero_visible_channels_state_sent',
  );
  addSpan(spans, 'splash_hide_async_ms', 'splash_hide_call', 'splash_hide_done');
  addDuration(durations, 'splash_hidden', computeDuration(splashHidden, base));
  addDuration(
    durations,
    'zero_users_load_ms',
    computeDuration(zeroUsersLoaded, zeroUsersLoadStart),
  );
  addDuration(
    durations,
    'zero_channels_load_ms',
    computeDuration(zeroChannelsLoaded, zeroChannelsLoadStart),
  );
  addDuration(
    durations,
    'zero_visible_channels_ms',
    computeDuration(zeroVisibleChannelsLoaded, zeroVisibleChannelsLoadStart),
  );
  addDuration(
    durations,
    'root_navigation_state_to_splash_hidden_ms',
    computeDuration(splashHidden, rootNavigationStateReady),
  );
  addDuration(
    durations,
    'first_native_frame_ms',
    computeDuration(launchTimes.firstNativeFrameUptimeMs, base),
  );

  return {
    startupRunId,
    coldStart: !hasEverLogged,
    native_anchor: nativeAnchor,
    logKind: params.logKind,
    ...(params.checkpoint ? { checkpoint: params.checkpoint } : {}),
    ...(params.finalReason ? { final_reason: params.finalReason } : {}),
    durations_ms: durations,
    ...(Object.keys(spans).length > 0 ? { spans_ms: spans } : {}),
    ...(queryStatuses.size > 0 ? { query_statuses: Object.fromEntries(queryStatuses) } : {}),
    ...(queryCounts.size > 0 ? { query_counts: Object.fromEntries(queryCounts) } : {}),
    screen: params.screen,
    isEnrolled: getBoolean('@lotus_is_enrolled'),
    // This is a non-secret startup hint for diagnostics only. AuthContext still
    // requires the protected token before authorizing a session.
    isLoggedIn: getString('@lotus_user_id') === null ? null : true,
    first_launch_after_update: checkFirstLaunchAfterUpdate(),
    ...(initSegments ? { initial_route_segments: initSegments } : {}),
  };
}

async function logStartupTimings(params: { screen: string }): Promise<void> {
  if (didLog) return;

  if (!milestones.has('splash_hidden')) {
    return;
  }

  await forceLogStartupTimings({ screen: params.screen, reason: 'complete' });
}

async function forceLogStartupTimings(params: {
  screen: string;
  reason: NonNullable<StartupTimingsPayload['final_reason']>;
}): Promise<void> {
  if (didLog) return;

  const payload = await buildStartupPayload({
    screen: params.screen,
    logKind: 'final',
    finalReason: params.reason,
  });

  if (!payload) return;
  didLog = true;
  hasEverLogged = true;
  if (finalLogFallback) {
    clearTimeout(finalLogFallback);
    finalLogFallback = null;
  }
  if (coldStartLogWatchdog) {
    clearTimeout(coldStartLogWatchdog);
    coldStartLogWatchdog = null;
  }
  if (payload.first_launch_after_update) {
    return;
  }
  void enqueueStartupMetrics(payload);
}

function scheduleFinalLogFallback(): void {
  if (didLog || finalLogFallback || !milestones.has('splash_hidden')) {
    return;
  }

  finalLogFallback = setTimeout(() => {
    finalLogFallback = null;
    void forceLogStartupTimings({ screen: pendingFinalScreen, reason: 'fallback_after_splash' });
  }, FINAL_LOG_FALLBACK_MS);
}

function scheduleColdStartLogWatchdog(): void {
  if (didLog || coldStartLogWatchdog) {
    return;
  }

  coldStartLogWatchdog = setTimeout(() => {
    coldStartLogWatchdog = null;
    void forceLogStartupTimings({ screen: pendingFinalScreen, reason: 'watchdog' });
  }, COLD_START_LOG_WATCHDOG_MS);
}

function abortStartupTracking(reason: string): void {
  if (didLog) return;

  if (finalLogFallback) {
    clearTimeout(finalLogFallback);
    finalLogFallback = null;
  }
  if (coldStartLogWatchdog) {
    clearTimeout(coldStartLogWatchdog);
    coldStartLogWatchdog = null;
  }

  didLog = true;

  logger.info(Event.LOTUS_STARTUP_DIAGNOSTIC, {
    reason: 'startup_tracking_aborted',
    abortReason: reason,
    reachedMilestones: Array.from(milestones.keys()),
  });
  void logger.flushLogs();
}

export const startupTimings = {
  init(params: { initialRouteSegments?: string[] }): void {
    scheduleColdStartLogWatchdog();

    // Invalidate cached baseline on true foreground to prevent warm-start pollution
    if (!appStateSubscription) {
      lastAppState = AppState.currentState;
      appStateSubscription = AppState.addEventListener('change', nextAppState => {
        if (lastAppState !== 'active' && nextAppState === 'active') {
          cachedLaunchTimes = null;
        }
        lastAppState = nextAppState;
      });
    }

    if (initSegments && initSegments.length > 0) {
      return;
    }
    const next = params.initialRouteSegments?.filter(Boolean);
    if (next && next.length > 0) {
      initSegments = next;
    }
  },

  async mark(key: MilestoneKey): Promise<void> {
    scheduleColdStartLogWatchdog();
    setMilestoneIfMissing(key, await nowUptimeMs());
    if (key === 'splash_hidden' || key === 'root_first_frame_painted') {
      scheduleFinalLogFallback();
      await logStartupTimings({ screen: pendingFinalScreen });
    }
  },

  async getElapsedSinceNativeLaunchMs(): Promise<number> {
    const launchTimes = await ensureLaunchTimes();
    const base =
      Platform.OS === 'ios'
        ? launchTimes.appUptimeMs
        : launchTimes.activityUptimeMs !== undefined
          ? launchTimes.activityUptimeMs
          : launchTimes.appUptimeMs;
    return (await nowUptimeMs()) - base;
  },

  setQueryStatus(queryName: string, status: string): void {
    queryStatuses.set(queryName, status);
  },

  setQueryCount(queryName: string, count: number): void {
    queryCounts.set(queryName, count);
  },
};
