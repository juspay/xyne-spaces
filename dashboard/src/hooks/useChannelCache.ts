import { useState, useEffect } from 'react';

const MAX_CACHED_CHANNELS = 10;

type CachedChannel = {
  channelId: string;
  lastAccessedAt: number;
};

export function useChannelCache(activeChannelId: string | undefined): CachedChannel[] {
  const [cachedChannels, setCachedChannels] = useState<CachedChannel[]>([]);

  useEffect(() => {
    if (!activeChannelId) return;
    setCachedChannels(prev => {
      const existing = prev.filter(c => c.channelId !== activeChannelId);
      const updated = [{ channelId: activeChannelId, lastAccessedAt: Date.now() }, ...existing];
      return updated.slice(0, MAX_CACHED_CHANNELS);
    });
  }, [activeChannelId]);

  return cachedChannels;
}
