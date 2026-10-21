import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MailboxState } from '@xyne/shared';

import { filterSupportTicketsByMailboxFolder } from '@/src/features/xyne-desks/tickets/utils/filter-support-tickets-by-mailbox-folder';

describe('filterSupportTicketsByMailboxFolder', () => {
  const rows = [
    { id: 'inbox-default' },
    { id: 'inbox-overlay', userMailbox: [{ state: MailboxState.INBOX }] },
    { id: 'archived', userMailbox: [{ state: MailboxState.ARCHIVED }] },
    { id: 'spam', userMailbox: [{ state: MailboxState.SPAM }] },
    { id: 'ticket-archived', isArchived: true },
  ];

  it('passes through server-filtered folders unchanged', () => {
    assert.equal(filterSupportTicketsByMailboxFolder(rows, 'starred').length, rows.length);
    assert.equal(filterSupportTicketsByMailboxFolder(rows, 'spam').length, rows.length);
  });

  it('keeps inbox overlays and drops archived/spam/ticket-archived', () => {
    const out = filterSupportTicketsByMailboxFolder(rows, 'inbox');
    assert.deepEqual(
      out.map(r => r.id),
      ['inbox-default', 'inbox-overlay'],
    );
  });

  it('keeps overlay-archived in All Mail and drops spam plus ticket-level archived', () => {
    const out = filterSupportTicketsByMailboxFolder(rows, 'all');
    assert.deepEqual(
      out.map(r => r.id),
      ['inbox-default', 'inbox-overlay', 'archived'],
    );
  });
});
