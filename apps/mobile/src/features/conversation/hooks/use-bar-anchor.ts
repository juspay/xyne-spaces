import { useState, useSyncExternalStore, type RefObject } from 'react';
import type { View } from 'react-native';
import { useKeyboardHandler } from 'react-native-keyboard-controller';
import { scheduleOnRN } from 'react-native-worklets';

import { sameWindowRect, type WindowRect } from '../model/mentions-card';

/**
 * Where the typing bar is in the window, for a card drawn in a layer above it.
 * The bar attaches `ref` and calls `measure` from its `onLayout`; only the
 * card subscribes, so the bar itself never re-renders for a new position.
 */
export type BarAnchor = Readonly<{
  ref: RefObject<View | null>;
  /** Re-reads the bar's window rect; a no-op while nothing is subscribed. */
  measure: () => void;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => WindowRect | null;
}>;

function createBarAnchor(): BarAnchor {
  const ref: RefObject<View | null> = { current: null };
  const listeners = new Set<() => void>();
  let rect: WindowRect | null = null;

  const measure = (): void => {
    const node = ref.current;
    if (node === null || listeners.size === 0) return;
    node.measureInWindow((x, y, width, height) => {
      if (listeners.size === 0 || width <= 0) return;
      const next = { x, y, width, height };
      if (rect !== null && sameWindowRect(rect, next)) return;
      rect = next;
      listeners.forEach(listener => listener());
    });
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    if (listeners.size === 1) measure();
    return (): void => {
      listeners.delete(listener);
      // A rect kept while closed could be stale by the next open.
      if (listeners.size === 0) rect = null;
    };
  };

  return { ref, measure, subscribe, getSnapshot: () => rect };
}

export function useBarAnchor(): BarAnchor {
  const [anchor] = useState(createBarAnchor);
  return anchor;
}

/**
 * The bar's window rect while subscribed. The keyboard moves the bar without
 * a layout pass, so it is read again whenever the keyboard settles.
 */
export function useBarAnchorRect(anchor: BarAnchor): WindowRect | null {
  const rect = useSyncExternalStore(anchor.subscribe, anchor.getSnapshot);
  // Only `measure` goes to the worklet, not the anchor with its view ref.
  const { measure } = anchor;
  useKeyboardHandler(
    {
      onEnd: () => {
        'worklet';
        scheduleOnRN(measure);
      },
    },
    [measure],
  );
  return rect;
}
