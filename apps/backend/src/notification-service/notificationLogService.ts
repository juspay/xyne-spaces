import type {
  NotificationLogEventType,
  NotificationLogChannel,
  NotificationLogProvider,
  NotificationLogStatus,
} from '@prisma/client';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';
import {
  getNotificationLogEvents,
  getNotificationLogWriteFailures,
} from '@/services/otel/notificationMetrics';
import { redactMetadata } from './logging/redactMetadata';

/**
 * Public shape callers use to record a lifecycle transition. Everything except
 * the routing keys is optional. `metadata` is redacted here, so callers may
 * pass raw notification metadata without leaking content.
 */
export interface RecordEventInput {
  workspaceId?: string | null;
  correlationId?: string | null;
  eventType: NotificationLogEventType;
  channel: NotificationLogChannel;
  status: NotificationLogStatus;
  provider?: NotificationLogProvider | null;
  notificationId?: string | null;
  attempt?: number;
  reasonCode?: string | null;
  metadata?: unknown;
  idempotencyKey?: string | null;
  occurredAt?: Date;
}

/**
 * Fail-soft writer for the notification lifecycle audit trail (SDLCT-0002).
 *
 * Design invariants:
 *  - GATED: does nothing unless `config.notificationLog.enabled` is true.
 *  - FAIL-SOFT: every write is wrapped; a logging failure NEVER propagates into
 *    the delivery path. The audit trail is diagnostic, not load-bearing.
 *  - SAFE: metadata is redacted+allowlisted before it touches the DB.
 *  - CHEAP TO CALL: callers `void notificationLogService.record(...)` as
 *    fire-and-forget; missing workspace/correlation ids short-circuit to a
 *    no-op instead of throwing.
 */
class NotificationLogService {
  get enabled(): boolean {
    return config.notificationLog?.enabled === true;
  }

  /** Default idempotency key when a caller doesn't supply one. */
  private buildIdempotencyKey(input: RecordEventInput): string | undefined {
    if (input.idempotencyKey) return input.idempotencyKey;
    if (!input.correlationId) return undefined;
    // One row per (correlation, eventType, attempt) unless a caller overrides.
    return `${input.correlationId}:${input.eventType}:${input.attempt ?? 0}`;
  }

  async record(input: RecordEventInput): Promise<void> {
    if (!this.enabled) return;

    // Routing keys are mandatory for a useful, joinable event. Without them we
    // skip rather than write an orphan row.
    if (!input.workspaceId || !input.correlationId) {
      return;
    }

    try {
      await repositories.notificationLogs.createEvent({
        workspaceId: input.workspaceId,
        correlationId: input.correlationId,
        eventType: input.eventType,
        channel: input.channel,
        status: input.status,
        provider: input.provider ?? null,
        notificationId: input.notificationId ?? null,
        attempt: input.attempt ?? 0,
        reasonCode: input.reasonCode ?? null,
        metadata: redactMetadata(input.metadata) ?? null,
        idempotencyKey: this.buildIdempotencyKey(input) ?? null,
        occurredAt: input.occurredAt ?? new Date(),
      });

      try {
        getNotificationLogEvents().add(1, {
          eventType: input.eventType,
          channel: input.channel,
          status: input.status,
        });
      } catch {
        // metrics are best-effort
      }
    } catch (error) {
      // Swallow: the audit path must never break notification delivery.
      try {
        getNotificationLogWriteFailures().add(1, { eventType: input.eventType });
      } catch {
        /* ignore */
      }
      logger.warn(
        `[NOTIFICATION-LOG] write failed (non-fatal) for correlationId=${input.correlationId} eventType=${input.eventType}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // ---- Convenience recorders for the mobile-push pipeline ------------------

  recordNotificationCreated(
    args: Pick<RecordEventInput, 'workspaceId' | 'correlationId' | 'notificationId' | 'channel' | 'metadata'>,
  ): Promise<void> {
    return this.record({
      ...args,
      eventType: 'NOTIFICATION_CREATED',
      status: 'SUCCESS',
    });
  }

  recordDeliveryPlanned(
    args: Pick<RecordEventInput, 'workspaceId' | 'correlationId' | 'notificationId' | 'channel' | 'provider' | 'metadata'>,
  ): Promise<void> {
    return this.record({
      ...args,
      eventType: 'DELIVERY_PLANNED',
      status: 'STARTED',
    });
  }

  recordQueueEnqueued(
    args: Pick<RecordEventInput, 'workspaceId' | 'correlationId' | 'notificationId' | 'channel' | 'provider' | 'metadata'>,
  ): Promise<void> {
    return this.record({
      ...args,
      eventType: 'QUEUE_ENQUEUED',
      status: 'SUCCESS',
    });
  }

  recordQueueProcessingStarted(
    args: Pick<RecordEventInput, 'workspaceId' | 'correlationId' | 'notificationId' | 'channel' | 'provider' | 'attempt' | 'metadata'>,
  ): Promise<void> {
    return this.record({
      ...args,
      eventType: 'QUEUE_PROCESSING_STARTED',
      status: 'STARTED',
    });
  }

  recordProviderRequestStarted(
    args: Pick<RecordEventInput, 'workspaceId' | 'correlationId' | 'notificationId' | 'channel' | 'provider' | 'attempt' | 'metadata'>,
  ): Promise<void> {
    return this.record({
      ...args,
      eventType: 'PROVIDER_REQUEST_STARTED',
      status: 'STARTED',
    });
  }

  recordProviderAccepted(
    args: Pick<RecordEventInput, 'workspaceId' | 'correlationId' | 'notificationId' | 'channel' | 'provider' | 'attempt' | 'metadata'>,
  ): Promise<void> {
    return this.record({
      ...args,
      eventType: 'PROVIDER_ACCEPTED',
      status: 'SUCCESS',
    });
  }

  recordProviderRejected(
    args: Pick<RecordEventInput, 'workspaceId' | 'correlationId' | 'notificationId' | 'channel' | 'provider' | 'attempt' | 'reasonCode' | 'metadata'>,
  ): Promise<void> {
    return this.record({
      ...args,
      eventType: 'PROVIDER_REJECTED',
      status: 'FAILED',
    });
  }

  recordDeliveryRetryScheduled(
    args: Pick<RecordEventInput, 'workspaceId' | 'correlationId' | 'notificationId' | 'channel' | 'provider' | 'attempt' | 'reasonCode' | 'metadata'>,
  ): Promise<void> {
    return this.record({
      ...args,
      eventType: 'DELIVERY_RETRY_SCHEDULED',
      status: 'RETRYING',
    });
  }

  recordDeliveryFailedFinal(
    args: Pick<RecordEventInput, 'workspaceId' | 'correlationId' | 'notificationId' | 'channel' | 'provider' | 'attempt' | 'reasonCode' | 'metadata'>,
  ): Promise<void> {
    return this.record({
      ...args,
      eventType: 'DELIVERY_FAILED_FINAL',
      status: 'FAILED',
    });
  }

  recordDeliverySkipped(
    args: Pick<RecordEventInput, 'workspaceId' | 'correlationId' | 'notificationId' | 'channel' | 'provider' | 'reasonCode' | 'metadata'>,
  ): Promise<void> {
    return this.record({
      ...args,
      eventType: 'DELIVERY_SKIPPED',
      status: 'SKIPPED',
    });
  }
}

export const notificationLogService = new NotificationLogService();
