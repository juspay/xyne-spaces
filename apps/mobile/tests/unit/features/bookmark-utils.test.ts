import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BookmarkEntityType, ChannelScopeType, type Bookmark } from '@xyne/shared';
import {
  readReminderRecord,
  getCompletionTimestamp,
  isMessageBookmark,
  isCompletedMessageBookmark,
  isActiveMessageBookmark,
  isBookmarkMarkedDone,
  getReminderTimestamp,
  hasActiveReminder,
  compareActiveBookmarks,
  compareCompletedBookmarks,
  partitionMessageBookmarks,
  truncateBookmarkPreview,
  formatReminderFallbackLabel,
  normalizeScopeType,
  getBookmarkSurface,
  resolveBookmarkChatOpenTarget,
} from '@/src/features/bookmarks/bookmark-utils';

const createBookmark = (overrides: Partial<Bookmark> = {}): Bookmark =>
  ({
    id: 'bm-1',
    userId: 'user-1',
    entityId: 'msg-1',
    entityType: BookmarkEntityType.MESSAGE,
    createdAt: 1_000,
    updatedAt: 2_000,
    isDeleted: false,
    isCompleted: false,
    metadata: null,
    ...overrides,
  }) as Bookmark;

describe('readReminderRecord', () => {
  it('reads reminder string fields and the enabled flag', () => {
    const record = readReminderRecord({
      reminder: {
        enabled: true,
        remindAt: '2030-01-01T00:00:00.000Z',
        channelId: 'chan-1',
        status: 'PENDING',
      },
    });
    assert.equal(record?.enabled, true);
    assert.equal(record?.remindAt, '2030-01-01T00:00:00.000Z');
    assert.equal(record?.channelId, 'chan-1');
    assert.equal(record?.status, 'PENDING');
  });

  it('falls back to reminder.context for string fields', () => {
    const record = readReminderRecord({
      reminder: { enabled: true, context: { channelName: 'general' } },
    });
    assert.equal(record?.channelName, 'general');
  });

  it('returns null when there is no reminder object', () => {
    assert.equal(readReminderRecord(null), null);
    assert.equal(readReminderRecord({}), null);
  });
});

describe('completion + message predicates', () => {
  it('getCompletionTimestamp uses completedAt when parseable, else updatedAt', () => {
    assert.equal(
      getCompletionTimestamp(
        createBookmark({ metadata: { completion: { completedAt: '2021-01-01T00:00:00.000Z' } } }),
      ),
      Date.parse('2021-01-01T00:00:00.000Z'),
    );
    assert.equal(getCompletionTimestamp(createBookmark({ updatedAt: 4_242 })), 4_242);
  });

  it('isMessageBookmark requires a non-deleted MESSAGE bookmark', () => {
    assert.equal(isMessageBookmark(createBookmark()), true);
    assert.equal(isMessageBookmark(createBookmark({ isDeleted: true })), false);
    assert.equal(
      isMessageBookmark(createBookmark({ entityType: BookmarkEntityType.TICKET })),
      false,
    );
  });

  it('isCompletedMessageBookmark is true via isCompleted or completion.done with completedAt', () => {
    assert.equal(isCompletedMessageBookmark(createBookmark({ isCompleted: true })), true);
    assert.equal(
      isCompletedMessageBookmark(
        createBookmark({
          metadata: { completion: { done: true, completedAt: '2026-08-18T10:00:00.000Z' } },
        }),
      ),
      true,
    );
    assert.equal(
      isCompletedMessageBookmark(createBookmark({ metadata: { completion: { done: true } } })),
      false,
    );
    assert.equal(isCompletedMessageBookmark(createBookmark()), false);
    assert.equal(isBookmarkMarkedDone({ completion: { done: true, completedAt: '  ' } }), false);
  });

  it('isActiveMessageBookmark is the complement for message bookmarks', () => {
    assert.equal(isActiveMessageBookmark(createBookmark()), true);
    assert.equal(isActiveMessageBookmark(createBookmark({ isCompleted: true })), false);
  });

  it('partitionMessageBookmarks drops a completed copy when the same entity is active', () => {
    const completed = createBookmark({
      id: 'completed',
      entityId: 'msg-1',
      isCompleted: true,
      updatedAt: 5_000,
    });
    const restored = createBookmark({ id: 'restored', entityId: 'msg-1', updatedAt: 6_000 });
    const otherDone = createBookmark({
      id: 'other',
      entityId: 'msg-2',
      isCompleted: false,
      updatedAt: 9_000,
      metadata: { completion: { done: true, completedAt: '2026-08-18T10:00:00.000Z' } },
    });
    const partitioned = partitionMessageBookmarks([completed, restored, otherDone, completed]);
    assert.deepEqual(
      partitioned.all.map(item => item.id),
      ['restored'],
    );
    assert.deepEqual(
      partitioned.complete.map(item => item.id),
      ['other'],
    );
  });
});

describe('reminder timestamps', () => {
  it('getReminderTimestamp parses remindAt or returns null', () => {
    assert.equal(
      getReminderTimestamp(
        createBookmark({ metadata: { reminder: { remindAt: '2030-01-01T00:00:00.000Z' } } }),
      ),
      Date.parse('2030-01-01T00:00:00.000Z'),
    );
    assert.equal(getReminderTimestamp(createBookmark()), null);
    assert.equal(
      getReminderTimestamp(createBookmark({ metadata: { reminder: { remindAt: 'nope' } } })),
      null,
    );
  });

  it('hasActiveReminder is false when disabled, SENT, or CANCELLED', () => {
    const at = '2030-01-01T00:00:00.000Z';
    assert.equal(
      hasActiveReminder(createBookmark({ metadata: { reminder: { remindAt: at } } })),
      true,
    );
    assert.equal(
      hasActiveReminder(
        createBookmark({ metadata: { reminder: { remindAt: at, enabled: false } } }),
      ),
      false,
    );
    assert.equal(
      hasActiveReminder(
        createBookmark({ metadata: { reminder: { remindAt: at, status: 'SENT' } } }),
      ),
      false,
    );
    assert.equal(
      hasActiveReminder(
        createBookmark({ metadata: { reminder: { remindAt: at, status: 'CANCELLED' } } }),
      ),
      false,
    );
  });
});

describe('comparators', () => {
  it('compareActiveBookmarks ranks overdue before upcoming before none', () => {
    const now = Date.now();
    const overdue = createBookmark({
      id: 'overdue',
      metadata: { reminder: { remindAt: new Date(now - 60_000).toISOString() } },
    });
    const upcoming = createBookmark({
      id: 'upcoming',
      metadata: { reminder: { remindAt: new Date(now + 60_000).toISOString() } },
    });
    const none = createBookmark({ id: 'none' });

    const sorted = [none, upcoming, overdue].sort(compareActiveBookmarks).map(b => b.id);
    assert.deepEqual(sorted, ['overdue', 'upcoming', 'none']);
  });

  it('compareCompletedBookmarks orders by completion time descending', () => {
    const older = createBookmark({ id: 'older', updatedAt: 1_000 });
    const newer = createBookmark({ id: 'newer', updatedAt: 9_000 });
    const sorted = [older, newer].sort(compareCompletedBookmarks).map(b => b.id);
    assert.deepEqual(sorted, ['newer', 'older']);
  });
});

describe('formatting + scope helpers', () => {
  it('truncateBookmarkPreview leaves short strings and ellipsises long ones', () => {
    assert.equal(truncateBookmarkPreview('short'), 'short');
    const long = 'a'.repeat(200);
    const out = truncateBookmarkPreview(long);
    assert.equal(out.length, 182);
    assert.ok(out.endsWith('...'));
  });

  it('formatReminderFallbackLabel reflects reminder status', () => {
    assert.equal(formatReminderFallbackLabel({ status: 'SENT' }), 'Reminder sent');
    assert.equal(formatReminderFallbackLabel({ status: 'CANCELLED' }), 'Reminder cancelled');
    assert.equal(formatReminderFallbackLabel({}), 'Reminder set');
    assert.ok(
      formatReminderFallbackLabel({ remindAt: '2030-01-01T09:00:00.000Z' }).startsWith(
        'Reminder for ',
      ),
    );
  });

  it('normalizeScopeType passes valid scope types and rejects others', () => {
    assert.equal(normalizeScopeType('DM'), ChannelScopeType.DM);
    assert.equal(normalizeScopeType('GROUP_DM'), ChannelScopeType.GROUP_DM);
    assert.equal(normalizeScopeType('NONSENSE'), undefined);
    assert.equal(normalizeScopeType(undefined), undefined);
  });

  it('getBookmarkSurface routes DMs to "dms" and the rest to "channels"', () => {
    assert.equal(getBookmarkSurface('DM'), 'dms');
    assert.equal(getBookmarkSurface('GROUP_DM'), 'dms');
    assert.equal(getBookmarkSurface('DEFAULT'), 'channels');
    assert.equal(getBookmarkSurface(undefined), 'channels');
  });
});

describe('resolveBookmarkChatOpenTarget', () => {
  it('returns null without a channel id', () => {
    assert.equal(
      resolveBookmarkChatOpenTarget({
        bookmarkEntityId: 'msg-1',
        channelId: '  ',
      }),
      null,
    );
  });

  it('includes conversation createdAt so old channel bookmarks can open a linked window', () => {
    const target = resolveBookmarkChatOpenTarget({
      bookmarkEntityId: 'msg-old',
      channelId: 'channel-1',
      conversationId: 'conv-1',
      scopeType: 'DEFAULT',
      hydratedMessage: {
        messageId: 'msg-old',
        conversationId: 'conv-1',
        senderId: 'u-1',
        content: 'hello from the past',
        createdAt: 1_700_000_000_000,
        hasAttachment: false,
        isDeleted: false,
        conversation: {
          channelId: 'channel-1',
          conversationId: 'conv-1',
          initialMessageId: 'msg-old',
          createdAt: 1_700_000_000_000,
        },
      },
    });

    assert.deepEqual(target, {
      channelId: 'channel-1',
      messageId: 'msg-old',
      conversationId: 'conv-1',
      createdAt: 1_700_000_000_000,
      surface: 'channels',
      scopeType: ChannelScopeType.DEFAULT,
    });
  });

  it('falls back to message createdAt when conversation cursor is missing', () => {
    const target = resolveBookmarkChatOpenTarget({
      bookmarkEntityId: 'msg-2',
      channelId: 'channel-1',
      conversationId: 'conv-2',
      hydratedMessage: {
        messageId: 'msg-2',
        conversationId: 'conv-2',
        senderId: 'u-1',
        content: 'hi',
        createdAt: 42,
        hasAttachment: false,
        isDeleted: false,
        conversation: {
          channelId: 'channel-1',
          conversationId: 'conv-2',
          initialMessageId: 'msg-2',
        },
      },
    });

    assert.equal(target?.createdAt, 42);
  });

  it('classifies thread reply bookmarks with threadId', () => {
    const target = resolveBookmarkChatOpenTarget({
      bookmarkEntityId: 'reply-1',
      channelId: 'channel-1',
      conversationId: 'thread-1',
      hydratedMessage: {
        messageId: 'reply-1',
        conversationId: 'thread-1',
        senderId: 'u-1',
        content: 'reply',
        createdAt: 99,
        hasAttachment: false,
        isDeleted: false,
        conversation: {
          channelId: 'channel-1',
          conversationId: 'thread-1',
          initialMessageId: 'parent-1',
          createdAt: 50,
        },
      },
    });

    assert.equal(target?.threadId, 'thread-1');
    assert.equal(target?.createdAt, 50);
  });
});
