import { firstKnownReleaseValue } from '../config/firstKnownReleaseValue';

export type NotificationDeliveryMetricPoint = Readonly<{
  name: string;
  description: string;
  attributes: Readonly<Record<string, string>>;
}>;

export type NotificationDeliveryMetricsResource = Readonly<{
  serviceName: string;
  serviceVersion: string;
  buildVersion: string;
  environment: string;
  osType: string;
}>;

export const OTLP_AGGREGATION_TEMPORALITY_CUMULATIVE = 2;
export const OTLP_POINT_WINDOW_NS = 1_000_000_000n;

function otlpStringAttribute(
  key: string,
  value: string,
): { key: string; value: { stringValue: string } } {
  return {
    key,
    value: { stringValue: value },
  };
}

function otlpSumMetric(
  point: NotificationDeliveryMetricPoint,
  startTimeUnixNano: string,
  timeUnixNano: string,
): Record<string, unknown> {
  return {
    name: point.name,
    description: point.description,
    unit: '1',
    sum: {
      aggregationTemporality: OTLP_AGGREGATION_TEMPORALITY_CUMULATIVE,
      isMonotonic: true,
      dataPoints: [
        {
          asDouble: 1,
          attributes: Object.entries(point.attributes).map(([key, value]) =>
            otlpStringAttribute(key, value),
          ),
          startTimeUnixNano,
          timeUnixNano,
        },
      ],
    },
  };
}

function isUsableReleaseLabel(value: string): boolean {
  return firstKnownReleaseValue(value).length > 0;
}

function unixNanoInterval(endTimeUnixNano: bigint): { start: string; end: string } {
  const start =
    endTimeUnixNano > OTLP_POINT_WINDOW_NS ? endTimeUnixNano - OTLP_POINT_WINDOW_NS : 0n;
  return {
    start: start.toString(),
    end: endTimeUnixNano.toString(),
  };
}

/**
 * Builds the same OTLP JSON Godel already stores for the iOS Notification
 * Service Extension: a one-shot cumulative sum of 1 with a non-zero window.
 * Short-lived JS delta flushes are accepted with HTTP 200 and then dropped.
 */
export function buildNotificationDeliveryMetricsPayload(
  points: readonly NotificationDeliveryMetricPoint[],
  resource: NotificationDeliveryMetricsResource,
  endTimeUnixNano: bigint,
): Record<string, unknown> {
  const interval = unixNanoInterval(endTimeUnixNano);
  const attributes = [
    otlpStringAttribute('service.name', resource.serviceName),
    otlpStringAttribute('os.type', resource.osType),
    otlpStringAttribute('deployment.environment.name', resource.environment),
  ];

  if (isUsableReleaseLabel(resource.serviceVersion)) {
    attributes.push(otlpStringAttribute('service.version', resource.serviceVersion));
  }

  if (isUsableReleaseLabel(resource.buildVersion)) {
    attributes.push(otlpStringAttribute('app.build.version', resource.buildVersion));
  }

  return {
    resourceMetrics: [
      {
        resource: {
          attributes,
          droppedAttributesCount: 0,
        },
        scopeMetrics: [
          {
            scope: { name: resource.serviceName },
            metrics: points.map(point => otlpSumMetric(point, interval.start, interval.end)),
          },
        ],
      },
    ],
  };
}
