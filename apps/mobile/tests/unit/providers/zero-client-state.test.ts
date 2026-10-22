import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isFatalZeroClientResetReason,
  isZeroClientStateNotFoundReason,
  shouldRequestZeroConnect,
} from '@/src/providers/zeroClientState';

describe('isZeroClientStateNotFoundReason', () => {
  it('matches the Zero connection error string', () => {
    assert.equal(isZeroClientStateNotFoundReason('Client not found'), true);
    assert.equal(isZeroClientStateNotFoundReason('ClientNotFound'), true);
  });

  it('matches ProtocolError-shaped objects', () => {
    assert.equal(isZeroClientStateNotFoundReason({ kind: 'ClientNotFound' }), true);
    assert.equal(
      isZeroClientStateNotFoundReason({
        message: 'Server could not find state... Client not found',
      }),
      true,
    );
  });

  it('ignores other connection errors', () => {
    assert.equal(isZeroClientStateNotFoundReason(undefined), false);
    assert.equal(isZeroClientStateNotFoundReason('needs-auth'), false);
    assert.equal(isZeroClientStateNotFoundReason({ kind: 'Unauthorized' }), false);
    assert.equal(isZeroClientStateNotFoundReason('Rehome'), false);
    assert.equal(isZeroClientStateNotFoundReason('Reconnect required'), false);
  });
});

describe('isFatalZeroClientResetReason', () => {
  it('treats cookie/client-deleted errors as fatal', () => {
    assert.equal(
      isFatalZeroClientResetReason({ kind: 'InvalidConnectionRequestBaseCookie' }),
      true,
    );
    assert.equal(isFatalZeroClientResetReason('UnexpectedBaseCookie'), true);
    assert.equal(isFatalZeroClientResetReason('Unknown Error'), false);
    assert.equal(isFatalZeroClientResetReason('Rehome'), false);
    assert.equal(isFatalZeroClientResetReason('Server ping request failed'), false);
  });
});

describe('shouldRequestZeroConnect', () => {
  it('only resumes Zero terminal states', () => {
    assert.equal(shouldRequestZeroConnect('error'), true);
    assert.equal(shouldRequestZeroConnect('needs-auth'), true);
    assert.equal(shouldRequestZeroConnect('connecting'), false);
    assert.equal(shouldRequestZeroConnect('connected'), false);
    assert.equal(shouldRequestZeroConnect('disconnected'), false);
  });
});
