import { logger, Event as LogEvent } from './logger';
/**
 * Search Navigation Utilities
 *
 * Centralized navigation logic for search results across all search interfaces.
 */

import { NavigateFunction } from 'react-router-dom';
import { DisplaySearchResult } from '../types/search';
import { channelService } from '../services/Chat/channelService';
import { ChannelScopeType, ChannelType, isDeskChannelType } from '@xyne/shared';
import { toast } from 'sonner';
import { browserPanelActor } from '../machines/browserPanelMachine';
import { xyneAIActor } from '../machines/xyneAIMachine';
import { isXyneOrigin } from './browserPanelPartition';
import { toStandalonePath } from './electronApp';

/**
 * Channel data interface for navigation
 * Using readonly to match Zero query results
 */
interface Channel {
  readonly id: string;
  readonly scopeType: ChannelScopeType;
  readonly type?: ChannelType;
  readonly participants?: ReadonlyArray<{ readonly userId: string }>;
}

/**
 * Main navigation router for search results
 *
 * @param result - The search result to navigate to
 * @param navigate - React Router navigate function
 * @param channelData - User's channel data (required for user navigation)
 */
export const navigateToSearchResult = async (
  result: DisplaySearchResult,
  navigate: NavigateFunction,
  channelData?: Channel[],
): Promise<void> => {
  switch (result.type) {
    case 'user':
      await navigateToUser(result, navigate, channelData);
      break;

    case 'channel':
      navigateToChannel(result, navigate);
      break;

    case 'conversation':
      // Mail results come back as type='conversation' with subApp='DESK'.
      // Route them to the Desk view (specific thread + scroll to the mail).
      if (result.searchContext?.subApp === 'DESK') {
        navigateToMail(result, navigate);
      } else {
        navigateToMessage(result, navigate);
      }
      break;

    case 'ticket':
      navigateToTicket(result, navigate, channelData);
      break;

    case 'attachment':
      if (result.searchContext?.subApp === 'CANVAS') {
        navigateToCanvas(result, navigate);
      } else if (result.searchContext?.subApp === 'TRANSCRIPT') {
        navigateToTranscript(result, navigate);
      } else if (result.searchContext?.subApp === 'CHAT_ATTACHMENT') {
        navigateToChatAttachment(result, navigate);
      } else if (result.searchContext?.subApp === 'TICKET_ATTACHMENT') {
        navigateToTicketAttachment(result, navigate);
      } else {
        navigateToAttachment(result, navigate);
      }
      break;

    case 'collection':
      navigateToCollection(result, navigate);
      break;

    default:
      logger.warn(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_warn',
        message: String('[SEARCH-NAVIGATION] Unknown result type:'),
        context: [result.type],
      });
  }
};

/**
 * Navigate to a user (create or open DM channel)
 *
 * Logic:
 * 1. Check if DM channel already exists with this user
 * 2. If exists, navigate to it
 * 3. If not, create new DM channel and navigate
 */
export const navigateToUser = async (
  result: DisplaySearchResult,
  navigate: NavigateFunction,
  channelData?: Channel[],
): Promise<void> => {
  if (!channelData) {
    logger.warn(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_warn',
      message: String('[SEARCH-NAVIGATION] No channel data available for user navigation'),
    });
    return;
  }

  // Look for existing 1:1 DM channel with this user
  const existingDmChannel = channelData.find(channel => {
    // Check if it's a 1:1 DM channel (scopeType DM with exactly 2 participants)
    // and if the searched user is the other participant
    return (
      channel.scopeType === ChannelScopeType.DM &&
      channel.participants?.length === 2 &&
      channel.participants?.some(p => p.userId === result.id)
    );
  });

  if (existingDmChannel) {
    void navigate(`/chat/dir/${existingDmChannel.id}`);
  } else {
    try {
      const dmResponse = await channelService.createDm({
        participantIds: [result.id],
      });
      void navigate(`/chat/dir/${dmResponse.id}`);
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[SEARCH-NAVIGATION] Failed to create DM:'),
        error: error,
      });
      throw new Error('Failed to start conversation with user');
    }
  }
};

/**
 * Navigate to a channel
 *
 * Simple redirect to the channel page
 */
export const navigateToChannel = (
  result: DisplaySearchResult,
  navigate: NavigateFunction,
): void => {
  void navigate(`/chat/dir/${result.id}`);
};

/**
 * Navigate to a message
 *
 * Complex logic handling both threaded and standalone messages:
 *
 * Thread messages (replyCount > 0):
 * - Navigate to thread panel (/chat/{channelId}/{conversationId})
 * - Set hash with origin (conversationId) to scroll main chat to parent conversation
 * - Set hash with messageId to scroll thread panel to specific message and highlight it
 *
 * Standalone messages (replyCount = 0):
 * - Navigate to main chat only (/chat/{channelId})
 * - Set hash with origin to scroll to the conversation and highlight it
 */
export const navigateToMessage = (
  result: DisplaySearchResult,
  navigate: NavigateFunction,
): void => {
  const { channelId, messageId, conversationId, replyCount } = result.searchContext || {};

  if (!channelId) {
    throw new Error('Cannot navigate to message: missing channel information');
  }

  // Check if this is a thread (has replies)
  if (replyCount && replyCount > 0) {
    // This is a thread - navigate to thread panel
    if (messageId) {
      // Navigate to thread panel with dual-hash navigation
      // origin=conversationId scrolls main chat to parent conversation
      // messageId=messageId scrolls thread panel to specific message and highlights it
      void navigate(
        `/chat/dir/${channelId}/${conversationId}#origin=${conversationId}&messageId=${messageId}`,
      );
    } else {
      // Navigate to thread panel, only scroll main chat to parent conversation
      void navigate(`/chat/dir/${channelId}/${conversationId}#origin=${conversationId}`);
    }
  } else {
    // This is a standalone message (no replies) - navigate to main chat only
    void navigate(`/chat/dir/${channelId}#origin=${conversationId}`);
  }
};

/**
 * Navigate to a mail
 *
 * Target URL: /support/{channelId}/{xyneId}?conversationId={conversationId}&ticketId={ticketId}&mail={mailId}
 * The SupportScreen reads `mail` from the query string and scrolls to the
 * matching EmailThreadItem after the thread's emails have loaded.
 */
export const navigateToMail = (result: DisplaySearchResult, navigate: NavigateFunction): void => {
  const { xyneId, conversationId, ticketId, mailId, channelId } = result.searchContext || {};
  if (!xyneId || !conversationId || !channelId) {
    toast.error('Cannot navigate to mail: missing conversation or channel information');
    return;
  }
  const params = new URLSearchParams();
  params.set('conversationId', conversationId);
  if (ticketId) params.set('ticketId', ticketId);
  if (mailId) params.set('mail', mailId);
  void navigate(`/support/${channelId}/${xyneId}?${params.toString()}`);
};

/**
 * Navigate to a ticket
 *
 * Routes to Support view for EMAIL channel tickets, Chat view for board tickets
 */
export const navigateToTicket = (
  result: DisplaySearchResult,
  navigate: NavigateFunction,
  channelData?: Channel[],
): void => {
  const ticketId = result.searchContext?.ticketId || result.id;
  const channelId = result.searchContext?.channelId;
  const conversationId = result.searchContext?.conversationId;
  const xyneId = result.searchContext?.xyneId;

  if (!channelId) {
    toast.error('Cannot navigate to ticket: missing channel information');
    return;
  }

  // Lookup channel to determine type
  const channel = channelData?.find(c => c.id === channelId);

  // If EMAIL channel (Support/Desk ticket) AND has xyneId → Support view
  if (isDeskChannelType(channel?.type) && xyneId) {
    void navigate(`/support/${channelId}/${xyneId}`, {
      state: { conversationId, ticketId },
    });
    return;
  }

  // Board ticket OR fallback → Chat view
  if (!conversationId) {
    toast.error('Cannot navigate to ticket: missing conversation information');
    return;
  }

  void navigate(`/chat/dir/${channelId}/${conversationId}/${ticketId}?selectedTab=details`);
};

/**
 * Navigate to an attachment
 *
 * Navigate to the channel where the attachment was shared
 * with state to trigger attachment modal/viewer
 */
export const navigateToAttachment = (
  result: DisplaySearchResult,
  navigate: NavigateFunction,
): void => {
  const attachmentId = result.searchContext?.attachmentId || result.id;
  if (result.searchContext?.originalUrl) {
    window.open(result.searchContext.originalUrl, '_blank', 'noopener,noreferrer');
  } else if (result.searchContext?.channelId) {
    void navigate(`/chat/dir/${result.searchContext.channelId}`, {
      state: {
        attachmentId,
        openAttachment: true,
      },
    });
  } else {
    logger.warn(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_warn',
      message: String(
        '[SEARCH-NAVIGATION] Cannot navigate to attachment: missing channel information',
      ),
    });
  }
};

/**
 * Navigate to a canvas
 *
 * Opens the global canvas view for the selected canvas
 */
export const navigateToCanvas = (result: DisplaySearchResult, navigate: NavigateFunction): void => {
  void navigate(`/chat/canvas/${result.id}`);
};

/**
 * Navigate to a transcript
 *
 * Navigates to the chat location where the transcript was shared
 */
export const navigateToTranscript = (
  result: DisplaySearchResult,
  navigate: NavigateFunction,
): void => {
  const { channelId, conversationId } = result.searchContext || {};

  if (channelId && conversationId) {
    void navigate(`/chat/dir/${channelId}/${conversationId}`);
  } else if (channelId) {
    void navigate(`/chat/dir/${channelId}`);
  } else {
    // Fallback to attachment viewer
    navigateToAttachment(result, navigate);
  }
};

export const navigateToChatAttachment = (
  result: DisplaySearchResult,
  navigate: NavigateFunction,
): void => {
  const { channelId, conversationId, messageId } = result.searchContext || {};

  if (messageId) {
    void navigate(
      `/chat/dir/${channelId}/${conversationId}#origin=${conversationId}&messageId=${messageId}`,
    );
  } else {
    void navigate(`/chat/dir/${channelId}/${conversationId}#origin=${conversationId}`);
  }
};

export const navigateToTicketAttachment = (
  result: DisplaySearchResult,
  navigate: NavigateFunction,
): void => {
  const { channelId, conversationId, ticketId } = result.searchContext || {};

  if (channelId && conversationId && ticketId) {
    void navigate(`/chat/dir/${channelId}/${conversationId}/${ticketId}?selectedTab=files`);
  } else if (channelId && conversationId) {
    void navigate(`/chat/dir/${channelId}/${conversationId}`);
  } else if (channelId) {
    void navigate(`/chat/dir/${channelId}`);
  } else {
    navigateToAttachment(result, navigate);
  }
};

/**
 * Pure resolution of a search result to its target URL without performing navigation.
 *
 * Used by the CMD+click / CMD+Enter flow in CMDK so we can open the result in
 * the Electron in-app browser panel (or a new web tab) instead of navigating
 * in place. Kept in sync with the per-type `navigateToX` helpers above.
 *
 * - `internal`: a React-Router path within our SPA. Callers prefix
 *   `window.location.origin` when they need an absolute URL for a webview.
 * - `external`: an external URL (e.g. Drive/Notion link from an attachment).
 * - `async-user`: the target is a user DM that does not yet exist and would
 *   need an async creation call. Callers should fall back to default behavior.
 */
type SearchResultTarget =
  | { kind: 'internal'; path: string; state?: unknown }
  | { kind: 'external'; url: string }
  | { kind: 'async-user'; userId: string };

export const computeSearchResultPath = (
  result: DisplaySearchResult,
  channelData?: Channel[],
): SearchResultTarget | null => {
  switch (result.type) {
    case 'user': {
      if (!channelData) return null;
      const existingDmChannel = channelData.find(
        channel =>
          channel.scopeType === ChannelScopeType.DM &&
          channel.participants?.length === 2 &&
          channel.participants?.some(p => p.userId === result.id),
      );
      if (existingDmChannel) {
        return { kind: 'internal', path: `/chat/dir/${existingDmChannel.id}` };
      }
      return { kind: 'async-user', userId: result.id };
    }
    case 'channel':
      return { kind: 'internal', path: `/chat/dir/${result.id}` };
    case 'conversation': {
      const { channelId, messageId, conversationId, replyCount } = result.searchContext || {};
      if (!channelId) return null;
      if (replyCount && replyCount > 0) {
        if (messageId) {
          return {
            kind: 'internal',
            path: `/chat/dir/${channelId}/${conversationId}#origin=${conversationId}&messageId=${messageId}`,
          };
        }
        return {
          kind: 'internal',
          path: `/chat/dir/${channelId}/${conversationId}#origin=${conversationId}`,
        };
      }
      return { kind: 'internal', path: `/chat/dir/${channelId}#origin=${conversationId}` };
    }
    case 'ticket': {
      const ticketId = result.searchContext?.ticketId || result.id;
      const channelId = result.searchContext?.channelId;
      const conversationId = result.searchContext?.conversationId;
      if (!channelId || !conversationId) return null;
      return {
        kind: 'internal',
        path: `/chat/dir/${channelId}/${conversationId}/${ticketId}?selectedTab=details`,
      };
    }
    case 'attachment': {
      const subApp = result.searchContext?.subApp;
      if (subApp === 'CANVAS') {
        return { kind: 'internal', path: `/chat/canvas/${result.id}` };
      }
      if (subApp === 'TRANSCRIPT') {
        const { channelId, conversationId } = result.searchContext || {};
        if (channelId && conversationId) {
          return { kind: 'internal', path: `/chat/dir/${channelId}/${conversationId}` };
        }
        if (channelId) {
          return { kind: 'internal', path: `/chat/dir/${channelId}` };
        }
        if (result.searchContext?.originalUrl) {
          return { kind: 'external', url: result.searchContext.originalUrl };
        }
        return null;
      }
      if (subApp === 'CHAT_ATTACHMENT') {
        const { channelId, conversationId, messageId } = result.searchContext || {};
        if (!channelId || !conversationId) return null;
        if (messageId) {
          return {
            kind: 'internal',
            path: `/chat/dir/${channelId}/${conversationId}#origin=${conversationId}&messageId=${messageId}`,
          };
        }
        return {
          kind: 'internal',
          path: `/chat/dir/${channelId}/${conversationId}#origin=${conversationId}`,
        };
      }
      if (subApp === 'TICKET_ATTACHMENT') {
        const { channelId, conversationId, ticketId } = result.searchContext || {};
        if (channelId && conversationId && ticketId) {
          return {
            kind: 'internal',
            path: `/chat/dir/${channelId}/${conversationId}/${ticketId}?selectedTab=files`,
          };
        }
        if (channelId && conversationId) {
          return { kind: 'internal', path: `/chat/dir/${channelId}/${conversationId}` };
        }
        if (channelId) {
          return { kind: 'internal', path: `/chat/dir/${channelId}` };
        }
        if (result.searchContext?.originalUrl) {
          return { kind: 'external', url: result.searchContext.originalUrl };
        }
        return null;
      }
      // Generic attachment
      if (result.searchContext?.originalUrl) {
        return { kind: 'external', url: result.searchContext.originalUrl };
      }
      if (result.searchContext?.channelId) {
        const attachmentId = result.searchContext?.attachmentId || result.id;
        return {
          kind: 'internal',
          path: `/chat/dir/${result.searchContext.channelId}`,
          state: { attachmentId, openAttachment: true },
        };
      }
      return null;
    }
    default:
      return null;
  }
};

/**
 * CMDK open-in-browser helper.
 *
 * On Electron + modifier: routes the result to the in-app browser panel
 * (`browserPanelActor`). External attachment URLs go straight in; internal
 * routes are prefixed with `window.location.origin` so the webview loads the
 * SPA at that route.
 *
 * On web + modifier: opens the resolved URL in a new browser tab.
 *
 * Without modifier (or on mobile where the modifier is unreliable): delegates
 * to `navigateToSearchResult` — no behavior change.
 *
 * `user` results whose DM does not yet exist cannot be resolved synchronously,
 * so they always take the default path (DM created, navigated in place).
 */
export const openSearchResult = async (
  result: DisplaySearchResult,
  options: { modifier: boolean; isElectron: boolean; isMobile: boolean },
  navigate: NavigateFunction,
  channelData?: Channel[],
): Promise<void> => {
  const { modifier, isElectron, isMobile } = options;

  if (!modifier || isMobile) {
    await navigateToSearchResult(result, navigate, channelData);
    return;
  }

  let target = computeSearchResultPath(result, channelData);
  if (!target) {
    await navigateToSearchResult(result, navigate, channelData);
    return;
  }
  if (target.kind === 'async-user') {
    // DM doesn't exist yet — create it so we have a channel ID to open.
    try {
      const dmResponse = await channelService.createDm({ participantIds: [target.userId] });
      target = { kind: 'internal', path: `/chat/dir/${dmResponse.id}` };
    } catch {
      await navigateToSearchResult(result, navigate, channelData);
      return;
    }
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  // Paths from computeSearchResultPath are /chat/... — they need the
  // /:workspaceId prefix that useWorkspaceNavigate normally injects.
  // Extract it from the current pathname (first non-empty segment).
  const firstSegment =
    typeof window !== 'undefined'
      ? (window.location.pathname.split('/').find(s => s.length > 0) ?? '')
      : '';
  const workspacePrefix = firstSegment ? `/${firstSegment}` : '';
  const url = target.kind === 'external' ? target.url : `${origin}${workspacePrefix}${target.path}`;

  if (isElectron) {
    // For Xyne URLs, carry the current theme into the panel via a query
    // param. The panel webview has its own localStorage (separate partition),
    // so without this the theme would reset to the default on first load.
    // `useTheme` reads `?theme=` on init and strips it from the URL.
    let panelUrl = url;
    if (isXyneOrigin(url)) {
      try {
        const currentTheme =
          typeof localStorage !== 'undefined' ? localStorage.getItem('xyne-theme') : null;
        if (currentTheme) {
          const withTheme = new URL(url);
          withTheme.searchParams.set('theme', currentTheme);
          panelUrl = withTheme.toString();
        }
      } catch (error) {
        logger.warn(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_warn',
          message: String('[openSearchResult] failed to attach theme param:'),
          context: [error],
        });
      }
    }

    // Mirror the main session's auth cookies into the `persist:xyne-spaces`
    // partition before the panel tab mounts, so Xyne URLs pick up the user's
    // existing sign-in instead of bouncing through OAuth. We only sync for
    // Xyne-origin URLs; external URLs never receive our cookies.
    if (isXyneOrigin(panelUrl)) {
      try {
        await window.electronAPI?.syncXyneCookiesToBrowserPanel?.(panelUrl);
      } catch (error) {
        logger.warn(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_warn',
          message: String('[openSearchResult] cookie sync failed:'),
          context: [error],
        });
      }
    }

    if (isXyneOrigin(panelUrl)) {
      // Open internal routes in a new standalone Electron window.
      // Use target.path (no workspace prefix) so it matches /newWindow/chat/dir/:id routes.
      const basePath = target.kind === 'external' ? target.url : target.path;
      const standalonePath = toStandalonePath(basePath);
      const newWin = window.open(standalonePath, '_blank');
      newWin?.focus();
    } else {
      // External URLs go to the browser panel.
      xyneAIActor.send({ type: 'CLOSE' });
      const panelState = browserPanelActor.getSnapshot().context.browserPanelState;
      if (panelState === 'open') {
        browserPanelActor.send({ type: 'OPEN_URLS', urls: [panelUrl] });
      } else {
        browserPanelActor.send({ type: 'OPEN', urls: [panelUrl] });
      }
    }
    return;
  }

  // Web: open the regular route in a new browser tab (full app chrome).
  // No theme param needed — same origin = same localStorage = same theme.
  window.open(url, '_blank', 'noopener,noreferrer');
};

/**
 * Navigate to a collection document in the knowledge base viewer
 */
export const navigateToCollection = (
  result: DisplaySearchResult,
  navigate: NavigateFunction,
): void => {
  const { projectId, channelId, docId, collectionId, folderId } = result.searchContext || {};

  // Navigate to knowledge base file viewer
  if (!projectId || !channelId || !collectionId || !docId) {
    logger.warn(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_warn',
      message: String(
        '[SEARCH-NAVIGATION] Cannot navigate to collection: missing projectId, channelId, collectionId, or docId',
      ),
    });
    return;
  }

  // Use '_' sentinel for root-level files (no parent folder), matching KB convention
  const folder = folderId || '_';

  const params = new URLSearchParams();
  if (result.context) params.set('highlight', btoa(encodeURIComponent(result.context)));

  const queryString = params.toString();
  const path = `/knowledge-base/${projectId}/${channelId}/${collectionId}/${folder}/${docId}`;

  void navigate(queryString ? `${path}?${queryString}` : path);
};
