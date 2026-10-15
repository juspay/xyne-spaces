import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  TicketDetailEmailSnapshot,
  TicketDetailSnapshot,
} from '@/src/features/xyne-desks/detail/types';
import {
  emailAttachmentCount,
  mapEmailRow,
  mapEmailRows,
  mapTicketDetail,
  mergeTicketDetailEmails,
  ticketEmailsLookIncomplete,
  visibleEmailAttachments,
} from '@/src/features/xyne-desks/detail/utils/map-ticket-detail';

function expectDetail(row: unknown): TicketDetailSnapshot {
  const detail = mapTicketDetail(row);
  if (detail === null) {
    assert.fail('expected mapTicketDetail to return a snapshot');
  }
  return detail;
}

describe('map-ticket-detail / mapEmailRow', () => {
  it('coerces recipient fields into string arrays and counts attachments', () => {
    const snapshot = mapEmailRow({
      id: 'e1',
      to: ['a@x.com', '', 'b@x.com'],
      cc: 'c@x.com',
      bcc: null,
      replyTo: [1, 'd@x.com'],
      attachments: [{}, {}],
    });
    assert.deepEqual(snapshot.to, ['a@x.com', 'b@x.com']);
    assert.deepEqual(snapshot.cc, ['c@x.com']);
    assert.deepEqual(snapshot.bcc, []);
    assert.deepEqual(snapshot.replyTo, ['d@x.com']);
    assert.equal(snapshot.attachmentCount, 0);
    assert.equal(snapshot.attachments.length, 0);
  });

  it('keeps attachment metadata and skips deleted rows', () => {
    const snapshot = mapEmailRow({
      id: 'e2',
      attachments: [
        {
          id: 'a1',
          originalFilename: 'photo.png',
          mimetype: 'image/png',
          size: 2048,
          isDeleted: false,
        },
        { id: 'a2', originalFilename: 'gone.pdf', isDeleted: true },
        { originalFilename: 'no-id.png' },
      ],
    });

    assert.equal(snapshot.attachmentCount, 1);
    assert.deepEqual(snapshot.attachments, [
      {
        id: 'a1',
        originalFilename: 'photo.png',
        mimetype: 'image/png',
        size: 2048,
        metadata: null,
      },
    ]);
  });
});

describe('map-ticket-detail / mapEmailRows', () => {
  it('drops rows without an id and sorts by createdAt ascending', () => {
    const rows = mapEmailRows([
      { id: 'b', createdAt: 200 },
      { id: '', createdAt: 50 },
      { id: 'a', createdAt: 100 },
    ]);
    assert.deepEqual(
      rows.map(r => r.id),
      ['a', 'b'],
    );
  });

  it('returns an empty array for nullish input', () => {
    assert.deepEqual(mapEmailRows(null), []);
    assert.deepEqual(mapEmailRows(undefined), []);
  });
});

describe('map-ticket-detail / mapTicketDetail', () => {
  it('returns null for non-object rows or rows without an id', () => {
    assert.equal(mapTicketDetail(null), null);
    assert.equal(mapTicketDetail('nope'), null);
    assert.equal(mapTicketDetail({ title: 'x' }), null);
  });

  it('applies fallbacks for missing fields', () => {
    const detail = expectDetail({ id: 't1' });
    assert.equal(detail.xyneId, 't1');
    assert.equal(detail.title, '(No subject)');
    assert.equal(detail.channelId, '');
    assert.equal(detail.status, null);
    assert.equal(detail.isArchived, false);
    assert.equal(detail.emailCount, 0);
    assert.equal(detail.conversationId, null);
    assert.equal(detail.conversation, null);
    assert.equal(detail.deskSource, null);
  });

  it('maps deskSource from App Desk inbound metadata shape', () => {
    // Mirrors public ticketController App Desk inbound ticketMetadata (Zero json object).
    const detail = expectDetail({
      id: 't-app',
      metadata: {
        deskSource: {
          type: 'app',
          installedAppId: 'installed-app-1',
          appName: 'HR Portal',
        },
        fromEmailAddress: 'Ada Lovelace <ada@example.com>',
        reporterEmail: 'ada@example.com',
      },
    });
    assert.deepEqual(detail.deskSource, { type: 'app' });
  });

  it('ignores invalid deskSource metadata and JSON-string metadata', () => {
    assert.equal(mapTicketDetail({ id: 't', metadata: { deskSource: 'app' } })?.deskSource, null);
    assert.equal(
      mapTicketDetail({ id: 't', metadata: { deskSource: { type: 1 } } })?.deskSource,
      null,
    );
    assert.equal(
      mapTicketDetail({
        id: 't',
        metadata: JSON.stringify({ deskSource: { type: 'app' } }),
      })?.deskSource,
      null,
    );
  });

  it('prefers statusV2 over status and resolves the conversation id', () => {
    const detail = expectDetail({
      id: 't2',
      status: 'OLD',
      statusV2: 'OPEN',
      title: '  Hello  ',
      conversation: { id: 'conv-1' },
    });
    assert.equal(detail.status, 'OPEN');
    assert.equal(detail.title, 'Hello');
    assert.equal(detail.conversationId, 'conv-1');
    assert.deepEqual(detail.conversation, { id: 'conv-1' });
  });

  it('falls back emailCount to the mapped email length and sorts emails', () => {
    const detail = expectDetail({
      id: 't3',
      emails: [
        { id: 'e2', createdAt: 20 },
        { id: 'e1', createdAt: 10 },
      ],
    });
    assert.equal(detail.emailCount, 2);
    assert.deepEqual(
      detail.emails.map(e => e.id),
      ['e1', 'e2'],
    );
  });
});

describe('map-ticket-detail / mergeTicketDetailEmails', () => {
  const base = expectDetail({ id: 't', emailCount: 1, emails: [{ id: 'e1', createdAt: 1 }] });

  it('keeps the original detail when the fallback list is empty or not an array', () => {
    assert.equal(mergeTicketDetailEmails(base, []), base);
    assert.equal(mergeTicketDetailEmails(base, 'nope'), base);
  });

  it('keeps the original when it already has at least as many emails', () => {
    assert.equal(mergeTicketDetailEmails(base, [{ id: 'x', createdAt: 5 }]), base);
  });

  it('adopts the richer email list and bumps the count', () => {
    const merged = mergeTicketDetailEmails(base, [
      { id: 'a', createdAt: 1 },
      { id: 'b', createdAt: 2 },
    ]);
    assert.equal(merged.emails.length, 2);
    assert.equal(merged.emailCount, 2);
  });

  it('copies attachments onto the existing chain when counts match', () => {
    const merged = mergeTicketDetailEmails(base, [
      {
        id: 'e1',
        createdAt: 1,
        attachments: [
          { id: 'att-1', originalFilename: 'note.pdf', mimetype: 'application/pdf', size: 12 },
        ],
      },
    ]);
    assert.equal(merged.emails.length, 1);
    assert.equal(merged.emails[0]?.id, 'e1');
    assert.deepEqual(
      merged.emails[0]?.attachments.map(attachment => attachment.id),
      ['att-1'],
    );
  });

  it('does not throw when the existing chain omits attachments', () => {
    const detail = expectDetail({
      id: 't1',
      emails: [{ id: 'e1', createdAt: 1 }],
    });
    const withoutAttachments = {
      ...detail,
      emails: detail.emails.map(email => {
        const { attachments, attachmentCount, ...rest } = email;
        void attachments;
        void attachmentCount;
        return rest as Omit<TicketDetailEmailSnapshot, 'attachments' | 'attachmentCount'>;
      }),
    } as TicketDetailSnapshot;

    const merged = mergeTicketDetailEmails(withoutAttachments, [
      {
        id: 'e1',
        createdAt: 1,
        attachments: [
          { id: 'att-1', originalFilename: 'note.pdf', mimetype: 'application/pdf', size: 12 },
        ],
      },
    ]);
    assert.equal(emailAttachmentCount(withoutAttachments.emails[0]!), 0);
    assert.deepEqual(
      merged.emails[0]?.attachments.map(attachment => attachment.id),
      ['att-1'],
    );
  });
});

describe('map-ticket-detail / ticketEmailsLookIncomplete', () => {
  it('is false when emails are present', () => {
    const detail = expectDetail({ id: 't', emails: [{ id: 'e1', createdAt: 1 }] });
    assert.equal(ticketEmailsLookIncomplete(detail), false);
  });

  it('is true when the ticket claims a thread but emails are empty', () => {
    const byCount = expectDetail({ id: 't', emailCount: 3 });
    const byConversation = expectDetail({ id: 't', conversationId: 'c1' });
    assert.equal(ticketEmailsLookIncomplete(byCount), true);
    assert.equal(ticketEmailsLookIncomplete(byConversation), true);
  });

  it('is false when there is no thread evidence', () => {
    const detail = expectDetail({ id: 't' });
    assert.equal(ticketEmailsLookIncomplete(detail), false);
  });
});

describe('visibleEmailAttachments', () => {
  const file = {
    id: 'att-1',
    originalFilename: 'photo.png',
    mimetype: 'image/png',
    size: 10,
    metadata: null as { contentId?: string; isInline?: boolean } | null,
  };

  it('hides inline cid and data-att-id attachments', () => {
    const visible = visibleEmailAttachments(
      [
        file,
        { ...file, id: 'att-2', metadata: { contentId: 'cid-9' } },
        { ...file, id: 'att-3', metadata: { isInline: true } },
      ],
      '<img src="cid:cid-9"><img data-att-id="att-1">',
    );

    assert.deepEqual(
      visible.map(attachment => attachment.id),
      [],
    );
  });

  it('keeps regular attachments', () => {
    const visible = visibleEmailAttachments([file], '<p>Thanks</p>');
    assert.deepEqual(
      visible.map(attachment => attachment.id),
      ['att-1'],
    );
  });
});

describe('emailAttachmentCount', () => {
  it('treats missing attachments as zero', () => {
    assert.equal(emailAttachmentCount({ id: 'e1' } as never), 0);
  });
});
