import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ChatLinkOpenIntent } from '@/src/features/chat/navigation/chatOpenIntent';
import {
  getChatLinkLocationKey,
  resolveChatLink,
  resolveChatLinkDeduped,
  resolveChatLinkFromCache,
} from '@/src/features/chat/navigation/resolveChatLink';

const intent: ChatLinkOpenIntent = {
  kind: 'link',
  source: 'deeplink',
  hint: { channelId: 'channel-1', messageId: 'reply-1' },
};

describe('resolveChatLink', (): void => {
  it('derives a main destination from the initial message identity', async (): Promise<void> => {
    const result = await resolveChatLink(
      { ...intent, hint: { channelId: 'channel-1', messageId: 'initial-1' } },
      {
        getMessage: async () => ({
          messageId: 'initial-1',
          conversation: {
            channelId: 'channel-1',
            conversationId: 'conversation-1',
            createdAt: 100,
            initialMessageId: 'initial-1',
          },
        }),
        getConversation: async () => undefined,
      },
    );

    assert.deepEqual(result, {
      status: 'ok',
      location: {
        channelId: 'channel-1',
        destination: 'main',
        conversationId: 'conversation-1',
        messageId: 'initial-1',
        createdAt: 100,
        source: 'deeplink',
        surface: 'channels',
      },
    });
  });

  it('derives a thread destination for a non-initial reply', async (): Promise<void> => {
    const result = await resolveChatLink(intent, {
      getMessage: async () => ({
        messageId: 'reply-1',
        conversation: {
          channelId: 'channel-1',
          conversationId: 'conversation-1',
          createdAt: 100,
          initialMessageId: 'initial-1',
        },
      }),
      getConversation: async (): Promise<undefined> => undefined,
    });

    assert.deepEqual(result, {
      status: 'ok',
      location: {
        channelId: 'channel-1',
        destination: 'thread',
        threadId: 'conversation-1',
        conversationId: 'conversation-1',
        messageId: 'reply-1',
        createdAt: 100,
        source: 'deeplink',
        surface: 'channels',
      },
    });
  });

  it('routes a ticket reply to the ticket thread surface', async (): Promise<void> => {
    const ticketIntent: ChatLinkOpenIntent = {
      ...intent,
      hint: {
        channelId: 'channel-1',
        threadId: 'conversation-1',
        messageId: 'reply-1',
        surface: 'dms',
      },
    };
    const result = await resolveChatLink(ticketIntent, {
      getMessage: async () => ({
        messageId: 'reply-1',
        conversation: {
          channelId: 'channel-1',
          conversationId: 'conversation-1',
          createdAt: 100,
          initialMessageId: 'initial-1',
        },
      }),
      getConversation: async () => ({
        channelId: 'channel-1',
        conversationId: 'conversation-1',
        createdAt: 100,
        initialMessageId: 'initial-1',
        ticketId: 'ticket-1',
      }),
    });

    assert.deepEqual(result, {
      status: 'ok',
      location: {
        channelId: 'channel-1',
        destination: 'ticketThread',
        threadId: 'conversation-1',
        ticketId: 'ticket-1',
        conversationId: 'conversation-1',
        messageId: 'reply-1',
        createdAt: 100,
        source: 'deeplink',
        surface: 'dms',
      },
    });
  });

  it('rejects contradictory channel hints and invalid timestamps', async (): Promise<void> => {
    const wrongChannel = await resolveChatLink(intent, {
      getMessage: async () => ({
        messageId: 'reply-1',
        conversation: {
          channelId: 'channel-2',
          conversationId: 'conversation-1',
          createdAt: 100,
          initialMessageId: 'initial-1',
        },
      }),
      getConversation: async () => undefined,
    });
    const invalidTimestamp = await resolveChatLink(intent, {
      getMessage: async () => ({
        messageId: 'reply-1',
        conversation: {
          channelId: 'channel-1',
          conversationId: 'conversation-1',
          createdAt: 0,
          initialMessageId: 'initial-1',
        },
      }),
      getConversation: async () => undefined,
    });

    assert.deepEqual(wrongChannel, { status: 'not_found' });
    assert.deepEqual(invalidTimestamp, { status: 'not_found' });
  });

  it('does not turn an absent target into a direct open', async (): Promise<void> => {
    const result = await resolveChatLink(intent, {
      getMessage: async () => null,
      getConversation: async () => undefined,
    });

    assert.deepEqual(result, { status: 'not_found' });
  });

  it('keeps a transport failure retryable', async (): Promise<void> => {
    const result = await resolveChatLink(intent, {
      getMessage: async () => {
        throw new Error('offline');
      },
      getConversation: async () => undefined,
    });

    assert.deepEqual(result, { status: 'unavailable' });
  });

  it('opens from cache when the exact deep-link target is present', (): void => {
    const result = resolveChatLinkFromCache(
      {
        ...intent,
        hint: {
          channelId: 'channel-1',
          threadId: 'conversation-1',
          messageId: 'reply-1',
          surface: 'dms',
        },
      },
      {
        channelId: 'channel-1',
        conversationId: 'conversation-1',
        createdAt: 100,
        initialMessageId: 'initial-1',
        messages: [{ messageId: 'initial-1' }, { messageId: 'reply-1' }],
        ticketId: 'ticket-1',
      },
    );

    assert.deepEqual(result, {
      channelId: 'channel-1',
      destination: 'ticketThread',
      threadId: 'conversation-1',
      ticketId: 'ticket-1',
      conversationId: 'conversation-1',
      messageId: 'reply-1',
      createdAt: 100,
      source: 'deeplink',
      surface: 'dms',
    });
  });

  it('opens a cached root message when the thread cache has no inline root row', (): void => {
    const result = resolveChatLinkFromCache(
      {
        ...intent,
        hint: { channelId: 'channel-1', conversationId: 'conversation-1', messageId: 'initial-1' },
      },
      {
        channelId: 'channel-1',
        conversationId: 'conversation-1',
        createdAt: 100,
        initialMessageId: 'initial-1',
        messages: [],
      },
    );

    assert.deepEqual(result, {
      channelId: 'channel-1',
      destination: 'main',
      conversationId: 'conversation-1',
      messageId: 'initial-1',
      createdAt: 100,
      source: 'deeplink',
      surface: 'channels',
    });
  });

  it('opens a root message from the channel cache when no thread snapshot exists', (): void => {
    const result = resolveChatLinkFromCache(
      {
        ...intent,
        hint: { channelId: 'channel-1', conversationId: 'conversation-1', messageId: 'initial-1' },
      },
      null,
      {
        channelId: 'channel-1',
        conversationId: 'conversation-1',
        createdAt: 100,
        initialMessageId: 'initial-1',
      },
    );

    assert.deepEqual(result, {
      channelId: 'channel-1',
      destination: 'main',
      conversationId: 'conversation-1',
      messageId: 'initial-1',
      createdAt: 100,
      source: 'deeplink',
      surface: 'channels',
    });
  });

  it('keeps the resolver when the cached thread does not contain the target', (): void => {
    const result = resolveChatLinkFromCache(intent, {
      channelId: 'channel-1',
      conversationId: 'conversation-1',
      createdAt: 100,
      initialMessageId: 'initial-1',
      messages: [{ messageId: 'initial-1' }],
    });

    assert.equal(result, null);
  });

  it('shares a duplicate location lookup within the active Zero client', async (): Promise<void> => {
    const scope = {};
    let resolveMessage: ((value: { messageId: string; conversation: null }) => void) | undefined;
    let calls = 0;
    const dependencies = {
      getMessage: async (): Promise<{ messageId: string; conversation: null }> => {
        calls += 1;
        return new Promise(resolve => {
          resolveMessage = resolve;
        });
      },
      getConversation: async (): Promise<undefined> => undefined,
    };

    const first = resolveChatLinkDeduped(scope, intent, dependencies);
    const second = resolveChatLinkDeduped(scope, intent, dependencies);

    assert.equal(getChatLinkLocationKey(intent), 'channel-1|||reply-1');
    assert.equal(first, second);
    assert.equal(calls, 1);
    resolveMessage?.({ messageId: 'reply-1', conversation: null });
    assert.deepEqual(await first, { status: 'not_found' });
  });
});
