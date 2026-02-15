/**
 * Search Navigation Utilities
 *
 * Centralized navigation logic for search results across all search interfaces.
 */

import { NavigateFunction } from 'react-router-dom';
import { DisplaySearchResult } from '../types/search';
import { channelService } from '../services/Chat/channelService';
import { ChannelScopeType } from '@xyne/shared';
import { toast } from 'sonner';

/**
 * Channel data interface for navigation
 * Using readonly to match Zero query results
 */
interface Channel {
  readonly id: string;
  readonly scopeType: ChannelScopeType;
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
      navigateToMessage(result, navigate);
      break;

    case 'ticket':
      navigateToTicket(result, navigate);
      break;

    case 'attachment':
      navigateToAttachment(result, navigate);
      break;

    default:
      console.warn('[SEARCH-NAVIGATION] Unknown result type:', result.type);
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
    console.warn('[SEARCH-NAVIGATION] No channel data available for user navigation');
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
      console.error('[SEARCH-NAVIGATION] Failed to create DM:', error);
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
 * Navigate to a ticket
 *
 * Navigate to minimized view (thread view) with ticket details
 */
export const navigateToTicket = (result: DisplaySearchResult, navigate: NavigateFunction): void => {
  const ticketId = result.searchContext?.ticketId || result.id;
  const channelId = result.searchContext?.channelId;
  const conversationId = result.searchContext?.conversationId;

  if (!channelId || !conversationId) {
    toast.error('Cannot navigate to ticket: missing channel or conversation information');
    return;
  }

  // Navigate to minimized view (thread view) with details tab
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
    console.warn('[SEARCH-NAVIGATION] Cannot navigate to attachment: missing channel information');
  }
};
