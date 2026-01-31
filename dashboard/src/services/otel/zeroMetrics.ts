import { metrics } from '@opentelemetry/api';
import type { Counter, Histogram, Meter } from '@opentelemetry/api';
import { OTEL_SERVICE_NAME } from '../../config';

function getMeter(): Meter {
  return metrics.getMeter(OTEL_SERVICE_NAME);
}

let _zeroSocketConnectionAttemptDuration: Histogram | null = null;
let _zeroSocketConnectionTotalDuration: Histogram | null = null;
let _zeroSocketConnectionRetriesPerRequest: Histogram | null = null;
let _zeroSocketSessionDuration: Histogram | null = null;
let _zeroSocketEventsTotal: Counter | null = null;

export const zeroSocketConnectionAttemptDuration: Histogram = new Proxy({} as Histogram, {
  get(_target, prop) {
    if (!_zeroSocketConnectionAttemptDuration) {
      _zeroSocketConnectionAttemptDuration = getMeter().createHistogram(
        'zero_socket_connection_attempt_duration',
        {
          description: 'Latency per Zero-socket connection attempt in milliseconds',
          unit: 'ms',
          advice: {
            explicitBucketBoundaries: [
              100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600, 51200, 102400, 204800, 409600,
            ],
          },
        },
      );
    }
    return _zeroSocketConnectionAttemptDuration[prop as keyof Histogram];
  },
});

export const zeroSocketConnectionTotalDuration: Histogram = new Proxy({} as Histogram, {
  get(_target, prop) {
    if (!_zeroSocketConnectionTotalDuration) {
      _zeroSocketConnectionTotalDuration = getMeter().createHistogram(
        'zero_socket_connection_total_duration',
        {
          description: 'Total connect time for Zero-socket connections in milliseconds',
          unit: 'ms',
          advice: {
            explicitBucketBoundaries: [
              100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600, 51200, 102400, 204800, 409600,
            ],
          },
        },
      );
    }
    return _zeroSocketConnectionTotalDuration[prop as keyof Histogram];
  },
});

export const zeroSocketConnectionRetriesPerRequest: Histogram = new Proxy({} as Histogram, {
  get(_target, prop) {
    if (!_zeroSocketConnectionRetriesPerRequest) {
      _zeroSocketConnectionRetriesPerRequest = getMeter().createHistogram(
        'zero_socket_connection_retries_per_request',
        {
          description: 'Number of retries per Zero-socket connection request',
          unit: '1',
          advice: {
            explicitBucketBoundaries: [0, 1, 2, 3, 5, 10, 20],
          },
        },
      );
    }
    return _zeroSocketConnectionRetriesPerRequest[prop as keyof Histogram];
  },
});

export const zeroSocketSessionDuration: Histogram = new Proxy({} as Histogram, {
  get(_target, prop) {
    if (!_zeroSocketSessionDuration) {
      _zeroSocketSessionDuration = getMeter().createHistogram(
        'zero_socket_session_duration_seconds',
        {
          description: 'Duration of Zero-socket sessions in seconds',
          unit: 's',
          advice: {
            explicitBucketBoundaries: [1, 10, 30, 60, 300, 600, 1800, 3600],
          },
        },
      );
    }
    return _zeroSocketSessionDuration[prop as keyof Histogram];
  },
});

export const zeroSocketEventsTotal: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_zeroSocketEventsTotal) {
      _zeroSocketEventsTotal = getMeter().createCounter('zero_socket_events_total', {
        description: 'Total number of Zero-socket events',
        unit: '1',
      });
    }
    return _zeroSocketEventsTotal[prop as keyof Counter];
  },
});
