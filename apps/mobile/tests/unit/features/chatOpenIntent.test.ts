import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ImperativeRouter as Router } from 'expo-router';

import {
  buildChatOpenRoute,
  buildResolvedChatRoute,
  commitResolvedChatOpen,
  createChatOpenIntent,
  executeChatOpenIntent,
  reanchorOpenConversation,
} from '@/src/features/chat/navigation/chatOpenIntent';
import { getChatOpenAttemptId, releaseChatOpen, tryBeginChatOpen } from '@/src/utils/chatOpenGuard';
import { setRouteSnapshot } from '@/src/features/chat/navigation/routeSnapshot';

describe('chat open intent', (): void => {
  it('classifies an anchor-free link as a direct conversation open', (): void => {
    const intent = createChatOpenIntent(
      { channelId: 'channel-1', openStartedAtMs: 99 },
      'deeplink',
    );

    assert.deepEqual(intent, {
      kind: 'direct',
      channelId: 'channel-1',
      source: 'deeplink',
      openStartedAtMs: 99,
    });
    assert.deepEqual(buildChatOpenRoute(intent!), {
      pathname: '/chat/[channelId]',
      params: {
        channelId: 'channel-1',
        source: 'deeplink',
        from: 'deeplink',
        openStartedAtMs: '99',
      },
    });
  });

  it('executes direct opens with the singular base-chat policy', (): void => {
    let pushed = false;
    let singularKey: string | null = null;
    const router = {
      push: (_href, options): void => {
        pushed = true;
        const singular = options?.dangerouslySingular;
        singularKey = typeof singular === 'function' ? (singular('chat', {}) ?? null) : null;
      },
      replace: (): void => undefined,
      setParams: (): void => undefined,
    } satisfies Pick<Router, 'push' | 'replace' | 'setParams'>;

    assert.equal(
      executeChatOpenIntent(router, { kind: 'direct', channelId: 'guard-execution' }),
      true,
    );

    assert.equal(pushed, true);
    assert.equal(singularKey, 'base-chat');
  });

  it('preserves every external location field in an exact link route', (): void => {
    const intent = createChatOpenIntent(
      {
        channelId: 'channel-1',
        threadId: 'thread-1',
        origin: 'conversation-1',
        messageId: 'message-1',
        openStartedAtMs: 100,
      },
      'deeplink',
    );

    assert.deepEqual(buildChatOpenRoute(intent!), {
      pathname: '/(protected)/chat-deeplink',
      params: {
        channelId: 'channel-1',
        threadId: 'thread-1',
        conversationId: 'conversation-1',
        messageId: 'message-1',
        openStartedAtMs: '100',
        landing: 'exact',
        resolving: '1',
        source: 'deeplink',
        from: 'deeplink',
      },
    });
  });

  it('authoritatively resolves an external message when its surface is unknown', (): void => {
    const intent = createChatOpenIntent(
      {
        channelId: 'channel-1',
        origin: 'conversation-1',
        messageId: 'reply-1',
        createdAt: 123,
        openStartedAtMs: 101,
      },
      'deeplink',
    );

    assert.deepEqual(buildChatOpenRoute(intent!), {
      pathname: '/(protected)/chat-deeplink',
      params: {
        channelId: 'channel-1',
        conversationId: 'conversation-1',
        messageId: 'reply-1',
        createdAt: '123',
        openStartedAtMs: '101',
        landing: 'exact',
        resolving: '1',
        source: 'deeplink',
        from: 'deeplink',
      },
    });
  });

  it('authoritatively resolves every deep-link thread before choosing ticket or plain thread', (): void => {
    const intent = createChatOpenIntent(
      {
        channelId: 'channel-1',
        threadId: 'thread-1',
        origin: 'thread-1',
        messageId: 'reply-1',
        createdAt: 123,
        surface: 'channels',
        openStartedAtMs: 105,
      },
      'deeplink',
    );

    assert.deepEqual(buildChatOpenRoute(intent!), {
      pathname: '/(protected)/chat-deeplink',
      params: {
        channelId: 'channel-1',
        threadId: 'thread-1',
        conversationId: 'thread-1',
        messageId: 'reply-1',
        createdAt: '123',
        surface: 'channels',
        openStartedAtMs: '105',
        landing: 'exact',
        resolving: '1',
        source: 'deeplink',
        from: 'deeplink',
      },
    });
  });

  it('rejects a link without a channel identity', (): void => {
    assert.equal(
      createChatOpenIntent({ channelId: '  ', messageId: 'message-1' }, 'deeplink'),
      null,
    );
  });

  it('builds the resolved thread route from data-derived thread identity', (): void => {
    assert.deepEqual(
      buildResolvedChatRoute({
        channelId: 'channel-1',
        destination: 'thread',
        threadId: 'conversation-1',
        conversationId: 'conversation-1',
        messageId: 'reply-1',
        createdAt: 123,
        source: 'deeplink',
        surface: 'channels',
      }),
      {
        pathname: '/chat/[channelId]/[threadId]',
        params: {
          channelId: 'channel-1',
          threadId: 'conversation-1',
          conversationId: 'conversation-1',
          messageId: 'reply-1',
          createdAt: '123',
          landing: 'exact',
          source: 'deeplink',
          from: 'deeplink',
          surface: 'channels',
        },
      },
    );
  });

  it('builds a resolved ticket-thread route without mounting a plain thread first', (): void => {
    assert.deepEqual(
      buildResolvedChatRoute(
        {
          channelId: 'channel-1',
          destination: 'ticketThread',
          ticketId: 'ticket-1',
          threadId: 'conversation-1',
          conversationId: 'conversation-1',
          messageId: 'reply-1',
          createdAt: 123,
          source: 'deeplink',
          surface: 'channels',
        },
        { openStartedAtMs: 100, chatOpenAttemptId: 'attempt-1' },
      ),
      {
        pathname: '/ticket/[ticketId]',
        params: {
          ticketId: 'ticket-1',
          selectedTab: 'thread',
          channelId: 'channel-1',
          threadId: 'conversation-1',
          messageId: 'reply-1',
          source: 'deeplink',
          from: 'deeplink',
          openStartedAtMs: '100',
          chatOpenAttemptId: 'attempt-1',
        },
      },
    );
  });

  it('replaces the resolver host for an external resolved open', (): void => {
    const calls: string[] = [];
    const router = {
      dismissTo: (href): void => {
        calls.push(`dismiss:${String(href)}`);
      },
      push: (href): void => {
        const route = href as { pathname: string };
        calls.push(`push:${route.pathname}`);
      },
      replace: (href): void => {
        const route = href as { pathname: string };
        calls.push(`replace:${route.pathname}`);
      },
    } satisfies Pick<Router, 'dismissTo' | 'push' | 'replace'>;

    commitResolvedChatOpen(router, {
      channelId: 'channel-1',
      destination: 'thread',
      threadId: 'thread-1',
      conversationId: 'thread-1',
      messageId: 'reply-1',
      createdAt: 123,
      source: 'deeplink',
      surface: 'dms',
      scopeType: 'DM',
    });

    assert.deepEqual(calls, ['replace:/chat/[channelId]/[threadId]']);
  });

  it('keeps Activity underneath an activity thread open', (): void => {
    const calls: string[] = [];
    const router = {
      dismissTo: (href): void => {
        calls.push(`dismiss:${String(href)}`);
      },
      push: (href): void => {
        const route = href as { pathname: string };
        calls.push(`push:${route.pathname}`);
      },
      replace: (href): void => {
        const route = href as { pathname: string };
        calls.push(`replace:${route.pathname}`);
      },
    } satisfies Pick<Router, 'dismissTo' | 'push' | 'replace'>;

    commitResolvedChatOpen(router, {
      channelId: 'channel-1',
      destination: 'thread',
      threadId: 'thread-1',
      conversationId: 'thread-1',
      messageId: 'reply-1',
      createdAt: 123,
      source: 'activity',
      surface: 'dms',
      scopeType: 'DM',
    });

    assert.deepEqual(calls, ['replace:/chat/[channelId]/[threadId]']);
  });

  it('replaces the resolver host for a notification thread open', (): void => {
    const calls: string[] = [];
    const router = {
      dismissTo: (href): void => {
        calls.push(`dismiss:${String(href)}`);
      },
      push: (href): void => {
        const route = href as { pathname: string };
        calls.push(`push:${route.pathname}`);
      },
      replace: (href): void => {
        const route = href as { pathname: string };
        calls.push(`replace:${route.pathname}`);
      },
    } satisfies Pick<Router, 'dismissTo' | 'push' | 'replace'>;

    commitResolvedChatOpen(router, {
      channelId: 'channel-1',
      destination: 'thread',
      threadId: 'thread-1',
      conversationId: 'thread-1',
      messageId: 'reply-1',
      createdAt: 123,
      source: 'notification',
      surface: 'channels',
    });

    assert.deepEqual(calls, ['replace:/chat/[channelId]/[threadId]']);
  });

  it('keeps call stack synthesis separate from chat notification opens', (): void => {
    const calls: string[] = [];
    const router = {
      dismissTo: (href): void => {
        calls.push(`dismiss:${String(href)}`);
      },
      push: (href): void => {
        const route = href as { pathname: string };
        calls.push(`push:${route.pathname}`);
      },
      replace: (href): void => {
        const route = href as { pathname: string };
        calls.push(`replace:${route.pathname}`);
      },
    } satisfies Pick<Router, 'dismissTo' | 'push' | 'replace'>;

    commitResolvedChatOpen(router, {
      channelId: 'channel-1',
      destination: 'thread',
      threadId: 'thread-1',
      conversationId: 'thread-1',
      messageId: 'reply-1',
      createdAt: 123,
      source: 'call',
      surface: 'channels',
    });

    assert.deepEqual(calls, [
      'dismiss:/(protected)/(tabs)/channels',
      'push:/chat/[channelId]',
      'push:/chat/[channelId]/[threadId]',
    ]);
  });

  it('resolves a notification message when its cursor is missing', (): void => {
    const notificationIntent = createChatOpenIntent(
      {
        channelId: 'channel-1',
        origin: 'conversation-1',
        messageId: 'message-1',
        openStartedAtMs: 101,
      },
      'notification',
    );
    const activityIntent = createChatOpenIntent(
      { channelId: 'channel-1', origin: 'conversation-1', openStartedAtMs: 102 },
      'activity',
    );

    assert.deepEqual(buildChatOpenRoute(notificationIntent!), {
      pathname: '/(protected)/chat-deeplink',
      params: {
        channelId: 'channel-1',
        conversationId: 'conversation-1',
        messageId: 'message-1',
        openStartedAtMs: '101',
        landing: 'exact',
        resolving: '1',
        source: 'notification',
        from: 'notification',
      },
    });
    assert.deepEqual(buildChatOpenRoute(activityIntent!), {
      pathname: '/chat/[channelId]',
      params: {
        channelId: 'channel-1',
        openStartedAtMs: '102',
        landing: 'exact',
        source: 'activity',
        from: 'activity',
        conversationId: 'conversation-1',
        resolving: '1',
      },
    });
  });

  it('opens a complete notification thread on its final screen', (): void => {
    const intent = createChatOpenIntent(
      {
        channelId: 'channel-1',
        threadId: 'conversation-1',
        messageId: 'reply-1',
        openStartedAtMs: 106,
      },
      'notification',
    );

    assert.deepEqual(buildChatOpenRoute(intent!), {
      pathname: '/(protected)/chat-deeplink',
      params: {
        channelId: 'channel-1',
        threadId: 'conversation-1',
        messageId: 'reply-1',
        openStartedAtMs: '106',
        landing: 'exact',
        source: 'notification',
        from: 'notification',
      },
    });
  });

  it('opens a complete notification channel message on its final screen', (): void => {
    const intent = createChatOpenIntent(
      {
        channelId: 'channel-1',
        origin: 'conversation-1',
        messageId: 'message-1',
        createdAt: 123,
        openStartedAtMs: 108,
      },
      'notification',
    );

    assert.deepEqual(buildChatOpenRoute(intent!), {
      pathname: '/chat/[channelId]',
      params: {
        channelId: 'channel-1',
        conversationId: 'conversation-1',
        messageId: 'message-1',
        createdAt: '123',
        landing: 'exact',
        source: 'notification',
        from: 'notification',
        openStartedAtMs: '108',
      },
    });
  });

  it('keeps a message-only notification behind the resolver', (): void => {
    const intent = createChatOpenIntent(
      { channelId: 'channel-1', messageId: 'message-1', openStartedAtMs: 109 },
      'notification',
    );

    assert.deepEqual(buildChatOpenRoute(intent!), {
      pathname: '/(protected)/chat-deeplink',
      params: {
        channelId: 'channel-1',
        messageId: 'message-1',
        openStartedAtMs: '109',
        landing: 'exact',
        resolving: '1',
        source: 'notification',
        from: 'notification',
      },
    });
  });

  it('opens a complete Activity message directly in its channel window', (): void => {
    const intent = createChatOpenIntent(
      {
        channelId: 'channel-1',
        origin: 'conversation-1',
        messageId: 'message-1',
        createdAt: 123,
        surface: 'dms',
        scopeType: 'DM',
        openStartedAtMs: 103,
      },
      'activity',
    );

    assert.deepEqual(buildChatOpenRoute(intent!), {
      pathname: '/chat/[channelId]',
      params: {
        channelId: 'channel-1',
        conversationId: 'conversation-1',
        messageId: 'message-1',
        createdAt: '123',
        surface: 'dms',
        scopeType: 'DM',
        landing: 'exact',
        source: 'activity',
        from: 'activity',
        openStartedAtMs: '103',
      },
    });
  });

  it('opens a classified Activity thread directly', (): void => {
    const intent = createChatOpenIntent(
      {
        channelId: 'channel-1',
        threadId: 'conversation-1',
        origin: 'conversation-1',
        messageId: 'reply-1',
        openStartedAtMs: 107,
      },
      'activity',
    );

    assert.deepEqual(buildChatOpenRoute(intent!), {
      pathname: '/chat/[channelId]/[threadId]',
      params: {
        channelId: 'channel-1',
        threadId: 'conversation-1',
        messageId: 'reply-1',
        landing: 'exact',
        source: 'activity',
        from: 'activity',
        openStartedAtMs: '107',
      },
    });
  });

  it('keeps an Activity thread without a conversation identity behind the resolver', (): void => {
    const intent = createChatOpenIntent(
      {
        channelId: 'channel-1',
        threadId: 'conversation-1',
        messageId: 'reply-1',
        openStartedAtMs: 110,
      },
      'activity',
    );

    assert.deepEqual(buildChatOpenRoute(intent!), {
      pathname: '/(protected)/chat-deeplink',
      params: {
        channelId: 'channel-1',
        threadId: 'conversation-1',
        messageId: 'reply-1',
        openStartedAtMs: '110',
        landing: 'exact',
        resolving: '1',
        source: 'activity',
        from: 'activity',
      },
    });
  });

  it('clears stale message and resolver state when re-anchoring in place', (): void => {
    setRouteSnapshot('/chat/channel-1');
    let received: Record<string, string | undefined> | null = null;
    const intent = createChatOpenIntent(
      {
        channelId: 'channel-1',
        origin: 'conversation-2',
        createdAt: 456,
        openStartedAtMs: 104,
      },
      'activity',
    );

    assert.equal(
      reanchorOpenConversation(
        {
          setParams: (params): void => {
            received = params;
          },
        },
        intent!,
      ),
      true,
    );
    assert.deepEqual(received, {
      conversationId: 'conversation-2',
      messageId: undefined,
      createdAt: '456',
      landing: 'exact',
      resolving: undefined,
      source: 'activity',
      from: 'activity',
      openStartedAtMs: '104',
    });
    setRouteSnapshot(null);
  });

  it('does not re-anchor a notification message without a cursor', (): void => {
    setRouteSnapshot('/chat/channel-1');
    let received: Record<string, string | undefined> | null = null;
    const intent = createChatOpenIntent(
      {
        channelId: 'channel-1',
        origin: 'conversation-2',
        messageId: 'message-2',
        openStartedAtMs: 105,
      },
      'notification',
    );

    assert.equal(
      reanchorOpenConversation(
        {
          setParams: (params): void => {
            received = params;
          },
        },
        intent!,
      ),
      false,
    );
    assert.equal(received, null);
    setRouteSnapshot(null);
  });

  it('re-anchors a newer notification inside the current thread', (): void => {
    setRouteSnapshot('/chat/channel-1/thread-1', null, {
      channelId: 'channel-1',
      threadId: 'thread-1',
    });
    let received: Record<string, string | undefined> | null = null;
    const intent = createChatOpenIntent(
      {
        channelId: 'channel-1',
        threadId: 'thread-1',
        messageId: 'reply-2',
        openStartedAtMs: 106,
      },
      'notification',
    );

    assert.equal(
      reanchorOpenConversation(
        {
          setParams: (params): void => {
            received = params;
          },
        },
        intent!,
      ),
      true,
    );
    assert.deepEqual(received, {
      threadId: 'thread-1',
      messageId: 'reply-2',
      createdAt: undefined,
      landing: 'exact',
      resolving: undefined,
      source: 'notification',
      from: 'notification',
      openStartedAtMs: '106',
    });
    setRouteSnapshot(null);
  });

  it('recognizes an in-place deep-link channel as the current main conversation', (): void => {
    setRouteSnapshot('/chat-deeplink', 'channel-1');
    const intent = createChatOpenIntent(
      {
        channelId: 'channel-1',
        origin: 'conversation-2',
        openStartedAtMs: 106,
      },
      'notification',
    );

    assert.equal(reanchorOpenConversation({ setParams: (): void => undefined }, intent!), true);
    setRouteSnapshot(null);
  });

  it('does not re-anchor an unresolved external message into the main list', (): void => {
    setRouteSnapshot('/chat/channel-1');
    const intent = createChatOpenIntent(
      {
        channelId: 'channel-1',
        origin: 'conversation-2',
        messageId: 'reply-1',
        createdAt: 456,
      },
      'deeplink',
    );

    assert.equal(reanchorOpenConversation({ setParams: (): void => undefined }, intent!), false);
  });

  it("does not release another invocation's guard when re-anchoring a duplicate tap", (): void => {
    setRouteSnapshot('/chat/channel-1');
    const intent = createChatOpenIntent(
      {
        channelId: 'channel-1',
        origin: 'conversation-1',
        createdAt: 123,
      },
      'notification',
    );
    const guardTarget = { channelId: 'channel-1', conversationId: 'conversation-1' };
    const ownerAttempt = tryBeginChatOpen(guardTarget);
    assert.ok(ownerAttempt);

    assert.equal(
      executeChatOpenIntent(
        {
          push: (): void => undefined,
          replace: (): void => undefined,
          setParams: (): void => undefined,
        },
        intent!,
      ),
      true,
    );
    assert.equal(getChatOpenAttemptId(guardTarget), ownerAttempt);
    releaseChatOpen(ownerAttempt);
    setRouteSnapshot(null);
  });
});
