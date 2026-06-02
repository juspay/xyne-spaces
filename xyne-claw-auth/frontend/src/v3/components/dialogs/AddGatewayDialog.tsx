import { useState } from "react";
import { WarningCircleIcon } from "@phosphor-icons/react";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { useSnackbar } from "../ui/Snackbar";
import { createGateway } from "../../../lib/api";
import type { Gateway } from "../../../lib/types";

interface AddGatewayDialogProps {
  open: boolean;
  existingTypes: string[];
  onClose: () => void;
  onCreated: (gateway: Gateway) => void;
}

export function AddGatewayDialog({ open, existingTypes, onClose, onCreated }: AddGatewayDialogProps) {
  const { show: showSnackbar } = useSnackbar();
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [creating, setCreating] = useState(false);

  const trimmedType = type.trim();
  const isDuplicate = trimmedType.length > 0 && existingTypes.includes(trimmedType);

  const handleCreate = async () => {
    if (!name.trim() || !trimmedType) return;
    setCreating(true);
    try {
      const gateway = await createGateway({ name: name.trim(), type: trimmedType });
      onCreated(gateway);
      setName("");
      setType("");
    } catch {
      showSnackbar({ variant: "error", title: "Failed to create gateway" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(newOpen) => {
        if (!newOpen) onClose();
      }}
      title="Add Gateway"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!name.trim() || !trimmedType || creating}
            onClick={handleCreate}
          >
            {creating ? "Creating..." : "Create"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[16px]">
        <div>
          <label className="mb-[4px] block text-[10px] font-medium uppercase tracking-[0.06em] text-xyne-fg-tertiary">
            Display Name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Slack, Microsoft Teams"
            className="w-full rounded-lg border border-xyne-border bg-xyne-surface px-[10px] py-[6px] text-[12px] text-xyne-fg-primary focus:border-xyne-brand focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-[4px] block text-[10px] font-medium uppercase tracking-[0.06em] text-xyne-fg-tertiary">
            Type
          </label>
          <input
            value={type}
            onChange={(e) => setType(e.target.value.toLowerCase().trim())}
            placeholder="e.g. slack, microsoft-teams"
            className="w-full rounded-lg border border-xyne-border bg-xyne-surface px-[10px] py-[6px] text-[12px] text-xyne-fg-primary focus:border-xyne-brand focus:outline-none"
          />
          <p className="mt-[4px] text-[11px] text-xyne-fg-tertiary">
            Lowercase, no spaces. Must match the gatewayType sent by your integration.
          </p>
          {isDuplicate && (
            <div className="mt-[4px] flex items-center gap-[6px] text-[11px] text-xyne-warning-fg">
              <WarningCircleIcon size={13} />
              A gateway of type &quot;{trimmedType}&quot; already exists. Creating another will fail.
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
