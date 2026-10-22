import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canCommitDeviceRegistration,
  canCommitVoipRegistration,
} from '@/src/notifications/registrationLifecyclePolicy';

describe('notification registration lifecycle policy', (): void => {
  it('rejects an FCM completion after logout or duplicate registration', (): void => {
    assert.equal(
      canCommitDeviceRegistration('fcm-a', null, () => true),
      true,
    );
    assert.equal(
      canCommitDeviceRegistration('fcm-a', 'fcm-a', () => true),
      false,
    );
    assert.equal(
      canCommitDeviceRegistration('fcm-a', null, () => false),
      false,
    );
  });

  it('rejects an older FCM token rotation after a newer attempt starts', (): void => {
    let latestAttempt = 0;
    const olderAttempt = ++latestAttempt;
    const newerAttempt = ++latestAttempt;

    assert.equal(
      canCommitDeviceRegistration('fcm-a', null, () => olderAttempt === latestAttempt),
      false,
    );
    assert.equal(
      canCommitDeviceRegistration('fcm-b', null, () => newerAttempt === latestAttempt),
      true,
    );
  });

  it('rejects a VoIP completion when the pending token changed or setup stopped', (): void => {
    assert.equal(
      canCommitVoipRegistration('voip-a', 'voip-a', () => true),
      true,
    );
    assert.equal(
      canCommitVoipRegistration('voip-a', 'voip-b', () => true),
      false,
    );
    assert.equal(
      canCommitVoipRegistration('voip-a', 'voip-a', () => false),
      false,
    );
  });
});
