import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildNotificationDeliveryMetricsPayload,
  OTLP_AGGREGATION_TEMPORALITY_CUMULATIVE,
  OTLP_POINT_WINDOW_NS,
} from '@/src/observability/metrics/otlp/buildNotificationDeliveryMetricsPayload';

describe('buildNotificationDeliveryMetricsPayload', () => {
  it('exports a cumulative sum of 1 with a non-zero time window', () => {
    const end = 2_000_000_000_000_000_000n;
    const payload = buildNotificationDeliveryMetricsPayload(
      [
        {
          name: 'notification_payload_received',
          description: 'Payloads that reached the notification pipeline',
          attributes: {
            delivery_context: 'background',
            category: 'chat',
          },
        },
      ],
      {
        serviceName: 'xynespaces-native',
        serviceVersion: '102.0.0',
        buildVersion: '1',
        environment: 'prod',
        osType: 'android',
      },
      end,
    );

    const resourceMetrics = payload['resourceMetrics'] as Array<Record<string, unknown>>;
    const resource = resourceMetrics[0]?.['resource'] as Record<string, unknown>;
    const metric = (
      (resourceMetrics[0]?.['scopeMetrics'] as Array<Record<string, unknown>>)[0]?.[
        'metrics'
      ] as Array<Record<string, unknown>>
    )[0];
    assert.ok(metric);
    const sum = metric['sum'] as Record<string, unknown>;
    const dataPoint = (sum['dataPoints'] as Array<Record<string, unknown>>)[0];
    assert.ok(dataPoint);

    assert.equal(sum['aggregationTemporality'], OTLP_AGGREGATION_TEMPORALITY_CUMULATIVE);
    assert.equal(sum['isMonotonic'], true);
    assert.equal(dataPoint['asDouble'], 1);
    assert.equal(dataPoint['timeUnixNano'], end.toString());
    assert.equal(dataPoint['startTimeUnixNano'], (end - OTLP_POINT_WINDOW_NS).toString());
    assert.equal(resource['droppedAttributesCount'], 0);

    const keys = (resource['attributes'] as Array<{ key: string }>).map(attribute => attribute.key);
    assert.deepEqual(keys, [
      'service.name',
      'os.type',
      'deployment.environment.name',
      'service.version',
      'app.build.version',
    ]);
  });

  it('omits unknown version labels so dashboards are not filtered onto a dead value', () => {
    const payload = buildNotificationDeliveryMetricsPayload(
      [
        {
          name: 'notification_payload_received',
          description: 'Payloads that reached the notification pipeline',
          attributes: { delivery_context: 'background', category: 'chat' },
        },
      ],
      {
        serviceName: 'xynespaces-native',
        serviceVersion: 'unknown',
        buildVersion: 'unknown',
        environment: 'prod',
        osType: 'android',
      },
      2_000_000_000_000_000_000n,
    );

    const resourceMetrics = payload['resourceMetrics'] as Array<Record<string, unknown>>;
    const resource = resourceMetrics[0]?.['resource'] as Record<string, unknown>;
    const keys = (resource['attributes'] as Array<{ key: string }>).map(attribute => attribute.key);
    assert.deepEqual(keys, ['service.name', 'os.type', 'deployment.environment.name']);
  });
});
