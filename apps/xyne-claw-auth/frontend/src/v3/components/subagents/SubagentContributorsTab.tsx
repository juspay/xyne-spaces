/**
 * SubagentContributorsTab — manage who else can edit this subagent.
 *
 * Replaces the "Shares" tab from the old right column. Pure people-management
 * surface: add by email, list current contributors with their role, remove.
 * Built-in subagents render a read-only banner since they can't be shared.
 */

import { useState } from "react";
import {
  WarningCircleIcon,
  TrashIcon,
  PlusIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import type { SubagentShareEntry } from "../../../lib/api";
import { TextField } from "../ui/TextField";
import { Button } from "../ui/Button";

interface SubagentContributorsTabProps {
  shares: SubagentShareEntry[];
  isBuiltIn: boolean;
  canEdit: boolean;
  onAddShare: (userIdOrEmail: string) => void;
  onRemoveShare: (userId: string) => void;
  addingShare: boolean;
}

export function SubagentContributorsTab({
  shares,
  isBuiltIn,
  canEdit,
  onAddShare,
  onRemoveShare,
  addingShare,
}: SubagentContributorsTabProps) {
  const [input, setInput] = useState("");

  if (isBuiltIn) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-xyne-border-subtle bg-xyne-surface-sunken px-6 py-10 text-center">
        <WarningCircleIcon size={28} className="text-xyne-fg-muted" />
        <p className="text-[13px] text-xyne-fg-secondary">
          Built-in subagents cannot be shared
        </p>
        <p className="text-[12px] text-xyne-fg-tertiary max-w-[360px]">
          They're provided by the platform and editable only by platform admins.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Tab header */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-baseline gap-2">
            <span className="text-[14px] font-semibold text-xyne-fg-primary">
              Contributors
            </span>
            <span className="text-xyne-fg-tertiary">•</span>
            <span className="text-[13px] font-normal text-xyne-fg-tertiary">
              shares
            </span>
          </span>
        </div>
        <p className="text-[12px] text-xyne-fg-tertiary">
          People with permission to edit this subagent alongside the owner.
        </p>
      </div>

      {/* Add */}
      {canEdit && (
        <div className="flex gap-2">
          <TextField
            placeholder="Email or user ID"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1"
          />
          <Button
            variant="primary"
            size="sm"
            leadingIcon={<PlusIcon size={14} />}
            disabled={!input.trim() || addingShare}
            onClick={() => {
              onAddShare(input.trim());
              setInput("");
            }}
          >
            Add
          </Button>
        </div>
      )}

      {/* List */}
      {shares.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-xyne-border-subtle px-6 py-10 text-center">
          <UsersThreeIcon size={28} className="text-xyne-fg-muted" />
          <p className="text-[13px] text-xyne-fg-secondary">
            No contributors yet
          </p>
          <p className="text-[12px] text-xyne-fg-tertiary max-w-[360px]">
            Only the owner can edit this subagent. Add people above to give them
            edit access.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {shares.map((share) => (
            <div
              key={share.userId}
              className="flex items-center gap-2.5 rounded-lg border border-xyne-border-subtle bg-xyne-surface-sunken px-3 py-2.5"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-xyne-surface text-[11px] font-semibold text-xyne-fg-secondary border border-xyne-border">
                {share.name?.[0]?.toUpperCase() ?? "?"}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-xyne-fg-primary">
                  {share.name}
                </p>
                <p className="truncate text-[11px] text-xyne-fg-muted">
                  {share.email}
                </p>
              </div>
              <span className="rounded-full bg-xyne-surface px-2 py-0.5 text-[11px] text-xyne-fg-secondary border border-xyne-border">
                {share.role}
              </span>
              {canEdit && (
                <button
                  onClick={() => onRemoveShare(share.userId)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-xyne-fg-muted transition hover:bg-xyne-error-bg hover:text-xyne-error-fg"
                  title="Remove share"
                >
                  <TrashIcon size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
