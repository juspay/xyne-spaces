import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';

type SetOpen = (open: boolean) => void;

const ExclusivePickerContext = createContext<{ current: SetOpen | null } | null>(null);

/**
 * Keeps one row picker open at a time. Row picker triggers stop click propagation so the row
 * doesn't open, which also stops Radix from treating that click as "outside" an open picker —
 * so the open one is closed here on pointer-down, before the next picker opens and takes focus.
 */
export function ExclusivePickerScope({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}): ReactNode {
  const openPicker = useRef<SetOpen | null>(null);
  const scopeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scope = scopeRef.current;
    if (!scope) return undefined;
    const closeOpenPicker = (event: PointerEvent): void => {
      const close = openPicker.current;
      if (!close) return;
      // The open picker's own trigger toggles it closed; Radix handles that.
      if (event.target instanceof Element && event.target.closest('[aria-expanded="true"]')) return;
      close(false);
      openPicker.current = null;
    };
    scope.addEventListener('pointerdown', closeOpenPicker, true);
    return (): void => scope.removeEventListener('pointerdown', closeOpenPicker, true);
  }, []);

  return (
    <ExclusivePickerContext.Provider value={openPicker}>
      <div ref={scopeRef} className={className}>
        {children}
      </div>
    </ExclusivePickerContext.Provider>
  );
}

/** No-op outside an ExclusivePickerScope. `setOpen` must be stable (a useState setter). */
export function useExclusivePicker(open: boolean, setOpen: SetOpen): void {
  const openPicker = useContext(ExclusivePickerContext);
  useEffect(() => {
    if (open && openPicker) openPicker.current = setOpen;
  }, [open, openPicker, setOpen]);
}
