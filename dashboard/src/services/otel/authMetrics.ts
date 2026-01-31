import { metrics } from '@opentelemetry/api';
import type { Counter, Histogram, Meter } from '@opentelemetry/api';
import { OTEL_SERVICE_NAME } from '../../config';

function getMeter(): Meter {
  return metrics.getMeter(OTEL_SERVICE_NAME);
}

let _authRefreshDuration: Histogram | null = null;
let _authRefreshTotal: Counter | null = null;
let _clearAuthTokenTotal: Counter | null = null;

export const authRefreshDuration: Histogram = new Proxy({} as Histogram, {
  get(_target, prop) {
    if (!_authRefreshDuration) {
      _authRefreshDuration = getMeter().createHistogram('auth_refresh_duration', {
        description: 'Duration of auth refresh requests in milliseconds',
        unit: 'ms',
        advice: {
          explicitBucketBoundaries: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
        },
      });
    }
    return _authRefreshDuration[prop as keyof Histogram];
  },
});

export const authRefreshTotal: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_authRefreshTotal) {
      _authRefreshTotal = getMeter().createCounter('auth_refresh_total', {
        description: 'Total number of auth refresh attempts',
        unit: '1',
      });
    }
    return _authRefreshTotal[prop as keyof Counter];
  },
});

export const clearAuthTokenTotal: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_clearAuthTokenTotal) {
      _clearAuthTokenTotal = getMeter().createCounter('clear_token_total', {
        description: 'Total times clearAuthTokens is called',
        unit: '1',
      });
    }
    return _clearAuthTokenTotal[prop as keyof Counter];
  },
});
