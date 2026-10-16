import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canSendDraft,
  composerDraftLookupId,
  compareDrafts,
  sortDrafts,
  dayKey,
  draftPreviewText,
  formatSentDayLabel,
  groupSentByDay,
  isScheduledDueSoon,
  parseDraftsSentTab,
  sortScheduled,
  stripDraftHtml,
  truncatePreview,
  type DelayedMessageRow,
  type DraftMessageRow,
  type SentMessageRow,
} from '@/src/features/drafts-sent/drafts-sent-utils';

describe('stripDraftHtml + preview', () => {
  it('strips tags and decodes a few entities', () => {
    assert.equal(stripDraftHtml('<p>Hello&nbsp;world &amp; co</p>'), 'Hello world & co');
  });

  it('falls back to empty-draft or attachment when there is no text', () => {
    assert.equal(draftPreviewText('<p></p>', false), '(empty draft)');
    assert.equal(draftPreviewText('   ', true), 'Attachment');
    assert.equal(draftPreviewText('<p>Saved note</p>', false), 'Saved note');
    assert.equal(draftPreviewText('<p></p>', false, 'Attachment', '(no text)'), '(no text)');
  });

  it('truncates long previews', () => {
    const preview = truncatePreview('a'.repeat(200));
    assert.equal(preview.endsWith('...'), true);
    assert.ok(preview.length < 200);
  });

  it('canSendDraft requires text or an attachment', () => {
    assert.equal(canSendDraft('<p></p>', false), false);
    assert.equal(canSendDraft('', true), true);
    assert.equal(canSendDraft('<p>hi</p>', false), true);
  });
});

describe('sorting + tabs', () => {
  it('sorts drafts by updatedAt desc then id desc', () => {
    const older = { id: 'b', updatedAt: 1 } as never;
    const newer = { id: 'a', updatedAt: 2 } as never;
    const sameTimeEarlierId = { id: 'c', updatedAt: 2 } as never;
    assert.ok(compareDrafts(newer, older) < 0);
    assert.ok(compareDrafts(sameTimeEarlierId, newer) < 0);
  });

  it('matches dashboard: hide empty content unless related attachment rows exist', () => {
    const rows = [
      { id: 'empty-html', content: '<p></p>', hasAttachment: false, attachments: [], updatedAt: 5 },
      { id: 'kept', content: '<p>hi</p>', hasAttachment: false, attachments: [], updatedAt: 4 },
      {
        id: 'ghost-flag',
        content: '',
        hasAttachment: true,
        attachments: [],
        updatedAt: 3,
      },
      {
        id: 'with-file',
        content: '',
        hasAttachment: true,
        attachments: [{ id: 'a1' }],
        updatedAt: 2,
      },
      {
        id: 'blank',
        content: '   ',
        hasAttachment: false,
        attachments: [],
        updatedAt: 1,
      },
      {
        id: 'twin',
        content: 'proposal',
        hasAttachment: false,
        attachments: [],
        updatedAt: 6,
        origin: 'twin',
      },
    ] as unknown as DraftMessageRow[];
    assert.deepEqual(
      sortDrafts(rows).map(row => row.id),
      ['empty-html', 'kept', 'with-file'],
    );
  });

  it('keeps only PENDING scheduled rows and sorts by scheduledFor asc', () => {
    const rows = [
      { id: 'late', scheduledFor: 30, status: 'PENDING' },
      { id: 'done', scheduledFor: 10, status: 'SENT' },
      { id: 'soon', scheduledFor: 20, status: 'PENDING' },
    ] as unknown as DelayedMessageRow[];
    assert.deepEqual(
      sortScheduled(rows).map(row => row.id),
      ['soon', 'late'],
    );
  });

  it('parses tab query params', () => {
    assert.equal(parseDraftsSentTab('scheduled'), 'scheduled');
    assert.equal(parseDraftsSentTab('twin'), 'twin');
    assert.equal(parseDraftsSentTab('nope'), 'drafts');
  });
});

describe('scheduled chip + sent grouping', () => {
  it('marks due-soon when within an hour in the future', () => {
    const now = 1_000_000;
    assert.equal(isScheduledDueSoon(now + 10 * 60 * 1000, now), true);
    assert.equal(isScheduledDueSoon(now + 2 * 60 * 60 * 1000, now), false);
    assert.equal(isScheduledDueSoon(now - 1000, now), false);
  });

  it('groups sent rows by local calendar day, newest first assumed by input order', () => {
    const today = new Date();
    today.setHours(15, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const rows = [
      { messageId: 'm1', createdAt: today.getTime() },
      { messageId: 'm2', createdAt: today.getTime() - 1000 },
      { messageId: 'm3', createdAt: yesterday.getTime() },
    ] as unknown as SentMessageRow[];

    const grouped = groupSentByDay(rows);
    assert.equal(grouped[0]?.type, 'header');
    assert.equal(grouped[0] && grouped[0].type === 'header' ? grouped[0].label : '', 'Today');
    assert.equal(grouped.filter(entry => entry.type === 'row').length, 3);
    assert.equal(dayKey(today.getTime()), dayKey(today.getTime() - 1000));
    assert.equal(formatSentDayLabel(yesterday.getTime(), today.getTime()), 'Yesterday');
  });

  it('formats sent day labels with full month and year when needed', () => {
    const sameYear = new Date(2026, 0, 15); // Jan 15 2026
    const otherYear = new Date(2024, 0, 15);
    assert.equal(
      formatSentDayLabel(sameYear.getTime(), new Date(2026, 5, 1).getTime()),
      'Thursday, January 15',
    );
    assert.equal(
      formatSentDayLabel(otherYear.getTime(), new Date(2026, 5, 1).getTime()),
      'Monday, January 15, 2024',
    );
  });
});

describe('composerDraftLookupId', () => {
  it('uses channel id for channel drafts and channel:thread for thread drafts', () => {
    assert.equal(composerDraftLookupId('ch-1', null), 'ch-1');
    assert.equal(composerDraftLookupId('ch-1', 'thread-9'), 'ch-1:thread-9');
  });
});
