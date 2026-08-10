/**
 * Pure completeness classifier for the notification pipeline (SDLCT-0002).
 *
 * This module is intentionally dependency-light: it imports ONLY Prisma types
 * (erased at compile time) so `classifyCompleteness` can be unit tested without
 * a database, env validation, or the otel/metrics stack. The workspace-scoped
 * repository wrappers and metric emission live in
 * `notificationLogCompletenessService.ts`, which composes this function.
 */
import type {
  NotificationLogEvent,
  NotificationLogEventType,
} from '@prisma/client';

export type CompletenessStatus = 'COMPLETE' | 'INCOMPLETE' | 'FAILED' | 'UNKNOWN';

export interface CompletenessResult {
  correlationId: string | null;
  notificationId: string | null;
  status: CompletenessStatus;
  /** Required stages that were never observed. */
  missingStages: NotificationLogEventType[];
  /** True when the pipeline hasn't finished but is still inside its grace window. */
  withinGracePeriod: boolean;
  /** Terminal failure reason, when status is FAILED. */
  reasonCode: string | null;
  /** ms between the first and last observed event (null if <2 events). */
  latencyMs: number | null;
  eventCount: number;
  firstEventAt: Date | null;
  lastEventAt: Date | null;
}

/**
 * Stages that every mobile-push delivery is expected to pass through, in order.
 * NOTIFICATION_CREATED is only required when at least one event carries a
 * notificationId (silent pushes have no persisted Notification row).
 */
export const REQUIRED_MOBILE_PUSH_STAGES: NotificationLogEventType[] = [
  'DELIVERY_PLANNED',
  'QUEUE_ENQUEUED',
  'QUEUE_PROCESSING_STARTED',
  'PROVIDER_REQUEST_STARTED',
];

export const TERMINAL_SUCCESS: NotificationLogEventType[] = [
  'PROVIDER_ACCEPTED',
  'DELIVERY_SKIPPED',
];
export const TERMINAL_FAILURE: NotificationLogEventType[] = [
  'PROVIDER_REJECTED',
  'DELIVERY_FAILED_FINAL',
];

/** Default grace window before a still-unfinished pipeline is called INCOMPLETE. */
export const DEFAULT_PROVIDER_HANDOFF_TIMEOUT_MS = 2 * 60 * 1000;

export interface ClassifyOptions {
  nowMs?: number;
  providerHandoffTimeoutMs?: number;
  /** Service-layer flag; ignored by the pure classifier, honored by the service wrapper. */
  emitMetrics?: boolean;
}

/**
 * Classify an ordered (or unordered) set of lifecycle events into
 * COMPLETE / INCOMPLETE / FAILED / UNKNOWN. Pure function of the events plus a
 * clock — no side effects.
 */
export function classifyCompleteness(
  events: NotificationLogEvent[],
  options: ClassifyOptions = {},
): CompletenessResult {
  const nowMs = options.nowMs ?? Date.now();
  const timeoutMs =
    options.providerHandoffTimeoutMs ?? DEFAULT_PROVIDER_HANDOFF_TIMEOUT_MS;

  if (!events || events.length === 0) {
    return {
      correlationId: null,
      notificationId: null,
      status: 'UNKNOWN',
      missingStages: [],
      withinGracePeriod: false,
      reasonCode: null,
      latencyMs: null,
      eventCount: 0,
      firstEventAt: null,
      lastEventAt: null,
    };
  }

  const sorted = [...events].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const seen = new Set<NotificationLogEventType>(sorted.map((e) => e.eventType));

  const correlationId = first.correlationId ?? null;
  const notificationId =
    sorted.find((e) => e.notificationId)?.notificationId ?? null;
  const latencyMs =
    sorted.length >= 2
      ? last.occurredAt.getTime() - first.occurredAt.getTime()
      : null;

  // Required set: base stages, plus NOTIFICATION_CREATED only if this delivery
  // had a persisted notification row.
  const required = [...REQUIRED_MOBILE_PUSH_STAGES];
  if (notificationId) required.unshift('NOTIFICATION_CREATED');

  const missingStages = required.filter((stage) => !seen.has(stage));
  const hasTerminalSuccess = TERMINAL_SUCCESS.some((s) => seen.has(s));
  const hasTerminalFailure = TERMINAL_FAILURE.some((s) => seen.has(s));

  let status: CompletenessStatus;
  let withinGracePeriod = false;
  let reasonCode: string | null = null;

  if (hasTerminalFailure && !hasTerminalSuccess) {
    status = 'FAILED';
    const failEvent = [...sorted]
      .reverse()
      .find((e) => TERMINAL_FAILURE.includes(e.eventType));
    reasonCode = failEvent?.reasonCode ?? null;
  } else if (missingStages.length === 0 && (hasTerminalSuccess || hasTerminalFailure)) {
    status = 'COMPLETE';
  } else {
    // Not done. Inside the grace window we still call it INCOMPLETE but flag
    // that it may yet finish, so consumers don't alert prematurely.
    withinGracePeriod = nowMs - last.occurredAt.getTime() <= timeoutMs;
    status = 'INCOMPLETE';
  }

  return {
    correlationId,
    notificationId,
    status,
    missingStages,
    withinGracePeriod,
    reasonCode,
    latencyMs,
    eventCount: sorted.length,
    firstEventAt: first.occurredAt,
    lastEventAt: last.occurredAt,
  };
}
