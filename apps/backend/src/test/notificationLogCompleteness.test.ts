import { classifyCompleteness } from '@/notification-service/notificationLogCompleteness';
import type { NotificationLogEvent, NotificationLogEventType } from '@prisma/client';

// Test the PURE classifier directly — no DB, no metrics, no env.
const svc = { classify: classifyCompleteness };
const CLASSIFY_OPTS = { emitMetrics: false as const };

let seq = 0;
/** Build a minimal NotificationLogEvent for the classifier under test. */
function ev(
  eventType: NotificationLogEventType,
  overrides: Partial<NotificationLogEvent> = {},
): NotificationLogEvent {
  seq += 1;
  return {
    id: `evt_${seq}`,
    workspaceId: 'ws_1',
    correlationId: 'corr_1',
    notificationId: overrides.notificationId ?? null,
    eventType,
    channel: 'MOBILE_PUSH',
    status: 'SUCCESS',
    provider: 'FCM',
    attempt: 0,
    reasonCode: null,
    metadata: null,
    idempotencyKey: null,
    occurredAt: overrides.occurredAt ?? new Date(1_000 + seq * 1000),
    createdAt: new Date(),
    ...overrides,
  } as NotificationLogEvent;
}

describe('NotificationLogCompletenessService.classify (SDLCT-0002)', () => {
  it('returns UNKNOWN for an empty event list', () => {
    const r = svc.classify([], CLASSIFY_OPTS);
    expect(r.status).toBe('UNKNOWN');
    expect(r.eventCount).toBe(0);
    expect(r.missingStages).toEqual([]);
  });

  it('classifies a full happy-path pipeline (with notification row) as COMPLETE', () => {
    const events = [
      ev('NOTIFICATION_CREATED', { notificationId: 'notif_1' }),
      ev('DELIVERY_PLANNED'),
      ev('QUEUE_ENQUEUED'),
      ev('QUEUE_PROCESSING_STARTED'),
      ev('PROVIDER_REQUEST_STARTED'),
      ev('PROVIDER_ACCEPTED'),
    ];
    const r = svc.classify(events, CLASSIFY_OPTS);
    expect(r.status).toBe('COMPLETE');
    expect(r.missingStages).toEqual([]);
    expect(r.notificationId).toBe('notif_1');
    expect(r.latencyMs).toBeGreaterThan(0);
  });

  it('does not require NOTIFICATION_CREATED for silent pushes (no notification row)', () => {
    const events = [
      ev('DELIVERY_PLANNED'),
      ev('QUEUE_ENQUEUED'),
      ev('QUEUE_PROCESSING_STARTED'),
      ev('PROVIDER_REQUEST_STARTED'),
      ev('PROVIDER_ACCEPTED'),
    ];
    const r = svc.classify(events, CLASSIFY_OPTS);
    expect(r.status).toBe('COMPLETE');
    expect(r.missingStages).toEqual([]);
  });

  it('marks a terminal provider rejection with no success as FAILED and surfaces reasonCode', () => {
    const events = [
      ev('DELIVERY_PLANNED'),
      ev('QUEUE_ENQUEUED'),
      ev('QUEUE_PROCESSING_STARTED'),
      ev('PROVIDER_REQUEST_STARTED'),
      ev('PROVIDER_REJECTED', { status: 'FAILED', reasonCode: 'UNREGISTERED' }),
      ev('DELIVERY_FAILED_FINAL', { status: 'FAILED', reasonCode: 'UNREGISTERED' }),
    ];
    const r = svc.classify(events, CLASSIFY_OPTS);
    expect(r.status).toBe('FAILED');
    expect(r.reasonCode).toBe('UNREGISTERED');
  });

  it('treats retry-then-success as COMPLETE (success overrides an earlier rejection)', () => {
    const events = [
      ev('DELIVERY_PLANNED'),
      ev('QUEUE_ENQUEUED'),
      ev('QUEUE_PROCESSING_STARTED'),
      ev('PROVIDER_REQUEST_STARTED'),
      ev('PROVIDER_REJECTED', { status: 'FAILED', reasonCode: 'INTERNAL' }),
      ev('DELIVERY_RETRY_SCHEDULED', { status: 'RETRYING' }),
      ev('PROVIDER_ACCEPTED'),
    ];
    const r = svc.classify(events, CLASSIFY_OPTS);
    expect(r.status).toBe('COMPLETE');
  });

  it('flags an unfinished pipeline within the grace window as INCOMPLETE + withinGracePeriod', () => {
    const now = 100_000;
    const events = [
      ev('DELIVERY_PLANNED', { occurredAt: new Date(now - 1_000) }),
      ev('QUEUE_ENQUEUED', { occurredAt: new Date(now - 500) }),
    ];
    const r = svc.classify(events, {
      ...CLASSIFY_OPTS,
      nowMs: now,
      providerHandoffTimeoutMs: 60_000,
    });
    expect(r.status).toBe('INCOMPLETE');
    expect(r.withinGracePeriod).toBe(true);
    expect(r.missingStages).toEqual(
      expect.arrayContaining(['QUEUE_PROCESSING_STARTED', 'PROVIDER_REQUEST_STARTED']),
    );
  });

  it('flags a stalled pipeline past the grace window as INCOMPLETE + not withinGracePeriod', () => {
    const now = 100_000;
    const events = [
      ev('DELIVERY_PLANNED', { occurredAt: new Date(now - 600_000) }),
      ev('QUEUE_ENQUEUED', { occurredAt: new Date(now - 590_000) }),
    ];
    const r = svc.classify(events, {
      ...CLASSIFY_OPTS,
      nowMs: now,
      providerHandoffTimeoutMs: 60_000,
    });
    expect(r.status).toBe('INCOMPLETE');
    expect(r.withinGracePeriod).toBe(false);
  });

  it('sorts unordered events by occurredAt before classifying', () => {
    const now = 50_000;
    const events = [
      ev('PROVIDER_ACCEPTED', { occurredAt: new Date(now + 5) }),
      ev('DELIVERY_PLANNED', { occurredAt: new Date(now + 1) }),
      ev('PROVIDER_REQUEST_STARTED', { occurredAt: new Date(now + 4) }),
      ev('QUEUE_ENQUEUED', { occurredAt: new Date(now + 2) }),
      ev('QUEUE_PROCESSING_STARTED', { occurredAt: new Date(now + 3) }),
    ];
    const r = svc.classify(events, CLASSIFY_OPTS);
    expect(r.status).toBe('COMPLETE');
    expect(r.firstEventAt?.getTime()).toBe(now + 1);
    expect(r.lastEventAt?.getTime()).toBe(now + 5);
  });
});
