import type { NotificationLogEvent } from '@prisma/client';
import { repositories } from '@/database/repositories';
import {
  getNotificationPipelineCompleteness,
  getNotificationPipelineMissingStage,
  getNotificationPipelineLatency,
} from '@/services/otel/notificationMetrics';
import {
  classifyCompleteness,
  type ClassifyOptions,
  type CompletenessResult,
  type CompletenessStatus,
} from './notificationLogCompleteness';

// Re-export the pure types so existing importers of this module keep working.
export type { ClassifyOptions, CompletenessResult, CompletenessStatus };

/**
 * Completeness classifier for the notification pipeline (SDLCT-0002).
 *
 * The classification itself is a PURE function (`classifyCompleteness`, in
 * `notificationLogCompleteness.ts`) so it can be unit tested without a database
 * or the metrics/env stack. This service adds the two side-effecting concerns:
 * best-effort metric emission, and workspace-scoped repository reads.
 */
export class NotificationLogCompletenessService {
  /**
   * Classify an ordered (or unordered) set of lifecycle events into
   * COMPLETE / INCOMPLETE / FAILED / UNKNOWN and (unless opted out) emit metrics.
   */
  classify(
    events: NotificationLogEvent[],
    options: ClassifyOptions = {},
  ): CompletenessResult {
    const result = classifyCompleteness(events, options);
    this.maybeEmit(result, options);
    return result;
  }

  private maybeEmit(result: CompletenessResult, options: ClassifyOptions): void {
    if (options.emitMetrics === false) return;
    try {
      getNotificationPipelineCompleteness().add(1, { status: result.status });
      for (const stage of result.missingStages) {
        getNotificationPipelineMissingStage().add(1, { stage });
      }
      if (result.latencyMs !== null && result.status === 'COMPLETE') {
        getNotificationPipelineLatency().record(result.latencyMs);
      }
    } catch {
      // metrics are best-effort
    }
  }

  /** Workspace-scoped completeness for a single notification. */
  async getCompletenessForNotificationId(
    workspaceId: string,
    notificationId: string,
    options: ClassifyOptions = {},
  ): Promise<CompletenessResult> {
    const events = await repositories.notificationLogs.findByNotificationId(
      workspaceId,
      notificationId,
    );
    return this.classify(events, options);
  }

  /** Workspace-scoped completeness for a correlation id. */
  async getCompletenessForCorrelationId(
    workspaceId: string,
    correlationId: string,
    options: ClassifyOptions = {},
  ): Promise<CompletenessResult> {
    const events = await repositories.notificationLogs.findByCorrelationId(
      workspaceId,
      correlationId,
    );
    return this.classify(events, options);
  }
}

export const notificationLogCompletenessService = new NotificationLogCompletenessService();
