import { useCallback, useRef, type ReactElement, type RefObject } from 'react';
import type { View } from 'react-native';

import { useLatestRef } from '@/src/components/input-composer/utils/use-latest-ref';
import {
  ChatRenderProvider,
  useChatRenderTokens,
} from '@/src/features/chat/v2/components/chat/message-row';

import { setHoldSource } from '../model/hold-source-store';

/**
 * Lets a message row be lifted by the hold menu. The row attaches `rowRef` to
 * its pressable and calls `registerHold` as it is long-pressed; the menu then
 * asks the row where it is on screen and draws `buildCopy()` there.
 *
 * `buildCopy` is read through a ref, so the row can pass a fresh closure every
 * render without changing `registerHold`'s identity.
 *
 * The menu draws outside the list, where the list's render tokens (window
 * width, text widths) are not provided, so the copy carries the row's own.
 */
export function useHoldSource(buildCopy: () => ReactElement): {
  rowRef: RefObject<View | null>;
  registerHold: (messageId: string | null) => void;
} {
  const rowRef = useRef<View>(null);
  const tokens = useChatRenderTokens();
  const sourceRef = useLatestRef({ buildCopy, tokens });

  const registerHold = useCallback(
    (messageId: string | null): void => {
      // A row without a message (still unsent, or a system row) opens the menu unlifted.
      if (messageId === null) return;
      const source = sourceRef.current;
      setHoldSource(messageId, {
        content: (
          <ChatRenderProvider value={source.tokens}>{source.buildCopy()}</ChatRenderProvider>
        ),
        measure: onMeasured => {
          const node = rowRef.current;
          if (!node) {
            onMeasured(null);
            return;
          }
          node.measureInWindow((x, y, width, height) => {
            onMeasured(width > 0 && height > 0 ? { x, y, width, height } : null);
          });
        },
      });
    },
    [sourceRef],
  );

  return { rowRef, registerHold };
}
