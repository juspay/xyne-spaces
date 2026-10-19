import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classifyRemoteLogoutResponse,
  remoteLogoutFailed,
  remoteLogoutNotAttempted,
} from '@/src/services/remoteLogoutOutcome';

describe('remote logout outcome', (): void => {
  it('confirms only an explicit successful server response', (): void => {
    assert.deepEqual(classifyRemoteLogoutResponse({ success: true }), {
      attempted: true,
      confirmed: true,
      reason: 'confirmed',
    });
  });

  it('does not treat a rejected or malformed response as revocation', (): void => {
    assert.deepEqual(classifyRemoteLogoutResponse({ success: false }), {
      attempted: true,
      confirmed: false,
      reason: 'rejected',
    });
    assert.deepEqual(classifyRemoteLogoutResponse(null), {
      attempted: true,
      confirmed: false,
      reason: 'rejected',
    });
  });

  it('preserves failure reason without exposing an error payload', (): void => {
    assert.deepEqual(remoteLogoutFailed('timed_out'), {
      attempted: true,
      confirmed: false,
      reason: 'timed_out',
    });
    assert.deepEqual(remoteLogoutFailed('failed'), {
      attempted: true,
      confirmed: false,
      reason: 'failed',
    });
  });

  it('represents a missing user id without making a network attempt', (): void => {
    assert.deepEqual(remoteLogoutNotAttempted(), {
      attempted: false,
      confirmed: false,
      reason: 'not_attempted',
    });
  });
});
