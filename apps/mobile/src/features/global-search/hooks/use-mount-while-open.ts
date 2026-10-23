/**
 * Keeps a bottom sheet mounted through its close animation; unmounting on
 * `isOpen === false` alone snaps it away.
 *
 * The same rule is reimplemented in add-people-modal, create-dm-drawer and
 * create-channel-drawer. It belongs on AppBottomSheet.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** The open/close contract every filter sheet hands to AppBottomSheet. */
export type SheetMountProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onDismiss: () => void;
};

export function useMountWhileOpen(
  isOpen: boolean,
  onClose: () => void,
): { shouldRender: boolean; sheetProps: SheetMountProps } {
  const [shouldRender, setShouldRender] = useState(isOpen);
  // Written synchronously in onOpenChange too: a swipe-away reports the open change and the
  // dismiss in one tick, before the owner re-renders with the new `isOpen`.
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;

  useEffect(() => {
    if (isOpen) setShouldRender(true);
  }, [isOpen]);

  const onOpenChange = useCallback(
    (open: boolean) => {
      isOpenRef.current = open;
      if (!open) onClose();
    },
    [onClose],
  );

  // A close that finishes after a quick reopen must not unmount the now-open sheet.
  const onDismiss = useCallback(() => {
    if (!isOpenRef.current) setShouldRender(false);
  }, []);

  return { shouldRender, sheetProps: { isOpen, onOpenChange, onDismiss } };
}
