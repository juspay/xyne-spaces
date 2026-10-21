import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveDeskMailboxIdentity } from '@/src/features/xyne-desks/detail/utils/resolve-desk-mailbox-identity';

describe('resolveDeskMailboxIdentity', () => {
  it('uses send-as email for From and treats dlEmail as a self alias', () => {
    const identity = resolveDeskMailboxIdentity(
      {
        sendAsEmail: 'Support Desk <support@example.com>',
        dlEmail: 'desk-list@example.com',
        ownerUserId: 'owner-1',
      },
      [{ id: 'owner-1', email: 'owner@example.com' }],
      'agent@example.com',
    );

    assert.equal(identity.fromEmail, 'support@example.com');
    assert.ok(identity.selfEmails.includes('support@example.com'));
    assert.ok(identity.selfEmails.includes('desk-list@example.com'));
    assert.ok(identity.selfEmails.includes('owner@example.com'));
    assert.ok(identity.selfEmails.includes('agent@example.com'));
  });
});
