import { useCallback, useEffect, useRef } from 'react';

import type { ChatInputSendHandler } from '@/src/components/input-composer';

import { sendScrollToEndOptions } from './sendScroll';

export const useSendAndFollowTail = ({
  onSend,
  isEditing,
  isAtTail,
  scrollToEnd,
}: {
  onSend: ChatInputSendHandler;
  isEditing: boolean;
  /** Mirrors V2's `!isScrolledUpRef.current` edit rule. */
  isAtTail: boolean;
  scrollToEnd: (options: { animated: boolean; closeKeyboard: boolean }) => Promise<void>;
}): ChatInputSendHandler => {
  const frameRef = useRef<number | null>(null);
  useEffect(
    () => (): void => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    },
    [],
  );
  return useCallback(
    (payload, restore): void => {
      void onSend(payload, restore);
      if (isEditing && !isAtTail) {
        return;
      }
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        void scrollToEnd(sendScrollToEndOptions);
      });
    },
    [isAtTail, isEditing, onSend, scrollToEnd],
  );
};
