import { APP_VARIANT, LOGGER_CONFIG, TELEMETRY_CONFIG } from '../../../config';
import { FetchHttpClient } from '../../logging/remote/http/FetchHttpClient';
import type { HttpClient } from '../../logging/remote/http/HttpClient';
import { resolveMetricReleaseIdentity } from '../resolveMetricReleaseIdentity';
import {
  buildNotificationDeliveryMetricsPayload,
  type NotificationDeliveryMetricPoint,
} from './buildNotificationDeliveryMetricsPayload';

const httpClient: HttpClient = new FetchHttpClient();

const pendingPoints: NotificationDeliveryMetricPoint[] = [];

export function queueNotificationDeliveryMetric(point: NotificationDeliveryMetricPoint): void {
  pendingPoints.push(point);
}

function nowUnixNano(): bigint {
  return BigInt(Date.now()) * 1_000_000n;
}

function reportMetricsPost(statusCode: number): void {
  try {
    // eslint-disable-next-line no-console -- Headless Android has no NSE log stream.
    console.warn(`[NotificationDelivery] metrics POST status=${statusCode}`);
  } catch {
    // Diagnostics must never interrupt delivery.
  }
}

/**
 * Posts queued notification counters with `fetch`, the same HTTP stack that
 * already delivers Android headless logs. The OpenTelemetry SDK exporter is
 * not used here: short-lived FCM wakes start it, flush a delta, and die, and
 * Godel/VictoriaMetrics drop that payload.
 */
export async function flushNotificationDeliveryMetrics(): Promise<void> {
  const points = pendingPoints.splice(0);

  if (!TELEMETRY_CONFIG.enabled || points.length === 0) {
    return;
  }

  const release = resolveMetricReleaseIdentity();
  const payload = buildNotificationDeliveryMetricsPayload(
    points,
    {
      serviceName: TELEMETRY_CONFIG.serviceName,
      serviceVersion: release.serviceVersion,
      buildVersion: release.buildVersion,
      environment: APP_VARIANT ?? (__DEV__ ? 'dev' : 'prod'),
      osType: LOGGER_CONFIG.platform,
    },
    nowUnixNano(),
  );

  const response = await httpClient.post({
    url: TELEMETRY_CONFIG.metricsEndpoint,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  reportMetricsPost(response.statusCode);

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Notification metrics POST failed with status ${response.statusCode}`);
  }
}
