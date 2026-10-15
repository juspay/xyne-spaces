import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveMetricsEndpoint } from '@/src/observability/metrics/config/resolveMetricsEndpoint';

describe('resolveMetricsEndpoint', () => {
  it('uses the fallback host when the override is missing or blank', () => {
    assert.equal(
      resolveMetricsEndpoint(undefined, 'https://spaces.xyne.juspay.net'),
      'https://spaces.xyne.juspay.net/godel/v1/metrics',
    );

    assert.equal(
      resolveMetricsEndpoint('', 'https://spaces.xyne.juspay.net'),
      'https://spaces.xyne.juspay.net/godel/v1/metrics',
    );

    assert.equal(
      resolveMetricsEndpoint('   ', 'https://spaces.xyne.juspay.net'),
      'https://spaces.xyne.juspay.net/godel/v1/metrics',
    );
  });

  it('uses a non-empty override and strips a trailing slash', () => {
    assert.equal(
      resolveMetricsEndpoint('http://localhost:4001/', 'https://spaces.xyne.juspay.net'),
      'http://localhost:4001/godel/v1/metrics',
    );
  });
});
