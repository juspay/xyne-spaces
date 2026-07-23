import { useEffect, useState } from "react";
import { SpinnerGapIcon, CheckCircleIcon, WarningIcon } from "@phosphor-icons/react";
import { deleteDigitalTwinMemories, getDigitalTwinStatus } from "../../../lib/api";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";

interface Props {
  userId: string;
  open: boolean;
  /** Current live memory count, for the confirmation copy. */
  currentCount?: number;
  onClose: () => void;
  /** Fired once the background delete has finished, so the caller can refresh. */
  onDeleted: () => void;
}

type Phase = "form" | "deleting" | "done" | "error";

/**
 * Delete the user's stored twin memories — all, or a created-date range. The
 * delete runs in the background; this modal fires it and then polls
 * status.memoryDeleteInProgress, showing a live indicator (remaining count)
 * until it completes. Used to wipe + re-backfill with clean temporal metadata.
 */
export function DeleteMemoriesModal({ userId, open, currentCount, onClose, onDeleted }: Props) {
  const [mode, setMode] = useState<"all" | "range">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [deletedCount, setDeletedCount] = useState(0);
  const [liveCount, setLiveCount] = useState<number | undefined>(currentCount);
  const [err, setErr] = useState<string | null>(null);

  // Pull the current memory count when the modal opens (for the confirm copy +
  // the "remaining" indicator baseline).
  useEffect(() => {
    if (!open) return;
    setLiveCount(currentCount);
    getDigitalTwinStatus(userId)
      .then((s) => setLiveCount(s.memoryCount ?? 0))
      .catch(() => {});
  }, [open, userId, currentCount]);

  const reset = () => {
    setPhase("form");
    setRemaining(null);
    setDeletedCount(0);
    setErr(null);
  };

  const close = () => {
    if (phase === "deleting") return; // don't allow closing mid-delete
    reset();
    onClose();
  };

  async function submit() {
    setErr(null);
    if (mode === "range" && (!from || !to || from > to)) {
      setErr("Pick a valid date range (from ≤ to).");
      return;
    }
    const before = liveCount ?? 0;
    setPhase("deleting");
    setRemaining(before);
    try {
      await deleteDigitalTwinMemories(userId, {
        mode,
        ...(mode === "range"
          ? { from: new Date(`${from}T00:00:00`).toISOString(), to: new Date(`${to}T23:59:59.999`).toISOString() }
          : {}),
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPhase("error");
      return;
    }

    // Poll the delete indicator until the background job clears.
    let ticks = 0;
    const iv = setInterval(async () => {
      ticks += 1;
      try {
        const s = await getDigitalTwinStatus(userId);
        setRemaining(s.memoryCount ?? 0);
        if (!s.memoryDeleteInProgress) {
          clearInterval(iv);
          setDeletedCount(Math.max(0, before - (s.memoryCount ?? 0)));
          setPhase("done");
          onDeleted();
          setTimeout(() => close(), 1400);
        }
      } catch {
        /* transient — keep polling */
      }
      if (ticks >= 80) {
        clearInterval(iv);
        setPhase("done");
        onDeleted();
      }
    }, 1500);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
      title="Delete memories"
      leftOffset={100}
      footer={
        phase === "form" || phase === "error" ? (
          <>
            <Button variant="ghost" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={submit}>
              {mode === "all" ? "Delete all memories" : "Delete range"}
            </Button>
          </>
        ) : phase === "done" ? (
          <Button variant="ghost" size="sm" onClick={close}>
            Close
          </Button>
        ) : null
      }
    >
      {phase === "deleting" ? (
        <div className="flex flex-col items-center gap-[10px] py-[14px] text-center">
          <SpinnerGapIcon size={26} className="animate-spin text-xyne-fg-secondary" />
          <p className="text-[13px] font-medium text-xyne-fg-primary">Deleting memories…</p>
          <p className="text-[12px] text-xyne-fg-tertiary">
            {remaining != null ? <>{remaining} memor{remaining === 1 ? "y" : "ies"} remaining</> : "Working…"}
          </p>
          <p className="text-[11px] text-xyne-fg-muted">This runs in the background — keep this open.</p>
        </div>
      ) : phase === "done" ? (
        <div className="flex flex-col items-center gap-[8px] py-[14px] text-center">
          <CheckCircleIcon size={26} weight="fill" className="text-xyne-success-fg" />
          <p className="text-[13px] font-medium text-xyne-fg-primary">
            Deleted {deletedCount} memor{deletedCount === 1 ? "y" : "ies"}
          </p>
          <p className="text-[12px] text-xyne-fg-tertiary">Run a backfill to rebuild with fresh temporal metadata.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-[12px]">
          <p className="text-[12px] text-xyne-fg-secondary">
            Permanently removes your stored memories from the Twin. Your persona files (soul.md, …) are kept.
            {typeof liveCount === "number" && (
              <> You currently have <span className="font-semibold text-xyne-fg-primary">{liveCount}</span> memor{liveCount === 1 ? "y" : "ies"}.</>
            )}
          </p>

          <div className="flex flex-col gap-[6px]">
            <label className={`flex cursor-pointer items-start gap-[8px] rounded-lg border p-[10px] transition ${mode === "all" ? "border-xyne-fg-primary bg-xyne-surface-sunken" : "border-xyne-border hover:bg-xyne-surface-sunken/60"}`}>
              <input type="radio" name="del-mode" checked={mode === "all"} onChange={() => setMode("all")} className="mt-[2px]" />
              <span>
                <span className="block text-[12px] font-medium text-xyne-fg-primary">All memories</span>
                <span className="block text-[11px] text-xyne-fg-tertiary">Wipe everything for a clean re-backfill.</span>
              </span>
            </label>

            <label className={`flex cursor-pointer items-start gap-[8px] rounded-lg border p-[10px] transition ${mode === "range" ? "border-xyne-fg-primary bg-xyne-surface-sunken" : "border-xyne-border hover:bg-xyne-surface-sunken/60"}`}>
              <input type="radio" name="del-mode" checked={mode === "range"} onChange={() => setMode("range")} className="mt-[2px]" />
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-medium text-xyne-fg-primary">Date range</span>
                <span className="block text-[11px] text-xyne-fg-tertiary">Only memories created between two dates.</span>
                {mode === "range" && (
                  <div className="mt-[8px] flex items-center gap-[8px]">
                    <input
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                      className="rounded-md border border-xyne-border bg-xyne-surface px-[8px] py-[4px] text-[12px] text-xyne-fg-primary"
                    />
                    <span className="text-[11px] text-xyne-fg-muted">to</span>
                    <input
                      type="date"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                      className="rounded-md border border-xyne-border bg-xyne-surface px-[8px] py-[4px] text-[12px] text-xyne-fg-primary"
                    />
                  </div>
                )}
              </span>
            </label>
          </div>

          <div className="flex items-start gap-[6px] rounded-lg border border-xyne-error-fg/25 bg-xyne-error-bg px-[10px] py-[8px] text-[11px] text-xyne-error-fg">
            <WarningIcon size={13} weight="bold" className="mt-[1px] shrink-0" />
            This can't be undone. Deleted memories are removed from recall, the memories tab, and the constellation.
          </div>

          {err && (
            <div className="rounded-lg border border-xyne-border bg-xyne-error-bg p-[10px] text-[11px] text-xyne-error-fg">{err}</div>
          )}
        </div>
      )}
    </Dialog>
  );
}
