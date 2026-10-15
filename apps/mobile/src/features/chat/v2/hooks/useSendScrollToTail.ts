import { useCallback, type MutableRefObject, type RefObject } from 'react';

import type { useKeyboardScrollToEnd } from '@legendapp/list/keyboard';

import { CHAT_KEYBOARD_SCROLL_CLOSE_ON_SEND } from '@/src/features/chat/v2/chatKeyboardConfig';
import { shouldRetrySendScrollUntilReady } from '@/src/features/chat/v2/components/chat/chat-list-policy';

type ScrollMessageToEnd = ReturnType<typeof useKeyboardScrollToEnd>['scrollMessageToEnd'];

type UseSendScrollToTailParams = {
  /** Flipped to `false` on host unmount so a queued frame can bail out. */
  isMountedRef: RefObject<boolean>;
  /**
   * Set while a send-scroll owns the list freeze. Shared with the host's
   * `applyFreeze`, which ORs it together with the host-specific sheet owners.
   */
  isSendScrollInFlightRef: MutableRefObject<boolean>;
  /** Monotonic token so the newest send/scroll wins and stale ones bail out. */
  sendScrollSequenceRef: MutableRefObject<number>;
  /** Library helper that scrolls the underlying list to its tail. */
  scrollMessageToEnd: ScrollMessageToEnd;
  /** Host-owned single writer of the freeze SharedValue. */
  applyFreeze: () => void;
};

type RunSendScrollToTailOptions = {
  /** When provided, wait until this is true so the new row is in list data. */
  isReady?: () => boolean;
  /** Runs after this send's scroll settles (not when a newer send supersedes it). */
  onSettled?: () => void;
};

/**
 * Re-pins a chat list to the tail after a send. `maintainScrollAtEnd` only
 * follows the tail when the user is already near the bottom, so a send drives
 * the scroll explicitly. A sequence token lets a newer send/scroll win, and the
 * freeze owner state is re-applied once the library helper settles.
 *
 * The freeze owners diverge per host (a thread also has reminder/actions
 * sheets, the channel screen has only the actions sheet), so this hook does NOT
 * own the freeze. The host passes in `applyFreeze` plus the two refs it shares
 * with it — keeping one identical send-scroll sequencer for both screens while
 * each keeps its own freeze bookkeeping.
 */
export function useSendScrollToTail({
  isMountedRef,
  isSendScrollInFlightRef,
  sendScrollSequenceRef,
  scrollMessageToEnd,
  applyFreeze,
}: UseSendScrollToTailParams): (options?: RunSendScrollToTailOptions) => void {
  return useCallback(
    (options?: RunSendScrollToTailOptions): void => {
      const sendScrollSequence = ++sendScrollSequenceRef.current;
      let framesElapsed = 0;
      const attempt = (): void => {
        if (!isMountedRef.current || sendScrollSequenceRef.current !== sendScrollSequence) {
          return;
        }
        const isReady = options?.isReady?.() ?? true;
        if (shouldRetrySendScrollUntilReady(isReady, framesElapsed)) {
          framesElapsed += 1;
          requestAnimationFrame(attempt);
          return;
        }
        isSendScrollInFlightRef.current = true;
        applyFreeze();
        void scrollMessageToEnd({
          animated: true,
          closeKeyboard: CHAT_KEYBOARD_SCROLL_CLOSE_ON_SEND,
        }).finally(() => {
          if (sendScrollSequenceRef.current !== sendScrollSequence) {
            // A newer send owns the freeze, but the library scroll helper has
            // already released its internal freeze. Re-apply the combined owner
            // state before the newer scroll completes.
            applyFreeze();
            return;
          }
          // scrollMessageToEnd unconditionally sets freeze back to false when it
          // finishes; re-apply our combined state in case a sheet is still open.
          isSendScrollInFlightRef.current = false;
          applyFreeze();
          options?.onSettled?.();
        });
      };
      requestAnimationFrame(attempt);
    },
    [applyFreeze, scrollMessageToEnd, isMountedRef, isSendScrollInFlightRef, sendScrollSequenceRef],
  );
}
