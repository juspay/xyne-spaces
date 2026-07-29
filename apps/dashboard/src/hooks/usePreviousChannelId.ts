import { useEffect, useRef } from 'react';

/**
 * Hook to track the previous channel ID
 * Returns the previous channelId, or null if there's no previous channel
 */
export function usePreviousChannelId(channelId: string | undefined): string | null {
  const prevRef = useRef<string | null>(null);
  const currentRef = useRef<string | null>(null);

  useEffect(() => {
    // Store the current channelId as previous before updating
    prevRef.current = currentRef.current;
    // Update current to the new channelId
    currentRef.current = channelId || null;
  }, [channelId]);

  // Return the previous channelId (will be null on first render)
  return prevRef.current;
}
