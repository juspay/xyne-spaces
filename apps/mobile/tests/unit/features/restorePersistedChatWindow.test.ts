import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  queryCacheActor,
  type QueryCacheConversation,
  type ThreadConversation,
} from '@xyne/shared/machines';

import {
  restorePersistedChatWindow,
  type PersistedChatWindowReader,
  type PersistedChatWindowWriter,
} from '@/src/features/chat/navigation/restorePersistedChatWindow';

const threadWindow = { messages: [{ messageId: 'reply-1' }] } as unknown as ThreadConversation;
const channelWindow = [{ initialMessageId: 'message-1' }] as unknown as QueryCacheConversation[];

const makeWriter = (): {
  writer: PersistedChatWindowWriter;
  writes: {
    channel?: { id: string; rows: QueryCacheConversation[] };
    thread?: { id: string; conversation: ThreadConversation };
  };
} => {
  const writes: {
    channel?: { id: string; rows: QueryCacheConversation[] };
    thread?: { id: string; conversation: ThreadConversation };
  } = {};
  return {
    writer: {
      setChannel: (id, rows) => {
        writes.channel = { id, rows };
      },
      setThread: (id, conversation) => {
        writes.thread = { id, conversation };
      },
    },
    writes,
  };
};

describe('restorePersistedChatWindow', (): void => {
  it('restores a previously visited thread without a message id', (): void => {
    const reads: Array<[string, string, string | undefined]> = [];
    const { writer, writes } = makeWriter();
    const reader: PersistedChatWindowReader = (kind, id, messageId) => {
      reads.push([kind, id, messageId]);
      return threadWindow;
    };

    restorePersistedChatWindow({ channelId: 'channel-1', threadId: ' thread-1 ' }, reader, writer);

    assert.deepEqual(reads, [['thread', 'thread-1', undefined]]);
    assert.deepEqual(writes.thread, { id: 'thread-1', conversation: threadWindow });
  });

  it('uses a persisted channel window for a direct or activity open', (): void => {
    const { writer, writes } = makeWriter();
    const reader: PersistedChatWindowReader = () => channelWindow;

    restorePersistedChatWindow(
      { channelId: ' channel-1 ', messageId: ' message-1 ' },
      reader,
      writer,
    );

    assert.deepEqual(writes.channel, { id: 'channel-1', rows: channelWindow });
  });

  it('restores a partial window as context while the requested message hydrates', (): void => {
    const { writer, writes } = makeWriter();

    restorePersistedChatWindow(
      { channelId: 'channel-1', threadId: 'thread-1', messageId: 'new-reply' },
      () => threadWindow,
      writer,
    );

    assert.deepEqual(writes.thread, { id: 'thread-1', conversation: threadWindow });
  });

  it('uses an explicit thread kind when the route only has a conversation id', (): void => {
    const { writer, writes } = makeWriter();

    restorePersistedChatWindow(
      {
        channelId: 'channel-1',
        kind: 'thread',
        conversationId: 'thread-2',
        messageId: 'reply-2',
      },
      (kind, id, messageId) => {
        assert.deepEqual([kind, id, messageId], ['thread', 'thread-2', 'reply-2']);
        return threadWindow;
      },
      writer,
    );

    assert.deepEqual(writes.thread, { id: 'thread-2', conversation: threadWindow });
  });

  it('tries the conversation entity as a thread before falling back to the channel', (): void => {
    const { writer, writes } = makeWriter();
    const reads: Array<[string, string]> = [];

    restorePersistedChatWindow(
      {
        channelId: 'channel-1',
        conversationId: 'thread-3',
        messageId: 'reply-3',
      },
      (kind, id) => {
        reads.push([kind, id]);
        return kind === 'thread' ? threadWindow : channelWindow;
      },
      writer,
    );

    assert.deepEqual(reads, [['thread', 'thread-3']]);
    assert.deepEqual(writes.thread, { id: 'thread-3', conversation: threadWindow });
    assert.equal(writes.channel, undefined);
  });

  it('falls back to the channel entity when a conversation is not a thread', (): void => {
    const { writer, writes } = makeWriter();
    const reads: Array<[string, string]> = [];

    restorePersistedChatWindow(
      {
        channelId: 'channel-1',
        conversationId: 'conversation-1',
        messageId: 'message-1',
      },
      (kind, id) => {
        reads.push([kind, id]);
        return kind === 'channel' ? channelWindow : null;
      },
      writer,
    );

    assert.deepEqual(reads, [
      ['thread', 'conversation-1'],
      ['channel', 'channel-1'],
    ]);
    assert.deepEqual(writes.channel, { id: 'channel-1', rows: channelWindow });
    assert.equal(writes.thread, undefined);
  });

  it('does not let an empty in-memory channel hide persisted rows', (): void => {
    const channelId = 'empty-memory-channel';
    queryCacheActor.send({
      type: 'SET_CONVERSATIONS',
      channelId,
      conversations: [],
    });

    const { writer, writes } = makeWriter();
    restorePersistedChatWindow({ channelId }, () => channelWindow, writer);

    assert.deepEqual(writes.channel, { id: channelId, rows: channelWindow });
  });

  it('does not let an empty in-memory thread hide persisted rows', (): void => {
    const threadId = 'empty-memory-thread';
    queryCacheActor.send({
      type: 'SET_THREAD_CONVERSATION',
      conversationId: threadId,
      conversation: { messages: [] } as unknown as ThreadConversation,
    });

    const { writer, writes } = makeWriter();
    restorePersistedChatWindow(
      { channelId: 'channel-1', kind: 'thread', threadId },
      () => threadWindow,
      writer,
    );

    assert.deepEqual(writes.thread, { id: threadId, conversation: threadWindow });
  });

  it('leaves an existing in-memory window authoritative', (): void => {
    const channelId = 'already-cached-channel';
    queryCacheActor.send({
      type: 'SET_CONVERSATIONS',
      channelId,
      conversations: channelWindow,
    });

    let writes = 0;
    const writer: PersistedChatWindowWriter = {
      setChannel: () => {
        writes += 1;
      },
      setThread: () => {
        writes += 1;
      },
    };

    restorePersistedChatWindow(
      { channelId },
      () => [{ initialMessageId: 'older-persisted-row' }] as QueryCacheConversation[],
      writer,
    );

    assert.equal(writes, 0);
  });

  it('supersedes a stale in-memory thread when only the warm window has the notified message', (): void => {
    // The notified reply is by definition new, so a window left over from an
    // earlier visit cannot contain it. Before this rule, "memory has rows" made
    // the freshly warmed window unreachable and the thread painted from a
    // partially materialized live query — the single-message open.
    const threadId = 'stale-memory-thread';
    queryCacheActor.send({
      type: 'SET_THREAD_CONVERSATION',
      conversationId: threadId,
      conversation: {
        messages: [{ messageId: 'old-reply-1' }, { messageId: 'old-reply-2' }],
      } as unknown as ThreadConversation,
    });

    const warmThread = {
      messages: [
        { messageId: 'old-reply-1' },
        { messageId: 'old-reply-2' },
        { messageId: 'notified-reply' },
      ],
    } as unknown as ThreadConversation;

    const { writer, writes } = makeWriter();
    restorePersistedChatWindow(
      { channelId: 'channel-1', kind: 'thread', threadId, messageId: 'notified-reply' },
      () => warmThread,
      writer,
    );

    assert.deepEqual(writes.thread, { id: threadId, conversation: warmThread });
  });

  it('supersedes a stale in-memory channel when only the warm window has the notified message', (): void => {
    const channelId = 'stale-memory-channel';
    queryCacheActor.send({
      type: 'SET_CONVERSATIONS',
      channelId,
      conversations: [{ initialMessageId: 'old-message' }] as unknown as QueryCacheConversation[],
    });

    const warmChannel = [
      { initialMessageId: 'old-message' },
      { initialMessageId: 'notified-message' },
    ] as unknown as QueryCacheConversation[];

    const { writer, writes } = makeWriter();
    restorePersistedChatWindow(
      { channelId, messageId: 'notified-message' },
      () => warmChannel,
      writer,
    );

    assert.deepEqual(writes.channel, { id: channelId, rows: warmChannel });
  });

  it('keeps memory authoritative when it already holds the notified message', (): void => {
    const threadId = 'fresh-memory-thread';
    queryCacheActor.send({
      type: 'SET_THREAD_CONVERSATION',
      conversationId: threadId,
      conversation: {
        messages: [{ messageId: 'old-reply' }, { messageId: 'notified-reply' }],
      } as unknown as ThreadConversation,
    });

    let reads = 0;
    let writes = 0;
    const writer: PersistedChatWindowWriter = {
      setChannel: () => {
        writes += 1;
      },
      setThread: () => {
        writes += 1;
      },
    };

    restorePersistedChatWindow(
      { channelId: 'channel-1', kind: 'thread', threadId, messageId: 'notified-reply' },
      () => {
        reads += 1;
        return threadWindow;
      },
      writer,
    );

    // Memory can land the open, so the disk read is skipped entirely.
    assert.equal(reads, 0);
    assert.equal(writes, 0);
  });

  it('keeps warm context when neither memory nor disk holds the notified message', (): void => {
    const threadId = 'both-stale-thread';
    const memoryWindow = {
      messages: [{ messageId: 'old-reply-1' }, { messageId: 'old-reply-2' }],
    } as unknown as ThreadConversation;
    queryCacheActor.send({
      type: 'SET_THREAD_CONVERSATION',
      conversationId: threadId,
      conversation: memoryWindow,
    });

    let writes = 0;
    const writer: PersistedChatWindowWriter = {
      setChannel: () => {
        writes += 1;
      },
      setThread: () => {
        writes += 1;
      },
    };

    restorePersistedChatWindow(
      { channelId: 'channel-1', kind: 'thread', threadId, messageId: 'notified-reply' },
      () => ({ messages: [{ messageId: 'other-old-reply' }] }) as unknown as ThreadConversation,
      writer,
    );

    // Swapping one targetless window for another discards context for no gain.
    assert.equal(writes, 0);
  });

  it('does not write an empty or missing persisted window', (): void => {
    let writeCount = 0;
    const writer: PersistedChatWindowWriter = {
      setChannel: () => {
        writeCount += 1;
      },
      setThread: () => {
        writeCount += 1;
      },
    };

    restorePersistedChatWindow(
      { channelId: 'channel-1', threadId: 'thread-1' },
      () => null,
      writer,
    );
    restorePersistedChatWindow({ channelId: 'channel-1' }, () => [], writer);

    assert.equal(writeCount, 0);
  });
});
