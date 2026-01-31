import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'channel-scroll-positions';

type ScrollPositions = Record<string, number>;

interface UseChannelScrollPersistenceReturn {
  getScrollPosition: (channelId: string) => number | undefined;
  setScrollPosition: (channelId: string, position: number) => void;
}

/**
 * Hook to persist chat scroll positions per channel in localStorage
 *
 * @returns Object with getScrollPosition and setScrollPosition functions
 */
export const useChannelScrollPersistence = (): UseChannelScrollPersistenceReturn => {
  const [scrollPositions, setScrollPositions] = useState<ScrollPositions>({});

  // Load positions from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as ScrollPositions;
      setScrollPositions(parsed);
    }
  }, []);

  // Save to localStorage whenever positions change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scrollPositions));
  }, [scrollPositions]);

  const getScrollPosition = useCallback(
    (channelId: string): number | undefined => {
      return scrollPositions[channelId];
    },
    [scrollPositions],
  );

  const setScrollPosition = useCallback((channelId: string, position: number): void => {
    setScrollPositions(prev => ({
      ...prev,
      [channelId]: position,
    }));
  }, []);

  return {
    getScrollPosition,
    setScrollPosition,
  };
};
