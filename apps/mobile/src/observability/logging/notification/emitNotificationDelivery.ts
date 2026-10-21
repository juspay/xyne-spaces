import { appMetrics } from '../../metrics/appMetrics';
import { APP_METRICS } from '../../metrics/metrics';
import {
  flushNotificationDeliveryMetrics,
  queueNotificationDeliveryMetric,
} from '../../metrics/otlp/flushNotificationDeliveryMetrics';
import { flushRemoteLogs, logger as structuredLogger } from '../appLogger';
import { hydrateLogIdentityFromPersistedSession } from '../hydrateLogIdentity';
import type {
  NotificationDeliveryFields,
  NotificationDisplayCategory,
  NotificationPresentationOwner,
  NotificationSkipReason,
} from './notificationDelivery';

const HEADLESS_FLUSH_TIMEOUT_MS = 4000;

function emitWithSessionIdentity(write: () => void): void {
  hydrateLogIdentityFromPersistedSession();
  write();
}

export function emitNotificationPayloadReceived(fields: NotificationDeliveryFields): void {
  emitWithSessionIdentity(() => {
    queueNotificationDeliveryMetric({
      name: APP_METRICS.notificationPayloadReceived.name,
      description: APP_METRICS.notificationPayloadReceived.description,
      attributes: {
        delivery_context: fields.deliveryContext,
        category: fields.category,
      },
    });
    structuredLogger.info('notification_payload_received', fields);
  });
}

export function emitNotificationDisplayed(
  fields: NotificationDeliveryFields & {
    category: NotificationDisplayCategory;
    presentationOwner: NotificationPresentationOwner;
    trayNotificationId: string | null;
  },
): void {
  emitWithSessionIdentity(() => {
    queueNotificationDeliveryMetric({
      name: APP_METRICS.notificationDisplayed.name,
      description: APP_METRICS.notificationDisplayed.description,
      attributes: {
        delivery_context: fields.deliveryContext,
        category: fields.category,
        presentation_owner: fields.presentationOwner,
      },
    });
    structuredLogger.info('notification_displayed', fields);
  });
}

export function emitNotificationDisplaySkipped(
  fields: NotificationDeliveryFields & {
    reason: NotificationSkipReason;
  },
): void {
  emitWithSessionIdentity(() => {
    queueNotificationDeliveryMetric({
      name: APP_METRICS.notificationDisplaySkipped.name,
      description: APP_METRICS.notificationDisplaySkipped.description,
      attributes: {
        delivery_context: fields.deliveryContext,
        category: fields.category,
        reason: fields.reason,
      },
    });
    structuredLogger.info('notification_display_skipped', fields);
  });
}

export function emitNotificationDisplayFailed(
  fields: NotificationDeliveryFields & {
    category: NotificationDisplayCategory;
    error: unknown;
  },
): void {
  emitWithSessionIdentity(() => {
    queueNotificationDeliveryMetric({
      name: APP_METRICS.notificationDisplayFailed.name,
      description: APP_METRICS.notificationDisplayFailed.description,
      attributes: {
        delivery_context: fields.deliveryContext,
        category: fields.category,
      },
    });
    structuredLogger.error('notification_display_failed', fields);
  });
}

export function emitNotificationHandlerFailed(
  fields: NotificationDeliveryFields & {
    error: unknown;
  },
): void {
  emitWithSessionIdentity(() => {
    queueNotificationDeliveryMetric({
      name: APP_METRICS.notificationHandlerFailed.name,
      description: APP_METRICS.notificationHandlerFailed.description,
      attributes: {
        delivery_context: fields.deliveryContext,
        category: fields.category,
      },
    });
    structuredLogger.error('notification_handler_failed', fields);
  });
}

export async function flushNotificationDeliveryObservability(): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timedOut = new Promise<'timeout'>(resolve => {
    timeout = setTimeout(() => resolve('timeout'), HEADLESS_FLUSH_TIMEOUT_MS);
  });

  const jobs: Array<Promise<unknown>> = [flushRemoteLogs(), flushNotificationDeliveryMetrics()];

  if (appMetrics.isStarted()) {
    jobs.push(appMetrics.forceFlush());
  }

  try {
    const result = await Promise.race([Promise.all(jobs).then(() => 'flushed' as const), timedOut]);
    if (result === 'timeout') {
      console.warn('[NotificationDelivery] observability flush timed out');
    }
  } catch (error) {
    console.warn('[NotificationDelivery] observability flush failed', error);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
