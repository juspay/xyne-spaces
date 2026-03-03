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
          description: 'Duration of Zero-socket sessions in milliseconds',
          unit: 'ms',
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

// Zero Query Metrics
let _zeroQueryOperations: Counter | null = null;
let _zeroQueryLatency: Histogram | null = null;

export const zeroQueryOperations: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_zeroQueryOperations) {
      _zeroQueryOperations = getMeter().createCounter('zero_query_operations', {
        description: 'Total number of Zero query operations with stage (start, success, error)',
        unit: '1',
      });
    }
    return _zeroQueryOperations[prop as keyof Counter];
  },
});

export const zeroQueryLatency: Histogram = new Proxy({} as Histogram, {
  get(_target, prop) {
    if (!_zeroQueryLatency) {
      _zeroQueryLatency = getMeter().createHistogram('zero_query_latency', {
        description: 'Latency of Zero queries in milliseconds',
        unit: 'ms',
        advice: {
          explicitBucketBoundaries: [
            10, 25, 50, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600,
          ],
        },
      });
    }
    return _zeroQueryLatency[prop as keyof Histogram];
  },
});

// Zero Mutation Metrics
let _zeroMutationOperations: Counter | null = null;
let _zeroMutationLatency: Histogram | null = null;

export const zeroMutationOperations: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_zeroMutationOperations) {
      _zeroMutationOperations = getMeter().createCounter('zero_mutation_operations', {
        description: 'Total number of Zero mutation operations with stage (start, success, error)',
        unit: '1',
      });
    }
    return _zeroMutationOperations[prop as keyof Counter];
  },
});

export const zeroMutationLatency: Histogram = new Proxy({} as Histogram, {
  get(_target, prop) {
    if (!_zeroMutationLatency) {
      _zeroMutationLatency = getMeter().createHistogram('zero_mutation_latency', {
        description: 'Latency of Zero mutations in milliseconds',
        unit: 'ms',
        advice: {
          explicitBucketBoundaries: [
            10, 25, 50, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600,
          ],
        },
      });
    }
    return _zeroMutationLatency[prop as keyof Histogram];
  },
});

let _zeroRunOperations: Counter | null = null;
let _zeroRunLatency: Histogram | null = null;

export const zeroRunOperations: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_zeroRunOperations) {
      _zeroRunOperations = getMeter().createCounter('zero_run_operations', {
        description: 'Total number of Zero run operations with stage (start, success, error)',
        unit: '1',
      });
    }
    return _zeroRunOperations[prop as keyof Counter];
  },
});

export const zeroRunLatency: Histogram = new Proxy({} as Histogram, {
  get(_target, prop) {
    if (!_zeroRunLatency) {
      _zeroRunLatency = getMeter().createHistogram('zero_run_latency', {
        description: 'Latency of Zero run operations in milliseconds',
        unit: 'ms',
        advice: {
          explicitBucketBoundaries: [
            10, 25, 50, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600,
          ],
        },
      });
    }
    return _zeroRunLatency[prop as keyof Histogram];
  },
});
