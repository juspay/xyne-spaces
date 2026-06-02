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
  ArrowRightIcon,
} from "@phosphor-icons/react";
import { listDigitalTwinClusters, getDigitalTwinCluster } from "../../../lib/api";
import type { DigitalTwinCandidate } from "../../../lib/api";
import { Skeleton } from "../ui/Skeleton";
import { ProposalModal } from "./ProposalModal";

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

export function DigitalTwinReviewTab({ userId, onApproved }: DigitalTwinReviewTabProps) {
  const [groups, setGroups]   = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState<string | null>(null);
  const [selected, setSelected] = useState<{ candidate: DigitalTwinCandidate; subsystem: string } | null>(null);

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

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex flex-col gap-[12px]">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="overflow-hidden rounded-xl border border-xyne-border bg-xyne-surface">
            {/* Header */}
            <div className="flex items-center gap-[10px] border-b border-xyne-border bg-xyne-surface-sunken px-[14px] py-[10px]">
              <Skeleton className="h-[28px] w-[28px] rounded-full" />
              <Skeleton className="h-[12px] w-[90px] rounded" />
              <Skeleton className="ml-auto h-[20px] w-[20px] rounded-full" />
            </div>
            {/* Rows */}
            {[...Array(i === 0 ? 3 : 2)].map((_, j) => (
              <div key={j} className="flex items-center gap-[10px] border-b border-xyne-border px-[14px] py-[12px] last:border-b-0">
                <div className="min-w-0 flex-1 space-y-[6px]">
                  <Skeleton className="h-[11px] w-[85%] rounded" />
                  <Skeleton className="h-[10px] w-[55%] rounded" />
                </div>
                <Skeleton className="h-[32px] w-[32px] shrink-0 rounded-full" />
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
    <>
      <div className="flex flex-col gap-[12px]">
        {groups.map((group) => {
          const info = SUBSYSTEM_CONFIG[group.subsystem] ?? { label: group.subsystem, icon: null };
          return (
            <div key={group.subsystem} className="overflow-hidden rounded-xl border border-xyne-border bg-xyne-surface">

              {/* ── Subsystem header ── */}
              <div className="flex items-center gap-[10px] border-b border-xyne-border bg-xyne-surface-sunken px-[14px] py-[10px]">
                <div className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full border border-xyne-border bg-xyne-surface text-xyne-fg-secondary">
                  {info.icon}
                </div>
                <span className="text-[12px] font-semibold text-xyne-fg-primary">{info.label}</span>
                <div className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border border-xyne-border bg-xyne-surface text-[10px] font-bold tabular-nums text-xyne-fg-muted">
                  {group.candidates.length}
                </div>
              </div>

              {/* ── Candidate rows ── */}
              <div className="divide-y divide-xyne-border">
                {group.candidates.map((candidate) => (
                  <button
                    key={candidate.id}
                    onClick={() => setSelected({ candidate, subsystem: group.subsystem })}
                    className="group flex w-full items-center gap-[10px] px-[14px] py-[12px] text-left transition hover:bg-xyne-surface-sunken"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-[12px] leading-relaxed text-xyne-fg-primary">
                        {candidate.editedText ?? candidate.text}
                      </p>
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
                        {(candidate.sourceRefs?.length ?? 0) > 0 && (
                          <span className="text-[10px] text-xyne-fg-tertiary">
                            {candidate.sourceRefs.length} source{candidate.sourceRefs.length !== 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full border border-xyne-border bg-xyne-surface text-xyne-fg-muted transition group-hover:border-xyne-fg-primary/30 group-hover:text-xyne-fg-primary">
                      <ArrowRightIcon size={14} weight="bold" />
                    </div>
                  </button>
                ))}
              </div>

            </div>
          );
        })}
      </div>

      {/* ── Proposal detail modal ── */}
      {selected && (
        <ProposalModal
          userId={userId}
          candidate={selected.candidate}
          subsystem={selected.subsystem}
          open
          onClose={() => setSelected(null)}
          onApproved={handleApproved}
          onRejected={handleRejected}
        />
      )}
    </>
  );
}
