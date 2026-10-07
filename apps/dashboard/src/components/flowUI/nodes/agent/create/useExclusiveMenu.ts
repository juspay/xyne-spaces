import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * One menu open at a time across the create canvas and its test chat.
 *
 * The test chat floats above the page and still takes clicks while a canvas
 * menu is open, and Radix only dismisses the top-most layer on an outside
 * press, so opening the chat's + over Add property used to leave both up. A
 * menu that opens closes whichever one was open before it.
 */
let closeOpenMenu: (() => void) | null = null;

export function useExclusiveMenu(): {
  open: boolean;
  onOpenChange: (open: boolean) => void;
} {
  const [open, setOpen] = useState(false);
  const closeRef = useRef(() => setOpen(false));

  useEffect(() => {
    const close = closeRef.current;
    return (): void => {
      if (closeOpenMenu === close) closeOpenMenu = null;
    };
  }, []);

  const onOpenChange = useCallback((next: boolean) => {
    const close = closeRef.current;
    if (next) {
      if (closeOpenMenu && closeOpenMenu !== close) closeOpenMenu();
      closeOpenMenu = close;
    } else if (closeOpenMenu === close) {
      closeOpenMenu = null;
    }
    setOpen(next);
  }, []);

  return { open, onOpenChange };
}
