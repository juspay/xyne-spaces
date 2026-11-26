import { useEffect, useRef, type RefObject } from 'react';
import { AccessibilityInfo, findNodeHandle, type View } from 'react-native';

/**
 * Moves the screen reader to `ref` once it has mounted, after `delayMs` (the
 * swap that brings it in), so a control that replaces the one just tapped
 * keeps the reader's place. `enabled` is read at mount only: a later render
 * must not cancel the move.
 */
export function useMountAccessibilityFocus(
  ref: RefObject<View | null>,
  enabled: boolean,
  delayMs: number,
): void {
  const enabledAtMount = useRef(enabled);
  const delayAtMount = useRef(delayMs);
  useEffect(() => {
    if (!enabledAtMount.current) return undefined;
    const timer = setTimeout(() => {
      const node = ref.current ? findNodeHandle(ref.current) : null;
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, delayAtMount.current);
    return (): void => clearTimeout(timer);
  }, [ref]);
}
