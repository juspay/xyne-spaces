import { surfaceFromTarget } from '../notification/notificationPath';

export const ACTIVITY_OPEN_SKELETON_TIMEOUT_MS = 8_000;
export const ACTIVITY_OPEN_HIGHLIGHT_TIMEOUT_MS = 8_000;
export const ACTIVITY_OPEN_JOURNEY_TIMEOUT_MS = 20_000;

export type ActivityOpenSurface = 'channel' | 'thread';

export type ActivityOpenOutcome =
  'highlighted' | 'skeleton_timeout' | 'highlight_timeout' | 'abandoned';

export type ActivityOpenTarget = Readonly<{
  channelId: string;
  messageId?: string;
  threadId?: string;
}>;

export type CompletedActivityOpen = Readonly<{
  durationMs: number;
  outcome: ActivityOpenOutcome;
  surface: ActivityOpenSurface;
  chatSkeletonShown: boolean;
  messageHighlighted: boolean;
  channelId: string;
  messageId: string | null;
  threadId: string | null;
}>;

export type BeginActivityOpenInput = Readonly<{
  target: ActivityOpenTarget;
  nowMs?: number;
}>;

export interface ActivityOpenTimeoutScheduler {
  schedule(callback: () => void, durationMs: number): { cancel(): void };
}

const defaultScheduler: ActivityOpenTimeoutScheduler = {
  schedule(callback, durationMs) {
    const handle = setTimeout(callback, durationMs);
    return { cancel: () => clearTimeout(handle) };
  },
};

type PendingActivityOpen = {
  baselineMs: number;
  surface: ActivityOpenSurface;
  target: ActivityOpenTarget;
  journeyId: number;
  chatSkeletonShown: boolean;
  listReady: boolean;
  messageHighlighted: boolean;
  skeletonShownAtMs: number | null;
  listReadyAtMs: number | null;
  completed: boolean;
};

type CancelableTimeout = { cancel(): void };

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

let scheduler: ActivityOpenTimeoutScheduler = defaultScheduler;
let pending: PendingActivityOpen | null = null;
let journeyId = 0;

const journeyListeners = new Set<() => void>();
const completionListeners = new Set<(completed: CompletedActivityOpen) => void>();

let skeletonTimer: CancelableTimeout | null = null;
let highlightTimer: CancelableTimeout | null = null;
let journeyTimer: CancelableTimeout | null = null;

export function configureActivityOpenScheduler(next: ActivityOpenTimeoutScheduler): void {
  scheduler = next;
}

export function getActivityOpenJourneyId(): number {
  return journeyId;
}

export function subscribeActivityOpenJourney(listener: () => void): () => void {
  journeyListeners.add(listener);
  return () => journeyListeners.delete(listener);
}

export function subscribeActivityOpenCompleted(
  listener: (completed: CompletedActivityOpen) => void,
): () => void {
  completionListeners.add(listener);
  return () => completionListeners.delete(listener);
}

function bumpJourney(): void {
  journeyId += 1;
  for (const l of journeyListeners) l();
}

function clearTimers(): void {
  skeletonTimer?.cancel();
  highlightTimer?.cancel();
  journeyTimer?.cancel();
  skeletonTimer = null;
  highlightTimer = null;
  journeyTimer = null;
}

function sameTarget(a: ActivityOpenTarget, b: ActivityOpenTarget): boolean {
  return (
    a.channelId === b.channelId &&
    (a.messageId ?? '') === (b.messageId ?? '') &&
    (a.threadId ?? '') === (b.threadId ?? '')
  );
}

function toCompleted(
  state: PendingActivityOpen,
  outcome: ActivityOpenOutcome,
  endedAt: number,
): CompletedActivityOpen {
  return {
    durationMs: Math.max(0, Math.round(endedAt - state.baselineMs)),
    outcome,
    surface: state.surface,
    chatSkeletonShown: state.chatSkeletonShown,
    messageHighlighted: state.messageHighlighted,
    channelId: state.target.channelId,
    messageId: state.target.messageId ?? null,
    threadId: state.target.threadId ?? null,
  };
}

function notifyCompleted(completed: CompletedActivityOpen): void {
  for (const l of completionListeners) {
    try {
      l(completed);
    } catch {
      // Completion listeners must never break chat rendering.
    }
  }
}

function completeAt(outcome: ActivityOpenOutcome, atMs: number): CompletedActivityOpen | null {
  if (pending === null || pending.completed) return null;
  pending.completed = true;
  clearTimers();
  const completed = toCompleted(pending, outcome, atMs);
  pending = null;
  notifyCompleted(completed);
  return completed;
}

function matchesJourney(id?: number): boolean {
  return pending !== null && !pending.completed && (id === undefined || pending.journeyId === id);
}

function scheduleJourneyTimeout(state: PendingActivityOpen): void {
  const id = state.journeyId;
  const endsAt = state.baselineMs + ACTIVITY_OPEN_JOURNEY_TIMEOUT_MS;
  journeyTimer = scheduler.schedule(() => {
    journeyTimer = null;
    if (!matchesJourney(id)) return;
    completeAt('highlight_timeout', endsAt);
  }, ACTIVITY_OPEN_JOURNEY_TIMEOUT_MS);
}

function scheduleSkeletonTimeout(state: PendingActivityOpen): void {
  const startedAt = state.skeletonShownAtMs;
  if (startedAt === null) return;
  const id = state.journeyId;
  skeletonTimer?.cancel();
  skeletonTimer = scheduler.schedule(() => {
    skeletonTimer = null;
    if (!matchesJourney(id)) return;
    completeAt('skeleton_timeout', startedAt + ACTIVITY_OPEN_SKELETON_TIMEOUT_MS);
  }, ACTIVITY_OPEN_SKELETON_TIMEOUT_MS);
}

function scheduleHighlightTimeout(state: PendingActivityOpen): void {
  const startedAt = state.listReadyAtMs;
  if (startedAt === null || !state.target.messageId) return;
  const id = state.journeyId;
  highlightTimer?.cancel();
  highlightTimer = scheduler.schedule(() => {
    highlightTimer = null;
    if (!matchesJourney(id)) return;
    completeAt('highlight_timeout', startedAt + ACTIVITY_OPEN_HIGHLIGHT_TIMEOUT_MS);
  }, ACTIVITY_OPEN_HIGHLIGHT_TIMEOUT_MS);
}

export function resetActivityOpen(): void {
  clearTimers();
  pending = null;
  journeyId = 0;
  scheduler = defaultScheduler;
  completionListeners.clear();
  journeyListeners.clear();
}

export function beginActivityOpen(input: BeginActivityOpenInput): CompletedActivityOpen | null {
  const baseline = input.nowMs ?? nowMs();

  if (pending !== null && !pending.completed && sameTarget(pending.target, input.target)) {
    return null;
  }

  let superseded: CompletedActivityOpen | null = null;
  if (pending !== null && !pending.completed) {
    superseded = completeAt('abandoned', baseline);
  }

  const state: PendingActivityOpen = {
    baselineMs: baseline,
    surface: surfaceFromTarget(input.target),
    target: input.target,
    journeyId: journeyId + 1,
    chatSkeletonShown: false,
    listReady: false,
    messageHighlighted: false,
    skeletonShownAtMs: null,
    listReadyAtMs: null,
    completed: false,
  };

  pending = state;
  bumpJourney();
  scheduleJourneyTimeout(state);
  return superseded;
}

export function markActivityChatSkeletonShown(atMs: number): CompletedActivityOpen | null {
  if (pending === null || pending.completed || pending.chatSkeletonShown) return null;
  pending.chatSkeletonShown = true;
  pending.skeletonShownAtMs = atMs;
  scheduleSkeletonTimeout(pending);
  return null;
}

export function markActivityListReady(atMs: number): CompletedActivityOpen | null {
  if (pending === null || pending.completed || pending.listReady) return null;
  pending.listReady = true;
  pending.listReadyAtMs = atMs;
  skeletonTimer?.cancel();
  skeletonTimer = null;

  // Activity rows without a messageId (e.g. deleted / conversation-only)
  // still count as "opened" when the list becomes ready.
  if (!pending.target.messageId) {
    return completeAt('highlighted', atMs);
  }

  scheduleHighlightTimeout(pending);
  return null;
}

export function markActivityMessageHighlighted(atMs: number): CompletedActivityOpen | null {
  if (pending === null || pending.completed || pending.messageHighlighted) return null;
  pending.messageHighlighted = true;
  return completeAt('highlighted', atMs);
}

export function abandonActivityOpen(atMs: number): CompletedActivityOpen | null {
  return completeAt('abandoned', atMs);
}

export function getPendingActivityOpenTarget(): ActivityOpenTarget | null {
  if (pending === null || pending.completed) return null;
  return pending.target;
}
