import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildMailboxReplyRecipients,
  isDeskOutboundEmail,
  parseDefaultCcEmails,
  parseRecipientInput,
} from '@/src/features/xyne-desks/detail/components/mailbox-reply/mailbox-reply.utils';
import { resolveDeskMailboxIdentity } from '@/src/features/xyne-desks/detail/utils/resolve-desk-mailbox-identity';

const latestEmail = {
  from: 'Alice <alice@example.com>',
  to: ['agent@xyne.com', 'bob@example.com'],
  cc: ['cc@example.com'],
  replyTo: [] as string[],
};

describe('resolveDeskMailboxIdentity', () => {
  it('prefers configured send-as over the signed-in agent', () => {
    const identity = resolveDeskMailboxIdentity(
      { sendAsEmail: 'support@example.com', dlEmail: 'desk-list@example.com' },
      [{ id: 'owner', email: 'owner@example.com' }],
      'agent@example.com',
    );

    assert.equal(identity.fromEmail, 'support@example.com');
    assert.deepEqual([...identity.selfEmails].sort(), [
      'agent@example.com',
      'desk-list@example.com',
      'support@example.com',
    ]);
  });

  it('falls back to the desk owner when send-as is missing', () => {
    const identity = resolveDeskMailboxIdentity(
      { ownerUserId: 'owner-1' },
      [{ id: 'owner-1', email: 'owner@example.com' }],
      'agent@example.com',
    );

    assert.equal(identity.fromEmail, 'owner@example.com');
    assert.ok(identity.selfEmails.includes('owner@example.com'));
  });
});

describe('isDeskOutboundEmail', () => {
  it('treats reply types as desk outbound', () => {
    assert.equal(isDeskOutboundEmail({ type: 'REPLY' }), true);
    assert.equal(isDeskOutboundEmail({ type: 'REPLY_ALL' }), true);
    assert.equal(isDeskOutboundEmail({ type: 'DEFAULT' }), false);
  });
});

describe('buildMailboxReplyRecipients', () => {
  it('reply-all puts sender and other recipients on To, excluding self', () => {
    const recipients = buildMailboxReplyRecipients(
      latestEmail,
      ['agent@xyne.com'],
      undefined,
      'replyAll',
    );

    assert.deepEqual(
      recipients.to.map(recipient => recipient.email),
      ['alice@example.com', 'bob@example.com'],
    );
    assert.deepEqual(
      recipients.cc.map(recipient => recipient.email),
      ['cc@example.com'],
    );
    assert.deepEqual(recipients.bcc, []);
  });

  it('reply-all prefers reply-to over from', () => {
    const recipients = buildMailboxReplyRecipients(
      { ...latestEmail, replyTo: ['support@example.com'] },
      ['agent@xyne.com'],
      undefined,
      'replyAll',
    );

    assert.deepEqual(
      recipients.to.map(recipient => recipient.email),
      ['support@example.com', 'bob@example.com'],
    );
  });

  it('reply uses the sender as To', () => {
    const recipients = buildMailboxReplyRecipients(
      latestEmail,
      ['agent@xyne.com'],
      undefined,
      'reply',
    );

    assert.deepEqual(
      recipients.to.map(recipient => recipient.email),
      ['alice@example.com'],
    );
    assert.deepEqual(recipients.cc, []);
  });

  it('reply to a self-sent email uses the original To list', () => {
    const recipients = buildMailboxReplyRecipients(
      { ...latestEmail, from: 'agent@xyne.com' },
      ['agent@xyne.com'],
      undefined,
      'reply',
    );

    assert.deepEqual(
      recipients.to.map(recipient => recipient.email),
      ['bob@example.com'],
    );
  });

  it('reply to a desk-sent email targets original recipients instead of the desk mailbox', () => {
    const recipients = buildMailboxReplyRecipients(
      {
        type: 'REPLY',
        from: 'Support <support@example.com>',
        to: ['customer@example.com'],
        cc: [],
        replyTo: [],
      },
      ['support@example.com', 'agent@example.com'],
      undefined,
      'reply',
    );

    assert.deepEqual(
      recipients.to.map(recipient => recipient.email),
      ['customer@example.com'],
    );
  });

  it('reply-all excludes the desk mailbox when the latest email was sent by the desk', () => {
    const recipients = buildMailboxReplyRecipients(
      {
        type: 'REPLY_ALL',
        from: 'Support <support@example.com>',
        to: ['customer@example.com', 'support@example.com'],
        cc: ['cc@example.com'],
        replyTo: [],
      },
      ['support@example.com', 'agent@example.com'],
      undefined,
      'replyAll',
    );

    assert.deepEqual(
      recipients.to.map(recipient => recipient.email),
      ['customer@example.com'],
    );
    assert.deepEqual(
      recipients.cc.map(recipient => recipient.email),
      ['cc@example.com'],
    );
  });
});

describe('parseDefaultCcEmails', () => {
  it('parses JSON string arrays', () => {
    assert.deepEqual(parseDefaultCcEmails('["a@x.com","b@x.com"]'), ['a@x.com', 'b@x.com']);
  });

  it('parses comma-separated desk preferences', () => {
    assert.deepEqual(parseDefaultCcEmails('a@x.com, b@x.com; c@x.com'), [
      'a@x.com',
      'b@x.com',
      'c@x.com',
    ]);
  });

  it('returns an empty list for blank values', () => {
    assert.deepEqual(parseDefaultCcEmails(''), []);
    assert.deepEqual(parseDefaultCcEmails(null), []);
    assert.deepEqual(parseDefaultCcEmails(undefined), []);
  });
});

describe('parseRecipientInput', () => {
  it('does not commit a name query when space is typed without @', () => {
    const parsed = parseRecipientInput('deepak oram', false);
    assert.deepEqual(parsed.recipients, []);
    assert.equal(parsed.remainder, 'deepak oram');
  });

  it('commits emails on space only after @ is present', () => {
    const parsed = parseRecipientInput('ada@x.com ', false);
    assert.deepEqual(
      parsed.recipients.map(recipient => recipient.email),
      ['ada@x.com'],
    );
    assert.equal(parsed.remainder, '');
  });
});
