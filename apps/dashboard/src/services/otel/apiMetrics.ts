import { metrics } from '@opentelemetry/api';
import type { Counter, Histogram, Meter } from '@opentelemetry/api';
import { OTEL_SERVICE_NAME } from '../../config';

function getMeter(): Meter {
  return metrics.getMeter(OTEL_SERVICE_NAME);
}

let _httpRequestDuration: Histogram | null = null;
let _httpRequestTotal: Counter | null = null;
let _httpRequestErrors: Counter | null = null;

export const httpRequestDuration: Histogram = new Proxy({} as Histogram, {
  get(_target, prop) {
    if (!_httpRequestDuration) {
      _httpRequestDuration = getMeter().createHistogram('client_http_request_duration', {
        description: 'Duration of HTTP requests in milliseconds',
        unit: 'ms',
        advice: {
          explicitBucketBoundaries: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
        },
      });
    }
    return _httpRequestDuration[prop as keyof Histogram];
  },
});

export const httpRequestTotal: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_httpRequestTotal) {
      _httpRequestTotal = getMeter().createCounter('client_http_requests_total', {
        description: 'Total number of HTTP requests',
        unit: '1',
      });
    }
    return _httpRequestTotal[prop as keyof Counter];
  },
});

export const httpRequestErrors: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_httpRequestErrors) {
      _httpRequestErrors = getMeter().createCounter('client_http_request_errors_total', {
        description: 'Total number of HTTP request errors',
        unit: '1',
      });
    }
    return _httpRequestErrors[prop as keyof Counter];
  },
});
