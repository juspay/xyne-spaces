jest.mock('@/database/repositories', () => ({ repositories: {} }));
jest.mock('@/database/client', () => ({ db: {} }));
jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));
jest.mock('@/utils/mentionParser', () => ({
  extractUserMentions: jest.fn(() => []),
  extractGroupMentions: jest.fn(() => []),
}));
jest.mock('../engine/event-router', () => ({
  eventRouter: { emit: jest.fn() },
}));
jest.mock('@xyne/shared', () => ({
  MessageType: {
    USER: 'USER',
    BOT: 'BOT',
    SYSTEM: 'SYSTEM',
    FORWARDED: 'FORWARDED',
  },
}));

import { MessageType } from '@xyne/shared';
import {
  MessageLocation,
  messageReceivedTrigger,
} from './message-received.trigger';

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    message: {
      id: 'message-1',
      content: 'Please start the incident call',
      conversationId: 'conversation-1',
      channelId: 'channel-1',
      createdAt: new Date('2026-08-29T00:00:00.000Z'),
    },
    author: null,
    authorId: 'user-1',
    channelId: 'channel-1',
    conversationId: 'conversation-1',
    messageLocation: MessageLocation.NEW_CONVERSATION,
    msgType: MessageType.USER,
    deleted: false,
    ...overrides,
  };
}

describe('MessageReceivedTrigger thread reply filters', () => {
  it('keeps legacy configurations limited to new conversations', () => {
    expect(messageReceivedTrigger.matchFilters({}, payload())).toBe(true);
    expect(
      messageReceivedTrigger.matchFilters(
        {},
        payload({ messageLocation: MessageLocation.THREAD_REPLY }),
      ),
    ).toBe(false);
  });

  it('matches thread replies when explicitly configured', () => {
    const config = { messageLocation: MessageLocation.THREAD_REPLY };

    expect(
      messageReceivedTrigger.matchFilters(
        config,
        payload({ messageLocation: MessageLocation.THREAD_REPLY }),
      ),
    ).toBe(true);
    expect(messageReceivedTrigger.matchFilters(config, payload())).toBe(false);
  });

  it('matches both locations when configured for any message', () => {
    const config = { messageLocation: MessageLocation.ANY };

    expect(messageReceivedTrigger.matchFilters(config, payload())).toBe(true);
    expect(
      messageReceivedTrigger.matchFilters(
        config,
        payload({ messageLocation: MessageLocation.THREAD_REPLY }),
      ),
    ).toBe(true);
  });

  it('limits thread replies to configured conversations', () => {
    const config = {
      messageLocation: MessageLocation.THREAD_REPLY,
      conversationIds: ['conversation-1'],
    };

    expect(
      messageReceivedTrigger.matchFilters(
        config,
        payload({ messageLocation: MessageLocation.THREAD_REPLY }),
      ),
    ).toBe(true);
    expect(
      messageReceivedTrigger.matchFilters(
        config,
        payload({
          conversationId: 'conversation-2',
          messageLocation: MessageLocation.THREAD_REPLY,
        }),
      ),
    ).toBe(false);
  });

  it('applies existing text matching to thread replies', () => {
    const config = {
      messageLocation: MessageLocation.THREAD_REPLY,
      contentContains: 'INCIDENT CALL',
    };

    expect(
      messageReceivedTrigger.matchFilters(
        config,
        payload({ messageLocation: MessageLocation.THREAD_REPLY }),
      ),
    ).toBe(true);
    expect(
      messageReceivedTrigger.matchFilters(
        config,
        payload({
          messageLocation: MessageLocation.THREAD_REPLY,
          message: {
            id: 'message-2',
            content: 'No alert required',
            conversationId: 'conversation-1',
            channelId: 'channel-1',
            createdAt: new Date('2026-08-29T00:01:00.000Z'),
          },
        }),
      ),
    ).toBe(false);
  });

  it('defaults new trigger configurations to new conversations', () => {
    const parsed = messageReceivedTrigger.validate({});

    expect(parsed.messageLocation).toBe(MessageLocation.NEW_CONVERSATION);
    expect(parsed.messageTypes).toEqual([MessageType.USER]);
  });
});
