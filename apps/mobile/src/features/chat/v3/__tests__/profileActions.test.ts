import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { profileActionEnabled, profileCallBlockedReason } from '../overlays/profileActions';

describe('profileActionEnabled', (): void => {
  it('disables Message and Call on the own profile, not Info', (): void => {
    const own = { isOwnProfile: true, hasUserId: true };
    const other = { isOwnProfile: false, hasUserId: true };
    assert.equal(profileActionEnabled('message', own), false);
    assert.equal(profileActionEnabled('call', own), false);
    assert.equal(profileActionEnabled('info', own), true);
    assert.equal(profileActionEnabled('message', other), true);
    assert.equal(profileActionEnabled('call', other), true);
  });

  it('disables Info without a user id', (): void => {
    assert.equal(profileActionEnabled('info', { isOwnProfile: false, hasUserId: false }), false);
  });
});

describe('profileCallBlockedReason', (): void => {
  it('treats an in-progress call as an alert, not a disabled tile', (): void => {
    assert.equal(profileCallBlockedReason(true, false), 'own');
    assert.equal(profileCallBlockedReason(false, true), 'in-call');
    assert.equal(profileCallBlockedReason(false, false), null);
    assert.equal(profileActionEnabled('call', { isOwnProfile: false, hasUserId: true }), true);
  });
});
