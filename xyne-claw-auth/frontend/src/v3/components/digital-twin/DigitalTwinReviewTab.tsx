import { useState, useEffect, useCallback } from "react";
import {
  PencilSimpleIcon,
  GraduationCapIcon,
  FolderOpenIcon,
  UsersThreeIcon,
  SlidersIcon,
  GitBranchIcon,
  IdentificationCardIcon,
  FileTextIcon,
  SpinnerGapIcon,
  CheckIcon,
  XIcon,
} from "@phosphor-icons/react";
import { listDigitalTwinClusters, getDigitalTwinCluster, patchDigitalTwinCandidate, approveDigitalTwinCluster } from "../../../lib/api";
import type { DigitalTwinCandidate } from "../../../lib/api";
import { Skeleton } from "../ui/Skeleton";
import { Tooltip } from "../ui/Tooltip";
import { useSnackbar } from "../ui/Snackbar";

const SUBSYSTEM_CONFIG: Record<string, { label: string; icon: React.ReactNode }> = {
  style:         { label: "Communication style", icon: <PencilSimpleIcon weight="duotone" size={13} /> },
  expertise:     { label: "Expertise",            icon: <GraduationCapIcon weight="duotone" size={13} /> },
  projects:      { label: "Projects",             icon: <FolderOpenIcon weight="duotone" size={13} /> },
  relationships: { label: "Relationships",        icon: <UsersThreeIcon weight="duotone" size={13} /> },
  preferences:   { label: "Preferences",          icon: <SlidersIcon weight="duotone" size={13} /> },
  decisions:     { label: "Decisions",            icon: <GitBranchIcon weight="duotone" size={13} /> },
  context:       { label: "Context",              icon: <IdentificationCardIcon weight="duotone" size={13} /> },
  docs:          { label: "Documents",            icon: <FileTextIcon weight="duotone" size={13} /> },
};

interface Group {
  subsystem: string;
  candidates: DigitalTwinCandidate[];
}

interface DigitalTwinReviewTabProps {
  userId: string;
  onApproved?: () => void;
}

function CandidateRow({
  userId,
  candidate,
  onApproved,
  onRejected,
}: {
  userId: string;
  candidate: DigitalTwinCandidate;
  onApproved: (id: string) => void;
  onRejected: (id: string) => void;
}) {
  const { show: showSnackbar } = useSnackbar();
  const [acting, setActing] = useState<"approve" | "reject" | "save" | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(candidate.editedText ?? candidate.text);
  // Committed copy shown when not editing — updated after a successful save.
  const [committed, setCommitted] = useState(candidate.editedText ?? candidate.text);

  const isBusy = acting !== null;
  const isDirty = text.trim() !== committed.trim();

  const handleApprove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setActing("approve");
    try {
      // Persist any unsaved edit alongside the approval.
      await patchDigitalTwinCandidate(userId, candidate.id, {
        ...(isDirty ? { editedText: text.trim() } : {}),
        status: "approved",
      });
      showSnackbar({ variant: "success", title: "Approved — memory saved to Hindsight" });
      onApproved(candidate.id);
    } catch {
      showSnackbar({ variant: "error", title: "Failed to approve" });
    } finally {
      setActing(null);
    }
  };

  const handleReject = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setActing("reject");
    try {
      await patchDigitalTwinCandidate(userId, candidate.id, { status: "rejected" });
      showSnackbar({ variant: "success", title: "Rejected" });
      onRejected(candidate.id);
    } catch {
      showSnackbar({ variant: "error", title: "Failed to reject" });
    } finally {
      setActing(null);
    }
  };

  const handleSave = async () => {
    if (!isDirty) { setEditing(false); return; }
    setActing("save");
    try {
      await patchDigitalTwinCandidate(userId, candidate.id, { editedText: text.trim() });
      setCommitted(text.trim());
      setEditing(false);
      showSnackbar({ variant: "success", title: "Edit saved" });
    } catch {
      showSnackbar({ variant: "error", title: "Failed to save edit" });
    } finally {
      setActing(null);
    }
  };

  const handleCancelEdit = () => {
    setText(committed);
    setEditing(false);
  };

  return (
    <div className="flex w-full items-start gap-[10px] px-[14px] py-[12px]">
      <div className="min-w-0 flex-1">
        {editing ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={isBusy}
            rows={3}
            autoFocus
            className="w-full resize-none rounded-lg border border-xyne-brand bg-xyne-surface-sunken px-[10px] py-[7px] text-[12px] leading-relaxed text-xyne-fg-primary focus:outline-none disabled:opacity-60"
          />
        ) : (
          <p className="line-clamp-2 text-[12px] leading-relaxed text-xyne-fg-primary">
            {committed}
          </p>
        )}
        <div className="mt-[5px] flex flex-wrap items-center gap-[8px]">
          {candidate.signalScore != null && (
            <span className={`text-[10px] font-medium ${
              candidate.signalScore >= 0.8 ? "text-xyne-success-fg"
              : candidate.signalScore >= 0.6 ? "text-xyne-warning-fg"
              : "text-xyne-error-fg"
            }`}>
              {Math.round(candidate.signalScore * 100)}% confidence
            </span>
          )}
          {isDirty && !editing && (
            <span className="text-[10px] font-medium text-xyne-warning-fg">· edited</span>
          )}
          {(candidate.sourceRefs?.length ?? 0) > 0 && (
            <span className="text-[10px] text-xyne-fg-tertiary">
              {candidate.sourceRefs.length} source{candidate.sourceRefs.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Inline actions */}
      <div className="flex shrink-0 items-center gap-[8px]" onClick={(e) => e.stopPropagation()}>
        {editing ? (
          <>
            <Tooltip content="Save edit" side="top">
              <button
                onClick={() => void handleSave()}
                disabled={isBusy}
                className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-xyne-brand text-white transition hover:opacity-85 active:scale-95 disabled:opacity-50"
              >
                {acting === "save"
                  ? <SpinnerGapIcon size={14} className="animate-spin" />
                  : <CheckIcon size={14} weight="bold" />}
              </button>
            </Tooltip>
            <Tooltip content="Cancel" side="top">
              <button
                onClick={handleCancelEdit}
                disabled={isBusy}
                className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-xyne-border bg-xyne-surface text-xyne-fg-tertiary transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary active:scale-95 disabled:opacity-50"
              >
                <XIcon size={14} weight="bold" />
              </button>
            </Tooltip>
          </>
        ) : (
          <>
            <Tooltip content="Edit" side="top">
              <button
                onClick={() => setEditing(true)}
                disabled={isBusy}
                className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-xyne-border bg-xyne-surface text-xyne-fg-tertiary transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary active:scale-95 disabled:opacity-50"
              >
                <PencilSimpleIcon size={14} />
              </button>
            </Tooltip>
            <Tooltip content={isDirty ? "Save & approve" : "Approve"} side="top">
              <button
                onClick={(e) => void handleApprove(e)}
                disabled={isBusy}
                className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-xyne-success-fg text-white transition hover:opacity-85 active:scale-95 disabled:opacity-50"
              >
                {acting === "approve"
                  ? <SpinnerGapIcon size={14} className="animate-spin" />
                  : <CheckIcon size={14} weight="bold" />}
              </button>
            </Tooltip>
            <Tooltip content="Reject" side="top">
              <button
                onClick={(e) => void handleReject(e)}
                disabled={isBusy}
                className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-xyne-error-fg/50 bg-xyne-error-bg/40 text-xyne-error-fg transition hover:bg-xyne-error-bg active:scale-95 disabled:opacity-50"
              >
                {acting === "reject"
                  ? <SpinnerGapIcon size={14} className="animate-spin" />
                  : <XIcon size={14} weight="bold" />}
              </button>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );
}

export function DigitalTwinReviewTab({ userId, onApproved }: DigitalTwinReviewTabProps) {
  const [groups, setGroups]   = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState<string | null>(null);
  const { show: showSnackbar } = useSnackbar();
  const [bulkActing, setBulkActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const { clusters } = await listDigitalTwinClusters(userId);
      const withPending = clusters.filter((c) => c.pending > 0);
      const results = await Promise.all(
        withPending.map((cl) =>
          getDigitalTwinCluster(userId, cl.subsystem)
            .then((data) => ({
              subsystem: cl.subsystem,
              candidates: data.candidates.filter((c) => c.status === "pending"),
            }))
            .catch(() => ({ subsystem: cl.subsystem, candidates: [] as DigitalTwinCandidate[] })),
        ),
      );
      setGroups(results.filter((r) => r.candidates.length > 0));
    } catch {
      setErr("Failed to load proposals");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const removeCandidate = useCallback((candidateId: string) => {
    setGroups((prev) =>
      prev
        .map((g) => ({ ...g, candidates: g.candidates.filter((c) => c.id !== candidateId) }))
        .filter((g) => g.candidates.length > 0),
    );
  }, []);

  const handleApproved = useCallback((candidateId: string) => {
    removeCandidate(candidateId);
    onApproved?.();
  }, [removeCandidate, onApproved]);

  const handleRejected = useCallback((candidateId: string) => {
    removeCandidate(candidateId);
  }, [removeCandidate]);

  const totalPending = groups.reduce((sum, g) => sum + g.candidates.length, 0);

  /* ── Bulk approve: one subsystem group, or every group at once ──
     Backed by /clusters/:subsystem/approve, which retains every pending
     candidate in that subsystem to Hindsight in the background (returns 202).
     We optimistically drop the approved group(s) from the list. */
  const approveGroup = useCallback(async (subsystem: string) => {
    setBulkActing(subsystem);
    try {
      const { count } = await approveDigitalTwinCluster(userId, subsystem);
      showSnackbar({ variant: "success", title: `Approving ${count ?? "all"} — saving to Hindsight` });
      setGroups((prev) => prev.filter((g) => g.subsystem !== subsystem));
      onApproved?.();
    } catch {
      showSnackbar({ variant: "error", title: "Failed to approve group" });
    } finally {
      setBulkActing(null);
    }
  }, [userId, onApproved, showSnackbar]);

  const approveEverything = useCallback(async () => {
    const subsystems = groups.map((g) => g.subsystem);
    if (subsystems.length === 0) return;
    setBulkActing("__all__");
    try {
      await Promise.all(subsystems.map((s) => approveDigitalTwinCluster(userId, s)));
      showSnackbar({ variant: "success", title: `Approving all ${totalPending} proposals — saving to Hindsight` });
      setGroups([]);
      onApproved?.();
    } catch {
      showSnackbar({ variant: "error", title: "Some proposals failed to approve" });
      void load();
    } finally {
      setBulkActing(null);
    }
  }, [userId, groups, totalPending, onApproved, showSnackbar, load]);

  if (loading) {
    return (
      <div className="flex flex-col gap-[12px]">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="overflow-hidden rounded-xl border border-xyne-border bg-xyne-surface">
            <div className="flex items-center gap-[10px] border-b border-xyne-border bg-xyne-surface-sunken px-[14px] py-[10px]">
              <Skeleton className="h-[28px] w-[28px] rounded-full" />
              <Skeleton className="h-[12px] w-[90px] rounded" />
              <Skeleton className="ml-auto h-[20px] w-[20px] rounded-full" />
            </div>
            {[...Array(i === 0 ? 3 : 2)].map((_, j) => (
              <div key={j} className="flex items-center gap-[10px] border-b border-xyne-border px-[14px] py-[12px] last:border-b-0">
                <div className="min-w-0 flex-1 space-y-[6px]">
                  <Skeleton className="h-[11px] w-[85%] rounded" />
                  <Skeleton className="h-[10px] w-[55%] rounded" />
                </div>
                <div className="flex gap-[8px]">
                  <Skeleton className="h-[30px] w-[30px] rounded-full" />
                  <Skeleton className="h-[30px] w-[30px] rounded-full" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (err) {
    return (
      <div className="rounded-lg border border-xyne-border p-[16px] text-center">
        <p className="text-[12px] text-xyne-error-fg">{err}</p>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-[8px] rounded-xl border border-dashed border-xyne-border py-[48px] text-center">
        <p className="text-[13px] text-xyne-fg-secondary">No proposals pending</p>
        <p className="text-[12px] text-xyne-fg-tertiary">
          The daily curator adds new candidates after 21:00 UTC each night.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[12px]">
      {/* Bulk action — approve every pending proposal across all groups at once */}
      <div className="flex items-center justify-between px-[2px]">
        <span className="text-[12px] tabular-nums text-xyne-fg-tertiary">
          {totalPending} proposal{totalPending !== 1 ? "s" : ""} pending
        </span>
        <button
          type="button"
          onClick={() => void approveEverything()}
          disabled={bulkActing !== null}
          className="flex items-center gap-[6px] rounded-full bg-xyne-success-fg px-[12px] py-[6px] text-[12px] font-semibold text-white transition hover:opacity-85 active:scale-95 disabled:opacity-50"
        >
          {bulkActing === "__all__"
            ? <SpinnerGapIcon size={13} className="animate-spin" />
            : <CheckIcon size={13} weight="bold" />}
          Approve all
        </button>
      </div>
      {groups.map((group) => {
        const info = SUBSYSTEM_CONFIG[group.subsystem] ?? { label: group.subsystem, icon: null };
        return (
          <div key={group.subsystem} className="overflow-hidden rounded-xl border border-xyne-border bg-xyne-surface">
            {/* Subsystem header */}
            <div className="flex items-center gap-[10px] border-b border-xyne-border bg-xyne-surface-sunken px-[14px] py-[10px]">
              <div className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full border border-xyne-border bg-xyne-surface text-xyne-fg-secondary">
                {info.icon}
              </div>
              <span className="text-[12px] font-semibold text-xyne-fg-primary">{info.label}</span>
              <div className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border border-xyne-border bg-xyne-surface text-[10px] font-bold tabular-nums text-xyne-fg-muted">
                {group.candidates.length}
              </div>
              <Tooltip content={`Approve all ${group.candidates.length} in ${info.label}`} side="left">
                <button
                  type="button"
                  onClick={() => void approveGroup(group.subsystem)}
                  disabled={bulkActing !== null}
                  className="ml-auto flex items-center gap-[5px] rounded-full border border-xyne-success-fg/40 px-[10px] py-[4px] text-[11px] font-semibold text-xyne-success-fg transition hover:bg-xyne-surface-sunken active:scale-95 disabled:opacity-50"
                >
                  {bulkActing === group.subsystem
                    ? <SpinnerGapIcon size={12} className="animate-spin" />
                    : <CheckIcon size={12} weight="bold" />}
                  Approve all
                </button>
              </Tooltip>
            </div>

            {/* Candidate rows — inline approve/reject */}
            <div className="divide-y divide-xyne-border">
              {group.candidates.map((candidate) => (
                <CandidateRow
                  key={candidate.id}
                  userId={userId}
                  candidate={candidate}
                  onApproved={handleApproved}
                  onRejected={handleRejected}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
