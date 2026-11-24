import { type ReactElement } from 'react';
import { useSegments } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';

import { useBubbleScope, useBubbles } from '../../hooks/use-bubbles';
import { BubbleAgentWatch } from './bubble-agent-watch';
import { BubbleStack } from './bubble-stack';

/** The room's route: the chat stack's `[channelId]` index. */
const ROOM_SEGMENT = '[channelId]';

/**
 * Parked threads for the chat stack, mounted once in its layout: each one's
 * agent feed, and the bubbles, which show over the room only (a thread card,
 * the room's other pages or a screen above the stack hide them).
 */
export function BubbleHost(): ReactElement | null {
  const bubbles = useBubbles(useBubbleScope());
  const segments = useSegments() as string[];
  const focused = useIsFocused();

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
      <BubbleStack bubbles={bubbles} visible={focused && segments.at(-1) === ROOM_SEGMENT} />
    </>
  );
}
