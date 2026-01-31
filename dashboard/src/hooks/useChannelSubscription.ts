import { useEffect } from 'react';
import { websocketService } from '../services/clients/socketClient';

/**
 * Custom hook to automatically subscribe to a channel via WebSocket
 *
 * Handles automatic subscription when component mounts and cleanup when unmounts.
 * Re-subscribes automatically when channelId changes.
 *
 * @param channelId - The channel ID to subscribe to
 * @param conversationIds - Optional array of conversation IDs to subscribe to
 *
 * @example
 * ```typescript
 * // Subscribe to a single channel
 * useChannelSubscription('channel-123');
 *
 * // Works with optional channelId
 * useChannelSubscription(channelId); // channelId might be undefined
 * ```
 */
export const useChannelSubscription = (
  channelId: string | string[] | undefined,
  conversationIds: string[] = [],
): void => {
  useEffect((): (() => void) | undefined => {
    // Guard clause: Don't subscribe if no channel or WebSocket not connected
    if (!channelId || !websocketService.isConnectedToServer()) {
      return;
    }

    // Prepare subscription data
    const subscriptionData = {
      channels: Array.isArray(channelId) ? channelId : [channelId],
      conversations: conversationIds,
    };

    // Subscribe to the channel for real-time updates
    websocketService.emit('subscribe_to_channels', subscriptionData);

    // Cleanup function - runs when:
    // 1. Component unmounts
    // 2. channelId changes (before re-subscribing to new channel)
    return (): void => {
      if (websocketService.isConnectedToServer()) {
        websocketService.emit('unsubscribe_from_channels', {
          channels: Array.isArray(channelId) ? channelId : [channelId],
          conversations: conversationIds,
        });
      }
    };
  }, [channelId, conversationIds]);
};
