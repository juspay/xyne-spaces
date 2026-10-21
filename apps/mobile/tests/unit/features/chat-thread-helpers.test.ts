import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MessageItem } from '@/src/components/message-composer';
import {
  dedupeAndSortThreadMessages,
  isThreadTargetCached,
  mergeOpeningThreadMessages,
  shouldHoldThreadTargetWhileEmpty,
} from '@/src/features/chat/v2/components/chat/chat-thread-helpers';

const createMessage = (messageId: string, createdAt: number, source: string): MessageItem =>
  ({
    messageId,
    createdAt,
    source,
    isSent: source === 'server',
    content: `content-${messageId}`,
  }) as unknown as MessageItem;

describe('chat thread data policy', () => {
  it('keeps the thread root first, drops duplicate message keys, and sorts replies', () => {
    const parent = createMessage('parent', 300, 'server');
    const lateReply = createMessage('reply-late', 500, 'server');
    const earlyReply = createMessage('reply-early', 400, 'server');
    const duplicateReply = createMessage('reply-late', 500, 'pending');

    const normalized = dedupeAndSortThreadMessages(
      [parent, duplicateReply, lateReply, earlyReply],
      'thread-1',
    );

    assert.deepEqual(
      normalized.map(message => (message as unknown as { messageId: string }).messageId),
      ['parent', 'reply-early', 'reply-late'],
    );
    assert.equal(normalized[2], lateReply);
  });

  it('requires the exact target before treating a cached thread as ready', () => {
    const parent = createMessage('parent', 100, 'server');
    const reply = createMessage('reply', 200, 'server');

    assert.equal(isThreadTargetCached([], 'reply'), false);
    assert.equal(isThreadTargetCached([parent], 'reply'), false);
    assert.equal(isThreadTargetCached([parent, reply], 'reply'), true);
    assert.equal(isThreadTargetCached([parent], undefined), true);
  });

  it('keeps existing thread rows visible while a newer target syncs', () => {
    assert.equal(
      shouldHoldThreadTargetWhileEmpty({
        messageId: 'reply',
        hasWarmTarget: false,
        hasMessages: true,
        hasQueryError: false,
        didUserScroll: false,
      }),
      false,
    );
    assert.equal(
      shouldHoldThreadTargetWhileEmpty({
        messageId: 'reply',
        hasWarmTarget: false,
        hasMessages: false,
        hasQueryError: false,
        didUserScroll: false,
      }),
      true,
    );
    assert.equal(
      shouldHoldThreadTargetWhileEmpty({
        messageId: 'reply',
        hasWarmTarget: true,
        hasMessages: false,
        hasQueryError: false,
        didUserScroll: false,
      }),
      false,
    );
  });

  it('keeps the opening window until the live thread query is complete', () => {
    const openingParent = createMessage('parent', 100, 'server');
    const openingTarget = createMessage('reply', 200, 'server');
    const openingLaterReply = createMessage('later-reply', 300, 'server');
    const liveParent = createMessage('parent', 100, 'server');
    const liveTarget = createMessage('reply', 200, 'server');

    const duringLoad = mergeOpeningThreadMessages({
      openingMessages: [openingParent, openingTarget, openingLaterReply],
      liveMessages: [liveParent, liveTarget],
      messageId: 'reply',
      liveQueryComplete: false,
      threadId: 'thread-1',
    });
    assert.deepEqual(
      duringLoad.map(message => message.messageId),
      ['parent', 'reply', 'later-reply'],
    );

    const afterLoad = mergeOpeningThreadMessages({
      openingMessages: [openingParent, openingTarget, openingLaterReply],
      liveMessages: [liveParent, liveTarget],
      messageId: 'reply',
      liveQueryComplete: true,
      threadId: 'thread-1',
    });
    assert.deepEqual(
      afterLoad.map(message => message.messageId),
      ['parent', 'reply'],
    );
  });

  it('keeps a cached window painted while the anchored target is still missing', () => {
    const cachedTail = [
      createMessage('older-tail', 100, 'server'),
      createMessage('latest-tail', 200, 'server'),
    ];
    const liveAnchoredWindow = [
      createMessage('parent', 900, 'server'),
      createMessage('target', 1000, 'server'),
    ];

    const whileTargetIsMissing = mergeOpeningThreadMessages({
      openingMessages: cachedTail,
      liveMessages: [createMessage('newer-live-row', 300, 'server')],
      messageId: 'target',
      liveQueryComplete: false,
      threadId: 'thread-1',
    });
    // `threadConversation` is unpaginated, so a cached window is the whole
    // thread and an absent target can only be newer than everything in it.
    // Painting the union is correct and tail-anchored; blanking here put a
    // skeleton over a thread the user had already read.
    assert.deepEqual(
      whileTargetIsMissing.map(message => message.messageId),
      ['older-tail', 'latest-tail', 'newer-live-row'],
    );

    const afterMissingTargetCompletes = mergeOpeningThreadMessages({
      openingMessages: cachedTail,
      liveMessages: [createMessage('newer-live-row', 300, 'server')],
      messageId: 'target',
      liveQueryComplete: true,
      threadId: 'thread-1',
    });
    // Live is "complete" but doesn't have the target — it's stale.
    // Return the opening window as-is to avoid blank messages from
    // incomplete live data.
    assert.deepEqual(
      afterMissingTargetCompletes.map(message => message.messageId),
      ['older-tail', 'latest-tail'],
    );

    const whenTargetArrives = mergeOpeningThreadMessages({
      openingMessages: cachedTail,
      liveMessages: liveAnchoredWindow,
      messageId: 'target',
      liveQueryComplete: false,
      threadId: 'thread-1',
    });
    // A live window that merely holds the target first is usually a partial
    // materialization; it must not evict the rest of the thread.
    assert.deepEqual(
      whenTargetArrives.map(message => message.messageId),
      ['older-tail', 'latest-tail', 'parent', 'target'],
    );

    const afterTargetSettles = mergeOpeningThreadMessages({
      openingMessages: cachedTail,
      liveMessages: liveAnchoredWindow,
      messageId: 'target',
      liveQueryComplete: true,
      threadId: 'thread-1',
    });
    // Once the live query settles and has the target it is authoritative.
    assert.deepEqual(
      afterTargetSettles.map(message => message.messageId),
      ['parent', 'target'],
    );

    const afterUserScroll = mergeOpeningThreadMessages({
      openingMessages: cachedTail,
      liveMessages: liveAnchoredWindow,
      messageId: 'target',
      liveQueryComplete: false,
      threadId: 'thread-1',
      preserveOpeningWindow: true,
    });
    assert.deepEqual(
      afterUserScroll.map(message => message.messageId),
      ['older-tail', 'latest-tail'],
    );

    const afterUserScrollWithCompleteLive = mergeOpeningThreadMessages({
      openingMessages: cachedTail,
      liveMessages: liveAnchoredWindow,
      messageId: 'target',
      liveQueryComplete: true,
      threadId: 'thread-1',
      preserveOpeningWindow: true,
    });
    assert.deepEqual(
      afterUserScrollWithCompleteLive.map(message => message.messageId),
      ['parent', 'target'],
    );

    const afterUserScrollWithoutOpeningRows = mergeOpeningThreadMessages({
      openingMessages: [],
      liveMessages: [createMessage('newer-live-row', 300, 'server')],
      messageId: 'target',
      liveQueryComplete: false,
      threadId: 'thread-1',
      preserveOpeningWindow: true,
    });
    assert.deepEqual(
      afterUserScrollWithoutOpeningRows.map(message => message.messageId),
      ['newer-live-row'],
    );
  });
});
