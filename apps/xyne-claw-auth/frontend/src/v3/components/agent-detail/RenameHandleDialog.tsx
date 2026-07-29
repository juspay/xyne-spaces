/**
 * RenameHandleDialog — owner-only flow for renaming an agent's handle.
 *
 * The handle is part of every URL pointing at this agent (`/v3/agents/:slug`)
 * so renaming it can break deep links. This dialog gates the action behind
 * explicit confirmation, runs client-side format validation, and surfaces
 * the backend's typed errors (INVALID_SLUG / SLUG_TAKEN) inline so the user
 * can correct without losing their input.
 *
 * On success: parent navigates to `/v3/agents/<newHandle>` so the page
 * follows the rename and doesn't 404 on the previous URL.
 */

import { useEffect, useState } from "react";
import { WarningCircleIcon } from "@phosphor-icons/react";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { updateAgent } from "../../../lib/api";

interface RenameHandleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentHandle: string;
  /** Called after a successful rename with the new handle. The parent is
      responsible for navigating to the new URL + reloading agent state. */
  onRenamed: (newHandle: string) => void;
}

// Matches the server-side regex in routes/agents.ts so client + server
// agree on acceptable handles. 2-64 chars, lowercase letters/digits/hyphens,
// no leading or trailing hyphen.
const HANDLE_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function validateHandle(handle: string): string | null {
  if (!handle) return "Handle is required.";
  if (handle.length < 2) return "Handle must be at least 2 characters.";
  if (handle.length > 64) return "Handle must be 64 characters or fewer.";
  if (!/^[a-z0-9-]+$/.test(handle))
    return "Use only lowercase letters, digits, and hyphens.";
  if (handle.startsWith("-") || handle.endsWith("-"))
    return "Handle can't start or end with a hyphen.";
  if (!HANDLE_REGEX.test(handle)) return "Invalid handle format.";
  return null;
}

export function RenameHandleDialog({
  open,
  onOpenChange,
  currentHandle,
  onRenamed,
}: RenameHandleDialogProps) {
  const [draft, setDraft] = useState(currentHandle);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form state every time the dialog opens — otherwise a previous
  // failed attempt or unchanged draft leaks across opens.
  useEffect(() => {
    if (open) {
      setDraft(currentHandle);
      setError(null);
      setSubmitting(false);
    }
  }, [open, currentHandle]);

  const trimmed = draft.trim().toLowerCase();
  const unchanged = trimmed === currentHandle;
  const validationError = unchanged ? null : validateHandle(trimmed);
  const canSubmit = !unchanged && !validationError && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateAgent(currentHandle, { slug: trimmed });
      onRenamed(trimmed);
      onOpenChange(false);
    } catch (err) {
      // The backend surfaces typed codes — pull a friendly message from
      // the response when possible, fall back to a generic line otherwise.
      const msg = err instanceof Error ? err.message : "";
      if (msg.toLowerCase().includes("already taken") || msg.includes("409")) {
        setError(`The handle "${trimmed}" is already in use.`);
      } else if (msg.toLowerCase().includes("invalid handle") || msg.includes("400")) {
        setError(msg.replace(/^[^:]+:\s*/, ""));
      } else if (msg.includes("403") || msg.toLowerCase().includes("forbidden")) {
        setError("You don't have permission to rename this agent.");
      } else {
        setError(msg || "Couldn't rename — please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Rename handle"
      description="The handle is part of this agent's URL. Renaming it will break any existing deep links."
      maxWidth={520}
      footer={
        <>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {submitting ? "Renaming…" : "Rename"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Current → new visual */}
        <div className="flex flex-col gap-2">
          <span className="text-[12px] font-semibold text-xyne-fg-secondary">
            New handle
          </span>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) handleSubmit();
            }}
            placeholder="e.g. kiwi-search"
            autoFocus
            disabled={submitting}
            className="w-full rounded-lg border border-xyne-border bg-xyne-surface-subtle px-3 py-2.5 font-mono text-[14px] text-xyne-fg-primary placeholder:text-xyne-fg-muted focus:border-xyne-border-focus focus:bg-xyne-surface focus:outline-none focus:shadow-[var(--comp-focus-ring)] disabled:opacity-60"
          />
          <p className="text-[11px] text-xyne-fg-tertiary">
            2-64 characters · lowercase letters, digits, and hyphens · no leading or trailing hyphen
          </p>
        </div>

        {/* Inline before/after preview when the draft is valid + changed */}
        {!unchanged && !validationError && (
          <div className="rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle px-3 py-2.5 flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.06em] text-xyne-fg-tertiary">
              Before · after
            </span>
            <div className="flex items-center gap-2 font-mono text-[13px]">
              <span className="text-xyne-fg-tertiary line-through">
                /agents/{currentHandle}
              </span>
              <span className="text-xyne-fg-tertiary">→</span>
              <span className="text-xyne-fg-primary">
                /agents/{trimmed}
              </span>
            </div>
          </div>
        )}

        {/* Validation hint (live, client-side) */}
        {!unchanged && validationError && (
          <div className="flex items-start gap-2 rounded-lg border border-xyne-warning-border bg-xyne-warning-bg px-3 py-2 text-[12px] text-xyne-warning-fg">
            <WarningCircleIcon size={14} weight="fill" className="shrink-0 mt-[1px]" />
            <span>{validationError}</span>
          </div>
        )}

        {/* Server-side error (from the API response) */}
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-xyne-error-border bg-xyne-error-bg px-3 py-2 text-[12px] text-xyne-error-fg">
            <WarningCircleIcon size={14} weight="fill" className="shrink-0 mt-[1px]" />
            <span>{error}</span>
          </div>
        )}

        {/* Permanent warning — non-dismissible reminder of consequences */}
        <div className="flex items-start gap-2 rounded-lg border border-xyne-border-subtle px-3 py-2 text-[11px] text-xyne-fg-tertiary">
          <WarningCircleIcon size={12} className="shrink-0 mt-[1px]" />
          <span>
            Existing bookmarks, links shared in chat, and references to this
            agent's URL will no longer work after the rename.
          </span>
        </div>
      </div>
    </Dialog>
  );
}
