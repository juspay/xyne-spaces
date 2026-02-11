import { metrics } from '@opentelemetry/api';
import type { Counter, Histogram, Meter } from '@opentelemetry/api';
import { config } from '@/config/env';

function getMeter(): Meter {
  return metrics.getMeter(config.otel.serviceName);
}

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