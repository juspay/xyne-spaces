import { useState } from "react";
import { disableDigitalTwin } from "../../../lib/api";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";

interface DisableModalProps {
  userId: string;
  open: boolean;
  onClose: () => void;
  onDisabled: () => void;
}

export function DisableModal({ userId, open, onClose, onDisabled }: DisableModalProps) {
  const [deleteMemories, setDeleteMemories] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setDisabling(true);
    setErr(null);
    try {
      await disableDigitalTwin(userId, deleteMemories);
      onDisabled();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setDisabling(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(newOpen) => {
        if (!newOpen) onClose();
      }}
      title="Disable Digital Twin"
      leftOffset={100}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" disabled={disabling} onClick={submit}>
            {disabling ? "Disabling…" : "Disable"}
          </Button>
        </>
      }
    >
      <p className="text-[12px] text-xyne-fg-secondary">
        Disabling stops the Twin from responding to mentions and pauses the nightly curator.
        Your approved memories and candidates remain unless you choose to delete them.
      </p>
      <label className="flex cursor-pointer items-center gap-[8px] rounded-lg border border-xyne-border p-[10px]">
        <input
          type="checkbox"
          checked={deleteMemories}
          onChange={(e) => setDeleteMemories(e.target.checked)}
        />
        <span className="text-[12px] text-xyne-fg-primary">
          Also delete all my memories and candidates — this cannot be undone
        </span>
      </label>
      {err && (
        <div className="rounded-lg border border-xyne-border bg-xyne-error-bg p-[10px] text-[11px] text-xyne-error-fg">
          {err}
        </div>
      )}
    </Dialog>
  );
}
