/**
 * React hook for channel operations.
 */

import { useState, useEffect, useCallback } from 'react';
import { getSdkClient } from '../lib/sdk-client';
import type { Channel } from '@xyne/spaces-sdk';

interface UseChannelsReturn {
  channels: Channel[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  markAsViewed: (channelId: string) => Promise<void>;
}

export function useChannels(): UseChannelsReturn {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchChannels = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const sdk = await getSdkClient();
      // Use listAll() which returns Channel[] directly
      const channelList = await sdk.channels.listAll();

      // Sort by most recent activity
      const sorted = [...channelList].sort((a, b) => {
        return (b.lastActivityAt || 0) - (a.lastActivityAt || 0);
      });

      setChannels(sorted);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load channels';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const markAsViewed = useCallback(async (channelId: string) => {
    try {
      const sdk = await getSdkClient();
      await sdk.channels.markAsViewed(channelId);
    } catch (err) {
      console.error('Failed to mark channel as viewed:', err);
    }
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  return {
    channels,
    isLoading,
    error,
    refresh: fetchChannels,
    markAsViewed,
  };
}
