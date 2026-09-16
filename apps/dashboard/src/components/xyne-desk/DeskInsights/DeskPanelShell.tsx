import React from 'react';
import { Dialog } from '../../ui/Dialog/Dialog';
import { cn } from '../../../utils/classNames';

/**
 * Shared right-slide sheet geometry for the desk insight panels (metrics,
 * topics explorer, desk report). Kept in one place so the standalone panels and
 * the combined Insights panel cannot drift apart visually.
 */
export const DESK_PANEL_DIALOG_CLASS = cn(
  'left-auto right-0 top-0 bottom-0 h-screen w-[85vw] max-h-none max-w-none translate-x-0 translate-y-0 rounded-l-[16px] rounded-r-none bg-transparent shadow-none',
  'data-[state=open]:!zoom-in-100 data-[state=open]:!slide-in-from-top-[0%] data-[state=open]:!slide-in-from-right-full',
  'data-[state=closed]:!zoom-out-100 data-[state=closed]:!slide-out-to-top-[0%] data-[state=closed]:!slide-out-to-right-full',
);

/**
 * Surface classes for a panel body. When the panel is embedded inside the
 * combined Insights sheet the outer sheet already owns the border, rounding and
 * shadow, so the child must not draw its own.
 */
export const deskPanelSurfaceClass = (embedded?: boolean): string =>
  cn(
    'isolate flex h-full w-full flex-col overflow-hidden bg-popover',
    !embedded && 'rounded-l-[16px] border border-desk-border shadow-2xl dark:border-border',
  );

export interface DeskPanelShellProps {
  /** When true the children are rendered inline (the caller owns the Dialog). */
  embedded?: boolean;
  open: boolean;
  onClose: () => void;
  /** Accessible dialog title, ignored when embedded. */
  title: string;
  children: React.ReactNode;
}

/**
 * Renders a desk insight panel either as its own right-slide Dialog (legacy
 * standalone usage) or inline inside the combined Insights sheet.
 */
export const DeskPanelShell: React.FC<DeskPanelShellProps> = ({
  embedded,
  open,
  onClose,
  title,
  children,
}) => {
  if (embedded) return <>{children}</>;
  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) onClose();
      }}
      title={title}
      className={DESK_PANEL_DIALOG_CLASS}
    >
      {children}
    </Dialog>
  );
};
