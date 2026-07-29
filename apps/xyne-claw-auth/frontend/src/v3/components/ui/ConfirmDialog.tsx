import { Dialog } from "./Dialog";
import { Button } from "./Button";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}

/**
 * ConfirmDialog — reusable confirmation modal for destructive actions.
 *
 * Focus trap and Esc-to-close are handled by the underlying Base UI Dialog.
 * Cancel button receives autoFocus so the destructive action is never the
 * default focused element.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button
            autoFocus
            variant="secondary"
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? "destructive" : "primary"}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {null}
    </Dialog>
  );
}
