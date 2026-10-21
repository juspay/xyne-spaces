import type { NativeAnchor } from '../startup/coldStart';
import type { NotificationOpenSurface } from './notificationPath';

export const NOTIFICATION_HEADER_RESOLVE_TIMEOUT_MS = 60_000;

export type NotificationHeaderResolveOutcome = 'resolved' | 'missing' | 'timeout' | 'abandoned';

export type NotificationHeaderTitleStatus =
  'pending' | 'resolved' | 'unknown' | 'unknown_user' | 'group_fallback';

export type NotificationHeaderResolveTarget = Readonly<{
  channelId: string;
  messageId?: string;
  threadId?: string;
}>;

export type CompletedNotificationHeaderResolve = Readonly<{
  durationMs: number;
  outcome: NotificationHeaderResolveOutcome;
  headerStatus: NotificationHeaderTitleStatus;
  channelPresentInVisibleChannels: boolean;
  visibleChannelListPublished: boolean;
  userDirectoryPublished: boolean;
  scopeType: string | null;
  surface: NotificationOpenSurface;
  nativeAnchor: NativeAnchor;
  channelId: string;
  messageId: string | null;
  threadId: string | null;
  notificationId: string | null;
  notificationType: string | null;
  metadata: string | null;
}>;

export type BeginNotificationHeaderResolveInput = Readonly<{
  target: NotificationHeaderResolveTarget;
  surface: NotificationOpenSurface;
  baselineUptimeMs: number;
  nativeAnchor: NativeAnchor;
  notificationId?: string | null;
  notificationType?: string | null;
  metadata?: string | null;
}>;

export type ObserveNotificationHeaderResolveInput = Readonly<{
  channelId: string;
  headerStatus: NotificationHeaderTitleStatus;
  channelPresentInVisibleChannels: boolean;
  visibleChannelListPublished: boolean;
  userDirectoryPublished: boolean;
  scopeType: string | null;
  atUptimeMs: number;
}>;

export interface NotificationHeaderResolveTimeoutScheduler {
  schedule(callback: () => void, durationMs: number): { cancel(): void };
}

type PendingNotificationHeaderResolve = {
  baselineUptimeMs: number;
  nativeAnchor: NativeAnchor;
  surface: NotificationOpenSurface;
  target: NotificationHeaderResolveTarget;
  notificationId: string | null;
  notificationType: string | null;
  metadata: string | null;
  headerStatus: NotificationHeaderTitleStatus;
  channelPresentInVisibleChannels: boolean;
  visibleChannelListPublished: boolean;
  userDirectoryPublished: boolean;
  scopeType: string | null;
  timeoutStarted: boolean;
  completed: boolean;
};

type CancelableTimeout = {
  cancel(): void;
};

const defaultScheduler: NotificationHeaderResolveTimeoutScheduler = {
  schedule(callback, durationMs) {
    const timeoutHandle = setTimeout(callback, durationMs);
    return {
      cancel: (): void => {
        clearTimeout(timeoutHandle);
      },
    };
  },
};

let scheduler: NotificationHeaderResolveTimeoutScheduler = defaultScheduler;
let pending: PendingNotificationHeaderResolve | null = null;
const completionListeners = new Set<(completed: CompletedNotificationHeaderResolve) => void>();
const snapshotListeners = new Set<() => void>();
let headerTimer: CancelableTimeout | null = null;

export function configureNotificationHeaderResolveScheduler(
  nextScheduler: NotificationHeaderResolveTimeoutScheduler,
): void {
  scheduler = nextScheduler;
}

function clearTimer(): void {
  headerTimer?.cancel();
  headerTimer = null;
}

function sameTarget(
  left: NotificationHeaderResolveTarget,
  right: NotificationHeaderResolveTarget,
): boolean {
  return (
    left.channelId === right.channelId &&
    (left.messageId ?? '') === (right.messageId ?? '') &&
    (left.threadId ?? '') === (right.threadId ?? '')
  );
}

function toCompleted(
  state: PendingNotificationHeaderResolve,
  outcome: NotificationHeaderResolveOutcome,
  endedAt: number,
): CompletedNotificationHeaderResolve {
  return {
    durationMs: Math.max(0, Math.round(endedAt - state.baselineUptimeMs)),
    outcome,
    headerStatus: state.headerStatus,
    channelPresentInVisibleChannels: state.channelPresentInVisibleChannels,
    visibleChannelListPublished: state.visibleChannelListPublished,
    userDirectoryPublished: state.userDirectoryPublished,
    scopeType: state.scopeType,
    surface: state.surface,
    nativeAnchor: state.nativeAnchor,
    channelId: state.target.channelId,
    messageId: state.target.messageId ?? null,
    threadId: state.target.threadId ?? null,
    notificationId: state.notificationId,
    notificationType: state.notificationType,
    metadata: state.metadata,
  };
}

function notifySnapshot(): void {
  for (const listener of snapshotListeners) {
    try {
      listener();
    } catch {
      // Snapshot listeners must never break the header render.
    }
  }
}

function notifyCompleted(completed: CompletedNotificationHeaderResolve): void {
  for (const listener of completionListeners) {
    try {
      listener(completed);
    } catch {
      // Completion listeners must never break the header render.
    }
  }
}

function completeAt(
  outcome: NotificationHeaderResolveOutcome,
  atUptimeMs: number,
): CompletedNotificationHeaderResolve | null {
  if (pending === null || pending.completed) {
    return null;
  }

  pending.completed = true;
  clearTimer();
  const completed = toCompleted(pending, outcome, atUptimeMs);
  pending = null;
  notifySnapshot();
  notifyCompleted(completed);
  return completed;
}

function outcomeForStatus(
  status: NotificationHeaderTitleStatus,
): NotificationHeaderResolveOutcome | null {
  if (status === 'resolved' || status === 'group_fallback') {
    return 'resolved';
  }

  if (status === 'unknown' || status === 'unknown_user') {
    return 'missing';
  }

  return null;
}

function scheduleTimeout(state: PendingNotificationHeaderResolve, startedAt: number): void {
  if (state.timeoutStarted) {
    return;
  }

  state.timeoutStarted = true;
  headerTimer?.cancel();
  headerTimer = scheduler.schedule(() => {
    headerTimer = null;
    if (pending === null || pending.completed) {
      return;
    }
    completeAt('timeout', startedAt + NOTIFICATION_HEADER_RESOLVE_TIMEOUT_MS);
  }, NOTIFICATION_HEADER_RESOLVE_TIMEOUT_MS);
}

export function subscribeNotificationHeaderResolveCompleted(
  listener: (completed: CompletedNotificationHeaderResolve) => void,
): () => void {
  completionListeners.add(listener);
  return (): void => {
    completionListeners.delete(listener);
  };
}

export function subscribeNotificationHeaderResolveSnapshot(listener: () => void): () => void {
  snapshotListeners.add(listener);
  return (): void => {
    snapshotListeners.delete(listener);
  };
}

export function getNotificationHeaderResolveChannelId(): string | null {
  if (pending === null || pending.completed) {
    return null;
  }

  return pending.target.channelId;
}

export function resetNotificationHeaderResolve(): void {
  clearTimer();
  pending = null;
  scheduler = defaultScheduler;
  completionListeners.clear();
  snapshotListeners.clear();
}

export function beginNotificationHeaderResolve(
  input: BeginNotificationHeaderResolveInput,
): CompletedNotificationHeaderResolve | null {
  if (pending !== null && !pending.completed && sameTarget(pending.target, input.target)) {
    return null;
  }

  let superseded: CompletedNotificationHeaderResolve | null = null;
  if (pending !== null && !pending.completed) {
    superseded = completeAt('abandoned', input.baselineUptimeMs);
  }

  pending = {
    baselineUptimeMs: input.baselineUptimeMs,
    nativeAnchor: input.nativeAnchor,
    surface: input.surface,
    target: input.target,
    notificationId: input.notificationId ?? null,
    notificationType: input.notificationType ?? null,
    metadata: input.metadata ?? null,
    headerStatus: 'pending',
    channelPresentInVisibleChannels: false,
    visibleChannelListPublished: false,
    userDirectoryPublished: false,
    scopeType: null,
    timeoutStarted: false,
    completed: false,
  };
  notifySnapshot();

  return superseded;
}

export function observeNotificationHeaderResolve(
  input: ObserveNotificationHeaderResolveInput,
): CompletedNotificationHeaderResolve | null {
  if (pending === null || pending.completed) {
    return null;
  }

  if (input.channelId !== pending.target.channelId) {
    return null;
  }

  pending.headerStatus = input.headerStatus;
  pending.channelPresentInVisibleChannels = input.channelPresentInVisibleChannels;
  pending.visibleChannelListPublished = input.visibleChannelListPublished;
  pending.userDirectoryPublished = input.userDirectoryPublished;
  pending.scopeType = input.scopeType;

  const outcome = outcomeForStatus(input.headerStatus);
  if (outcome !== null) {
    return completeAt(outcome, input.atUptimeMs);
  }

  scheduleTimeout(pending, input.atUptimeMs);
  return null;
}

export function abandonNotificationHeaderResolve(
  atUptimeMs: number,
): CompletedNotificationHeaderResolve | null {
  return completeAt('abandoned', atUptimeMs);
}

export function getPendingNotificationHeaderResolveTarget(): NotificationHeaderResolveTarget | null {
  if (pending === null || pending.completed) {
    return null;
  }

  return pending.target;
}
