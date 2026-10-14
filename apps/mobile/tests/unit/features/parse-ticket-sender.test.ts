import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseTicketSender } from '@/src/features/xyne-desks/tickets/utils/parse-ticket-sender';

describe('parseTicketSender', () => {
  it('splits "Name <email>" into name and address', () => {
    assert.deepEqual(parseTicketSender('Alice <alice@x.com>'), {
      senderName: 'Alice',
      email: 'alice@x.com',
    });
  });

  it('strips quotes around the display name', () => {
    assert.deepEqual(parseTicketSender('"Bob B" <bob@x.com>'), {
      senderName: 'Bob B',
      email: 'bob@x.com',
    });
  });

  it('falls back to the address as the name when only an address is bracketed', () => {
    assert.deepEqual(parseTicketSender('<only@x.com>'), {
      senderName: 'only@x.com',
      email: 'only@x.com',
    });
  });

  it('extracts a bare email as both name and address', () => {
    assert.deepEqual(parseTicketSender('bare@x.com'), {
      senderName: 'bare@x.com',
      email: 'bare@x.com',
    });
  });

  it('returns free text with a null email when no address is present', () => {
    assert.deepEqual(parseTicketSender('text with no email'), {
      senderName: 'text with no email',
      email: null,
    });
  });

  it('returns an empty name and null email for empty or nullish input', () => {
    assert.deepEqual(parseTicketSender(''), { senderName: '', email: null });
    assert.deepEqual(parseTicketSender(null), { senderName: '', email: null });
    assert.deepEqual(parseTicketSender(undefined), { senderName: '', email: null });
  });
});
