import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useFocusEffect } from 'expo-router';

import type { ChatListHandle } from '@/src/features/chat/v2/components/chat/chat-list';

import { EDIT_STRIP_SETTLE_MS } from '../constants';

/**
 * Keeps the room at its newest messages where the redesign would move it off them:
 *
 * - The edit strip grows the typing bar, and the list's end space grows with it
 *   without scrolling, so the newest message, usually the one being edited,
 *   went under the strip. The list scrolls to its end once the strip has settled.
 * - The thread card leaves the room live under it, and the room's rows are
 *   measured again while the card is up (a reply deleted there, say), which
 *   drifts the list off its end. Back in front, the room returns to its end.
 *
 * Both only when the room was at its newest messages; scrolled up to an older
 * message, it stays put. Returns the list's scrolled-up callback, wrapped to
 * remember where the list is.
 */
export function useRoomKeepsTail(
  isEditing: boolean,
  listRef: RefObject<ChatListHandle | null>,
  onScrolledUpChange: (isScrolledUp: boolean) => void,
): (isScrolledUp: boolean) => void {
  const scrolledUp = useRef(false);
  // Whether the room was at its end when another screen covered it; null before the first cover.
  const leftAtTail = useRef<boolean | null>(null);

  useEffect(() => {
    if (!isEditing || scrolledUp.current) return undefined;
    const timer = setTimeout(() => {
      void listRef.current?.scrollToEnd({ animated: true });
    }, EDIT_STRIP_SETTLE_MS);
    return (): void => clearTimeout(timer);
  }, [isEditing, listRef]);

  useFocusEffect(
    useCallback(() => {
      if (leftAtTail.current === true) void listRef.current?.scrollToEnd({ animated: false });
      leftAtTail.current = null;
      return (): void => {
        leftAtTail.current = !scrolledUp.current;
      };
    }, [listRef]),
  );

  return useCallback(
    (isScrolledUp: boolean): void => {
      scrolledUp.current = isScrolledUp;
      onScrolledUpChange(isScrolledUp);
    },
    [onScrolledUpChange],
  );
}
