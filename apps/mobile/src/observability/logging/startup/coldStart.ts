import type {
  AppLifecycle,
  AppLifecycleState,
  AppLifecycleSubscription,
} from '../lifecycle/AppLifecycle';
import type { AppLogEventMap } from '../events';

export type LaunchCause = AppLogEventMap['app_startup_completed']['launchCause'];

export type NativeAnchor = AppLogEventMap['app_startup_completed']['nativeAnchor'];

export type StartupDestination = AppLogEventMap['app_startup_completed']['destination'];

export type LaunchTimes = Readonly<{
  platform: 'ios' | 'android';
  appUptimeMs?: number;
  activityUptimeMs?: number;
  isBackgrounded: boolean;
  launchCause?: LaunchCause;
}>;

export interface StartupClock {
  getLaunchTimes(): Promise<LaunchTimes | null>;
  nowUptimeMs(): Promise<number | null>;
}

export type CollectedLaunchSignals = Readonly<{
  initialUrl: string | null;
  hasInitialNotification: boolean;
  hasNotificationIntentExtras: boolean;
  hasInitialShare: boolean;
  hasColdStartCall: boolean;
  urlLooksLikeCall: boolean;
  urlLooksLikeShare: boolean;
  urlLooksLikeDeepLink: boolean;
}>;

export interface LaunchSignals {
  collect(): Promise<CollectedLaunchSignals>;
}

export type LaunchSignalSnapshot = Readonly<{
  nativeCause?: LaunchCause;
  initialUrl: string | null;
  hasInitialNotification: boolean;
  hasNotificationIntentExtras: boolean;
  hasInitialShare: boolean;
  hasColdStartCall: boolean;
  urlLooksLikeCall: boolean;
  urlLooksLikeShare: boolean;
  urlLooksLikeDeepLink: boolean;
}>;

export type LaunchBaseline = Readonly<{
  uptimeMs: number;
  nativeAnchor: NativeAnchor;
}>;

export type StartupDestinationInput = Readonly<{
  isEnrollmentResolved: boolean;
  isAuthResolved: boolean;
  isEnrolled: boolean;
  isSignedIn: boolean;
}>;

export type CompletedColdStart = Readonly<{
  durationMs: number;
  launchCause: LaunchCause;
  destination: StartupDestination;
  nativeAnchor: NativeAnchor;
}>;

export const COLD_START_BACKGROUND_ABORT_MS = 2_000;
export const COLD_START_LAUNCH_INTENT_SETTLE_MS = 1_000;

const CAUSE_PRIORITY: readonly LaunchCause[] = [
  'call',
  'notification',
  'share',
  'deeplink',
  'direct',
];

function firstPresentCause(candidates: readonly (LaunchCause | false | undefined)[]): LaunchCause {
  for (const cause of CAUSE_PRIORITY) {
    if (candidates.includes(cause)) {
      return cause;
    }
  }
  return 'direct';
}

export function resolveLaunchBaseline(launchTimes: LaunchTimes): LaunchBaseline | null {
  if (launchTimes.platform === 'ios') {
    if (launchTimes.appUptimeMs === undefined) {
      return null;
    }

    return {
      uptimeMs: launchTimes.appUptimeMs,
      nativeAnchor: 'app',
    };
  }

  if (launchTimes.activityUptimeMs !== undefined) {
    return {
      uptimeMs: launchTimes.activityUptimeMs,
      nativeAnchor: 'activity',
    };
  }

  if (launchTimes.appUptimeMs === undefined) {
    return null;
  }

  return {
    uptimeMs: launchTimes.appUptimeMs,
    nativeAnchor: 'app',
  };
}

export function resolveLaunchCause(signals: LaunchSignalSnapshot): LaunchCause {
  // CallKeep / incoming-call activities often report native "direct" at T0.
  // JS call detection is the only reliable upgrade for that case.
  if (signals.hasColdStartCall || signals.nativeCause === 'call' || signals.urlLooksLikeCall) {
    return 'call';
  }

  // The Activity/intent that started THIS native launch is the source of truth.
  // FCM getInitialNotification, Notifee, Expo last-response, and MMKV nav
  // intents are sticky across later direct/share opens and must not override it.
  if (signals.nativeCause !== undefined && signals.nativeCause !== 'direct') {
    return signals.nativeCause;
  }

  // Notifee tray taps reuse MAIN/LAUNCHER. Native extras on THIS activity
  // distinguish them from a direct launch (extras == null).
  if (signals.hasNotificationIntentExtras) {
    return 'notification';
  }

  return firstPresentCause([
    signals.hasInitialShare ? 'share' : undefined,
    signals.urlLooksLikeShare ? 'share' : undefined,
    signals.urlLooksLikeDeepLink ? 'deeplink' : undefined,
    signals.nativeCause === 'direct' ? 'direct' : undefined,
  ]);
}

export function resolveStartupDestination(
  input: StartupDestinationInput,
): StartupDestination | null {
  if (!input.isEnrollmentResolved) {
    return null;
  }

  if (!input.isEnrolled) {
    return 'enrollment';
  }

  if (!input.isAuthResolved) {
    return null;
  }

  if (!input.isSignedIn) {
    return 'login';
  }

  // Signed-in cold start always ends at the default screen. Later navigation
  // (chat, call, share, bookmarks) is not part of app_startup_completed.
  return 'dms';
}

type PendingColdStart = {
  baselineUptimeMs: number | null;
  nativeAnchor: NativeAnchor | null;
  nativeCause: LaunchCause | undefined;
  appliedSignals: LaunchSignalSnapshot | null;
  launchCause: LaunchCause | null;
  destination: StartupDestination | null;
  splashHidden: boolean;
  launchIntentSettled: boolean;
  readyAtByDestination: Map<StartupDestination, number>;
  completed: boolean;
  aborted: boolean;
};

let clock: StartupClock | null = null;
let pending: PendingColdStart | null = null;
let lifecycleSubscription: AppLifecycleSubscription | null = null;
let backgroundAbortTimer: ReturnType<typeof setTimeout> | null = null;
let lastLifecycleState: AppLifecycleState | null = null;
let launchIntentSettled = false;
let startupGeneration = 0;
const startupGenerationListeners = new Set<() => void>();

export function getStartupGeneration(): number {
  return startupGeneration;
}

export function subscribeStartupGeneration(listener: () => void): () => void {
  startupGenerationListeners.add(listener);
  return (): void => {
    startupGenerationListeners.delete(listener);
  };
}

function bumpStartupGeneration(): void {
  startupGeneration += 1;
  for (const listener of startupGenerationListeners) {
    listener();
  }
}

function createPending(): PendingColdStart {
  return {
    baselineUptimeMs: null,
    nativeAnchor: null,
    nativeCause: undefined,
    appliedSignals: null,
    launchCause: null,
    destination: null,
    splashHidden: false,
    launchIntentSettled,
    readyAtByDestination: new Map(),
    completed: false,
    aborted: false,
  };
}

export function configureColdStartClock(nextClock: StartupClock): void {
  clock = nextClock;
}

function clearBackgroundAbortTimer(): void {
  if (backgroundAbortTimer === null) {
    return;
  }

  clearTimeout(backgroundAbortTimer);
  backgroundAbortTimer = null;
}

export function resetColdStart(): void {
  clearBackgroundAbortTimer();
  lifecycleSubscription?.remove();
  lifecycleSubscription = null;
  lastLifecycleState = null;
  pending = null;
  launchIntentSettled = false;
  startupGeneration = 0;
}

function needsLaunchIntentSettle(state: PendingColdStart): boolean {
  return state.destination === 'dms' && state.launchCause === 'direct';
}

function canComplete(state: PendingColdStart): boolean {
  return (
    !state.completed &&
    !state.aborted &&
    state.baselineUptimeMs !== null &&
    state.nativeAnchor !== null &&
    state.launchCause !== null &&
    state.appliedSignals !== null &&
    state.destination !== null &&
    state.splashHidden &&
    state.readyAtByDestination.has(state.destination) &&
    (!needsLaunchIntentSettle(state) || state.launchIntentSettled)
  );
}

function toCompleted(state: PendingColdStart): CompletedColdStart | null {
  if (
    state.baselineUptimeMs === null ||
    state.nativeAnchor === null ||
    state.launchCause === null ||
    state.destination === null
  ) {
    return null;
  }

  const readyAt = state.readyAtByDestination.get(state.destination);
  if (readyAt === undefined) {
    return null;
  }

  return {
    durationMs: Math.max(0, Math.round(readyAt - state.baselineUptimeMs)),
    launchCause: state.launchCause,
    destination: state.destination,
    nativeAnchor: state.nativeAnchor,
  };
}

export function abortColdStart(): void {
  if (pending === null || pending.completed) {
    return;
  }

  clearBackgroundAbortTimer();
  pending.aborted = true;
}

function tryComplete(): CompletedColdStart | null {
  if (pending === null || !canComplete(pending)) {
    return null;
  }

  const completed = toCompleted(pending);
  if (completed === null) {
    return null;
  }

  clearBackgroundAbortTimer();
  pending.completed = true;
  return completed;
}

function assignLaunchCause(state: PendingColdStart): void {
  const nativeCause = state.appliedSignals?.nativeCause ?? state.nativeCause;
  state.launchCause = resolveLaunchCause({
    ...(state.appliedSignals ?? {
      initialUrl: null,
      hasInitialNotification: false,
      hasNotificationIntentExtras: false,
      hasInitialShare: false,
      hasColdStartCall: false,
      urlLooksLikeCall: false,
      urlLooksLikeShare: false,
      urlLooksLikeDeepLink: false,
    }),
    ...(nativeCause !== undefined ? { nativeCause } : {}),
  });
  syncBackgroundAbort();
}

function shouldAbortWhileBackgrounded(state: PendingColdStart): boolean {
  // Do not abort until we know why the app launched; otherwise a very early
  // brief background handoff during notification/share plumbing could kill a
  // valid startup before its signals resolve.
  if (state.appliedSignals === null) {
    return false;
  }

  // CallKit / CallKeep flows are legitimately foreground-negotiated: iOS may
  // resign active momentarily while the incoming-call UI is presented, and
  // this must not be treated as user abandonment.
  if (state.launchCause === 'call') {
    return false;
  }

  return true;
}

function isSameNativeLaunch(state: PendingColdStart, baseline: LaunchBaseline | null): boolean {
  return (
    baseline !== null &&
    state.baselineUptimeMs !== null &&
    state.nativeAnchor === baseline.nativeAnchor &&
    state.baselineUptimeMs === baseline.uptimeMs
  );
}

function abandonPending(resetLaunchIntentSettled: boolean): void {
  clearBackgroundAbortTimer();
  pending = null;

  if (resetLaunchIntentSettled) {
    launchIntentSettled = false;
  }
}

function scheduleBackgroundAbort(): void {
  if (backgroundAbortTimer !== null || pending === null || pending.completed || pending.aborted) {
    return;
  }

  backgroundAbortTimer = setTimeout(() => {
    backgroundAbortTimer = null;
    abortColdStart();
  }, COLD_START_BACKGROUND_ABORT_MS);
}

function syncBackgroundAbort(): void {
  if (pending === null || pending.completed || pending.aborted) {
    clearBackgroundAbortTimer();
    return;
  }

  if (lastLifecycleState === 'background' && shouldAbortWhileBackgrounded(pending)) {
    scheduleBackgroundAbort();
    return;
  }

  clearBackgroundAbortTimer();
}

export async function beginColdStart(
  appLifecycle?: AppLifecycle,
): Promise<CompletedColdStart | null> {
  if (clock === null) {
    return null;
  }

  // A concurrent remount must not start a second attempt while the first is
  // still reading native T0.
  if (
    pending !== null &&
    !pending.aborted &&
    !pending.completed &&
    pending.baselineUptimeMs === null
  ) {
    return null;
  }

  if (pending !== null && !pending.aborted) {
    const launchTimes = await clock.getLaunchTimes();
    const baseline = launchTimes ? resolveLaunchBaseline(launchTimes) : null;

    // Same native activity/process: RootLayout remounted. Do not double-log.
    // A later MainActivity.onCreate rewrites activityUptimeMs — that is a
    // new T0 and must start a new attempt even though JS survived.
    if (isSameNativeLaunch(pending, baseline) || baseline === null) {
      return null;
    }

    abandonPending(true);
  } else if (pending !== null) {
    abandonPending(false);
  }

  lastLifecycleState = null;
  pending = createPending();
  bumpStartupGeneration();

  if (appLifecycle && lifecycleSubscription === null) {
    lifecycleSubscription = appLifecycle.subscribe((nextState): void => {
      lastLifecycleState = nextState;
      syncBackgroundAbort();
    });
  }

  const launchTimes = await clock.getLaunchTimes();
  if (pending === null || pending.aborted) {
    return null;
  }

  if (!launchTimes) {
    abortColdStart();
    return null;
  }

  const baseline = resolveLaunchBaseline(launchTimes);
  if (!baseline) {
    abortColdStart();
    return null;
  }

  pending.baselineUptimeMs = baseline.uptimeMs;
  pending.nativeAnchor = baseline.nativeAnchor;
  pending.nativeCause = launchTimes.launchCause;

  if (pending.appliedSignals !== null || pending.nativeCause !== undefined) {
    assignLaunchCause(pending);
  }

  return tryComplete();
}

export function applyLaunchSignals(signals: LaunchSignalSnapshot): CompletedColdStart | null {
  if (pending === null || pending.completed || pending.aborted) {
    return null;
  }

  // Recovered nav intents arrive later and must not wipe THIS activity's extras.
  // Sticky FCM/MMKV still must not invent extras on a later direct launch.
  pending.appliedSignals = {
    ...signals,
    hasNotificationIntentExtras:
      signals.hasNotificationIntentExtras ||
      pending.appliedSignals?.hasNotificationIntentExtras === true,
  };
  assignLaunchCause(pending);
  return tryComplete();
}

export function markColdStartSplashHidden(): CompletedColdStart | null {
  if (pending === null || pending.completed || pending.aborted) {
    return null;
  }

  pending.splashHidden = true;
  return tryComplete();
}

export function markColdStartLaunchIntentSettled(): CompletedColdStart | null {
  launchIntentSettled = true;

  if (pending === null || pending.completed || pending.aborted) {
    return null;
  }

  pending.launchIntentSettled = true;
  return tryComplete();
}

export function setColdStartDestination(
  destination: StartupDestination | null,
): CompletedColdStart | null {
  if (pending === null || pending.completed || pending.aborted || destination === null) {
    return null;
  }

  pending.destination = destination;
  return tryComplete();
}

export async function noteStartupDestinationReady(
  destination: StartupDestination,
): Promise<CompletedColdStart | null> {
  if (pending === null || pending.completed || pending.aborted || clock === null) {
    return null;
  }

  if (!pending.readyAtByDestination.has(destination)) {
    const now = await clock.nowUptimeMs();
    if (pending === null || pending.completed || pending.aborted) {
      return null;
    }

    if (now === null) {
      abortColdStart();
      return null;
    }

    pending.readyAtByDestination.set(destination, now);
  }

  return tryComplete();
}

export function getPendingColdStartSnapshot(): CompletedColdStart | null {
  if (pending === null || pending.aborted) {
    return null;
  }

  return toCompleted({
    ...pending,
    readyAtByDestination: new Map(pending.readyAtByDestination),
  });
}
