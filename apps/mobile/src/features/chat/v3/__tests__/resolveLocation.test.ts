import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseOpenIntent } from '../intent/parseOpenIntent';
import { resolveLocation, type ResolveLocationDeps } from '../intent/resolveLocation';
import type { OpenIntent } from '../intent/openIntent.types';
import { landingTargetFrom } from '../machine/revealPolicy';

const mustParse = (raw: Record<string, unknown>): OpenIntent => {
  const result = parseOpenIntent(raw);
  assert.equal(result.ok, true, JSON.stringify(raw));
  if (!result.ok) {
    throw new Error('parse failed');
  }
  return result.value;
};

const deps = (over: Partial<ResolveLocationDeps> = {}): ResolveLocationDeps => ({
  snapshotRows: [],
  readCachedTicketId: () => null,
  runMessage: async () => undefined,
  runConversation: async () => undefined,
  readChannelStatus: () => null,
  now: () => 0,
  budgetMs: 4_000,
  ...over,
});

describe('resolveLocation', (): void => {
  it('lands a channel message from the message query, never hint.createdAt', async (): Promise<void> => {
    const intent = mustParse({
      channelId: 'channel-1',
      origin: 'parent-1',
      messageId: 'reply-1',
      createdAt: '1',
      source: 'notification',
    });
    const result = await resolveLocation(
      intent,
      deps({
        runMessage: async () => ({
          messageId: 'reply-1',
          createdAt: 90,
          isDeleted: false,
          conversation: {
            channelId: 'channel-1',
            conversationId: 'thread-1',
            createdAt: 10,
            parentMessageId: 'parent-1',
            initialMessageId: 'root-1',
          },
        }),
      }),
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.deepEqual(result.value.anchor, {
      conversationId: 'thread-1',
      messageId: 'reply-1',
      createdAt: 90,
    });
    assert.equal(landingTargetFrom(result.value).kind, 'anchor');
  });

  it('uses the channel snapshot cursor and skips the query on a hit', async (): Promise<void> => {
    let queried = false;
    const intent = mustParse({
      channelId: 'channel-1',
      messageId: 'm-1',
      source: 'notification',
    });
    const result = await resolveLocation(
      intent,
      deps({
        snapshotRows: [{ messageId: 'm-1', createdAt: 40 }],
        runMessage: async () => {
          queried = true;
          return undefined;
        },
      }),
    );
    assert.equal(queried, false);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.anchor?.createdAt, 40);
      assert.equal(result.value.anchor?.messageId, 'm-1');
    }
  });

  it('resolves a conversation-only deeplink via getConversationById', async (): Promise<void> => {
    const intent = mustParse({
      channelId: 'channel-1',
      conversationId: 'c-1',
      createdAt: '123',
      source: 'deeplink',
    });
    const result = await resolveLocation(
      intent,
      deps({
        runConversation: async () => ({
          channelId: 'channel-1',
          conversationId: 'c-1',
          createdAt: 50,
          initialMessageId: 'm-root',
        }),
      }),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.value.anchor, {
        conversationId: 'c-1',
        messageId: 'm-root',
        createdAt: 50,
      });
    }
  });

  it('finalises a ticket-thread from conversation.ticketId with a cold cache', async (): Promise<void> => {
    const intent = mustParse({
      channelId: 'channel-1',
      threadId: 'thread-1',
      messageId: 'reply-1',
      createdAt: '5',
      source: 'notification',
    });
    const result = await resolveLocation(
      intent,
      deps({
        runMessage: async () => ({
          messageId: 'reply-1',
          createdAt: 80,
          conversation: {
            channelId: 'channel-1',
            conversationId: 'thread-1',
            createdAt: 5,
            parentMessageId: 'root-1',
            ticketId: 'ticket-9',
          },
        }),
      }),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.surface.kind, 'ticket-thread');
      if (result.value.surface.kind === 'ticket-thread') {
        assert.equal(result.value.surface.ticketId, 'ticket-9');
      }
    }
  });

  it('returns not-found for a deleted message', async (): Promise<void> => {
    const intent = mustParse({
      channelId: 'channel-1',
      messageId: 'gone',
      source: 'notification',
    });
    const result = await resolveLocation(
      intent,
      deps({
        runMessage: async () => ({ messageId: 'gone', createdAt: 1, isDeleted: true }),
      }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.reason, 'not-found');
    }
  });

  it('keeps an unread-open on the list hint even when live lastViewedAt has moved', async (): Promise<void> => {
    const intent = mustParse({
      channelId: 'channel-1',
      source: 'tap',
      unreadOpen: '1',
      unreadLastViewedAt: '10',
      unreadCount: '2',
    });
    const result = await resolveLocation(
      intent,
      deps({
        snapshotRows: [{ messageId: 'm-1', createdAt: 50 }],
        readChannelStatus: () => ({ lastViewedAt: 50, lastViewedConversationId: 'm-1' }),
      }),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.value.unreadBoundary, { at: 10, conversationId: 'm-1' });
      assert.equal(landingTargetFrom(result.value).kind, 'tail');
    }
  });

  it('drops a stale unread hint to tail when every message is at or before it', async (): Promise<void> => {
    const intent = mustParse({
      channelId: 'channel-1',
      source: 'tap',
      unreadOpen: '1',
      unreadLastViewedAt: '90',
      unreadCount: '1',
    });
    const result = await resolveLocation(
      intent,
      deps({
        snapshotRows: [{ messageId: 'm-1', createdAt: 50 }],
      }),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.unreadBoundary, null);
      assert.equal(landingTargetFrom(result.value).kind, 'tail');
    }
  });

  it('fetches a named message even on a tap (show-in-channel parent preview)', async (): Promise<void> => {
    const intent = mustParse({
      channelId: 'channel-1',
      threadId: 'thread-1',
      messageId: 'parent-1',
      from: 'channel_thread',
    });
    const result = await resolveLocation(
      intent,
      deps({
        runMessage: async () => ({
          messageId: 'parent-1',
          createdAt: 40,
          conversation: {
            channelId: 'channel-1',
            conversationId: 'thread-1',
            createdAt: 40,
            initialMessageId: 'parent-1',
          },
        }),
      }),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.anchor?.messageId, 'parent-1');
      assert.equal(result.value.anchor?.createdAt, 40);
    }
  });

  it('does not treat a tail tap as unread just because lastViewedAt exists', async (): Promise<void> => {
    const intent = mustParse({
      channelId: 'channel-1',
      source: 'tap',
    });
    const result = await resolveLocation(
      intent,
      deps({
        snapshotRows: [],
        readChannelStatus: () => ({ lastViewedAt: 40, lastViewedConversationId: 'old-msg' }),
      }),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.unreadBoundary, null);
      assert.equal(landingTargetFrom(result.value).kind, 'tail');
    }
  });

  it('treats a missing source as an other-app deeplink and fetches the named message', async (): Promise<void> => {
    const intent = mustParse({
      channelId: 'channel-1',
      conversationId: 'conversation-1',
      messageId: 'message-1',
    });
    assert.equal(intent.entry, 'deeplink');
    const result = await resolveLocation(
      intent,
      deps({
        runMessage: async () => ({
          messageId: 'message-1',
          createdAt: 70,
          conversation: {
            channelId: 'channel-1',
            conversationId: 'conversation-1',
            createdAt: 70,
            initialMessageId: 'message-1',
          },
        }),
      }),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.anchor?.messageId, 'message-1');
      assert.equal(result.value.anchor?.createdAt, 70);
    }
  });

  it('times out resolving when the query exceeds the budget', async (): Promise<void> => {
    const intent = mustParse({
      channelId: 'channel-1',
      messageId: 'slow',
      source: 'deeplink',
    });
    const result = await resolveLocation(
      intent,
      deps({
        budgetMs: 5,
        now: (() => {
          let n = 0;
          return (): number => {
            n += 1;
            return n === 1 ? 0 : 10;
          };
        })(),
        runMessage: () => new Promise(() => undefined),
      }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(result.error, { reason: 'timeout', stage: 'resolving' });
    }
  });
});
