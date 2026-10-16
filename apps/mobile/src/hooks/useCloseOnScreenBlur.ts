import { useEffect, useRef } from 'react';

import { useTabPageIsFocused } from '@/src/hooks/useTabPageFocus';

/**
 * Closes a screen's overlays when that screen loses focus.
 *
 * Bottom sheets render into a portal inside a `FullWindowOverlay`, which sits
 * above the navigator — so a navigation that happens while one is open (a push
 * from a notification tap, most visibly) leaves the sheet floating over the
 * destination screen with the new screen alive behind it. The screen that owns
 * the sheet state closes it here on the way out.
 *
 * `close` is read through a ref, so a caller that rebuilds the callback each
 * render cannot turn a re-subscribe into a spurious close.
 *
 * Uses pager page focus inside TabPager (layout-hosted screens are otherwise
 * always "focused" at the navigator), and navigator focus everywhere else.
 */
export function useCloseOnScreenBlur(close: () => void): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  const isFocused = useTabPageIsFocused();

  useEffect(() => {
    if (!isFocused) return;
    return (): void => {
      closeRef.current();
    };
  }, [isFocused]);
}
