import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  JoinRequestStatus,
  describeJoinRequest,
  toJoinRequestStatus,
} from '@/src/features/onboarding/model/join-request';

describe('toJoinRequestStatus', () => {
  it('reads the statuses the backend sends', () => {
    assert.equal(toJoinRequestStatus('PENDING'), JoinRequestStatus.PENDING);
    assert.equal(toJoinRequestStatus('APPROVED'), JoinRequestStatus.APPROVED);
    assert.equal(toJoinRequestStatus('REJECTED'), JoinRequestStatus.REJECTED);
  });

  it('accepts the top-level result spelling too', () => {
    assert.equal(toJoinRequestStatus('REQUEST_PENDING'), JoinRequestStatus.PENDING);
    assert.equal(toJoinRequestStatus('REQUEST_REJECTED'), JoinRequestStatus.REJECTED);
  });

  it('ignores case', () => {
    assert.equal(toJoinRequestStatus('approved'), JoinRequestStatus.APPROVED);
  });

  it('treats anything unrecognised as pending, never as approved', () => {
    // The server took the request. "It is with an admin" is the only honest reading of a status
    // we do not know — in particular it must not unlock anything.
    assert.equal(toJoinRequestStatus(null), JoinRequestStatus.PENDING);
    assert.equal(toJoinRequestStatus(undefined), JoinRequestStatus.PENDING);
    assert.equal(toJoinRequestStatus(''), JoinRequestStatus.PENDING);
    assert.equal(toJoinRequestStatus('SOMETHING_NEW'), JoinRequestStatus.PENDING);
  });
});

describe('describeJoinRequest', () => {
  const base = { orgName: 'Juspay', isExisting: false };

  it('says a new request has been sent, and that it is not an approval', () => {
    const message = describeJoinRequest({ ...base, status: JoinRequestStatus.PENDING });

    assert.equal(message.title, 'Request sent');
    assert.match(message.body, /Juspay/);
    assert.match(message.body, /once it is approved/);
  });

  it('distinguishes a request that was already waiting', () => {
    const message = describeJoinRequest({
      ...base,
      status: JoinRequestStatus.PENDING,
      isExisting: true,
    });

    assert.equal(message.title, 'Request already sent');
  });

  it('tells an approved person to sign in again', () => {
    const message = describeJoinRequest({ ...base, status: JoinRequestStatus.APPROVED });

    assert.equal(message.title, 'You’re approved');
    assert.equal(message.actionLabel, 'Continue to sign in');
  });

  it('is plain about a declined request', () => {
    const message = describeJoinRequest({ ...base, status: JoinRequestStatus.REJECTED });

    assert.equal(message.title, 'Request declined');
    assert.match(message.body, /declined/);
  });

  it('never offers a way into the app — every outcome leaves via sign-in', () => {
    for (const status of Object.values(JoinRequestStatus)) {
      const { actionLabel } = describeJoinRequest({ ...base, status });
      assert.match(actionLabel, /sign in/i, status);
    }
  });
});
