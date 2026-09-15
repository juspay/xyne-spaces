import React, { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from "react";
import {
  BrainIcon,
  FireIcon,
  MagnifyingGlassIcon,
  TrashIcon,
  ArrowClockwiseIcon,
  ArrowsClockwiseIcon,
  SparkleIcon,
  CheckIcon,
  XIcon,
  ClipboardTextIcon,
  DownloadSimpleIcon,
  UploadSimpleIcon,
  PlayIcon,
  PauseIcon,
  InfoIcon,
} from "@phosphor-icons/react";
import {
  ApiError,
  listDigitalTwinMemories,
  deleteDigitalTwinMemory,
  getDigitalTwinStats,
  getDigitalTwinGraph,
  recallDigitalTwinMemory,
  getDigitalTwinMemoryHistory,
  triggerDigitalTwinConsolidation,
} from "../../../lib/api";
import type {
  MemoryBankMemory,
  MemoryHistoryEntry,
  TwinArchiveRecord,
  TwinMemoryArchive,
  MemoryBankStats,
  DigitalTwinGraphEdge,
  RecallResult,
} from "../../../lib/api";
import {
  MemoryConstellation,
  SUBSYSTEM_COLOR,
  DEFAULT_COLOR,
  LINK_TYPES,
  LINK_COLOR,
  LINK_LABEL,
  normalizeLinkType,
  type LinkType,
  type ConstellationNeighbor,
} from "./MemoryConstellation";
import { useSnackbar } from "../ui/Snackbar";
import { Search } from "../ui/Search";
import { Skeleton } from "../ui/Skeleton";
import { Button } from "../ui/Button";
import { Tooltip, InfoIcon as InfoHint } from "../ui/Tooltip";
import { EnableModal } from "./EnableModal";
import { DeleteMemoriesModal } from "./DeleteMemoriesModal";
import { ImportMemoriesModal } from "./ImportMemoriesModal";
import { DigitalTwinReviewTab } from "./DigitalTwinReviewTab";
import { SUBSYSTEM_LABELS } from "./ProposalModal";

type SubTab = "all" | "hot" | "proposals" | "tester";

const CATEGORY_STYLES: Record<
  string,
  { label: string; borderColor: string; textColor: string }
> = {
  world: {
    label: "WORLD",
    borderColor: "border-xyne-success-fg",
    textColor: "text-xyne-success-fg",
  },
  experience: {
    label: "EXPERIENCE",
    borderColor: "border-xyne-brand",
    textColor: "text-xyne-brand",
  },
  observation: {
    label: "OBSERVATION",
    borderColor: "border-xyne-warning-fg",
    textColor: "text-xyne-warning-fg",
  },
  mental_model: {
    label: "MENTAL MODEL",
    borderColor: "border-xyne-fg-secondary",
    textColor: "text-xyne-fg-secondary",
  },
};

function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return null;
  const style = CATEGORY_STYLES[category.toLowerCase()];
  if (!style) {
    return (
      <span className="rounded border border-xyne-border px-[6px] py-[1px] text-[10px] font-medium uppercase tracking-wide text-xyne-fg-tertiary">
        {category}
      </span>
    );
  }
  return (
    <span
      className={`rounded border px-[6px] py-[1px] text-[10px] font-medium uppercase tracking-wide ${style.borderColor} ${style.textColor}`}
    >
      {style.label}
    </span>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Compact relative-time formatter — "23h ago", "3d ago", "just now".
 * V1 uses relative timestamps everywhere; this matches that scanability.
 */
function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return fmtDate(iso);
}

/**
 * Hindsight appends entity/time metadata to the stored content, e.g.
 * "… | Involving: user | When: June 30". Strip those trailing "| Key: value"
 * segments for display so the memory reads as the fact the curator wrote.
 */
function cleanMemoryText(s: string): string {
  return s.replace(/\s*\|\s*(Involving|When|Where|Who|Related|Context)\s*:.*$/i, "").trim();
}

function memoryDeleteNotice(error: unknown): { title: string; description?: string } {
  if (error instanceof ApiError && error.code === "HINDSIGHT_DERIVED_OBSERVATION") {
    return {
      title: "Derived observation cannot be deleted directly",
      description: error.message,
    };
  }
  return {
    title: "Failed to delete memory",
    ...(error instanceof Error ? { description: error.message } : {}),
  };
}

function isObservationType(factType?: string | null): boolean {
  return factType?.toLowerCase() === "observation";
}

/** The curator subsystem label of a memory, from its `subsystem:<x>` tag. */
function subsystemOf(m: MemoryBankMemory): string | null {
  const t = (m.tags ?? []).find((x) => x.startsWith("subsystem:"));
  return t ? t.slice("subsystem:".length) : null;
}

/** Max nodes drawn in the constellation at once. The force-directed layout is
 *  O(n²) and thousands of dots is an unreadable hairball, so the graph shows
 *  only the LATEST N within the current window; the list below is never capped
 *  (it's paginated). When we truncate, we tell the user. */
const GRAPH_NODE_CAP = 200;

/** Parse a native <input type="date"> value (YYYY-MM-DD, local) to epoch ms.
 *  `end=true` snaps to the last ms of that day so a single-day pick is inclusive. */
function dateInputToMs(v: string, end = false): number | null {
  if (!v) return null;
  const [y, m, d] = v.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = end ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0);
  const t = dt.getTime();
  return Number.isNaN(t) ? null : t;
}

/** How many memories per page in the list. */
const MEMORY_PAGE_SIZE = 25;
const DAY_MS = 86_400_000;

const CATEGORY_LEGEND: Array<{ key: keyof typeof CATEGORY_STYLES; description: string }> = [
  { key: "world", description: "Durable, objective fact about you or your work." },
  { key: "experience", description: "Something observed during the agent's own runs — what it tried, what worked." },
  { key: "observation", description: "Secondary extraction pass — often a near-duplicate rephrasing of a WORLD fact." },
  { key: "mental_model", description: "Captured judgment call or framing the agent should respect." },
];

/** What each edge type actually means, in the user's terms rather than Hindsight's. */
const LINK_HINT: Record<LinkType, string> = {
  semantic: "Similar meaning — these memories say related things.",
  temporal: "Close in time — recorded within a day of each other.",
  entity: "Share a person, project or thing.",
  causes: "This memory led to the other.",
  caused_by: "This memory was brought about by the other.",
  enables: "This memory made the other possible.",
  prevents: "This memory ruled the other out.",
  other: "A link type this view does not recognise yet.",
};

/**
 * A titled group in the filter rail. The heading carries the group's own
 * explanation so individual controls stay unlabelled where their meaning is
 * obvious, and the rule under it does the separating — no boxes, so the rail
 * reads as one column rather than a stack of cards.
 */
function RailSection({
  label,
  hint,
  action,
  children,
}: {
  label: string;
  hint: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-[8px]">
      <div className="flex items-center gap-[5px] border-b border-xyne-border pb-[5px]">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-xyne-fg-tertiary">{label}</h3>
        <InfoHint text={hint} />
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </section>
  );
}

/** One labelled control inside a section, with its own explanation. */
function RailField({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-[3px]">
      <span className="flex items-center gap-[4px] text-[10.5px] text-xyne-fg-muted">
        {label}
        <InfoHint text={hint} />
      </span>
      {children}
    </label>
  );
}

/** Underlined select — the rail groups already carry the structure, so a boxed
 *  control per filter would add a second, competing frame. */
function RailSelect({
  value,
  onChange,
  children,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange" | "children">) {
  return (
    <select
      {...rest}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full cursor-pointer border-b border-xyne-border bg-transparent pb-[4px] text-[12px] text-xyne-fg-primary transition hover:border-xyne-fg-muted focus:border-xyne-fg-muted focus:outline-none"
    >
      {children}
    </select>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Main component
// ══════════════════════════════════════════════════════════════════════

interface DigitalTwinMemoriesTabProps {
  userId: string;
  /** Called after any candidate approval so the parent can refresh its own status counts. */
  onCandidateApproved?: () => void;
  /** Deep-link a memory to the pipeline event that proposed it. */
  onViewReasoning?: (pipelineEventId: string) => void;
}

export function DigitalTwinMemoriesTab({ userId, onCandidateApproved, onViewReasoning }: DigitalTwinMemoriesTabProps) {
  const [sub, setSub] = useState<SubTab>("all");
  /**
   * Bump to force the active sub-tab to refetch. We pass it as `key` to the
   * sub-tab so unmount → mount triggers the load effect from scratch — simpler
   * than threading a per-tab refresh handler all the way down.
   */
  const [refreshKey, setRefreshKey] = useState(0);
  /**
   * Incremented when an approval in the Candidates tab fires onApproved.
   * Used as part of the key for All / Hot / Graph subtabs ONLY — so those
   * tabs re-fetch without remounting (and resetting state) the Candidates tab.
   */
  const [approvalKey, setApprovalKey] = useState(0);
  const [showBackfill, setShowBackfill] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [consolidating, setConsolidating] = useState(false);
  const { show: showSnackbar } = useSnackbar();

  // Shared memory list — fetched ONCE here (the full set, paginated to
  // completion) and handed to BOTH the Memories tab and the Graph/constellation.
  // Previously each subtab fetched its own copy, so switching tabs (or opening
  // the graph) re-pulled the same ~58 kB payload. Re-fetches only on manual
  // refresh (refreshKey) or after a candidate approval (approvalKey).
  const [memories, setMemories] = useState<MemoryBankMemory[]>([]);
  const [memTotal, setMemTotal] = useState(0);
  const [memLoading, setMemLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setMemLoading(true);
    (async () => {
      try {
        const PAGE = 200;
        let offset = 0;
        let acc: MemoryBankMemory[] = [];
        let tot = 0;
        for (;;) {
          const data = await listDigitalTwinMemories(userId, { limit: PAGE, offset });
          const got = data?.memories ?? [];
          acc = acc.concat(got);
          tot = data?.total ?? acc.length;
          offset += PAGE;
          if (got.length < PAGE || acc.length >= tot) break;
        }
        if (!cancelled) {
          setMemories(acc);
          setMemTotal(tot);
        }
      } catch {
        if (!cancelled) {
          setMemories([]);
          setMemTotal(0);
        }
      } finally {
        if (!cancelled) setMemLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, refreshKey, approvalKey]);
  /**
   * Download every memory as a JSON archive. Purely client-side — the full set
   * is already in `memories` (fetched above), so there is no export endpoint
   * and nothing to poll.
   *
   * `content` is written verbatim, including Hindsight's "| Involving: …"
   * tail: the import side strips it for duplicate matching, and keeping it
   * raw means the archive stays a faithful record of what was stored. Tags are
   * exported for auditing only — import discards them and re-derives scope
   * from the session, so an archive can never widen its own access.
   */
  const exportMemories = useCallback(() => {
    const archive: TwinMemoryArchive = {
      format: "xyne.digital-twin.memories",
      version: 1,
      exportedAt: new Date().toISOString(),
      userId,
      count: memories.length,
      records: memories.map((m): TwinArchiveRecord => ({
        content: m.content,
        subsystem: subsystemOf(m),
        timestamp: m.createdAt,
        category: m.category,
        factType: m.factType ?? null,
        curatorReasoning: m.curatorReasoning,
        curatorConfidence: m.curatorConfidence,
        hindsightMemoryId: m.hindsightMemoryId,
        ...(m.tags ? { tags: m.tags } : {}),
        ...(m.entities?.length ? { entities: m.entities } : {}),
      })),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(archive, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `xyne-twin-memories-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showSnackbar({
      variant: "success",
      title: `Exported ${memories.length} memor${memories.length === 1 ? "y" : "ies"}`,
    });
  }, [memories, userId, showSnackbar]);

  /** Ask the Twin to re-derive observations from the current facts. Async on the
   *  server — this only reports that the job was accepted. */
  const runConsolidation = useCallback(async () => {
    setConsolidating(true);
    try {
      const res = await triggerDigitalTwinConsolidation();
      showSnackbar({
        variant: "success",
        title: res.deduplicated ? "Already running" : "Consolidation started",
        description: res.deduplicated
          ? "A run was already queued for your memories; this joined it."
          : "Your Twin is re-deriving observations. New ones appear here in a few minutes.",
        duration: 7_000,
      });
    } catch (e) {
      showSnackbar({
        variant: "error",
        title: "Could not start consolidation",
        ...(e instanceof Error ? { description: e.message } : {}),
      });
    } finally {
      setConsolidating(false);
    }
  }, [showSnackbar]);

  const removeMemory = useCallback((hindsightMemoryId: string) => {
    setMemories((prev) => prev.filter((m) => m.hindsightMemoryId !== hindsightMemoryId));
    setMemTotal((t) => Math.max(0, t - 1));
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Sub-tab nav + actions — pinned at top */}
      <div className="shrink-0 border-b border-xyne-border px-[20px] py-[12px]">
        <div className="flex flex-wrap items-center gap-[6px]">
          <span className="flex items-center gap-[2px]">
            <SubTabBtn active={sub === "all"} onClick={() => setSub("all")} icon={<BrainIcon size={13} />}>
              Memories
            </SubTabBtn>
            <InfoHint text="Facts your Twin has learned about you and draws on when it acts on your behalf." />
          </span>
          <span className="flex items-center gap-[2px]">
            <SubTabBtn active={sub === "hot"} onClick={() => setSub("hot")} icon={<FireIcon size={13} />}>
              Hot
            </SubTabBtn>
            <InfoHint text="Your most-recalled memories — the ones your Twin leaned on most over the last 7–90 days." />
          </span>
          <span className="flex items-center gap-[2px]">
            <SubTabBtn
              active={sub === "proposals"}
              onClick={() => setSub("proposals")}
              icon={<ClipboardTextIcon size={13} />}
            >
              Proposals
            </SubTabBtn>
            <InfoHint text="Candidate memories your Twin drafted from your activity, waiting for your approval. Approve one and it becomes a saved Memory. New candidates arrive nightly." />
          </span>
          <span className="flex items-center gap-[2px]">
            <SubTabBtn
              active={sub === "tester"}
              onClick={() => setSub("tester")}
              icon={<MagnifyingGlassIcon size={13} />}
            >
              Recall
            </SubTabBtn>
            <InfoHint text="Test what your Twin would remember — type a question and preview the memories it surfaces." />
          </span>

          {/* Right-side action buttons */}
          <div className="ml-auto flex items-center gap-[4px]">
            <Tooltip content="Backfill: learn from your past Spaces history (3–24 months). Adds candidate memories to your Proposals queue for review." side="bottom">
              <button
                onClick={() => setShowBackfill(true)}
                aria-label="Backfill history"
                className="flex items-center justify-center rounded-lg border border-xyne-border bg-xyne-surface p-[6px] text-xyne-fg-tertiary transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
              >
                <ArrowsClockwiseIcon size={13} />
              </button>
            </Tooltip>
            <Tooltip content="Re-derive observations from your current memories. Runs in the background." side="bottom">
              <button
                onClick={() => void runConsolidation()}
                disabled={consolidating || memLoading}
                aria-label="Consolidate memories"
                className="flex items-center justify-center rounded-lg border border-xyne-border bg-xyne-surface p-[6px] text-xyne-fg-tertiary transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <SparkleIcon size={13} className={consolidating ? "animate-pulse" : ""} />
              </button>
            </Tooltip>
            <Tooltip content="Export all memories as a JSON archive" side="bottom">
              <button
                onClick={exportMemories}
                disabled={memLoading || memories.length === 0}
                aria-label="Export memories"
                className="flex items-center justify-center rounded-lg border border-xyne-border bg-xyne-surface p-[6px] text-xyne-fg-tertiary transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <DownloadSimpleIcon size={13} />
              </button>
            </Tooltip>
            <Tooltip content="Import memories from an exported archive" side="bottom">
              <button
                onClick={() => setShowImport(true)}
                disabled={memLoading}
                aria-label="Import memories"
                className="flex items-center justify-center rounded-lg border border-xyne-border bg-xyne-surface p-[6px] text-xyne-fg-tertiary transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <UploadSimpleIcon size={13} />
              </button>
            </Tooltip>
            <Tooltip content="Refresh" side="bottom">
              <button
                onClick={() => setRefreshKey((k) => k + 1)}
                aria-label="Refresh"
                className="flex items-center justify-center rounded-lg border border-xyne-border bg-xyne-surface p-[6px] text-xyne-fg-tertiary transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
              >
                <ArrowClockwiseIcon size={13} />
              </button>
            </Tooltip>
            <Tooltip content="Delete memories (all / range)" side="bottom">
              <button
                onClick={() => setShowDelete(true)}
                aria-label="Delete memories"
                className="flex items-center justify-center rounded-lg border border-xyne-border bg-xyne-surface p-[6px] text-xyne-fg-tertiary transition hover:border-xyne-error-fg/40 hover:bg-xyne-error-bg hover:text-xyne-error-fg"
              >
                <TrashIcon size={13} />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* Backfill modal */}
      <EnableModal
        userId={userId}
        open={showBackfill}
        mode="backfill"
        onClose={() => setShowBackfill(false)}
        onEnabled={() => { setShowBackfill(false); setRefreshKey((k) => k + 1); }}
      />

      {/* Delete memories modal (all / range) */}
      <DeleteMemoriesModal
        userId={userId}
        open={showDelete}
        onClose={() => setShowDelete(false)}
        onDeleted={() => setRefreshKey((k) => k + 1)}
      />

      {/* Import modal — gets the live set so it can flag duplicates locally */}
      <ImportMemoriesModal
        open={showImport}
        existing={memories}
        onClose={() => setShowImport(false)}
        onImported={() => setRefreshKey((k) => k + 1)}
      />

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-[20px] py-[16px]">
        {sub === "all"      && <AllSubtab   userId={userId} memories={memories} total={memTotal} loading={memLoading} onRemove={removeMemory} onViewReasoning={onViewReasoning} />}
        {sub === "hot"      && <HotSubtab   key={`hot-${refreshKey}-${approvalKey}`}   userId={userId} />}
        {sub === "proposals" && (
          <DigitalTwinReviewTab
            key={`proposals-${refreshKey}`}
            userId={userId}
            onApproved={() => {
              setApprovalKey((k) => k + 1);
              onCandidateApproved?.();
            }}
          />
        )}
        {sub === "tester"   && <TesterSubtab key={`tester-${refreshKey}-${approvalKey}`}  userId={userId} />}
      </div>
    </div>
  );
}

// ── Sub-tab button ────────────────────────────────────────────────────

function SubTabBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-[6px] rounded-lg px-[12px] py-[6px] text-[12px] font-medium transition ${
        active
          ? "bg-xyne-surface-sunken text-xyne-fg-primary border border-xyne-border"
          : "text-xyne-fg-muted hover:bg-xyne-surface-sunken hover:text-xyne-fg-secondary"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

// ══════════════════════════════════════════════════════════════════════
// All memories sub-tab
// ══════════════════════════════════════════════════════════════════════

/** Long memories collapse to this many chars; user can expand inline. */
const MEMORY_TRUNCATE_AT = 240;

function AllSubtab({
  userId,
  memories,
  total,
  loading,
  onRemove,
  onViewReasoning,
}: {
  userId: string;
  /** Shared memory list, fetched once by the parent (also feeds the graph). */
  memories: MemoryBankMemory[];
  total: number;
  loading: boolean;
  /** Drop a deleted memory from the shared parent state. */
  onRemove: (hindsightMemoryId: string) => void;
  onViewReasoning?: (pipelineEventId: string) => void;
}) {
  const { show: showSnackbar } = useSnackbar();
  const [search, setSearch] = useState("");
  const [subsystem, setSubsystem] = useState("all");
  const [category, setCategory] = useState("all");
  const [entity, setEntity] = useState("all");
  // Calendar range (native date inputs, YYYY-MM-DD). Empty = open-ended on that
  // side; both empty = all time. A single day = From === To.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  // Edge-type visibility lives here now: the legend moved to the filter rail,
  // so the state has to sit above both the rail and the canvas. All types start
  // visible — the graph should show the whole picture until you narrow it.
  const [hiddenTypes, setHiddenTypes] = useState<Set<LinkType>>(() => new Set<LinkType>());
  // Graph (constellation) — real edges + entities from Hindsight, shared with the
  // list filters. Selection drives the right-side connected-memories panel.
  const [glinks, setGlinks] = useState<DigitalTwinGraphEdge[]>([]);
  const [entitiesById, setEntitiesById] = useState<Record<string, string[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [neighbors, setNeighbors] = useState<ConstellationNeighbor[]>([]);
  const [expanded, setExpanded] = useState(false);
  // Timeline scrubber — cutoff epoch ms (null = show everything).
  const [timeCutoff, setTimeCutoff] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  // Which panel shows below the graph: the paginated list or the selected node's
  // connections. Auto-follows selection.
  const [bottomTab, setBottomTab] = useState<"memories" | "connected">("memories");
  useEffect(() => { setBottomTab(selectedId ? "connected" : "memories"); }, [selectedId]);

  useEffect(() => {
    let cancelled = false;
    getDigitalTwinGraph(userId)
      .then((g) => {
        if (cancelled) return;
        setGlinks(g.edges ?? []);
        const ents: Record<string, string[]> = {};
        for (const n of g.nodes ?? []) if (n.entities?.length) ents[n.id] = n.entities;
        setEntitiesById(ents);
      })
      .catch(() => { /* graph is best-effort; nodes still render without edges */ });
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  // Present filter buckets (alphabetical by visible label).
  const presentSubsystems = useMemo(() => {
    const s = new Set<string>();
    for (const m of memories) { const x = subsystemOf(m); if (x) s.add(x); }
    return [...s].sort((a, b) => (SUBSYSTEM_LABELS[a] ?? a).localeCompare(SUBSYSTEM_LABELS[b] ?? b));
  }, [memories]);
  const presentCategories = useMemo(() => {
    const s = new Set<string>();
    for (const m of memories) { const c = (m.category ?? "").toLowerCase(); if (c) s.add(c); }
    return [...s].sort((a, b) => (CATEGORY_STYLES[a]?.label ?? a).localeCompare(CATEGORY_STYLES[b]?.label ?? b));
  }, [memories]);
  const presentEntities = useMemo(() => {
    const s = new Set<string>();
    for (const m of memories) for (const e of entitiesById[m.hindsightMemoryId] ?? []) s.add(e);
    return [...s].sort((a, b) => a.localeCompare(b)).slice(0, 200);
  }, [memories, entitiesById]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const fromMs = dateInputToMs(dateFrom, false);
    const toMs = dateInputToMs(dateTo, true);
    return memories.filter((m) => {
      if (q && !m.content.toLowerCase().includes(q)) return false;
      if (subsystem !== "all" && subsystemOf(m) !== subsystem) return false;
      if (category !== "all" && (m.category ?? "").toLowerCase() !== category) return false;
      if (entity !== "all" && !(entitiesById[m.hindsightMemoryId] ?? []).includes(entity)) return false;
      if (fromMs != null || toMs != null) {
        const t = Date.parse(m.createdAt);
        if (Number.isNaN(t)) return false;
        if (fromMs != null && t < fromMs) return false;
        if (toMs != null && t > toMs) return false;
      }
      return true;
    });
  }, [memories, search, subsystem, category, entity, dateFrom, dateTo, entitiesById]);

  // The constellation renders only the LATEST GRAPH_NODE_CAP of the filtered set
  // — force-directed layout is O(n²) and a few thousand dots is an unreadable
  // hairball. Truncation is anchored to the newest date in the window, so
  // narrowing the calendar (e.g. To = 30 days ago) surfaces the latest
  // GRAPH_NODE_CAP of THAT window. The list below is never capped.
  const graphMemories = useMemo(() => {
    if (filtered.length <= GRAPH_NODE_CAP) return filtered;
    return [...filtered]
      .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
      .slice(0, GRAPH_NODE_CAP);
  }, [filtered]);
  const graphTruncated = filtered.length > GRAPH_NODE_CAP;

  // Reset to the first page whenever the filter set changes shape.
  useEffect(() => { setPage(0); }, [search, subsystem, category, entity, dateFrom, dateTo]);

  // Timeline range spans the SHOWN nodes (the latest ≤GRAPH_NODE_CAP); reset the
  // scrubber when it changes.
  const [tMin, tMax] = useMemo(() => {
    let mn = Infinity, mx = -Infinity;
    for (const m of graphMemories) { const t = Date.parse(m.createdAt); if (!Number.isNaN(t)) { mn = Math.min(mn, t); mx = Math.max(mx, t); } }
    return Number.isFinite(mn) ? [mn, mx] : [0, 0];
  }, [graphMemories]);
  useEffect(() => { setTimeCutoff(null); setPlaying(false); }, [tMin, tMax]);
  // Play — advance the cutoff one day per tick until it reaches the newest memory.
  useEffect(() => {
    if (!playing || tMax <= tMin) return;
    const id = window.setInterval(() => {
      setTimeCutoff((prev) => {
        const next = (prev == null ? tMin : prev) + DAY_MS;
        if (next >= tMax) { setPlaying(false); return tMax; }
        return next;
      });
    }, 320);
    return () => window.clearInterval(id);
  }, [playing, tMin, tMax]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / MEMORY_PAGE_SIZE));
  const pageClamped = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(pageClamped * MEMORY_PAGE_SIZE, (pageClamped + 1) * MEMORY_PAGE_SIZE);
  const filtersActive = search.trim() !== "" || subsystem !== "all" || category !== "all" || entity !== "all" || dateFrom !== "" || dateTo !== "";
  const selected = selectedId ? filtered.find((m) => m.hindsightMemoryId === selectedId) ?? null : null;
  const timelineLabel = new Date(timeCutoff ?? tMax).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const handleDelete = useCallback(
    async (hindsightMemoryId: string, factType?: string | null) => {
      // Let the backend return its explicit derived-observation signal so the
      // user sees why this type cannot be deleted. Raw facts still get the
      // destructive-action confirmation.
      if (!isObservationType(factType) && !window.confirm("Delete this memory? This removes it from Hindsight and marks all related review rows as rejected. Recall-hit history is retained.")) {
        return;
      }
      try {
        await deleteDigitalTwinMemory(userId, hindsightMemoryId);
        onRemove(hindsightMemoryId);
        showSnackbar({ variant: "success", title: "Memory deleted" });
      } catch (error) {
        showSnackbar({ variant: "error", ...memoryDeleteNotice(error), duration: 8_000 });
      }
    },
    [userId, onRemove, showSnackbar],
  );

  // Only the edge types this graph actually contains. Listing all eight would
  // show rows for types Hindsight can emit but never has, and a legend that
  // describes absent things is worse than a short one.
  const presentLinkTypes = useMemo(() => {
    const present = new Set(glinks.map((l) => normalizeLinkType(l.linkType)));
    return LINK_TYPES.filter((t) => present.has(t));
  }, [glinks]);

  if (loading) {
    return (
      <div className="flex flex-col gap-[6px]">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-[64px] rounded-lg" />
        ))}
      </div>
    );
  }

  if (memories.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-[8px] rounded-lg border border-dashed border-xyne-border py-[48px] text-center">
        <p className="text-[13px] text-xyne-fg-secondary">No memories yet</p>
        <p className="text-[12px] text-xyne-fg-tertiary">
          Go to Proposals, approve the ones that look right, and they'll show up here
        </p>
      </div>
    );
  }

  // Which categories appear in this user's data — only legend those rows.
  const visibleCategories = new Set(
    memories
      .map((m) => (m.category ?? "").toLowerCase())
      .filter((c) => c in CATEGORY_STYLES),
  );

  return (
    <div className="flex min-h-0 flex-col gap-[20px] lg:flex-row">
      {/* ── FILTER RAIL ──────────────────────────────────────────────────────
          Every control that narrows what you see lives here, grouped by the
          question it answers: what am I looking for, which slice, when, and how
          is it drawn. Sticky so the graph can be scrolled past without losing
          the controls. Hidden below lg — the row layout collapses to the graph
          plus list, and the rail's controls would crowd a narrow viewport. */}
      <aside className="flex w-full shrink-0 flex-col gap-[20px] lg:sticky lg:top-0 lg:max-h-[calc(100vh-140px)] lg:w-[212px] lg:self-start lg:overflow-y-auto lg:pr-[10px]">
        <RailSection label="Find" hint="Free-text search across memory content. Case-insensitive, matches anywhere in the text.">
          <Search value={search} onChange={setSearch} placeholder="Search memories…" className="w-full" />
        </RailSection>

        <RailSection
          label="Narrow"
          hint="Filter the graph and the list together. Only values present in your memories are listed."
        >
          <RailField label="Subsystem" hint="Which part of your persona the memory feeds — how you write, what you decide, who you work with.">
            <RailSelect value={subsystem} onChange={setSubsystem} aria-label="Filter by subsystem">
              <option value="all">All</option>
              {presentSubsystems.map((s) => (
                <option key={s} value={s}>{SUBSYSTEM_LABELS[s] ?? s}</option>
              ))}
            </RailSelect>
          </RailField>
          <RailField label="Category" hint="What kind of knowledge it is: an objective fact, something observed during a run, or a derived synthesis.">
            <RailSelect value={category} onChange={setCategory} aria-label="Filter by category">
              <option value="all">All</option>
              {presentCategories.map((c) => (
                <option key={c} value={c}>{CATEGORY_STYLES[c]?.label ?? c.toUpperCase()}</option>
              ))}
            </RailSelect>
          </RailField>
          {presentEntities.length > 0 && (
            <RailField label="Entity" hint="A person, project or thing your Twin extracted. Picking one shows every memory that mentions it.">
              <RailSelect value={entity} onChange={setEntity} aria-label="Filter by entity">
                <option value="all">All</option>
                {presentEntities.map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </RailSelect>
            </RailField>
          )}
        </RailSection>

        <RailSection
          label="When"
          hint="Filters by when the memory was created. Leave either side blank for an open-ended range."
          action={
            (dateFrom || dateTo) ? (
              <button
                onClick={() => { setDateFrom(""); setDateTo(""); }}
                className="text-[10px] text-xyne-fg-muted transition hover:text-xyne-fg-secondary"
              >
                Clear
              </button>
            ) : null
          }
        >
          <div className="flex flex-col gap-[6px]">
            <input
              type="date"
              aria-label="From date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full border-b border-xyne-border bg-transparent pb-[4px] text-[11px] text-xyne-fg-secondary transition focus:border-xyne-fg-muted focus:outline-none"
            />
            <input
              type="date"
              aria-label="To date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full border-b border-xyne-border bg-transparent pb-[4px] text-[11px] text-xyne-fg-secondary transition focus:border-xyne-fg-muted focus:outline-none"
            />
          </div>
        </RailSection>

        <RailSection
          label="Connections"
          hint="How memories relate. Edges stay grey until you hover or select a node, then the ones touching it take these colours. Click a type to hide it."
        >
          <div className="flex flex-col gap-[5px]">
            {presentLinkTypes.map((t) => {
              const off = hiddenTypes.has(t);
              return (
                <button
                  key={t}
                  onClick={() =>
                    setHiddenTypes((prev) => {
                      const next = new Set(prev);
                      if (next.has(t)) next.delete(t); else next.add(t);
                      return next;
                    })
                  }
                  title={LINK_HINT[t]}
                  className={`group flex items-center gap-[8px] text-left text-[11px] transition ${
                    off ? "text-xyne-fg-muted" : "text-xyne-fg-secondary hover:text-xyne-fg-primary"
                  }`}
                >
                  <span
                    className="h-[2px] w-[18px] shrink-0 rounded-full transition"
                    style={{ background: LINK_COLOR[t], opacity: off ? 0.25 : 1 }}
                  />
                  <span className={off ? "line-through decoration-1" : ""}>{LINK_LABEL[t]}</span>
                </button>
              );
            })}
          </div>
        </RailSection>

        <RailSection label="Node key" hint="Node colour is the subsystem the memory feeds.">
          <div className="flex flex-col gap-[5px]">
            {presentSubsystems.map((s) => (
              <span key={s} className="flex items-center gap-[8px] text-[11px] text-xyne-fg-secondary">
                <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: SUBSYSTEM_COLOR[s] ?? DEFAULT_COLOR }} />
                {SUBSYSTEM_LABELS[s] ?? s}
              </span>
            ))}
          </div>
        </RailSection>

        {visibleCategories.size > 0 && (
          <RailSection label="Categories" hint="What each category badge in the list below means.">
            <div className="flex flex-col gap-[8px]">
              {CATEGORY_LEGEND.filter((row) => visibleCategories.has(row.key)).map((row) => (
                <div key={row.key} className="flex flex-col gap-[3px]">
                  <CategoryBadge category={row.key} />
                  <span className="text-[10.5px] leading-[1.45] text-xyne-fg-tertiary">{row.description}</span>
                </div>
              ))}
            </div>
          </RailSection>
        )}
      </aside>

      {/* ── MAIN COLUMN ─────────────────────────────────────────────────────
          Constellation first and large — it is the point of this screen — then
          the list on scroll. */}
      <div className="flex min-w-0 flex-1 flex-col gap-[12px]">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold text-xyne-fg-primary">Memory constellation</h2>
          <span className="text-[11px] tabular-nums text-xyne-fg-tertiary">
            {filtersActive ? `${filtered.length} of ${total}` : `${total} ${total === 1 ? "memory" : "memories"}`}
          </span>
        </div>

      {/* Graph on top — full-width constellation + timeline. Connected memories
          live in a tab below (not a side panel). Same filters as the list. */}
      {(() => {
        const graphRegion = (
          <div className={expanded ? "flex h-full min-h-0 flex-col gap-[8px]" : "flex flex-col gap-[8px]"}>
            {graphTruncated && (
              <div className="flex items-start gap-[6px] rounded-lg border border-xyne-border bg-xyne-surface-sunken px-[10px] py-[6px] text-[11px] text-xyne-fg-tertiary">
                <InfoIcon size={13} className="mt-[1px] shrink-0 text-xyne-fg-muted" />
                <span>
                  Showing the <span className="font-medium text-xyne-fg-secondary">{GRAPH_NODE_CAP} latest</span> of{" "}
                  {filtered.length} memories in this range. Narrow the date range to explore older memories on the graph — the list below shows all {filtered.length}.
                </span>
              </div>
            )}
            <div
              className={expanded ? "min-h-0 min-w-0 flex-1" : "min-w-0"}
              {...(expanded ? {} : { style: { height: "clamp(460px, 62vh, 760px)" } })}
            >
              <MemoryConstellation
                memories={graphMemories}
                links={glinks}
                entitiesById={entitiesById}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onNeighbors={setNeighbors}
                expanded={expanded}
                onToggleExpand={() => setExpanded((e) => !e)}
                visibleUntil={timeCutoff ?? undefined}
                hiddenTypes={hiddenTypes}
                onHiddenTypesChange={setHiddenTypes}
                showLegends={expanded}
              />
            </div>
            {tMax > tMin && (
              <div className="flex items-center gap-[10px] border-t border-xyne-border pt-[8px]">
                <button
                  onClick={() => {
                    if (!playing && (timeCutoff == null || timeCutoff >= tMax)) setTimeCutoff(tMin);
                    setPlaying((p) => !p);
                  }}
                  title={playing ? "Pause" : "Play — watch memories appear over time"}
                  className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full text-xyne-fg-tertiary transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
                >
                  {playing ? <PauseIcon size={12} weight="fill" /> : <PlayIcon size={12} weight="fill" />}
                </button>
                <span className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-xyne-fg-muted">Timeline</span>
                <input
                  type="range"
                  min={tMin}
                  max={tMax}
                  step={DAY_MS}
                  value={timeCutoff ?? tMax}
                  onChange={(e) => { setPlaying(false); setTimeCutoff(Number(e.target.value)); }}
                  className="h-[2px] flex-1 cursor-pointer accent-xyne-fg-secondary"
                />
                <span className="w-[92px] shrink-0 text-right text-[10px] tabular-nums text-xyne-fg-tertiary">{timelineLabel}</span>
              </div>
            )}
          </div>
        );
        return expanded
          ? <div className="fixed inset-0 z-50 flex flex-col bg-xyne-surface px-[20px] py-[16px]">{graphRegion}</div>
          : graphRegion;
      })()}

      {/* Bottom tabs — the paginated list vs the selected node's connections. */}
      <div className="flex items-center gap-[2px] border-b border-xyne-border">
        {(["memories", "connected"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setBottomTab(t)}
            className={`-mb-px border-b-2 px-[10px] py-[6px] text-[12px] font-medium capitalize transition ${
              bottomTab === t
                ? "border-xyne-fg-primary text-xyne-fg-primary"
                : "border-transparent text-xyne-fg-tertiary hover:text-xyne-fg-secondary"
            }`}
          >
            {t === "connected" ? `Connected${selected ? ` (${neighbors.length})` : ""}` : "Memories"}
          </button>
        ))}
      </div>

      {bottomTab === "memories" ? (
        <>

      {filtered.length === 0 && filtersActive && (
        <p className="py-[16px] text-center text-[12px] text-xyne-fg-muted">
          No memories match the current filters
        </p>
      )}
      <div className="flex flex-col">
        {pageItems.map((memory) => (
          <MemoryCard key={memory.hindsightMemoryId} memory={memory} onDelete={handleDelete} userId={userId} onViewReasoning={onViewReasoning} />
        ))}
      </div>
      {pageCount > 1 && (
        <div className="flex items-center justify-between pt-[6px] text-[11px] text-xyne-fg-tertiary">
          <span>
            Showing {pageClamped * MEMORY_PAGE_SIZE + 1}–
            {Math.min((pageClamped + 1) * MEMORY_PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-[10px]">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={pageClamped === 0}
              className="rounded px-[6px] py-[2px] transition hover:text-xyne-fg-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              Prev
            </button>
            <span className="tabular-nums">
              {pageClamped + 1} / {pageCount}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={pageClamped >= pageCount - 1}
              className="rounded px-[6px] py-[2px] transition hover:text-xyne-fg-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
        </>
      ) : selected ? (
        <ConstellationDetail
          memory={selected}
          neighbors={neighbors}
          onSelect={setSelectedId}
          onClose={() => setSelectedId(null)}
          onViewReasoning={onViewReasoning}
        />
      ) : (
        <p className="py-[24px] text-center text-[12px] text-xyne-fg-muted">
          Select a node in the graph above to see its connected memories.
        </p>
      )}
      </div>
    </div>
  );
}

function MemoryCard({
  memory,
  onDelete,
  userId,
  onViewReasoning,
}: {
  memory: MemoryBankMemory;
  onDelete: (id: string, factType?: string | null) => void;
  userId?: string;
  onViewReasoning?: (pipelineEventId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const cleanText = cleanMemoryText(memory.content);
  // Version history, fetched on first open. Only derived observations have any,
  // and only once consolidation has UPDATED them — which is exactly what
  // proofCount > 1 tells us, so the toggle never appears on a memory that would
  // return an empty list. There is no batch endpoint, hence one call per card.
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<MemoryHistoryEntry[] | null>(null);
  const [historyErr, setHistoryErr] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const sub = subsystemOf(memory);
  const isObservation = isObservationType(memory.factType);
  const mayHaveHistory = isObservationType(memory.factType) && (memory.proofCount ?? 0) > 1;

  const toggleHistory = useCallback(() => {
    setShowHistory((open) => {
      const next = !open;
      if (next && history === null && !historyLoading && userId) {
        setHistoryLoading(true);
        setHistoryErr(null);
        getDigitalTwinMemoryHistory(userId, memory.hindsightMemoryId)
          .then(setHistory)
          .catch((e) => setHistoryErr(e instanceof Error ? e.message : String(e)))
          .finally(() => setHistoryLoading(false));
      }
      return next;
    });
  }, [history, historyLoading, userId, memory.hindsightMemoryId]);

  const isLong = cleanText.length > MEMORY_TRUNCATE_AT;
  const visibleText =
    expanded || !isLong
      ? cleanText
      : cleanText.slice(0, MEMORY_TRUNCATE_AT) + "…";

  return (
    <div className="border-t border-xyne-border-subtle first:border-t-0">
      <div className="flex items-start gap-[12px] py-[13px]">
        <div className="flex-1 min-w-0">
          <p className="whitespace-pre-wrap text-[13px] leading-[1.55] text-xyne-fg-primary">
            {visibleText}{" "}
            {isLong && (
              <button
                onClick={() => setExpanded((e) => !e)}
                className="text-[11px] text-xyne-fg-tertiary underline-offset-2 hover:text-xyne-fg-primary hover:underline"
              >
                {expanded ? "show less" : "show more"}
              </button>
            )}
          </p>
          <div className="mt-[6px] flex flex-wrap items-center gap-[8px] text-[10px] text-xyne-fg-tertiary">
            {sub && (
              <span className="rounded border border-xyne-border px-[6px] py-[1px] text-[10px] font-medium text-xyne-fg-secondary">
                {SUBSYSTEM_LABELS[sub] ?? sub}
              </span>
            )}
            <CategoryBadge category={memory.category} />
            {memory.recallHits7d > 0 && (
              <span>
                {memory.recallHits7d} recall{memory.recallHits7d !== 1 ? "s" : ""} (7d)
              </span>
            )}
            <span title={`Created ${fmtDate(memory.createdAt)}`}>created {fmtRelative(memory.createdAt)}</span>
            {memory.lastRecalledAt && (
              <span>· last recalled {fmtRelative(memory.lastRecalledAt)}</span>
            )}
            {memory.curatorReasoning && (
              <button
                onClick={() => setShowReasoning((s) => !s)}
                className="underline-offset-2 hover:text-xyne-fg-primary hover:underline"
              >
                {showReasoning ? "hide curator" : "why?"}
              </button>
            )}
            {mayHaveHistory && (
              <button
                onClick={toggleHistory}
                title="Earlier versions of this memory, before your Twin revised it"
                className="underline-offset-2 hover:text-xyne-fg-primary hover:underline"
              >
                {showHistory ? "hide history" : "history"}
              </button>
            )}
          </div>
          {showHistory && (
            <div className="mt-[6px] rounded border border-xyne-border bg-xyne-surface px-[8px] py-[6px] text-[11px]">
              {historyLoading ? (
                <span className="text-xyne-fg-tertiary">Loading earlier versions…</span>
              ) : historyErr ? (
                <span className="text-xyne-error-fg">{historyErr}</span>
              ) : history && history.length > 0 ? (
                <ol className="flex flex-col gap-[8px]">
                  {history.map((h, i) => (
                    <li key={`${h.changedAt}-${i}`} className="border-l-2 border-xyne-border pl-[8px]">
                      <div className="text-[10px] uppercase tracking-wide text-xyne-fg-tertiary">
                        revised {fmtRelative(h.changedAt)}
                      </div>
                      <p className="mt-[2px] whitespace-pre-wrap text-xyne-fg-secondary">
                        {cleanMemoryText(h.previousText)}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : (
                // proofCount is a hint, not a contract — history can be
                // cascade-deleted while the count stays high.
                <span className="text-xyne-fg-tertiary">No earlier versions recorded.</span>
              )}
            </div>
          )}
          {showReasoning && memory.curatorReasoning && (
            <div className="mt-[6px] rounded border border-xyne-border bg-xyne-surface px-[8px] py-[6px] text-[11px] text-xyne-fg-secondary">
              <span className="font-medium text-xyne-fg-tertiary">Curator:</span>{" "}
              {memory.curatorReasoning}
              {memory.curatorConfidence != null && (
                <span className="ml-[4px] text-xyne-fg-tertiary">
                  (confidence {memory.curatorConfidence.toFixed(2)})
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-[8px]">
          {onViewReasoning && (
            memory.pipelineEventId ? (
              <button
                onClick={() => onViewReasoning(memory.pipelineEventId!)}
                title="See the LLM reasoning that proposed this memory"
                className="inline-flex items-center gap-[5px] rounded-md border border-xyne-border bg-xyne-surface px-[8px] py-[3px] font-mono text-[10.5px] text-xyne-fg-secondary transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
              >
                <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2.5 8h11M9 3.5 13.5 8 9 12.5" /></svg>
                reasoning
              </button>
            ) : isObservation ? (
              <span
                title="Derived by Hindsight from supporting world/experience facts; it has no single curator trace."
                className="inline-flex items-center rounded-md border border-dashed border-xyne-warning-border px-[8px] py-[3px] font-mono text-[10.5px] text-xyne-warning-fg"
              >
                derived
              </span>
            ) : (
              <span
                title="No pipeline trace — this memory predates the reasoning link."
                className="inline-flex items-center rounded-md border border-dashed border-xyne-border px-[8px] py-[3px] font-mono text-[10.5px] text-xyne-fg-muted"
              >
                no trace
              </span>
            )
          )}
          <button
            onClick={() => onDelete(memory.hindsightMemoryId, memory.factType)}
            className="text-xyne-fg-tertiary hover:text-xyne-error-fg"
            title={isObservation ? "Why can't I delete this derived observation?" : "Delete memory"}
          >
            <TrashIcon size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Hot memories sub-tab
// ══════════════════════════════════════════════════════════════════════

function HotSubtab({ userId }: { userId: string }) {
  const { show: showSnackbar } = useSnackbar();
  const [stats, setStats] = useState<MemoryBankStats | null>(null);
  const [range, setRange] = useState<"7d" | "30d" | "90d">("7d");
  const [loading, setLoading] = useState(false);
  /** IDs we've optimistically removed via the in-row Delete button. */
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    getDigitalTwinStats(userId, range)
      .then(setStats)
      .catch(() => showSnackbar({ variant: "error", title: "Failed to load stats" }))
      .finally(() => setLoading(false));
  }, [userId, range, showSnackbar]);

  const handleDelete = useCallback(
    async (hindsightMemoryId: string, factType?: string | null) => {
      if (
        !isObservationType(factType) &&
        !window.confirm(
          "Delete this memory? This removes it from Hindsight and marks related review rows as rejected. Recall-hit history is retained.",
        )
      ) {
        return;
      }
      try {
        await deleteDigitalTwinMemory(userId, hindsightMemoryId);
        // Optimistic — Hot is re-fetched on range change or manual refresh
        setDeletedIds((prev) => new Set(prev).add(hindsightMemoryId));
        showSnackbar({ variant: "success", title: "Memory deleted" });
      } catch (error) {
        showSnackbar({ variant: "error", ...memoryDeleteNotice(error), duration: 8_000 });
      }
    },
    [userId, showSnackbar],
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-[6px]">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-[48px] rounded-lg" />
        ))}
      </div>
    );
  }

  const hot = (stats?.hot ?? []).filter((m) => !deletedIds.has(m.hindsightMemoryId));

  return (
    <div className="flex flex-col gap-[10px]">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-xyne-fg-secondary">
          Memories ranked by recall frequency
        </span>
        <div className="flex items-center rounded-lg border border-xyne-border bg-xyne-surface-sunken p-[2px]">
          {(["7d", "30d", "90d"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-md px-[10px] py-[3px] text-[11px] font-medium transition ${
                range === r
                  ? "bg-xyne-surface text-xyne-fg-primary shadow-sm"
                  : "text-xyne-fg-muted hover:text-xyne-fg-secondary"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {hot.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-[8px] rounded-lg border border-dashed border-xyne-border py-[48px] text-center">
          <p className="text-[13px] text-xyne-fg-secondary">No hot memories</p>
          <p className="text-[12px] text-xyne-fg-tertiary">
            Memories will appear here once they start getting recalled
          </p>
        </div>
      )}

      <ol className="flex flex-col gap-[6px]">
        {hot.map((m, idx) => {
          const isRejected = m.status === "rejected";
          return (
            <li
              key={m.hindsightMemoryId}
              className="flex items-start gap-[10px] rounded-lg border border-xyne-border bg-xyne-surface-sunken p-[10px]"
            >
              {/* Numbered rank — V1 parity. Tabular nums keep alignment when
                  the list crosses 10. */}
              <span className="mt-[1px] inline-flex h-[20px] min-w-[26px] shrink-0 items-center justify-center rounded-full bg-xyne-surface px-[6px] text-[10px] font-semibold tabular-nums text-xyne-fg-secondary">
                #{idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-xyne-fg-primary">{m.content}</p>
                <div className="mt-[4px] flex flex-wrap items-center gap-[8px] text-[10px] text-xyne-fg-tertiary">
                  <CategoryBadge category={m.category} />
                  <span>
                    {m.hits} recall{m.hits !== 1 ? "s" : ""}
                  </span>
                  {m.lastRecalledAt && (
                    <span>last recalled {fmtRelative(m.lastRecalledAt)}</span>
                  )}
                  {isRejected && (
                    <span className="text-xyne-error-fg">(deleted from Hindsight)</span>
                  )}
                </div>
              </div>
              {!isRejected && (
                <button
                  onClick={() => handleDelete(m.hindsightMemoryId, m.factType)}
                  className="shrink-0 text-xyne-fg-tertiary hover:text-xyne-error-fg"
                  title={isObservationType(m.factType) ? "Why can't I delete this derived observation?" : "Delete memory"}
                  aria-label="Delete memory"
                >
                  <TrashIcon size={14} />
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Recall tester sub-tab
// ══════════════════════════════════════════════════════════════════════

function TesterSubtab({ userId }: { userId: string }) {
  const { show: showSnackbar } = useSnackbar();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RecallResult[] | null>(null);
  const [testing, setTesting] = useState(false);

  async function submit() {
    if (!query.trim()) return;
    setTesting(true);
    setResults(null);
    try {
      const res = await recallDigitalTwinMemory(userId, query.trim(), "mid");
      setResults(res);
    } catch {
      showSnackbar({ variant: "error", title: "Recall failed" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-col gap-[8px] rounded-lg border border-xyne-border bg-xyne-surface p-[12px]">
        <label className="text-[10px] font-medium uppercase tracking-[0.06em] text-xyne-fg-tertiary">
          Query
        </label>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask a question your Twin might answer…"
          rows={3}
          className="w-full resize-none rounded-lg border border-xyne-border bg-xyne-surface px-[10px] py-[6px] text-[12px] text-xyne-fg-primary focus:border-xyne-brand focus:outline-none"
        />
        <div className="flex items-center justify-end">
          <Button variant="primary" size="sm" disabled={!query.trim() || testing} onClick={submit}>
            <MagnifyingGlassIcon size={12} />
            {testing ? "Recalling…" : "Test recall"}
          </Button>
        </div>
      </div>

      {results && (
        <div className="flex flex-col gap-[8px]">
          <h4 className="text-[12px] font-medium text-xyne-fg-primary">
            {results.length} result{results.length !== 1 ? "s" : ""}
          </h4>
          {results.length === 0 && (
            <p className="text-[12px] text-xyne-fg-secondary">No memories recalled for this query</p>
          )}
          <div className="flex flex-col gap-[6px]">
            {results.map((r, i) => (
              <div
                key={r.id ?? i}
                className="rounded-lg border border-xyne-border bg-xyne-surface-sunken p-[10px]"
              >
                <p className="text-[12px] text-xyne-fg-primary">{r.text ?? "—"}</p>
                <div className="mt-[6px] flex flex-wrap items-center gap-[6px]">
                  {r.fact_type && (
                    <span className="rounded border border-xyne-border px-[6px] py-[1px] text-[10px] text-xyne-fg-tertiary">
                      {r.fact_type}
                    </span>
                  )}
                  {r.score != null && (
                    <span className={`text-[10px] font-medium tabular-nums ${
                      r.score >= 0.8 ? "text-xyne-success-fg"
                      : r.score >= 0.6 ? "text-xyne-warning-fg"
                      : "text-xyne-error-fg"
                    }`}>
                      {Math.round(r.score * 100)}% match
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const RELATION_COLOR: Record<string, string> = { semantic: "#9a8fc0", temporal: "#7fa890", entity: "#c2a15e" };

function ConstellationDetail({
  memory,
  neighbors,
  onSelect,
  onClose,
  onViewReasoning,
}: {
  memory: MemoryBankMemory;
  neighbors: ConstellationNeighbor[];
  onSelect: (id: string) => void;
  onClose: () => void;
  onViewReasoning?: (pipelineEventId: string) => void;
}) {
  const tags = (memory.tags ?? []).filter((t) => !t.startsWith("user:") && !t.startsWith("pipeline:"));
  const sub = subsystemOf(memory);
  return (
    <div className="rounded-xl border border-xyne-border bg-xyne-surface p-[16px]">
      <div className="flex items-start gap-[16px]">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-[6px]">
            {sub && (
              <span className="rounded border border-xyne-border px-[6px] py-[1px] text-[10px] font-medium text-xyne-fg-secondary">
                {SUBSYSTEM_LABELS[sub] ?? sub}
              </span>
            )}
            <CategoryBadge category={memory.category} />
          </div>
          <p className="mt-[8px] whitespace-pre-wrap text-[13.5px] leading-[1.55] text-xyne-fg-primary">
            {cleanMemoryText(memory.content)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-[8px]">
          {onViewReasoning && memory.pipelineEventId && (
            <button
              onClick={() => onViewReasoning(memory.pipelineEventId!)}
              title="See the backfill activity / LLM reasoning that proposed this memory"
              className="inline-flex items-center gap-[5px] rounded-md border border-xyne-border bg-xyne-surface px-[8px] py-[3px] font-mono text-[10.5px] text-xyne-fg-secondary transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
            >
              <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2.5 8h11M9 3.5 13.5 8 9 12.5" /></svg>
              reasoning
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-[2px] text-xyne-fg-tertiary transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
          >
            <XIcon size={14} />
          </button>
        </div>
      </div>
      <div className="mt-[12px] flex flex-wrap items-center gap-x-[14px] gap-y-[6px] border-t border-xyne-border-subtle pt-[12px] text-[11px] text-xyne-fg-tertiary">
        <span>created {fmtRelative(memory.createdAt)}</span>
        {memory.lastRecalledAt && <span>· last recalled {fmtRelative(memory.lastRecalledAt)}</span>}
        {memory.recallHits7d > 0 && <span>· {memory.recallHits7d} recall{memory.recallHits7d !== 1 ? "s" : ""} (7d)</span>}
        {tags.length > 0 && (
          <span className="ml-auto flex flex-wrap gap-[5px]">
            {tags.map((t) => (
              <span key={t} className="rounded bg-xyne-surface-sunken px-[6px] py-[1px] font-mono text-[10px] text-xyne-fg-tertiary">{t}</span>
            ))}
          </span>
        )}
      </div>

      {/* Connected memories — numbered to match the badges on the graph. */}
      {neighbors.length > 0 && (
        <div className="mt-[12px] border-t border-xyne-border-subtle pt-[12px]">
          <p className="mb-[8px] text-[10px] font-semibold uppercase tracking-[0.06em] text-xyne-fg-muted">
            Connected memories ({neighbors.length}) — numbers match the graph
          </p>
          <div className="flex flex-col gap-[3px]">
            {neighbors.map((nb) => (
              <button
                key={nb.id}
                onClick={() => onSelect(nb.id)}
                className="flex items-start gap-[9px] rounded-lg px-[8px] py-[6px] text-left transition hover:bg-xyne-surface-sunken"
                title="Focus this connected memory"
              >
                <span
                  className="mt-[1px] flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                  style={{ background: SUBSYSTEM_COLOR[nb.subsystem] ?? DEFAULT_COLOR }}
                >
                  {nb.index}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[12.5px] leading-[1.4] text-xyne-fg-secondary">
                    {cleanMemoryText(nb.text)}
                  </span>
                  {nb.entities.length > 0 && (
                    <span className="mt-[2px] block truncate text-[10px] text-xyne-fg-muted">
                      {nb.entities.slice(0, 6).join(", ")}
                    </span>
                  )}
                </span>
                <span className="mt-[1px] flex shrink-0 items-center gap-[5px] text-[10px] text-xyne-fg-tertiary">
                  <span className="flex items-center gap-[4px]">
                    <span className="h-[7px] w-[7px] rounded-full" style={{ background: RELATION_COLOR[nb.relation] }} />
                    {nb.relation}
                  </span>
                  <span className="tabular-nums text-xyne-fg-muted" title="link weight">
                    w{Number.isInteger(nb.weight) ? nb.weight : nb.weight.toFixed(1)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
