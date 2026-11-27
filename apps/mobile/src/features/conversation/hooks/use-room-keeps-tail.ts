import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { useFocusEffect } from 'expo-router';

import type { ChatListHandle } from '@/src/features/chat/v2/components/chat/chat-list';

import { ROOM_RETURN_SETTLE_MS, TYPING_BAR_GROWTH_SETTLE_MS } from '../constants';

/**
 * Keeps the room at its newest messages where the redesign would move it off them:
 *
 * - The typing bar grows (its tools row on focus, the edit strip, the
 *   attachment tray, another line), and the list's end space grows with it
 *   without scrolling, so the newest message went under the bar. The list
 *   scrolls to its end once the bar has settled.
 * - The thread card leaves the room live under it, and the room's rows are
 *   measured again while the card is up (a reply deleted there, say), which
 *   drifts the list off its end. Back in front, the room returns to its end.
 *
 * Both only when the room was resting at its newest messages; scrolled up to
 * an older message, it stays put. Returns the dock's composer layout callback,
 * wrapped to follow the typing bar's growth.
 */
export function useRoomKeepsTail(
  listRef: RefObject<ChatListHandle | null>,
  onComposerLayout: (event: LayoutChangeEvent) => void,
): (event: LayoutChangeEvent) => void {
  // Whether the room was at its end when another screen covered it; null before the first cover.
  const leftAtTail = useRef<boolean | null>(null);
  // The typing bar's last height; null until it is first laid out.
  const barHeight = useRef<number | null>(null);
  const growthTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => (): void => clearTimeout(growthTimer.current), []);

  const handleComposerLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      onComposerLayout(event);
      const height = event.nativeEvent.layout.height;
      const grew = barHeight.current !== null && height > barHeight.current;
      barHeight.current = height;
      // Read before the list's end space follows the bar, so it is where the room rested.
      if (!grew || listRef.current?.isAtEnd() !== true) return;
      clearTimeout(growthTimer.current);
      growthTimer.current = setTimeout(() => {
        void listRef.current?.scrollToEnd({ animated: true });
      }, TYPING_BAR_GROWTH_SETTLE_MS);
    },
    [listRef, onComposerLayout],
  );

  useFocusEffect(
    useCallback(() => {
      const returnToTail = leftAtTail.current === true;
      leftAtTail.current = null;
      let settle: ReturnType<typeof setTimeout> | undefined;
      if (returnToTail) {
        void listRef.current?.scrollToEnd({ animated: false });
        // The last rows can still change as the card leaves (iOS lays the
        // room out again then), so the room goes to its end once more after.
        settle = setTimeout(() => {
          void listRef.current?.scrollToEnd({ animated: true });
        }, ROOM_RETURN_SETTLE_MS);
      }
      return (): void => {
        clearTimeout(settle);
        leftAtTail.current = listRef.current?.isAtEnd() === true;
      };
    }, [listRef]),
  );

  return handleComposerLayout;
}
