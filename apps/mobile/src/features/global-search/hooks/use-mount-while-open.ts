/**
 * Keeps a bottom sheet mounted through its close animation; unmounting on
 * `isOpen === false` alone snaps it away.
 *
 * The same rule is reimplemented in add-people-modal, create-dm-drawer and
 * create-channel-drawer. It belongs on AppBottomSheet.
 */

import { useCallback, useEffect, useState } from 'react';

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

  useEffect(() => {
    if (isOpen) setShouldRender(true);
  }, [isOpen]);

  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );

  const onDismiss = useCallback(() => {
    setShouldRender(false);
  }, []);

  return { shouldRender, sheetProps: { isOpen, onOpenChange, onDismiss } };
}
