import type { LaunchCause, NativeAnchor } from '../startup/coldStart';
import {
  appendPathSegment,
  pathSegmentForPhase,
  resolveIdealPath,
  type NotificationOpenSurface,
} from './notificationPath';

export const NOTIFICATION_OPEN_SKELETON_TIMEOUT_MS = 8_000;
export const NOTIFICATION_OPEN_HIGHLIGHT_TIMEOUT_MS = 8_000;
export const NOTIFICATION_OPEN_JOURNEY_TIMEOUT_MS = 20_000;

/** Native `launchCause` / `appUptimeMs` are process-lifetime. A tap is only
 *  "cold" if it still belongs to that launch — not hours later on the same JS
 *  runtime. Android recents-swipe often destroys the Activity but keeps the
 *  process; `activityUptimeMs` resets while `appUptimeMs` does not. Process
 *  age is the gate that must stay warm in that case. */
export const NOTIFICATION_OPEN_COLD_LAUNCH_WINDOW_MS = 20_000;

/** Chat list/highlight can paint before `beginNotificationOpen` finishes the
 *  native clock read. Keep those marks for a short window and apply them when
 *  the journey starts so they are not dropped. */
export const NOTIFICATION_OPEN_MARK_BUFFER_TTL_MS = 5_000;

export type NotificationOpenOutcome =
  'highlighted' | 'skeleton_timeout' | 'highlight_timeout' | 'abandoned';

export type NotificationOpenAppState = 'cold' | 'warm';

export type NotificationOpenTarget = Readonly<{
  channelId: string;
  messageId?: string;
  threadId?: string;
}>;

export type CompletedNotificationOpen = Readonly<{
  durationMs: number;
  outcome: NotificationOpenOutcome;
  surface: NotificationOpenSurface;
  appState: NotificationOpenAppState;
  nativeAnchor: NativeAnchor;
  idealPath: string;
  realPath: string;
  pathMatched: boolean;
  chatSkeletonShown: boolean;
  messageHighlighted: boolean;
  channelId: string;
  messageId: string | null;
  threadId: string | null;
}>;

export type BeginNotificationOpenInput = Readonly<{
  target: NotificationOpenTarget;
  surface: NotificationOpenSurface;
  appState: NotificationOpenAppState;
  baselineUptimeMs: number;
  nativeAnchor: NativeAnchor;
  already?: Readonly<{
    splashHidden?: boolean;
    dmsVisible?: boolean;
    chatVisible?: boolean;
    nowUptimeMs: number;
  }>;
}>;

export interface NotificationOpenTimeoutScheduler {
  schedule(callback: () => void, durationMs: number): { cancel(): void };
}

type PhaseTimes = {
  splashHidden: number | null;
  dmsVisible: number | null;
  chatVisible: number | null;
  chatSkeletonShown: number | null;
  listReady: number | null;
  messageHighlighted: number | null;
};

type PendingNotificationOpen = {
  baselineUptimeMs: number;
  nativeAnchor: NativeAnchor;
  appState: NotificationOpenAppState;
  surface: NotificationOpenSurface;
  target: NotificationOpenTarget;
  journeyId: number;
  idealPath: string;
  realPath: string;
  times: PhaseTimes;
  chatSkeletonShown: boolean;
  listReady: boolean;
  messageHighlighted: boolean;
  completed: boolean;
};

type CancelableTimeout = {
  cancel(): void;
};

type BufferedNotificationOpenMark = Readonly<{
  kind: 'skeleton' | 'list_ready' | 'highlighted';
  atUptimeMs: number;
  channelId?: string;
  messageId?: string;
}>;

const defaultScheduler: NotificationOpenTimeoutScheduler = {
  schedule(callback, durationMs) {
    const timeoutHandle = setTimeout(callback, durationMs);
    return {
      cancel: (): void => {
        clearTimeout(timeoutHandle);
      },
    };
  },
};

let scheduler: NotificationOpenTimeoutScheduler = defaultScheduler;
let pending: PendingNotificationOpen | null = null;
let journeyId = 0;
const journeyListeners = new Set<() => void>();
const completionListeners = new Set<(completed: CompletedNotificationOpen) => void>();

let skeletonTimer: CancelableTimeout | null = null;
let highlightTimer: CancelableTimeout | null = null;
let journeyTimer: CancelableTimeout | null = null;
let bufferedMarks: BufferedNotificationOpenMark[] = [];

export function configureNotificationOpenScheduler(
  nextScheduler: NotificationOpenTimeoutScheduler,
): void {
  scheduler = nextScheduler;
}

export function resolveNotificationOpenClock(input: {
  hasSplashHidden: boolean;
  isProtectedStartupReady: boolean;
  launchCause?: LaunchCause | undefined;
  nativeBaselineUptimeMs: number;
  nowUptimeMs: number;
  processBaselineUptimeMs?: number | undefined;
}): {
  appState: NotificationOpenAppState;
  baselineUptimeMs: number;
} {
  const processAgeMs =
    input.processBaselineUptimeMs !== undefined
      ? Math.max(0, input.nowUptimeMs - input.processBaselineUptimeMs)
      : Math.max(0, input.nowUptimeMs - input.nativeBaselineUptimeMs);

  if (processAgeMs > NOTIFICATION_OPEN_COLD_LAUNCH_WINDOW_MS) {
    return {
      appState: 'warm',
      baselineUptimeMs: input.nowUptimeMs,
    };
  }

  const nativeAgeMs = Math.max(0, input.nowUptimeMs - input.nativeBaselineUptimeMs);
  const withinColdWindow = nativeAgeMs <= NOTIFICATION_OPEN_COLD_LAUNCH_WINDOW_MS;
  const startupInProgress = !input.hasSplashHidden || !input.isProtectedStartupReady;
  const isCold = withinColdWindow && (startupInProgress || input.launchCause === 'notification');

  return {
    appState: isCold ? 'cold' : 'warm',
    baselineUptimeMs: isCold ? input.nativeBaselineUptimeMs : input.nowUptimeMs,
  };
}

export function getNotificationOpenJourneyId(): number {
  return journeyId;
}

export function subscribeNotificationOpenJourney(listener: () => void): () => void {
  journeyListeners.add(listener);
  return (): void => {
    journeyListeners.delete(listener);
  };
}

export function subscribeNotificationOpenCompleted(
  listener: (completed: CompletedNotificationOpen) => void,
): () => void {
  completionListeners.add(listener);
  return (): void => {
    completionListeners.delete(listener);
  };
}

function bumpJourney(): void {
  journeyId += 1;
  for (const listener of journeyListeners) {
    listener();
  }
}

function clearTimers(): void {
  skeletonTimer?.cancel();
  highlightTimer?.cancel();
  journeyTimer?.cancel();
  skeletonTimer = null;
  highlightTimer = null;
  journeyTimer = null;
}

function sameTarget(left: NotificationOpenTarget, right: NotificationOpenTarget): boolean {
  return (
    left.channelId === right.channelId &&
    (left.messageId ?? '') === (right.messageId ?? '') &&
    (left.threadId ?? '') === (right.threadId ?? '')
  );
}

function toCompleted(
  state: PendingNotificationOpen,
  outcome: NotificationOpenOutcome,
  endedAt: number,
): CompletedNotificationOpen {
  return {
    durationMs: Math.max(0, Math.round(endedAt - state.baselineUptimeMs)),
    outcome,
    surface: state.surface,
    appState: state.appState,
    nativeAnchor: state.nativeAnchor,
    idealPath: state.idealPath,
    realPath: state.realPath,
    pathMatched: state.idealPath === state.realPath,
    chatSkeletonShown: state.chatSkeletonShown,
    messageHighlighted: state.messageHighlighted,
    channelId: state.target.channelId,
    messageId: state.target.messageId ?? null,
    threadId: state.target.threadId ?? null,
  };
}

function notifyCompleted(completed: CompletedNotificationOpen): void {
  for (const listener of completionListeners) {
    try {
      listener(completed);
    } catch {
      // Completion listeners must never break the state machine.
    }
  }
}

function completeAt(
  outcome: NotificationOpenOutcome,
  atUptimeMs: number,
): CompletedNotificationOpen | null {
  if (pending === null || pending.completed) {
    return null;
  }

  pending.completed = true;
  clearTimers();
  const completed = toCompleted(pending, outcome, atUptimeMs);
  pending = null;
  notifyCompleted(completed);
  return completed;
}

function matchesJourney(id?: number): boolean {
  return pending !== null && !pending.completed && (id === undefined || pending.journeyId === id);
}

function scheduleJourneyTimeout(state: PendingNotificationOpen): void {
  const id = state.journeyId;
  const endsAt = state.baselineUptimeMs + NOTIFICATION_OPEN_JOURNEY_TIMEOUT_MS;
  journeyTimer = scheduler.schedule(() => {
    journeyTimer = null;
    if (!matchesJourney(id)) {
      return;
    }
    completeAt('highlight_timeout', endsAt);
  }, NOTIFICATION_OPEN_JOURNEY_TIMEOUT_MS);
}

function scheduleSkeletonTimeout(state: PendingNotificationOpen): void {
  const startedAt = state.times.chatSkeletonShown;
  if (startedAt === null) {
    return;
  }

  const id = state.journeyId;
  skeletonTimer?.cancel();
  skeletonTimer = scheduler.schedule(() => {
    skeletonTimer = null;
    if (!matchesJourney(id)) {
      return;
    }
    completeAt('skeleton_timeout', startedAt + NOTIFICATION_OPEN_SKELETON_TIMEOUT_MS);
  }, NOTIFICATION_OPEN_SKELETON_TIMEOUT_MS);
}

function scheduleHighlightTimeout(state: PendingNotificationOpen): void {
  const startedAt = state.times.listReady;
  if (startedAt === null || !state.target.messageId) {
    return;
  }

  const id = state.journeyId;
  highlightTimer?.cancel();
  highlightTimer = scheduler.schedule(() => {
    highlightTimer = null;
    if (!matchesJourney(id)) {
      return;
    }
    completeAt('highlight_timeout', startedAt + NOTIFICATION_OPEN_HIGHLIGHT_TIMEOUT_MS);
  }, NOTIFICATION_OPEN_HIGHLIGHT_TIMEOUT_MS);
}

export function resetNotificationOpen(): void {
  clearTimers();
  pending = null;
  journeyId = 0;
  bufferedMarks = [];
  scheduler = defaultScheduler;
  completionListeners.clear();
  journeyListeners.clear();
}

export function bufferNotificationOpenMark(mark: BufferedNotificationOpenMark): void {
  bufferedMarks = [...bufferedMarks, mark].slice(-20);
}

function matchesBufferedMark(
  mark: BufferedNotificationOpenMark,
  target: NotificationOpenTarget,
): boolean {
  if (mark.channelId !== undefined && mark.channelId !== target.channelId) {
    return false;
  }

  if (
    mark.messageId !== undefined &&
    target.messageId !== undefined &&
    mark.messageId !== target.messageId
  ) {
    return false;
  }

  return true;
}

function applyBufferedMark(mark: BufferedNotificationOpenMark): CompletedNotificationOpen | null {
  if (mark.kind === 'skeleton') {
    return markNotificationChatSkeletonShown(mark.atUptimeMs);
  }

  if (mark.kind === 'list_ready') {
    return markNotificationPhase('list_ready', mark.atUptimeMs);
  }

  return markNotificationMessageHighlighted(mark.atUptimeMs);
}

function consumeBufferedMarks(nowUptimeMs: number): CompletedNotificationOpen | null {
  const remaining: BufferedNotificationOpenMark[] = [];
  let completed: CompletedNotificationOpen | null = null;

  const ordered = [...bufferedMarks].sort((left, right) => left.atUptimeMs - right.atUptimeMs);
  bufferedMarks = [];

  for (const mark of ordered) {
    if (completed !== null) {
      remaining.push(mark);
      continue;
    }

    if (nowUptimeMs - mark.atUptimeMs > NOTIFICATION_OPEN_MARK_BUFFER_TTL_MS) {
      continue;
    }

    if (pending === null || pending.completed || !matchesBufferedMark(mark, pending.target)) {
      remaining.push(mark);
      continue;
    }

    completed = applyBufferedMark(mark);
  }

  bufferedMarks =
    completed === null
      ? remaining
      : remaining.filter(
          mark => mark.channelId !== undefined && mark.channelId !== completed.channelId,
        );
  return completed;
}

export function beginNotificationOpen(
  input: BeginNotificationOpenInput,
): CompletedNotificationOpen | null {
  if (pending !== null && !pending.completed && sameTarget(pending.target, input.target)) {
    return null;
  }

  let superseded: CompletedNotificationOpen | null = null;
  if (pending !== null && !pending.completed) {
    superseded = completeAt('abandoned', input.already?.nowUptimeMs ?? input.baselineUptimeMs);
  }

  const state: PendingNotificationOpen = {
    baselineUptimeMs: input.baselineUptimeMs,
    nativeAnchor: input.nativeAnchor,
    appState: input.appState,
    surface: input.surface,
    target: input.target,
    journeyId: journeyId + 1,
    idealPath: resolveIdealPath(input.surface),
    realPath: '',
    times: {
      splashHidden: null,
      dmsVisible: null,
      chatVisible: null,
      chatSkeletonShown: null,
      listReady: null,
      messageHighlighted: null,
    },
    chatSkeletonShown: false,
    listReady: false,
    messageHighlighted: false,
    completed: false,
  };

  pending = state;
  bumpJourney();
  scheduleJourneyTimeout(state);

  const already = input.already;
  if (already?.splashHidden === true) {
    markNotificationPhase('splash_hidden', already.nowUptimeMs);
  }
  if (already?.dmsVisible === true) {
    markNotificationPhase('dms_visible', already.nowUptimeMs);
  }
  if (already?.chatVisible === true) {
    markNotificationPhase('chat_visible', already.nowUptimeMs);
  }

  const completedFromBuffer = consumeBufferedMarks(already?.nowUptimeMs ?? input.baselineUptimeMs);
  return superseded ?? completedFromBuffer;
}

export function markNotificationPhase(
  phase: 'splash_hidden' | 'dms_visible' | 'chat_visible' | 'list_ready',
  atUptimeMs: number,
): CompletedNotificationOpen | null {
  if (pending === null || pending.completed) {
    return null;
  }

  if (phase === 'splash_hidden' && pending.times.splashHidden === null) {
    pending.times.splashHidden = atUptimeMs;
  }

  if (phase === 'dms_visible' && pending.times.dmsVisible === null) {
    pending.times.dmsVisible = atUptimeMs;
    pending.realPath = appendPathSegment(
      pending.realPath,
      pathSegmentForPhase('dms_visible', pending.surface),
    );
  }

  if (phase === 'chat_visible' && pending.times.chatVisible === null) {
    pending.times.chatVisible = atUptimeMs;
    pending.realPath = appendPathSegment(
      pending.realPath,
      pathSegmentForPhase('chat_visible', pending.surface),
    );
  }

  if (phase === 'list_ready' && !pending.listReady) {
    pending.listReady = true;
    pending.times.listReady = atUptimeMs;
    skeletonTimer?.cancel();
    skeletonTimer = null;

    if (!pending.target.messageId) {
      return completeAt('highlighted', atUptimeMs);
    }

    scheduleHighlightTimeout(pending);
  }

  return null;
}

export function markNotificationChatSkeletonShown(
  atUptimeMs: number,
): CompletedNotificationOpen | null {
  if (pending === null || pending.completed || pending.chatSkeletonShown) {
    return null;
  }

  pending.chatSkeletonShown = true;
  pending.times.chatSkeletonShown = atUptimeMs;
  scheduleSkeletonTimeout(pending);
  return null;
}

export function markNotificationMessageHighlighted(
  atUptimeMs: number,
): CompletedNotificationOpen | null {
  if (pending === null || pending.completed || pending.messageHighlighted) {
    return null;
  }

  pending.messageHighlighted = true;
  pending.times.messageHighlighted = atUptimeMs;
  return completeAt('highlighted', atUptimeMs);
}

export function abandonNotificationOpen(atUptimeMs: number): CompletedNotificationOpen | null {
  return completeAt('abandoned', atUptimeMs);
}

export function getPendingNotificationOpenTarget(): NotificationOpenTarget | null {
  if (pending === null || pending.completed) {
    return null;
  }

  return pending.target;
}
