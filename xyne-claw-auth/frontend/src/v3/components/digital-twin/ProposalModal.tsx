import { useState, useEffect } from "react";
import { SpinnerGapIcon, CheckIcon, XIcon, PencilSimpleIcon } from "@phosphor-icons/react";
import { patchDigitalTwinCandidate } from "../../../lib/api";
import type { DigitalTwinCandidate } from "../../../lib/api";
import { Dialog } from "../ui/Dialog";
import { Tooltip } from "../ui/Tooltip";
import { useSnackbar } from "../ui/Snackbar";

export const SUBSYSTEM_LABELS: Record<string, string> = {
  style:         "Communication style",
  triage:        "Response triage",
  expertise:     "Expertise",
  projects:      "Projects",
  relationships: "Relationships",
  preferences:   "Preferences",
  decisions:     "Decisions",
  context:       "Context",
  docs:          "Documents",
};

interface ProposalModalProps {
  userId: string;
  candidate: DigitalTwinCandidate;
  subsystem: string;
  open: boolean;
  onClose: () => void;
  /** Called with the candidateId immediately after a successful approval. */
  onApproved: (candidateId: string) => void;
  /** Called with the candidateId immediately after a successful rejection. */
  onRejected: (candidateId: string) => void;
}

export function ProposalModal({
  userId,
  candidate,
  subsystem,
  open,
  onClose,
  onApproved,
  onRejected,
}: ProposalModalProps) {
  const { show: showSnackbar } = useSnackbar();
  const [text, setText] = useState(candidate.editedText ?? candidate.text);
  const [acting, setActing] = useState<"approve" | "reject" | null>(null);

  // Reset text when a different candidate is shown
  useEffect(() => {
    setText(candidate.editedText ?? candidate.text);
  }, [candidate.id, candidate.editedText, candidate.text]);

  const isDirty = text !== (candidate.editedText ?? candidate.text);
  const isBusy  = acting !== null;

  const handleApprove = async () => {
    setActing("approve");
    try {
      await patchDigitalTwinCandidate(userId, candidate.id, {
        ...(isDirty ? { editedText: text } : {}),
        status: "approved",
      });
      showSnackbar({ variant: "success", title: "Approved — memory saved to Hindsight" });
      onApproved(candidate.id);
      onClose();
    } catch {
      showSnackbar({ variant: "error", title: "Failed to approve" });
    } finally {
      setActing(null);
    }
  };

  const handleReject = async () => {
    setActing("reject");
    try {
      await patchDigitalTwinCandidate(userId, candidate.id, { status: "rejected" });
      showSnackbar({ variant: "success", title: "Rejected" });
      onRejected(candidate.id);
      onClose();
    } catch {
      showSnackbar({ variant: "error", title: "Failed to reject" });
    } finally {
      setActing(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { if (!o && !isBusy) onClose(); }}
      title="Review proposal"
      description={`${SUBSYSTEM_LABELS[subsystem] ?? subsystem} · memory candidate`}
      maxWidth={540}
      leftOffset={100}
      backdropClassName="bg-black/70"
    >
      {/* ── Metadata ── */}
      <div className="flex flex-wrap items-center gap-[8px]">
        <span className="rounded-full bg-xyne-brand/10 px-[8px] py-[2px] text-[11px] font-medium text-xyne-brand">
          {SUBSYSTEM_LABELS[subsystem] ?? subsystem}
        </span>
        {candidate.signalScore != null && (
          <span className={`text-[11px] font-medium ${
            candidate.signalScore >= 0.8 ? "text-xyne-success-fg"
            : candidate.signalScore >= 0.6 ? "text-xyne-warning-fg"
            : "text-xyne-error-fg"
          }`}>
            {Math.round(candidate.signalScore * 100)}% confidence
          </span>
        )}
        {(candidate.sourceRefs?.length ?? 0) > 0 && (
          <span className="text-[11px] text-xyne-fg-tertiary">
            {candidate.sourceRefs.length} source{candidate.sourceRefs.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* ── Editable memory text ── */}
      <div className="flex flex-col gap-[6px]">
        <label className="flex items-center gap-[6px] text-[10px] font-semibold uppercase tracking-[0.08em] text-xyne-fg-muted">
          Memory text
          <span className="flex items-center gap-[3px] font-normal normal-case tracking-normal text-xyne-fg-tertiary">
            <PencilSimpleIcon size={11} />
            editable
          </span>
          {isDirty && (
            <span className="font-normal normal-case tracking-normal text-xyne-warning-fg">
              · edited
            </span>
          )}
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          disabled={isBusy}
          placeholder="Edit this memory before approving…"
          className="w-full resize-none rounded-lg border border-xyne-border bg-xyne-surface-sunken px-[12px] py-[8px] text-[13px] leading-relaxed text-xyne-fg-primary transition-colors hover:border-xyne-border-strong focus:border-xyne-brand focus:bg-xyne-surface focus:outline-none disabled:opacity-60"
        />
      </div>

      {/* ── Actions — centered icon bubbles ── */}
      <div className="flex flex-col items-center gap-[6px] pt-[4px]">
        <div className="flex items-center justify-center gap-[24px]">
          <Tooltip content={isDirty ? "Save & approve" : "Approve"} side="top">
            <button
              onClick={handleApprove}
              disabled={isBusy}
              className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-xyne-success-fg text-white shadow-md transition hover:opacity-90 active:scale-95 disabled:opacity-50"
              aria-label={isDirty ? "Save & approve" : "Approve"}
            >
              {acting === "approve"
                ? <SpinnerGapIcon size={22} className="animate-spin" />
                : <CheckIcon size={22} weight="bold" />}
            </button>
          </Tooltip>
          <Tooltip content="Reject" side="top">
            <button
              onClick={handleReject}
              disabled={isBusy}
              className="flex h-[52px] w-[52px] items-center justify-center rounded-full border-2 border-xyne-error-fg/60 bg-xyne-error-fg/8 text-xyne-error-fg shadow-md transition hover:bg-xyne-error-fg/15 active:scale-95 disabled:opacity-50"
              aria-label="Reject"
            >
              {acting === "reject"
                ? <SpinnerGapIcon size={22} className="animate-spin" />
                : <XIcon size={22} weight="bold" />}
            </button>
          </Tooltip>
        </div>
        <div className="flex items-center gap-[48px] text-[11px] text-xyne-fg-muted">
          <span>{isDirty ? "Save & approve" : "Approve"}</span>
          <span>Reject</span>
        </div>
      </div>
    </Dialog>
  );
}
