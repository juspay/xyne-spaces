import { metrics } from '@opentelemetry/api';
import type { Counter, Histogram, Meter } from '@opentelemetry/api';
import { config } from '@/config/env';

function getMeter(): Meter {
  return metrics.getMeter(config.otel.serviceName);
}

let _zeroMutationOperations: Counter | null = null;
export function getZeroMutationOperations(): Counter {
  if (!_zeroMutationOperations) {
    _zeroMutationOperations = getMeter().createCounter('zero_mutation_operations', {
      description: 'Total number of Zero mutation operations with stage (start, success, error)',
      unit: '1',
    });
  }
  return _zeroMutationOperations;
}

let _zeroMutationLatency: Histogram | null = null;
export function getZeroMutationLatency(): Histogram {
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
  return _zeroMutationLatency;
}

let _zeroQueryOperations: Counter | null = null;
export function getZeroQueryOperations(): Counter {
  if (!_zeroQueryOperations) {
    _zeroQueryOperations = getMeter().createCounter('zero_query_operations', {
      description: 'Total number of Zero query operations with stage (start, success, error)',
      unit: '1',
    });
  }
  return _zeroQueryOperations;
}

let _zeroQueryLatency: Histogram | null = null;
export function getZeroQueryLatency(): Histogram {
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
  return _zeroQueryLatency;
}
