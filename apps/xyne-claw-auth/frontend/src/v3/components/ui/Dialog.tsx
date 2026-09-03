import type { ReactNode } from "react";
import { Dialog as BaseDialog } from "@base-ui-components/react/dialog";
import { X } from "@phosphor-icons/react";
import { cn } from "../../../lib/utils";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Accepts a ReactNode so callers can stack multiple lines (e.g. a
      step indicator on the first line and a contextual subtitle on the
      second) without breaking layout. Strings work as before. */
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: number | string;
  maxHeight?: number | string;
  /** Force a specific height (not just max). Use in large/full modal modes so flex-1 children fill correctly. */
  height?: number | string;
  headerActions?: ReactNode;
  bodyClassName?: string;
  /**
   * Shift the modal center-point right by this many pixels.
   * Use half the sidebar width (100 for the 200px V3 sidebar) so the modal
   * appears centered over the content area rather than the full viewport.
   */
  leftOffset?: number;
  /** Extra Tailwind classes merged onto the backdrop — use to increase opacity. */
  backdropClassName?: string;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  maxWidth = 560,
  maxHeight,
  height,
  headerActions,
  bodyClassName,
  leftOffset = 0,
  backdropClassName,
}: DialogProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop
          data-id="dialog-backdrop"
          className={cn(
            "fixed inset-0 z-[var(--comp-z-modal)] bg-black/40",
            "transition-opacity duration-[var(--comp-duration-normal)] ease-out",
            "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
            backdropClassName,
          )}
        />
        <BaseDialog.Popup
          data-id="dialog-popup"
          style={{
            maxWidth,
            maxHeight: maxHeight !== undefined ? (typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight) : "70vh",
            ...(height !== undefined ? { height: typeof height === "number" ? `${height}px` : height } : {}),
            width: leftOffset
              ? `calc(100vw - 32px - ${Math.abs(leftOffset) * 2}px)`
              : "calc(100vw - 32px)",
            position: "fixed",
            top: "50%",
            left: leftOffset ? `calc(50% + ${leftOffset}px)` : "50%",
            transform: "translate(-50%, -50%)",
          }}
          className={cn(
            "z-[var(--comp-z-modal)]",
            "flex flex-col overflow-hidden",
            "rounded-[var(--comp-dialog-radius)] bg-xyne-surface",
            "shadow-[var(--comp-shadow-xl)] border border-xyne-border",
            "outline-none",
            "transition-[opacity,transform,width,max-width,height,max-height] duration-500 ease-in-out",
            "data-[starting-style]:opacity-0 data-[starting-style]:[transform:translate(-50%,-50%)_scale(0.95)]",
            "data-[ending-style]:opacity-0 data-[ending-style]:[transform:translate(-50%,-50%)_scale(0.95)]",
          )}
        >
          <div
            data-id="dialog-header"
            className="flex shrink-0 items-start justify-between gap-4 border-b border-xyne-border-subtle bg-xyne-surface-subtle px-[var(--comp-dialog-padding)] py-4"
          >
            <div className="min-w-0 flex-1">
              <BaseDialog.Title className="text-[16px] font-bold leading-snug text-xyne-fg-primary">
                {title}
              </BaseDialog.Title>
              {description && (
                <BaseDialog.Description className="mt-1 text-[13px] text-xyne-fg-secondary">
                  {description}
                </BaseDialog.Description>
              )}
            </div>
          {headerActions && (
            <div className="flex shrink-0 items-center gap-1">
              {headerActions}
            </div>
          )}
            <BaseDialog.Close
              data-id="dialog-close"
              aria-label="Close"
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                "text-xyne-fg-muted hover:bg-xyne-border-subtle hover:text-xyne-fg-primary",
                "transition-colors duration-[var(--comp-duration-fast)]",
              )}
            >
              <X size={15} weight="bold" />
            </BaseDialog.Close>
          </div>

          <div
            data-id="dialog-body"
            className={bodyClassName ?? "flex-1 overflow-y-auto p-[var(--comp-dialog-padding)]"}
          >
            {bodyClassName !== undefined
              ? children
              : <div className="flex flex-col gap-4">{children}</div>}
          </div>

          {footer && (
            <div
              data-id="dialog-footer"
              className="flex shrink-0 items-center justify-end gap-2 border-t border-xyne-border-subtle bg-xyne-surface-subtle/60 px-[var(--comp-dialog-padding)] py-4"
            >
              {footer}
            </div>
          )}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
