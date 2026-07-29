import { metrics } from '@opentelemetry/api';
import type { Counter, Histogram, Meter } from '@opentelemetry/api';
import { OTEL_SERVICE_NAME } from '../../config';

function getMeter(): Meter {
  return metrics.getMeter(OTEL_SERVICE_NAME);
}

let _socketConnectionAttemptDuration: Histogram | null = null;
let _socketConnectionTotalDuration: Histogram | null = null;
let _socketConnectionRetriesPerRequest: Histogram | null = null;
let _socketSessionDuration: Histogram | null = null;
let _socketEventsTotal: Counter | null = null;

export const socketConnectionAttemptDuration: Histogram = new Proxy({} as Histogram, {
  get(_target, prop) {
    if (!_socketConnectionAttemptDuration) {
      _socketConnectionAttemptDuration = getMeter().createHistogram(
        'socket_connection_attempt_duration',
        {
          description: 'Latency per socket connection attempt in milliseconds',
          unit: 'ms',
          advice: {
            explicitBucketBoundaries: [100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000],
          },
        },
      );
    }
    return _socketConnectionAttemptDuration[prop as keyof Histogram];
  },
});

export const socketConnectionTotalDuration: Histogram = new Proxy({} as Histogram, {
  get(_target, prop) {
    if (!_socketConnectionTotalDuration) {
      _socketConnectionTotalDuration = getMeter().createHistogram(
        'socket_connection_total_duration',
        {
          description: 'Total connect time for socket connections in milliseconds',
          unit: 'ms',
          advice: {
            explicitBucketBoundaries: [100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000],
          },
        },
      );
    }
    return _socketConnectionTotalDuration[prop as keyof Histogram];
  },
});

export const socketConnectionRetriesPerRequest: Histogram = new Proxy({} as Histogram, {
  get(_target, prop) {
    if (!_socketConnectionRetriesPerRequest) {
      _socketConnectionRetriesPerRequest = getMeter().createHistogram(
        'socket_connection_retries_per_request',
        {
          description: 'Number of retries per socket connection request',
          unit: '1',
          advice: {
            explicitBucketBoundaries: [0, 1, 2, 3, 5, 10, 20],
          },
        },
      );
    }
    return _socketConnectionRetriesPerRequest[prop as keyof Histogram];
  },
});

export const socketSessionDuration: Histogram = new Proxy({} as Histogram, {
  get(_target, prop) {
    if (!_socketSessionDuration) {
      _socketSessionDuration = getMeter().createHistogram('socket_session_duration_seconds', {
        description: 'Duration of socket sessions in seconds',
        unit: 's',
        advice: {
          explicitBucketBoundaries: [1, 10, 30, 60, 300, 600, 1800, 3600],
        },
      });
    }
    return _socketSessionDuration[prop as keyof Histogram];
  },
});

export const socketEventsTotal: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_socketEventsTotal) {
      _socketEventsTotal = getMeter().createCounter('client_socket_events_total', {
        description: 'Total number of socket events',
        unit: '1',
      });
    }
    return _socketEventsTotal[prop as keyof Counter];
  },
});
