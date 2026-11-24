import { useCallback, useState } from 'react';

type SheetPhase = 'closed' | 'open' | 'closing';

type TransientSheet = {
  /** Mount the sheet: open, or still animating away. */
  mounted: boolean;
  isOpen: boolean;
  open: () => void;
  onOpenChange: (open: boolean) => void;
  onDismiss: () => void;
};

/**
 * A sheet a row mounts only while it is showing, so a row does not carry one
 * per message. It stays mounted after closing until the sheet reports it has
 * left the screen, so its exit animation plays.
 */
export function useTransientSheet(): TransientSheet {
  const [phase, setPhase] = useState<SheetPhase>('closed');

  const open = useCallback((): void => setPhase('open'), []);
  const onOpenChange = useCallback((next: boolean): void => {
    setPhase(previous => {
      if (next) return 'open';
      return previous === 'closed' ? 'closed' : 'closing';
    });
  }, []);
  const onDismiss = useCallback((): void => setPhase('closed'), []);

  return { mounted: phase !== 'closed', isOpen: phase === 'open', open, onOpenChange, onDismiss };
}
