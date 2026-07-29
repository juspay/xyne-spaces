import { metrics } from '@opentelemetry/api';
import type { Counter, Histogram, UpDownCounter, Meter } from '@opentelemetry/api';
import { config } from '@/config/env';

function getMeter(): Meter {
  return metrics.getMeter(config.otel.serviceName);
}

// HTTP Request Duration Histogram
let _httpRequestDuration: Histogram | null = null;
export function getHttpRequestDuration(): Histogram {
  if (!_httpRequestDuration) {
    _httpRequestDuration = getMeter().createHistogram('http_request_duration_ms', {
      description: 'Duration of HTTP requests in milliseconds',
      unit: 'ms',
      advice: {
        explicitBucketBoundaries: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
      },
    });
  }
  return _httpRequestDuration;
}

// HTTP Requests Total Counter
let _httpRequestTotal: Counter | null = null;
export function getHttpRequestTotal(): Counter {
  if (!_httpRequestTotal) {
    _httpRequestTotal = getMeter().createCounter('http_requests_total', {
      description: 'Total number of HTTP requests',
      unit: '1',
    });
  }
  return _httpRequestTotal;
}

// HTTP Request Errors Counter
let _httpRequestErrors: Counter | null = null;
export function getHttpRequestErrors(): Counter {
  if (!_httpRequestErrors) {
    _httpRequestErrors = getMeter().createCounter('http_request_errors_total', {
      description: 'Total number of HTTP request errors',
      unit: '1',
    });
  }
  return _httpRequestErrors;
}

// Active Connections UpDownCounter (replaces Gauge)
let _activeConnections: UpDownCounter | null = null;
export function getActiveConnections(): UpDownCounter {
  if (!_activeConnections) {
    _activeConnections = getMeter().createUpDownCounter('http_active_connections', {
      description: 'Number of active HTTP connections',
      unit: '1',
    });
  }
  return _activeConnections;
}
