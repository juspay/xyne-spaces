import { metrics } from '@opentelemetry/api';
import type { Counter, Histogram, UpDownCounter, Meter } from '@opentelemetry/api';
import { config } from '@/config/env';

function getMeter(): Meter {
  return metrics.getMeter(config.otel.serviceName);
}

// HTTP Request Duration Histogram
let _httpRequestDuration: Histogram | null = null;
export const httpRequestDuration: Histogram = new Proxy({} as Histogram, {
  get(_target, prop) {
    if (!_httpRequestDuration) {
      _httpRequestDuration = getMeter().createHistogram('http_request_duration_ms', {
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

// HTTP Requests Total Counter
let _httpRequestTotal: Counter | null = null;
export const httpRequestTotal: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_httpRequestTotal) {
      _httpRequestTotal = getMeter().createCounter('http_requests_total', {
        description: 'Total number of HTTP requests',
        unit: '1',
      });
    }
    return _httpRequestTotal[prop as keyof Counter];
  },
});

// HTTP Request Errors Counter
let _httpRequestErrors: Counter | null = null;
export const httpRequestErrors: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_httpRequestErrors) {
      _httpRequestErrors = getMeter().createCounter('http_request_errors_total', {
        description: 'Total number of HTTP request errors',
        unit: '1',
      });
    }
    return _httpRequestErrors[prop as keyof Counter];
  },
});

// Active Connections UpDownCounter (replaces Gauge)
let _activeConnections: UpDownCounter | null = null;
export const activeConnections: UpDownCounter = new Proxy({} as UpDownCounter, {
  get(_target, prop) {
    if (!_activeConnections) {
      _activeConnections = getMeter().createUpDownCounter('http_active_connections', {
        description: 'Number of active HTTP connections',
        unit: '1',
      });
    }
    return _activeConnections[prop as keyof UpDownCounter];
  },
});
