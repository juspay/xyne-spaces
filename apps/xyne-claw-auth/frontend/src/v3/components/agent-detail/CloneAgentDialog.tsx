/**
 * CloneAgentDialog — prompts for the new agent's name before cloning.
 *
 * A clone copies the prompt, tools, skills, behaviour settings and
 * knowledge-base grants into a new personal agent. Saved integration
 * credentials come across only when you already own the source — cloning
 * someone else's agent never copies their credentials, so the copy describes
 * itself differently in those two cases. Owners/contributors/admins get an
 * instant copy; everyone else raises an approval request (the chosen name is
 * carried through and applied when the owner approves). The parent owns the
 * actual clone call + navigation.
 */

import { useEffect, useRef, useState } from "react";
import { CopyIcon, CheckCircleIcon, WarningCircleIcon, CircleNotchIcon } from "@phosphor-icons/react";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { checkAgentName } from "../../../lib/api";

interface CloneAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Source agent's display name — used to seed the default "<name> (Copy)". */
  sourceName: string;
  /** True when the viewer can't edit → cloning raises an approval request. */
  needsApproval: boolean;
  /** True when the viewer already owns the source, the only case where its
   *  saved integration credentials travel with the copy. */
  isOwnAgent: boolean;
  /** Source's enabled state — mirrored onto the copy, so a paused source makes
   *  a paused copy and the dialog has to say so or the copy looks broken. */
  sourceEnabled: boolean;
  /** In-flight flag from the parent (disables inputs + button). */
  submitting: boolean;
  /** Called with the chosen name when the user confirms. */
  onConfirm: (name: string) => void;
}

const MAX_NAME = 200;

export function CloneAgentDialog({
  open,
  onOpenChange,
  sourceName,
  needsApproval,
  isOwnAgent,
  sourceEnabled,
  submitting,
  onConfirm,
}: CloneAgentDialogProps) {
  const [draft, setDraft] = useState("");
  // Name-availability check (advisory, matches the create-agent flow): the
  // display name isn't DB-unique, but we warn on collisions so two agents don't
  // end up with the same name. The clone's slug is generated server-side, so we
  // only check the name (empty slug → backend skips the slug check).
  const [checking, setChecking] = useState(false);
  const [nameTaken, setNameTaken] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Seed the default every time the dialog opens so it always reflects the
  // current source name and clears any prior edit.
  useEffect(() => {
    if (open) {
      setDraft(`${sourceName} (Copy)`);
      setChecking(false);
      setNameTaken(false);
    }
  }, [open, sourceName]);

  const trimmed = draft.trim().slice(0, MAX_NAME);

  // Debounced availability check. Re-runs whenever the trimmed name changes.
  useEffect(() => {
    if (!open) return;
    setNameTaken(false);
    if (!trimmed) {
      setChecking(false);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setChecking(true);
    timer.current = setTimeout(async () => {
      try {
        const r = await checkAgentName(trimmed, "");
        setNameTaken(!r.nameAvailable);
      } catch {
        // Network hiccup — don't block cloning on the advisory check.
        setNameTaken(false);
      } finally {
        setChecking(false);
      }
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [trimmed, open]);

  const canSubmit = trimmed.length > 0 && !submitting && !checking && !nameTaken;

  const submit = () => {
    if (!canSubmit) return;
    onConfirm(trimmed);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={needsApproval ? "Request a clone" : "Clone agent"}
      description={
        needsApproval
          ? "You'll send a request to this agent's owner. Your chosen name is used when they approve."
          : isOwnAgent
            ? "Creates your own copy — prompt, tools, skills, knowledge base and your integrations all come across. Its Spaces identity and sharing do not."
            : "Creates your own copy — prompt, tools, skills and knowledge-base grants come across. You'll connect your own credentials for its integrations."
      }
      maxWidth={520}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={!canSubmit}>
            {submitting
              ? needsApproval
                ? "Sending…"
                : "Cloning…"
              : needsApproval
                ? "Send request"
                : "Create copy"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <span className="text-[12px] font-semibold text-xyne-fg-secondary">Name</span>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit) submit();
          }}
          placeholder={`${sourceName} (Copy)`}
          maxLength={MAX_NAME}
          autoFocus
          disabled={submitting}
          className="w-full rounded-lg border border-xyne-border bg-xyne-surface-subtle px-3 py-2.5 text-[14px] text-xyne-fg-primary placeholder:text-xyne-fg-muted focus:border-xyne-border-focus focus:bg-xyne-surface focus:outline-none focus:shadow-[var(--comp-focus-ring)] disabled:opacity-60"
        />

        {/* Availability feedback — checking / taken / available. */}
        {trimmed.length > 0 && (
          <>
            {checking && (
              <span className="flex items-center gap-1.5 text-[11.5px] text-xyne-fg-tertiary">
                <CircleNotchIcon size={13} className="animate-spin" />
                Checking availability…
              </span>
            )}
            {!checking && nameTaken && (
              <span className="flex items-center gap-1.5 text-[11.5px] text-xyne-error-fg">
                <WarningCircleIcon size={13} weight="fill" />
                An agent named “{trimmed}” already exists — pick another name.
              </span>
            )}
            {!checking && !nameTaken && (
              <span className="flex items-center gap-1.5 text-[11.5px] text-xyne-success-fg">
                <CheckCircleIcon size={13} weight="fill" />
                Name is available.
              </span>
            )}
          </>
        )}

        <div className="mt-1 flex items-start gap-2 rounded-lg border border-xyne-border-subtle px-3 py-2 text-[11px] text-xyne-fg-tertiary">
          <CopyIcon size={12} className="mt-[1px] shrink-0" />
          <span>
            {sourceEnabled
              ? "The copy starts with no model selected — you'll pick one before its first run."
              : "This agent is paused, so your copy starts paused too — enable it when you're ready."}
          </span>
        </div>
      </div>
    </Dialog>
  );
}
