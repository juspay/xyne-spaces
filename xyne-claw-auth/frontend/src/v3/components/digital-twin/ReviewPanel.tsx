import { useEffect, useState, useCallback, useRef } from "react";
import {
  PencilSimpleIcon,
  GraduationCapIcon,
  FolderOpenIcon,
  UsersThreeIcon,
  SlidersIcon,
  GitBranchIcon,
  IdentificationCardIcon,
  FileTextIcon,
  ArrowsClockwiseIcon,
  UploadSimpleIcon,
  SpinnerGapIcon,
  CheckCircleIcon,
  DotsThreeIcon,
} from "@phosphor-icons/react";
import { Tooltip } from "../ui/Tooltip";
import {
  listDigitalTwinClusters,
  getDigitalTwinCluster,
} from "../../../lib/api";
import type { DigitalTwinClusterPreview, DigitalTwinCandidate } from "../../../lib/api";
import { useSnackbar } from "../ui/Snackbar";
import { ProposalModal } from "./ProposalModal";

/* ─── Subsystem config ─────────────────────────────────────────────────── */

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

/* ─── Types ─────────────────────────────────────────────────────────────── */

/** Flat preview row built from cluster top3 */
interface PreviewRow {
  id: string;
  text: string;
  subsystem: string;
}

interface ReviewPanelProps {
  userId: string;
  /** Increment to force a fresh fetch — use when the parent knows data changed. */
  refreshKey?: number;
  onApproved?: () => void;
  onBackfill?: () => void;
  onUpload?: () => void;
}

/* ─── Component ─────────────────────────────────────────────────────────── */

export function ReviewPanel({ userId, refreshKey, onApproved, onBackfill, onUpload }: ReviewPanelProps) {
  const { show: showSnackbar } = useSnackbar();

  const [clusters, setClusters] = useState<DigitalTwinClusterPreview[] | null>(null);
  const [loading, setLoading]   = useState(false);

  /* Candidate data fetched on demand, cached by subsystem */
  const clusterCacheRef = useRef<Map<string, DigitalTwinCandidate[]>>(new Map());
  const [fetchingId, setFetchingId] = useState<string | null>(null);

  /* Currently open proposal in the modal */
  const [selected, setSelected] = useState<{
    candidate: DigitalTwinCandidate;
    subsystem: string;
  } | null>(null);

  /* ── Load cluster list ── */
  const load = useCallback(async () => {
    setLoading(true);
    clusterCacheRef.current.clear();
    try {
      const { clusters: c } = await listDigitalTwinClusters(userId);
      setClusters(c.filter((cl) => cl.pending > 0));
    } catch {
      setClusters([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Re-fetch whenever userId or refreshKey changes
  useEffect(() => { load(); }, [load, refreshKey]);

  /* ── Flat list of preview rows from top3 across all clusters ── */
  const flatRows: PreviewRow[] = (clusters ?? []).flatMap((cl) =>
    cl.top3.map((t) => ({ id: t.id, text: t.text, subsystem: cl.subsystem })),
  );

  const totalPending = clusters?.reduce((s, c) => s + c.pending, 0) ?? 0;
  const totalShown   = flatRows.length;
  const overflow     = totalPending - totalShown;

  /* ── Open ProposalModal for a row ── */
  const handleOpen = useCallback(async (row: PreviewRow) => {
    setFetchingId(row.id);
    try {
      let candidates = clusterCacheRef.current.get(row.subsystem);
      if (!candidates) {
        const data = await getDigitalTwinCluster(userId, row.subsystem);
        candidates = data.candidates.filter((c) => c.status === "pending");
        clusterCacheRef.current.set(row.subsystem, candidates);
      }
      const candidate = candidates.find((c) => c.id === row.id);
      if (!candidate) {
        showSnackbar({ variant: "error", title: "Proposal no longer available" });
        return;
      }
      setSelected({ candidate, subsystem: row.subsystem });
    } catch {
      showSnackbar({ variant: "error", title: "Failed to load proposal" });
    } finally {
      setFetchingId(null);
    }
  }, [userId, showSnackbar]);

  /* ── After approval / rejection: remove from preview rows ── */
  const removeFromList = useCallback((candidateId: string) => {
    setClusters((prev) =>
      prev
        ?.map((cl) => ({
          ...cl,
          pending: Math.max(0, cl.pending - (cl.top3.some((t) => t.id === candidateId) ? 1 : 0)),
          top3: cl.top3.filter((t) => t.id !== candidateId),
        }))
        .filter((cl) => cl.pending > 0) ?? null,
    );
    // Invalidate cache for the relevant subsystem so next open re-fetches
    if (selected) clusterCacheRef.current.delete(selected.subsystem);
  }, [selected]);

  const handleApproved = useCallback((candidateId: string) => {
    removeFromList(candidateId);
    onApproved?.();
  }, [removeFromList, onApproved]);

  const handleRejected = useCallback((candidateId: string) => {
    removeFromList(candidateId);
  }, [removeFromList]);

  /* ── All caught up ── */
  if (!loading && totalPending === 0 && clusters !== null) {
    return (
      <div className="flex flex-col items-center gap-[8px] rounded-xl border border-xyne-border bg-xyne-surface-sunken px-[16px] py-[20px] text-center">
        <CheckCircleIcon size={20} weight="duotone" className="text-xyne-fg-muted" />
        <div>
          <p className="text-[12px] font-semibold text-xyne-fg-primary">All caught up</p>
          <p className="mt-[3px] text-[11px] leading-relaxed text-xyne-fg-tertiary">
            No proposals pending. Run a backfill or upload a&nbsp;.md file to generate new ones.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-xyne-border bg-xyne-surface">

        {/* ── Header ── */}
        <div className="flex items-center gap-[8px] border-b border-xyne-border px-[14px] py-[10px]">
          <span className="text-[12px] font-semibold text-xyne-fg-primary">Review</span>
          {loading ? (
            <SpinnerGapIcon size={12} className="animate-spin text-xyne-fg-muted" />
          ) : (
            <span className={`min-w-[20px] rounded-full px-[6px] py-[1px] text-center text-[10px] font-bold tabular-nums ${
              totalPending > 0
                ? "bg-xyne-warning-fg/15 text-xyne-warning-fg"
                : "bg-xyne-border text-xyne-fg-muted"
            }`}>
              {totalPending}
            </span>
          )}
          <div className="ml-auto flex items-center gap-[2px]">
            {onBackfill && (
              <Tooltip content="Backfill history" side="bottom">
                <button
                  onClick={onBackfill}
                  className="flex h-[28px] w-[28px] items-center justify-center rounded-full border border-xyne-border bg-xyne-surface text-xyne-fg-tertiary shadow-sm transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
                  aria-label="Backfill history"
                >
                  <ArrowsClockwiseIcon size={13} weight="duotone" />
                </button>
              </Tooltip>
            )}
            {onUpload && (
              <Tooltip content="Upload .md file" side="bottom">
                <button
                  onClick={onUpload}
                  className="flex h-[28px] w-[28px] items-center justify-center rounded-full border border-xyne-border bg-xyne-surface text-xyne-fg-tertiary shadow-sm transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
                  aria-label="Upload .md"
                >
                  <UploadSimpleIcon size={13} weight="duotone" />
                </button>
              </Tooltip>
            )}
          </div>
        </div>

        {/* ── Loading skeleton ── */}
        {loading && (
          <div className="divide-y divide-xyne-border">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-start gap-[10px] px-[14px] py-[11px]">
                <div className="mt-[1px] h-[13px] w-[13px] shrink-0 animate-pulse rounded bg-xyne-border" />
                <div className="flex-1 space-y-[6px]">
                  <div className="h-[11px] w-[80%] animate-pulse rounded bg-xyne-border" />
                  <div className="h-[10px] w-[55%] animate-pulse rounded bg-xyne-border" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Flat proposal rows ── */}
        {!loading && flatRows.length > 0 && (
          <div className="divide-y divide-xyne-border">
            {flatRows.map((row) => {
              const info = SUBSYSTEM_CONFIG[row.subsystem] ?? { label: row.subsystem, icon: null };
              const isFetching = fetchingId === row.id;
              return (
                <div
                  key={row.id}
                  className="flex items-start gap-[10px] px-[14px] py-[11px]"
                >
                  <div className="mt-[1px] shrink-0 text-xyne-fg-tertiary">{info.icon}</div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[11px] leading-relaxed text-xyne-fg-primary">
                      {row.text}
                    </p>
                    <p className="mt-[2px] text-[10px] text-xyne-fg-muted">{info.label}</p>
                  </div>
                  <Tooltip content="Review" side="left">
                    <button
                      onClick={() => handleOpen(row)}
                      disabled={isFetching}
                      className="mt-[1px] flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg text-xyne-fg-tertiary transition hover:bg-xyne-border/50 hover:text-xyne-fg-primary disabled:opacity-40"
                      aria-label="Review proposal"
                    >
                      {isFetching
                        ? <SpinnerGapIcon size={13} className="animate-spin" />
                        : <DotsThreeIcon size={15} weight="bold" />}
                    </button>
                  </Tooltip>
                </div>
              );
            })}

            {/* Overflow hint */}
            {overflow > 0 && (
              <p className="px-[14px] py-[10px] text-[11px] text-xyne-fg-tertiary">
                + {overflow} more — open the Proposals tab to see all
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Proposal modal ── */}
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
