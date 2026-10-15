import type { ImperativeRouter as Router } from 'expo-router';

import {
  getBaseConversationSurfacePath,
  type BaseConversationSurface,
} from '@/src/features/chat/baseConversationSurface';
import { rememberLastOpenChannel } from '@/src/features/chat/lastOpenChannel';
import { baseChatRouteSingular } from '@/src/features/chat/navigation/chatRoutePolicy';
import { restorePersistedChatWindow } from '@/src/features/chat/navigation/restorePersistedChatWindow';
import {
  CHAT_OPEN_GUARD_WINDOW_MS,
  getChatOpenAttemptId,
  releaseChatOpen,
  tryBeginChatOpen,
} from '@/src/utils/chatOpenGuard';
import {
  beginCriticalWindow,
  endCriticalWindow,
  getChatCriticalWindowTag,
} from '@/src/utils/interactionCriticalWindow';

export { getChatOpenAttemptId, releaseChatOpen, tryBeginChatOpen } from '@/src/utils/chatOpenGuard';
export type { ChatOpenAttemptId, ChatOpenGuardTarget } from '@/src/utils/chatOpenGuard';

/** Screen-mount release. Does not wait for list paint. */
export const releaseChatOpenForChannel = (
  attemptId: Parameters<typeof releaseChatOpen>[0],
  channelId: string,
): void => {
  releaseChatOpen(attemptId);
  if (channelId) {
    endCriticalWindow(getChatCriticalWindowTag(channelId));
  }
};

/**
 * Keep a single base-chat screen in the stack. Pushing `/chat/[channelId]` with
 * this option reuses the existing instance (replacing its params) instead of
 * stacking a duplicate — so navigating from activity/notifications can't leave
 * two chat screens behind (which would otherwise need pressing back twice).
 */
type OpenBaseChatRouteOptions = {
  surface: BaseConversationSurface;
  unreadCount?: number | undefined;
  unreadLastViewedAt?: number | undefined;
  unreadLastViewedConversationId?: string | undefined;
};

const getUnreadOpenParams = ({
  unreadCount,
  unreadLastViewedAt,
  unreadLastViewedConversationId,
}: OpenBaseChatRouteOptions): Record<string, string> => {
  if (
    typeof unreadCount !== 'number' ||
    unreadCount <= 0 ||
    typeof unreadLastViewedAt !== 'number' ||
    !Number.isFinite(unreadLastViewedAt) ||
    unreadLastViewedAt <= 0
  ) {
    // The singular chat route reuses its mounted screen. Explicitly clear the
    // mode so a previous unread-open route cannot leak into a normal open.
    return { unreadOpen: '0' };
  }

  return {
    unreadOpen: '1',
    unreadCount: String(unreadCount),
    unreadLastViewedAt: String(unreadLastViewedAt),
    ...(unreadLastViewedConversationId ? { unreadLastViewedConversationId } : {}),
  };
};

const rememberBaseChatRoute = (channelId: string, surface: BaseConversationSurface): void => {
  if (surface !== 'channels') return;
  rememberLastOpenChannel(channelId);
};

export const openBaseChatRoute = (
  router: Router,
  channelId: string,
  options: OpenBaseChatRouteOptions,
): void => {
  const openTarget = { channelId };
  const newChatOpenAttemptId = tryBeginChatOpen(openTarget);
  const chatOpenAttemptId = newChatOpenAttemptId ?? getChatOpenAttemptId(openTarget);
  const unreadParams = getUnreadOpenParams(options);

  const openStartedAtMs = Date.now();
  const { surface } = options;
  const criticalWindowTag = getChatCriticalWindowTag(channelId);
  if (!newChatOpenAttemptId) {
    // The first route is still in flight. Re-pushing the same singular route
    // only queues duplicate navigation work when iOS delivers delayed taps.
    return;
  }
  beginCriticalWindow(criticalWindowTag, CHAT_OPEN_GUARD_WINDOW_MS);
  rememberBaseChatRoute(channelId, surface);
  try {
    restorePersistedChatWindow({
      channelId,
    });
    router.push(
      {
        pathname: '/chat/[channelId]',
        params: {
          channelId,
          surface,
          source: 'tap',
          openStartedAtMs: String(openStartedAtMs),
          ...(chatOpenAttemptId ? { chatOpenAttemptId } : {}),
          ...unreadParams,
        },
      },
      { dangerouslySingular: baseChatRouteSingular },
    );
  } catch (error) {
    if (newChatOpenAttemptId) {
      releaseChatOpen(newChatOpenAttemptId);
      endCriticalWindow(criticalWindowTag);
    }
    throw error;
  }
};

export const openBaseConversationListRoute = (
  router: Router,
  surface: BaseConversationSurface,
): void => {
  const basePath = getBaseConversationSurfacePath(surface);
  router.dismissTo(basePath);
};
