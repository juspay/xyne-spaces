import type { Href, ImperativeRouter as Router } from 'expo-router';

import type { MessageDeepLinkPayload } from '@/src/utils/messageDeepLink';
import type { ResolvedChatLocation } from './resolveChatLink';
import { isCurrentChatTarget, isCurrentMainConversation } from './routeSnapshot';
import { baseChatRouteSingular, TICKET_ROUTE } from './chatRoutePolicy';
import { getBaseConversationSurfacePath } from '../baseConversationSurface';
import {
  restorePersistedChatWindow,
  type PersistedChatWindowTarget,
} from './restorePersistedChatWindow';
import {
  getChatOpenAttemptId,
  releaseChatOpen,
  tryBeginChatOpen,
  type ChatOpenGuardTarget,
} from '@/src/utils/chatOpenGuard';

export type ChatLinkSource =
  'notification' | 'activity' | 'deeplink' | 'search' | 'forward' | 'call';

export type ChatDirectOpenIntent = {
  kind: 'direct';
  channelId: string;
  source?: ChatLinkSource;
  surface?: 'channels' | 'dms';
  scopeType?: string;
  openStartedAtMs?: number;
};

export type ChatLinkOpenIntent = {
  kind: 'link';
  source: ChatLinkSource;
  hint: {
    channelId: string;
    threadId?: string;
    conversationId?: string;
    messageId?: string;
    createdAt?: number;
    surface?: 'channels' | 'dms';
    scopeType?: string;
    openStartedAtMs?: number;
  };
};

export type ChatOpenIntent = ChatDirectOpenIntent | ChatLinkOpenIntent;

const nonEmpty = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

/**
 * A bare conversation URL is a direct open. Any supplied message, conversation,
 * or thread identity is a link intent; the route policy decides whether its
 * context is complete enough for a direct open or needs the resolver host.
 */
export const createChatOpenIntent = (
  payload: MessageDeepLinkPayload,
  source: ChatLinkSource,
): ChatOpenIntent | null => {
  const channelId = nonEmpty(payload.channelId);
  if (!channelId) return null;

  const threadId = nonEmpty(payload.threadId);
  const conversationId = nonEmpty(payload.origin);
  const messageId = nonEmpty(payload.messageId);
  const scopeType = nonEmpty(payload.scopeType);
  const createdAt =
    typeof payload.createdAt === 'number' && Number.isFinite(payload.createdAt)
      ? payload.createdAt
      : undefined;
  if (!threadId && !conversationId && !messageId) {
    return {
      kind: 'direct',
      channelId,
      source,
      ...(payload.surface ? { surface: payload.surface } : {}),
      ...(scopeType ? { scopeType } : {}),
      openStartedAtMs: payload.openStartedAtMs ?? Date.now(),
    };
  }

  return {
    kind: 'link',
    source,
    hint: {
      channelId,
      ...(threadId ? { threadId } : {}),
      ...(conversationId ? { conversationId } : {}),
      ...(messageId ? { messageId } : {}),
      ...(createdAt !== undefined ? { createdAt } : {}),
      ...(payload.surface ? { surface: payload.surface } : {}),
      ...(scopeType ? { scopeType } : {}),
      openStartedAtMs: payload.openStartedAtMs ?? Date.now(),
    },
  };
};

export const hasCompleteChatLinkHint = (intent: ChatLinkOpenIntent): boolean =>
  !!intent.hint.threadId || (!!intent.hint.conversationId && intent.hint.createdAt !== undefined);

const hasCompleteActivityTarget = (intent: ChatLinkOpenIntent): boolean =>
  intent.source === 'activity' &&
  !!intent.hint.conversationId &&
  (!!intent.hint.threadId || (!!intent.hint.messageId && intent.hint.createdAt !== undefined));

const hasCompleteKnownTarget = (intent: ChatLinkOpenIntent): boolean =>
  intent.source === 'notification'
    ? !!intent.hint.threadId ||
      (!!intent.hint.conversationId &&
        (!intent.hint.messageId || intent.hint.createdAt !== undefined))
    : hasCompleteActivityTarget(intent);

export const reanchorOpenConversation = (
  router: { setParams: (params: Record<string, string | undefined>) => void },
  intent: ChatOpenIntent,
): boolean => {
  const canReanchorKnownNotification =
    intent.kind === 'link' &&
    intent.source === 'notification' &&
    ((!!intent.hint.conversationId &&
      !intent.hint.threadId &&
      isCurrentMainConversation(intent.hint.channelId) &&
      (!intent.hint.messageId || intent.hint.createdAt !== undefined)) ||
      (!!intent.hint.threadId && isCurrentChatTarget(intent.hint.channelId, intent.hint.threadId)));
  if (
    intent.kind !== 'link' ||
    (intent.source === 'deeplink' && !!intent.hint.messageId) ||
    (!intent.hint.threadId && !intent.hint.conversationId) ||
    (intent.hint.threadId
      ? !canReanchorKnownNotification
      : (!canReanchorKnownNotification && intent.hint.createdAt === undefined) ||
        !isCurrentMainConversation(intent.hint.channelId))
  ) {
    return false;
  }

  router.setParams({
    ...(intent.hint.threadId
      ? { threadId: intent.hint.threadId }
      : { conversationId: intent.hint.conversationId }),
    // setParams merges route params. Clear the old message id when this
    // location is conversation-only, otherwise row lookup targets stale data.
    messageId: intent.hint.messageId,
    createdAt: intent.hint.createdAt !== undefined ? String(intent.hint.createdAt) : undefined,
    landing: 'exact',
    resolving: undefined,
    source: intent.source,
    from: intent.source,
    openStartedAtMs: String(intent.hint.openStartedAtMs ?? Date.now()),
  });
  return true;
};

export const buildChatLinkResolverRoute = (
  intent: ChatLinkOpenIntent,
  chatOpenAttemptId?: string,
): Href => ({
  pathname: '/(protected)/chat-deeplink',
  params: {
    channelId: intent.hint.channelId,
    ...(intent.hint.threadId ? { threadId: intent.hint.threadId } : {}),
    ...(intent.hint.conversationId ? { conversationId: intent.hint.conversationId } : {}),
    ...(intent.hint.messageId ? { messageId: intent.hint.messageId } : {}),
    ...(intent.hint.createdAt !== undefined ? { createdAt: String(intent.hint.createdAt) } : {}),
    ...(intent.hint.surface ? { surface: intent.hint.surface } : {}),
    ...(intent.hint.scopeType ? { scopeType: intent.hint.scopeType } : {}),
    openStartedAtMs: String(intent.hint.openStartedAtMs ?? Date.now()),
    ...(chatOpenAttemptId ? { chatOpenAttemptId } : {}),
    landing: 'exact',
    resolving: '1',
    source: intent.source,
    // Kept for legacy consumers until all source-based behavior is migrated.
    from: intent.source,
  },
});

export const buildChatOpenRoute = (intent: ChatOpenIntent, chatOpenAttemptId?: string): Href => {
  if (intent.kind === 'link') {
    // Activity and notification payloads already provide the conversation/thread
    // classification when their target is complete. Keep those opens on the
    // final screen so that screen owns the only loading surface.
    if ((intent.hint.messageId || intent.hint.threadId) && !hasCompleteKnownTarget(intent)) {
      return buildChatLinkResolverRoute(intent, chatOpenAttemptId);
    }

    // A conversation-only link can mount the main-chat shell directly. If its
    // cursor is absent, the shell resolves that cursor in place.
    if (!hasCompleteChatLinkHint(intent) && !intent.hint.conversationId) {
      return buildChatLinkResolverRoute(intent, chatOpenAttemptId);
    }

    const commonParams = {
      channelId: intent.hint.channelId,
      ...(intent.hint.messageId ? { messageId: intent.hint.messageId } : {}),
      ...(intent.hint.createdAt !== undefined ? { createdAt: String(intent.hint.createdAt) } : {}),
      ...(intent.hint.surface ? { surface: intent.hint.surface } : {}),
      ...(intent.hint.scopeType ? { scopeType: intent.hint.scopeType } : {}),
      landing: 'exact',
      source: intent.source,
      from: intent.source,
      openStartedAtMs: String(intent.hint.openStartedAtMs ?? Date.now()),
      ...(chatOpenAttemptId ? { chatOpenAttemptId } : {}),
    };
    if (intent.hint.threadId) {
      if (intent.source === 'notification') {
        // Notification thread opens already have their final thread identity.
        // Keep them on the protected deep-link host so the native stack has
        // one chat entry instead of adding an anchored channel parent.
        // Do not set `resolving: '1'` here: v2 ChatThreadScreen treats that as
        // a resolver host (skeleton + skipped ticket replace). Cursor fill
        // (createdAt) is destination-owned via useResolveOpenCursor — the
        // deeplink host must not gate mount or lookup on the chat-v3 flag.
        return {
          pathname: '/(protected)/chat-deeplink',
          params: { ...commonParams, threadId: intent.hint.threadId },
        };
      }
      return {
        pathname: '/chat/[channelId]/[threadId]',
        params: { ...commonParams, threadId: intent.hint.threadId },
      };
    }
    if (intent.hint.createdAt === undefined) {
      return {
        pathname: '/chat/[channelId]',
        params: {
          ...commonParams,
          conversationId: intent.hint.conversationId!,
          // Cursor fill is destination-owned (useResolveOpenCursor). Do not set
          // resolving:'1' for notifications — v2 ChatList treats that as a
          // resolver skeleton and never fills createdAt. v3 still resolves from
          // source + messageId without the flag.
          ...(intent.source === 'notification' ? {} : { resolving: '1' }),
        },
      };
    }
    return {
      pathname: '/chat/[channelId]',
      params: {
        ...commonParams,
        conversationId: intent.hint.conversationId!,
        createdAt: String(intent.hint.createdAt!),
      },
    };
  }
  return {
    pathname: '/chat/[channelId]',
    params: {
      channelId: intent.channelId,
      ...(intent.surface ? { surface: intent.surface } : {}),
      ...(intent.scopeType ? { scopeType: intent.scopeType } : {}),
      ...(intent.source ? { source: intent.source, from: intent.source } : {}),
      ...(intent.openStartedAtMs !== undefined
        ? { openStartedAtMs: String(intent.openStartedAtMs) }
        : {}),
      ...(chatOpenAttemptId ? { chatOpenAttemptId } : {}),
    },
  };
};

const getChatOpenGuardTarget = (intent: ChatOpenIntent): ChatOpenGuardTarget =>
  intent.kind === 'link'
    ? {
        channelId: intent.hint.channelId,
        ...(intent.hint.threadId ? { threadId: intent.hint.threadId } : {}),
        ...(intent.hint.conversationId ? { conversationId: intent.hint.conversationId } : {}),
        ...(intent.hint.messageId ? { messageId: intent.hint.messageId } : {}),
      }
    : { channelId: intent.channelId };

const getPersistedChatWindowTarget = (intent: ChatOpenIntent): PersistedChatWindowTarget => {
  if (intent.kind === 'direct') {
    return {
      channelId: intent.channelId,
      kind: 'channel',
    };
  }

  return {
    channelId: intent.hint.channelId,
    // A conversation-only link may be either a channel conversation or a
    // thread. Leave the kind open so restorePersistedChatWindow can try the
    // warmed thread entity before the channel fallback.
    ...(intent.hint.threadId ? { kind: 'thread' as const } : {}),
    ...(intent.hint.threadId ? { threadId: intent.hint.threadId } : {}),
    ...(intent.hint.conversationId ? { conversationId: intent.hint.conversationId } : {}),
    ...(intent.hint.messageId ? { messageId: intent.hint.messageId } : {}),
  };
};

export type ChatOpenExecutionOptions = {
  mode?: 'push' | 'replace';
};

/**
 * Execute every intent through the same re-anchor and route policy. Keeping
 * this separate from intent construction lets each entry point preserve its
 * source-specific payload while sharing navigation semantics.
 */
export const executeChatOpenIntent = (
  router: Pick<Router, 'push' | 'replace' | 'setParams'>,
  intent: ChatOpenIntent,
  options: ChatOpenExecutionOptions = {},
): boolean => {
  const guardTarget = getChatOpenGuardTarget(intent);
  const newChatOpenAttemptId = tryBeginChatOpen(guardTarget);
  const chatOpenAttemptId = newChatOpenAttemptId ?? getChatOpenAttemptId(guardTarget) ?? undefined;

  // A pending external URL must stay queued when the guard cannot provide an
  // attempt. Callers use the return value to retry instead of dropping it.
  if (!chatOpenAttemptId) {
    return false;
  }

  try {
    restorePersistedChatWindow(getPersistedChatWindowTarget(intent));

    if (intent.kind === 'link' && reanchorOpenConversation(router, intent)) {
      // A duplicate tap may reuse an active attempt owned by an earlier
      // invocation. Only release an attempt created by this invocation.
      if (newChatOpenAttemptId) {
        releaseChatOpen(newChatOpenAttemptId);
      }
      return true;
    }

    const route = buildChatOpenRoute(intent, chatOpenAttemptId);
    if (options.mode === 'replace') {
      router.replace(route);
      return true;
    }

    router.push(route, { dangerouslySingular: baseChatRouteSingular });
    return true;
  } catch (error) {
    if (newChatOpenAttemptId) {
      releaseChatOpen(newChatOpenAttemptId);
    }
    throw error;
  }
};

export const buildResolvedChatRoute = (
  location: ResolvedChatLocation,
  options: { openStartedAtMs?: number; chatOpenAttemptId?: string } = {},
): Href => {
  const params = {
    channelId: location.channelId,
    conversationId: location.conversationId,
    ...(location.messageId ? { messageId: location.messageId } : {}),
    createdAt: String(location.createdAt),
    landing: 'exact',
    source: location.source,
    from: location.source,
    ...(location.surface ? { surface: location.surface } : {}),
    ...(location.scopeType ? { scopeType: location.scopeType } : {}),
    ...(options.openStartedAtMs !== undefined
      ? { openStartedAtMs: String(options.openStartedAtMs) }
      : {}),
    ...(options.chatOpenAttemptId ? { chatOpenAttemptId: options.chatOpenAttemptId } : {}),
  };

  if (location.destination === 'ticketThread' && location.ticketId && location.threadId) {
    return {
      pathname: TICKET_ROUTE,
      params: {
        ticketId: location.ticketId,
        selectedTab: 'thread',
        channelId: location.channelId,
        threadId: location.threadId,
        ...(location.messageId ? { messageId: location.messageId } : {}),
        source: location.source,
        from: location.source,
        ...(options.openStartedAtMs !== undefined
          ? { openStartedAtMs: String(options.openStartedAtMs) }
          : {}),
        ...(options.chatOpenAttemptId ? { chatOpenAttemptId: options.chatOpenAttemptId } : {}),
      },
    };
  }

  if (location.destination === 'thread' && location.threadId) {
    return {
      pathname: '/chat/[channelId]/[threadId]',
      params: { ...params, threadId: location.threadId },
    };
  }

  return { pathname: '/chat/[channelId]', params };
};

const shouldSynthesizeResolvedStack = (source: ChatLinkSource): boolean => source === 'call';

/**
 * Commit an authoritative resolver result. Replace the temporary resolver host
 * for normal chat opens so the destination screen remains the sole loading
 * owner. Call opens retain their deterministic list -> channel -> thread stack
 * because call navigation still depends on that back-stack contract.
 */
export const commitResolvedChatOpen = (
  router: Pick<Router, 'dismissTo' | 'push' | 'replace'>,
  location: ResolvedChatLocation,
  options: { openStartedAtMs?: number; chatOpenAttemptId?: string } = {},
): void => {
  const destinationRoute = buildResolvedChatRoute(location, options);
  if (!shouldSynthesizeResolvedStack(location.source)) {
    router.replace(destinationRoute);
    return;
  }

  router.dismissTo(getBaseConversationSurfacePath(location.surface));

  if (location.destination !== 'thread' || !location.threadId) {
    router.push(destinationRoute);
    return;
  }

  router.push(
    {
      pathname: '/chat/[channelId]',
      params: {
        channelId: location.channelId,
        surface: location.surface,
        ...(location.scopeType ? { scopeType: location.scopeType } : {}),
        source: location.source,
        from: location.source,
        ...(options.openStartedAtMs !== undefined
          ? { openStartedAtMs: String(options.openStartedAtMs) }
          : {}),
      },
    },
    { dangerouslySingular: baseChatRouteSingular },
  );
  router.push(destinationRoute);
};
