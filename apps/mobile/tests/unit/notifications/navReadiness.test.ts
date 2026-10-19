import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getChatRouteIdentity,
  isShellReadyForNotificationNav,
  matchesChatRouteTarget,
} from '@/src/notifications/navigation/navReadiness';

describe('isShellReadyForNotificationNav', (): void => {
  it('requires the protected shell to be mounted and ready', (): void => {
    assert.equal(isShellReadyForNotificationNav('/(protected)', true), false);
    assert.equal(isShellReadyForNotificationNav('/(protected)/(tabs)/activity', false), false);
    assert.equal(isShellReadyForNotificationNav('/(protected)/(tabs)/activity', true), true);
  });

  it('waits until a real destination exists so cold-start DMs cannot clobber chat', (): void => {
    assert.equal(isShellReadyForNotificationNav('/', true), false);
    assert.equal(isShellReadyForNotificationNav('/index', true), false);
    assert.equal(isShellReadyForNotificationNav('/(protected)/(tabs)', true), false);
    assert.equal(isShellReadyForNotificationNav('/(protected)/(tabs)/dms', true), true);
    assert.equal(isShellReadyForNotificationNav('/chat/channel-1', true), true);
    assert.equal(isShellReadyForNotificationNav('/(protected)/chat/channel-1', true), true);
  });
});

describe('matchesChatRouteTarget', (): void => {
  it('does not drop a concrete target for the channel already on screen', (): void => {
    assert.equal(
      matchesChatRouteTarget('/(protected)/chat/channel-1', {
        channelId: 'channel-1',
        conversationId: 'conversation-1',
        messageId: 'message-1',
      }),
      false,
    );
  });

  it('matches only exact route segments for ordinary channel opens', (): void => {
    assert.equal(
      matchesChatRouteTarget('/(protected)/chat/channel-10', { channelId: 'channel-1' }),
      false,
    );
    assert.equal(
      matchesChatRouteTarget('/(protected)/chat/channel-1', { channelId: 'channel-1' }),
      true,
    );
  });

  it('does not treat a concrete thread target as already landed', (): void => {
    assert.equal(
      matchesChatRouteTarget('/(protected)/chat/channel-1/thread-1', {
        channelId: 'channel-1',
        threadId: 'thread-1',
        messageId: 'reply-1',
      }),
      false,
    );
  });

  it('does not treat a newer message as visible on the same thread', (): void => {
    assert.equal(
      matchesChatRouteTarget(
        '/(protected)/chat/channel-1/thread-1',
        { channelId: 'channel-1', threadId: 'thread-1', messageId: 'reply-2' },
        { channelId: 'channel-1', threadId: 'thread-1' },
      ),
      false,
    );
    assert.equal(
      matchesChatRouteTarget(
        '/(protected)/chat/channel-1/thread-1',
        { channelId: 'channel-1', threadId: 'thread-1', messageId: 'reply-2' },
        { channelId: 'channel-1', threadId: 'thread-1', messageId: 'reply-2' },
      ),
      true,
    );
  });

  it('matches an exact target on the resolver route by its params', (): void => {
    const target = {
      channelId: 'channel-1',
      threadId: 'thread-1',
      messageId: 'reply-1',
    };

    assert.equal(
      matchesChatRouteTarget('/(protected)/chat-deeplink', target, {
        channelId: 'channel-1',
        threadId: 'thread-1',
        messageId: 'reply-1',
      }),
      true,
    );
    assert.equal(
      matchesChatRouteTarget('/(protected)/chat-deeplink', target, {
        channelId: 'channel-1',
        threadId: 'thread-1',
        messageId: 'reply-2',
      }),
      false,
    );
  });

  it('normalizes route params before matching and rejects ambiguous arrays', (): void => {
    assert.equal(
      matchesChatRouteTarget(
        '/(protected)/chat-deeplink',
        { channelId: 'channel-1', messageId: 'message-1' },
        { channelId: [' channel-1 '], messageId: [' message-1 '] },
      ),
      true,
    );
    assert.equal(
      matchesChatRouteTarget(
        '/(protected)/chat-deeplink',
        { channelId: 'channel-1', messageId: 'message-1' },
        { channelId: ['channel-1', 'channel-2'], messageId: 'message-1' },
      ),
      false,
    );
  });

  it('matches a ticket already on screen instead of stacking another copy', (): void => {
    assert.equal(
      matchesChatRouteTarget(
        '/(protected)/ticket/ticket-1',
        { ticketId: 'ticket-1' },
        { ticketId: 'ticket-1' },
      ),
      true,
    );
    assert.equal(
      matchesChatRouteTarget('/(protected)/ticket/ticket-1', { ticketId: 'ticket-1' }),
      true,
    );
    assert.equal(
      matchesChatRouteTarget('/(protected)/ticket/ticket-1', { ticketId: 'ticket-2' }),
      false,
    );
  });

  it('uses normalized route identity for deduplication', (): void => {
    assert.equal(
      getChatRouteIdentity('/chat/channel-1', {
        channelId: ' channel-1 ',
        messageId: [' message-1 '],
      }),
      getChatRouteIdentity('/chat/channel-1', {
        channelId: 'channel-1',
        messageId: 'message-1',
      }),
    );
  });
});
