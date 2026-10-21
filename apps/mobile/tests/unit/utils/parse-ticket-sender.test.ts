import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseTicketSender } from '@/src/features/xyne-desks/tickets/utils/parse-ticket-sender';

describe('parseTicketSender', () => {
  it('returns an empty sender for nullish or blank input', () => {
    assert.deepEqual(parseTicketSender(null), { senderName: '', email: null });
    assert.deepEqual(parseTicketSender(undefined), { senderName: '', email: null });
    assert.deepEqual(parseTicketSender(''), { senderName: '', email: null });
    assert.deepEqual(parseTicketSender('   '), { senderName: '', email: null });
  });

  it('parses a "Name <email>" pair', () => {
    assert.deepEqual(parseTicketSender('Krishna <k@x.com>'), {
      senderName: 'Krishna',
      email: 'k@x.com',
    });
  });

  it('strips surrounding quotes from the name', () => {
    assert.deepEqual(parseTicketSender('"Support Team" <s@x.com>'), {
      senderName: 'Support Team',
      email: 's@x.com',
    });
  });

  it('falls back to the email as the name when the angle name is empty', () => {
    assert.deepEqual(parseTicketSender('<only@x.com>'), {
      senderName: 'only@x.com',
      email: 'only@x.com',
    });
  });

  it('extracts a bare email address', () => {
    assert.deepEqual(parseTicketSender('hello@world.com'), {
      senderName: 'hello@world.com',
      email: 'hello@world.com',
    });
  });

  it('finds an embedded email inside free text', () => {
    assert.deepEqual(parseTicketSender('reply to foo@bar.com please'), {
      senderName: 'foo@bar.com',
      email: 'foo@bar.com',
    });
  });

  it('returns the raw text with no email when none is present', () => {
    assert.deepEqual(parseTicketSender('no email here'), {
      senderName: 'no email here',
      email: null,
    });
  });
});
