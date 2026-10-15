import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HttpRequestError } from '../http/HttpClient';
import { HttpRequestTimeoutError } from '../http/HttpRequestTimeoutError';
import { RemoteLogDeliveryError } from '../RemoteLogDeliveryError';
import {
  calculateRetryDelayMs,
  isRetryableRemoteLogError,
  validateRemoteLogRetryPolicy,
  type RemoteLogRetryPolicy,
} from './RemoteLogRetryPolicy';

const POLICY: RemoteLogRetryPolicy = {
  maximumAttempts: 6,
  initialDelayMs: 1_000,
  maximumDelayMs: 10_000,
};

describe('RemoteLogRetryPolicy', () => {
  it('retries network and temporary HTTP failures', () => {
    assert.equal(
      isRetryableRemoteLogError(new HttpRequestError(new Error('Network unavailable'))),
      true,
    );

    assert.equal(isRetryableRemoteLogError(new HttpRequestTimeoutError(10_000)), true);

    for (const statusCode of [408, 425, 429, 500, 502, 503, 504]) {
      assert.equal(isRetryableRemoteLogError(new RemoteLogDeliveryError(statusCode)), true);
    }
  });

  it('does not retry permanent or unknown failures', () => {
    for (const statusCode of [400, 401, 403, 404, 413]) {
      assert.equal(isRetryableRemoteLogError(new RemoteLogDeliveryError(statusCode)), false);
    }

    assert.equal(isRetryableRemoteLogError(new Error('Programming failure')), false);
  });

  it('calculates capped exponential delays with full jitter', () => {
    assert.equal(calculateRetryDelayMs(1, POLICY, 1), 1_000);
    assert.equal(calculateRetryDelayMs(2, POLICY, 1), 2_000);
    assert.equal(calculateRetryDelayMs(3, POLICY, 1), 4_000);
    assert.equal(calculateRetryDelayMs(4, POLICY, 1), 8_000);
    assert.equal(calculateRetryDelayMs(5, POLICY, 1), 10_000);

    assert.equal(calculateRetryDelayMs(2, POLICY, 0.25), 500);
    assert.equal(calculateRetryDelayMs(2, POLICY, 0), 0);
  });

  it('rejects invalid retry configurations', () => {
    assert.throws(
      () =>
        validateRemoteLogRetryPolicy({
          ...POLICY,
          maximumAttempts: 0,
        }),
      RangeError,
    );

    assert.throws(
      () =>
        validateRemoteLogRetryPolicy({
          ...POLICY,
          initialDelayMs: 20_000,
        }),
      RangeError,
    );

    assert.throws(() => calculateRetryDelayMs(0, POLICY, 0.5), RangeError);

    assert.throws(() => calculateRetryDelayMs(1, POLICY, 2), RangeError);
  });
});
