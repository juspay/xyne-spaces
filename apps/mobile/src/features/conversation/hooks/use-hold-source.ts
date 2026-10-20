import { useCallback, useEffect, useRef, type ReactElement, type RefObject } from 'react';
import type { View } from 'react-native';

import { setHoldSource } from '../model/hold-source-store';

/**
 * Lets a message row be lifted by the hold menu. The row attaches `rowRef` to
 * its pressable and calls `registerHold` as it is long-pressed; the menu then
 * asks the row where it is on screen and draws `buildCopy()` there.
 *
 * `buildCopy` is read through a ref, so the row can pass a fresh closure every
 * render without changing `registerHold`'s identity.
 */
export function useHoldSource(buildCopy: () => ReactElement): {
  rowRef: RefObject<View | null>;
  registerHold: (conversationId: string) => void;
} {
  const rowRef = useRef<View>(null);
  const buildCopyRef = useRef(buildCopy);
  useEffect(() => {
    buildCopyRef.current = buildCopy;
  });

  const registerHold = useCallback((conversationId: string): void => {
    setHoldSource(conversationId, {
      content: buildCopyRef.current(),
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
  }, []);

  return { rowRef, registerHold };
}
