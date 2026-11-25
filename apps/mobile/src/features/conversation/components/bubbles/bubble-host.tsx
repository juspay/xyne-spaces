import { useSyncExternalStore, type ReactElement } from 'react';
import { useGlobalSearchParams, useSegments } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';

import { useBubbleScope, useBubbles } from '../../hooks/use-bubbles';
import { getBubblesReturning, subscribeBubblesReturning } from '../../model/bubble-return-store';
import { bubblesShowOver } from '../../model/bubbles';
import { BubbleAgentWatch } from './bubble-agent-watch';
import { BubbleStack } from './bubble-stack';

/**
 * Parked threads, mounted once in the app's root shell: each one's agent
 * feed, and the bubbles, which float over every screen except the thread
 * card itself, calls and full-screen viewers.
 */
export function BubbleHost(): ReactElement | null {
  const bubbles = useBubbles(useBubbleScope());
  const segments = useSegments() as string[];
  const focused = useIsFocused();
  const { threadId: shownThreadId } = useGlobalSearchParams<{ threadId?: string }>();
  // A card opened from a bubble is leaving: the bubbles return with its exit.
  const returning = useSyncExternalStore(
    subscribeBubblesReturning,
    getBubblesReturning,
    getBubblesReturning,
  );

  if (bubbles.parked.length === 0) return null;

  return (
    <>
      {bubbles.parked.map(thread => (
        <BubbleAgentWatch
          key={thread.threadId}
          channelId={thread.channelId}
          threadId={thread.threadId}
        />
      ))}
      <BubbleStack
        bubbles={bubbles}
        visible={
          returning ||
          (focused &&
            bubblesShowOver(
              segments,
              shownThreadId,
              bubbles.parked.map(thread => thread.threadId),
            ))
        }
      />
    </>
  );
}
