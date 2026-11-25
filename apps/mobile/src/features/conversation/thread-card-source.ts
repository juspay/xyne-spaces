import type { View } from 'react-native';

import type { ThreadCardSource } from './model/thread-card-motion';
import { setThreadCardSource } from './model/thread-card-source-store';
import { THREAD_CARD_ROUTE, threadRoutePathname } from './thread-route';

/**
 * Notes where `node` sits on screen as the thing a thread card opens from, then
 * runs `open` once the frame is known (or straight away without a node, or
 * when threads open as the classic screen, which grows out of nothing). The
 * card grows out of that frame and shrinks back into it; one that cannot be
 * measured opens with the plain slide.
 */
export function openFromThreadCardSource(
  node: View | null,
  open: () => void,
  radius?: number,
): void {
  if (!node || threadRoutePathname() !== THREAD_CARD_ROUTE) {
    open();
    return;
  }
  node.measureInWindow((x, y, width, height) => {
    if (width > 0 && height > 0) {
      setThreadCardSource(
        radius === undefined ? { x, y, width, height } : { x, y, width, height, radius },
      );
    }
    open();
  });
}

/** Whether an Activity target opens a thread, the only kind a card grows out of its row for. */
export function activityTargetOpensThread(target: {
  kind: string;
  isThreadReply?: boolean | undefined;
}): boolean {
  return target.kind === 'message' && target.isThreadReply === true;
}

/**
 * The "N replies" strips on screen, by the thread each shows. The room list
 * recycles its rows, so a strip re-registers under its new thread and the card
 * only ever measures the strip that still shows its own.
 */
const openers = new Map<string, View>();

export function registerThreadCardOpener(threadId: string, node: View): () => void {
  openers.set(threadId, node);
  return (): void => {
    if (openers.get(threadId) === node) openers.delete(threadId);
  };
}

/**
 * Where the thread's strip sits now, as the card leaves: the room may have
 * moved under the card (new messages, the keyboard). Null when the strip is
 * gone or off screen, and the card keeps the frame it opened from.
 */
export function measureThreadCardOpener(
  threadId: string,
  windowHeight: number,
  done: (rect: Omit<ThreadCardSource, 'radius'> | null) => void,
): void {
  const node = openers.get(threadId);
  if (!node) {
    done(null);
    return;
  }
  node.measureInWindow((x, y, width, height) => {
    const onScreen = width > 0 && height > 0 && y + height > 0 && y < windowHeight;
    done(onScreen ? { x, y, width, height } : null);
  });
}
