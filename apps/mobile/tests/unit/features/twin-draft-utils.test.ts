import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DraftMessageRow } from '@/src/features/drafts-sent/drafts-sent-utils';
import {
  formatTwinDestinationLabel,
  listTwinDraftViews,
  partitionUserDrafts,
  rowToTwinReplyDraftView,
  twinDraftPreview,
} from '@/src/features/drafts-sent/twin-draft-utils';

const twinRow = (overrides: Partial<DraftMessageRow> & { id: string }): DraftMessageRow =>
  ({
    channelId: 'ch-1',
    conversationId: 'conv-1',
    userId: 'u-1',
    content: '',
    hasAttachment: false,
    createdAt: 100,
    updatedAt: 100,
    origin: 'twin',
    metadata: JSON.stringify({
      action: 'reply',
      message: 'Thanks for the ping',
      destinationKind: 'origin_thread',
      createdAt: 200,
    }),
    ...overrides,
  }) as DraftMessageRow;

describe('twin draft partition + parse', () => {
  it('partitions twin rows away from composer drafts', () => {
    const rows = [
      twinRow({ id: 't1' }),
      {
        id: 'u1',
        channelId: 'ch-1',
        conversationId: null,
        userId: 'u-1',
        content: 'hello',
        hasAttachment: false,
        createdAt: 1,
        updatedAt: 1,
        origin: null,
      },
    ] as unknown as DraftMessageRow[];

    const { userDrafts, twinDraftRows } = partitionUserDrafts(rows);
    assert.deepEqual(
      userDrafts.map(row => row.id),
      ['u1'],
    );
    assert.deepEqual(
      twinDraftRows.map(row => row.id),
      ['t1'],
    );
  });

  it('parses metadata into TwinReplyDraftView using row id', () => {
    const view = rowToTwinReplyDraftView(twinRow({ id: 'draft-9' }));
    assert.ok(view);
    assert.equal(view?.id, 'draft-9');
    assert.equal(view?.conversationId, 'conv-1');
    assert.equal(view?.action, 'reply');
    assert.equal(view?.message, 'Thanks for the ping');
    assert.equal(view?.createdAt, 200);
  });

  it('falls back to row.messageId when metadata omits sourceMessageId', () => {
    const view = rowToTwinReplyDraftView(
      twinRow({
        id: 'draft-10',
        messageId: 'msg-from-row',
        metadata: JSON.stringify({
          action: 'reply',
          message: 'hi',
          destinationKind: 'origin_thread',
        }),
      }),
    );
    assert.equal(view?.sourceMessageId, 'msg-from-row');
  });

  it('sorts twin views by createdAt desc', () => {
    const views = listTwinDraftViews([
      twinRow({
        id: 'older',
        metadata: JSON.stringify({ action: 'reply', message: 'a', createdAt: 10 }),
      }),
      twinRow({
        id: 'newer',
        metadata: JSON.stringify({ action: 'react', emoji: '👍', createdAt: 30 }),
      }),
    ]);
    assert.deepEqual(
      views.map(view => view.id),
      ['newer', 'older'],
    );
  });

  it('builds previews for react and reply actions', () => {
    assert.equal(
      twinDraftPreview({
        id: '1',
        channelId: 'ch',
        conversationId: 'c',
        action: 'react',
        emoji: '🎉',
        destinationKind: 'origin_thread',
        createdAt: 1,
      }),
      'Reacts 🎉',
    );
    assert.equal(
      twinDraftPreview({
        id: '2',
        channelId: 'ch',
        conversationId: 'c',
        action: 'reply',
        message: 'Thanks for the ping',
        destinationKind: 'origin_thread',
        createdAt: 1,
      }),
      'Thanks for the ping',
    );
    assert.equal(
      twinDraftPreview({
        id: '3',
        channelId: 'ch',
        conversationId: 'c',
        action: 'reply',
        destinationKind: 'origin_thread',
        createdAt: 1,
      }),
      '(no message)',
    );
    assert.equal(
      twinDraftPreview(
        {
          id: '4',
          channelId: 'ch',
          conversationId: 'c',
          action: 'reply',
          destinationKind: 'origin_thread',
          createdAt: 1,
        },
        '<p>Fallback from content</p>',
      ),
      'Fallback from content',
    );
  });

  it('formats destination labels', () => {
    assert.equal(
      formatTwinDestinationLabel({
        id: '1',
        channelId: 'ch',
        conversationId: 'c',
        action: 'reply',
        destinationKind: 'dm',
        destinationUserName: 'Alex',
        createdAt: 1,
      }),
      'Send as DM to Alex',
    );
  });
});
