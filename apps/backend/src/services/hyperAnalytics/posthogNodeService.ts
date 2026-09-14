import { PostHog } from 'posthog-node';
import { logger } from '@/utils/logger';

/**
 * Server-side PostHog sink. Receives every row that goes into
 * `workflow.user_activity_events` (see activityTrackingService.ts), so PostHog
 * holds the same events Grafana reads, including backend-originated ones
 * (call join, message sent, ...) that the browser SDK never sees.
 *
 * Gated on POSTHOG_API_KEY like SudoQuery is on SUDO_QUERY_TOKEN: with no key
 * every method is a silent no-op.
 */

interface CaptureParams {
  /** App user id; equals `user_activity_events.userId`, which Grafana groups by. */
  distinctId: string;
  event: string;
  properties: Record<string, unknown>;
  /** Client-side event time. Defaults to now when omitted. */
  timestamp?: Date;
}

class PostHogNodeService {
  private client: PostHog | null = null;
  private initAttempted = false;

  initialize(): void {
    if (this.initAttempted) {
      return;
    }
    this.initAttempted = true;

    const apiKey = process.env.POSTHOG_API_KEY?.trim();
    const host = process.env.POSTHOG_HOST?.trim() || 'https://eu.i.posthog.com';

    if (!apiKey) {
      logger.warn('[PostHog] POSTHOG_API_KEY not set, server-side capture disabled');
      return;
    }

    try {
      // Small batches, short interval: a pod dying between flushes loses seconds, not minutes.
      this.client = new PostHog(apiKey, { host, flushAt: 20, flushInterval: 5000 });
      logger.info('[PostHog] Server-side capture initialized', { host });
    } catch (error) {
      logger.error('[PostHog] Init failed:', error);
      this.client = null;
    }
  }

  capture(params: CaptureParams): void {
    if (!this.initAttempted) {
      this.initialize();
    }
    if (!this.client) {
      return;
    }

    try {
      this.client.capture({
        distinctId: params.distinctId,
        event: params.event,
        properties: params.properties,
        ...(params.timestamp && { timestamp: params.timestamp }),
      });
    } catch (error) {
      logger.debug('[PostHog] capture failed (non-blocking)', { error });
    }
  }

  /** Flushes the queue. Called from app shutdown so a SIGTERM does not drop the last batch. */
  async shutdown(): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      await this.client.shutdown(10_000);
    } catch (error) {
      logger.error('[PostHog] Shutdown flush failed:', error);
    } finally {
      this.client = null;
    }
  }
}

export const posthogNodeService = new PostHogNodeService();
