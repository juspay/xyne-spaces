import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { TicketDetailSnapshot } from '@/src/features/xyne-desks/detail/types';
import {
  mapEmailRow,
  mapEmailRows,
  mapTicketDetail,
  mergeTicketDetailEmails,
  ticketEmailsLookIncomplete,
} from '@/src/features/xyne-desks/detail/utils/map-ticket-detail';

describe('mapEmailRow', () => {
  it('fills defaults and coerces address fields to string arrays', () => {
    assert.deepEqual(mapEmailRow({ id: 'e1' }), {
      id: 'e1',
      type: null,
      subject: null,
      from: null,
      to: [],
      cc: [],
      bcc: [],
      replyTo: [],
      body: null,
      createdAt: null,
      updatedAt: null,
      externalThreadId: null,
      externalMessageId: null,
      attachmentCount: 0,
      attachments: [],
    });
  });

  it('normalizes array and string address fields and counts attachments', () => {
    const out = mapEmailRow({
      id: 'e2',
      to: ['a@x', '', 'b@y'],
      cc: 'c@x',
      attachments: [{}, {}],
    });
    assert.deepEqual(out.to, ['a@x', 'b@y']);
    assert.deepEqual(out.cc, ['c@x']);
    assert.equal(out.attachmentCount, 0);
    assert.equal(out.attachments.length, 0);
  });
});

describe('mapEmailRows', () => {
  it('drops rows without an id and sorts by createdAt ascending', () => {
    const out = mapEmailRows([
      { id: 'b', createdAt: 200 },
      { id: '', createdAt: 50 },
      { id: 'a', createdAt: 100 },
    ]);
    assert.deepEqual(
      out.map(e => e.id),
      ['a', 'b'],
    );
  });

  it('returns an empty array for null/undefined', () => {
    assert.deepEqual(mapEmailRows(null), []);
    assert.deepEqual(mapEmailRows(undefined), []);
  });
});

describe('mapTicketDetail', () => {
  it('returns null for non-object input or a row without an id', () => {
    assert.equal(mapTicketDetail(null), null);
    assert.equal(mapTicketDetail(42), null);
    assert.equal(mapTicketDetail({ title: 'x' }), null);
  });

  it('maps a minimal row with defaults', () => {
    const out = mapTicketDetail({ id: 't1' });
    assert.equal(out?.xyneId, 't1');
    assert.equal(out?.title, '(No subject)');
    assert.equal(out?.channelId, '');
    assert.equal(out?.status, null);
    assert.equal(out?.isArchived, false);
    assert.equal(out?.emailCount, 0);
    assert.deepEqual(out?.emails, []);
    assert.equal(out?.conversationId, null);
    assert.equal(out?.conversation, null);
  });

  it('derives emailCount from emails and conversationId from the nested conversation', () => {
    const out = mapTicketDetail({
      id: 't2',
      statusV2: 'DONE',
      status: 'OPEN',
      isArchived: true,
      emails: [{ id: 'e1', createdAt: 5 }],
      conversation: { id: 'c9' },
    });
    assert.equal(out?.status, 'DONE');
    assert.equal(out?.isArchived, true);
    assert.equal(out?.emailCount, 1);
    assert.equal(out?.conversationId, 'c9');
    assert.deepEqual(out?.conversation, { id: 'c9' });
  });
});

describe('mergeTicketDetailEmails', () => {
  const base = mapTicketDetail({ id: 't1' }) as TicketDetailSnapshot;

  it('keeps the detail when the incoming list is empty or not an array', () => {
    assert.equal(mergeTicketDetailEmails(base, []), base);
    assert.equal(mergeTicketDetailEmails(base, null), base);
  });

  it('prefers the richer incoming email list', () => {
    const merged = mergeTicketDetailEmails(base, [
      { id: 'e1', createdAt: 1 },
      { id: 'e2', createdAt: 2 },
    ]);
    assert.equal(merged.emails.length, 2);
    assert.equal(merged.emailCount, 2);
  });
});

describe('ticketEmailsLookIncomplete', () => {
  it('is false when emails are present', () => {
    const detail = mapTicketDetail({
      id: 't1',
      emails: [{ id: 'e1', createdAt: 1 }],
    }) as TicketDetailSnapshot;
    assert.equal(ticketEmailsLookIncomplete(detail), false);
  });

  it('is false for an empty ticket with no thread signals', () => {
    const detail = mapTicketDetail({ id: 't1' }) as TicketDetailSnapshot;
    assert.equal(ticketEmailsLookIncomplete(detail), false);
  });

  it('is true when the ticket claims a thread but has no emails', () => {
    const withConversation = mapTicketDetail({
      id: 't1',
      conversationId: 'c1',
    }) as TicketDetailSnapshot;
    assert.equal(ticketEmailsLookIncomplete(withConversation), true);

    const withCount = mapTicketDetail({ id: 't2', emailCount: 3 }) as TicketDetailSnapshot;
    assert.equal(ticketEmailsLookIncomplete(withCount), true);
  });
});
