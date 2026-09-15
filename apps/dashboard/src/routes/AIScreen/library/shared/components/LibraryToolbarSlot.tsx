import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const LibraryToolbarSlotContext = createContext<HTMLElement | null>(null);

export const LibraryToolbarSlotProvider = LibraryToolbarSlotContext.Provider;

export function LibraryToolbarPortal({ children }: { children: ReactNode }): ReactElement | null {
  const slot = useContext(LibraryToolbarSlotContext);
  if (!slot) return null;
  return createPortal(children, slot);
}
