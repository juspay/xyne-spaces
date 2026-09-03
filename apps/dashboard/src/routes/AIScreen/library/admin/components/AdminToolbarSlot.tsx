import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const AdminToolbarSlotContext = createContext<HTMLElement | null>(null);

export const AdminToolbarSlotProvider = AdminToolbarSlotContext.Provider;

export function AdminToolbarPortal({ children }: { children: ReactNode }): ReactElement | null {
  const slot = useContext(AdminToolbarSlotContext);
  if (!slot) return null;
  return createPortal(children, slot);
}

const AdminFooterSlotContext = createContext<HTMLElement | null>(null);

export const AdminFooterSlotProvider = AdminFooterSlotContext.Provider;

export function AdminFooterPortal({ children }: { children: ReactNode }): ReactElement | null {
  const slot = useContext(AdminFooterSlotContext);
  if (!slot) return null;
  return createPortal(children, slot);
}
