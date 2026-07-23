import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from "react";
import {
  BrainIcon,
  FireIcon,
  MagnifyingGlassIcon,
  TrashIcon,
  ArrowClockwiseIcon,
  ArrowsClockwiseIcon,
  CaretDownIcon,
  CaretUpIcon,
  CheckIcon,
  XIcon,
  ClipboardTextIcon,
  PlayIcon,
  PauseIcon,
  InfoIcon,
} from "@phosphor-icons/react";
import {
  listDigitalTwinMemories,
  deleteDigitalTwinMemory,
  getDigitalTwinStats,
  getDigitalTwinGraph,
  recallDigitalTwinMemory,
} from "../../../lib/api";
import type {
  MemoryBankMemory,
  MemoryBankStats,
  DigitalTwinGraphEdge,
  RecallResult,
} from "../../../lib/api";
import { MemoryConstellation, SUBSYSTEM_COLOR, DEFAULT_COLOR, type ConstellationNeighbor } from "./MemoryConstellation";
import { useSnackbar } from "../ui/Snackbar";
import { Search } from "../ui/Search";
import { Skeleton } from "../ui/Skeleton";
import { Button } from "../ui/Button";
import { Tooltip } from "../ui/Tooltip";
import { EnableModal } from "./EnableModal";
import { DeleteMemoriesModal } from "./DeleteMemoriesModal";
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

/** Compact, unobtrusive filter dropdown (native select — space-efficient, no
 *  popping colour, matches the surrounding metadata scale). */
function FilterSelect({
  value,
  onChange,
  label,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-xyne-border bg-xyne-surface px-[8px] py-[5px] text-[11px] text-xyne-fg-secondary focus:outline-none focus:ring-1 focus:ring-xyne-border-strong"
    >
      {children}
    </select>
  );
}

const CATEGORY_LEGEND: Array<{ key: keyof typeof CATEGORY_STYLES; description: string }> = [
  { key: "world", description: "Durable, objective fact about you or your work." },
  { key: "experience", description: "Something observed during the agent's own runs — what it tried, what worked." },
  { key: "observation", description: "Secondary extraction pass — often a near-duplicate rephrasing of a WORLD fact." },
  { key: "mental_model", description: "Captured judgment call or framing the agent should respect." },
];

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
  const removeMemory = useCallback((hindsightMemoryId: string) => {
    setMemories((prev) => prev.filter((m) => m.hindsightMemoryId !== hindsightMemoryId));
    setMemTotal((t) => Math.max(0, t - 1));
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Sub-tab nav + actions — pinned at top */}
      <div className="shrink-0 border-b border-xyne-border px-[20px] py-[12px]">
        <div className="flex flex-wrap items-center gap-[6px]">
          <SubTabBtn active={sub === "all"} onClick={() => setSub("all")} icon={<BrainIcon size={13} />}>
            Memories
          </SubTabBtn>
          <SubTabBtn active={sub === "hot"} onClick={() => setSub("hot")} icon={<FireIcon size={13} />}>
            Hot
          </SubTabBtn>
          <SubTabBtn
            active={sub === "proposals"}
            onClick={() => setSub("proposals")}
            icon={<ClipboardTextIcon size={13} />}
          >
            Proposals
          </SubTabBtn>
          <SubTabBtn
            active={sub === "tester"}
            onClick={() => setSub("tester")}
            icon={<MagnifyingGlassIcon size={13} />}
          >
            Recall
          </SubTabBtn>

          {/* Right-side action buttons */}
          <div className="ml-auto flex items-center gap-[4px]">
            <Tooltip content="Backfill history" side="bottom">
              <button
                onClick={() => setShowBackfill(true)}
                aria-label="Backfill history"
                className="flex items-center justify-center rounded-lg border border-xyne-border bg-xyne-surface p-[6px] text-xyne-fg-tertiary transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
              >
                <ArrowsClockwiseIcon size={13} />
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
  const [legendOpen, setLegendOpen] = useState(false);
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
    async (hindsightMemoryId: string) => {
      if (!window.confirm("Delete this memory? This removes it from Hindsight and marks all related review rows as rejected. Recall-hit history is retained.")) {
        return;
      }
      try {
        await deleteDigitalTwinMemory(userId, hindsightMemoryId);
        onRemove(hindsightMemoryId);
        showSnackbar({ variant: "success", title: "Memory deleted" });
      } catch {
        showSnackbar({ variant: "error", title: "Failed to delete memory" });
      }
    },
    [userId, onRemove, showSnackbar],
  );

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
    <div className="flex flex-col gap-[10px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <Search
          value={search}
          onChange={setSearch}
          placeholder="Search memories…"
          className="w-full sm:w-[240px]"
        />
        <FilterSelect value={subsystem} onChange={setSubsystem} label="Filter by subsystem">
          <option value="all">All subsystems</option>
          {presentSubsystems.map((s) => (
            <option key={s} value={s}>
              {SUBSYSTEM_LABELS[s] ?? s}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect value={category} onChange={setCategory} label="Filter by category">
          <option value="all">All categories</option>
          {presentCategories.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_STYLES[c]?.label ?? c.toUpperCase()}
            </option>
          ))}
        </FilterSelect>
        {presentEntities.length > 0 && (
          <FilterSelect value={entity} onChange={setEntity} label="Filter by entity">
            <option value="all">All entities</option>
            {presentEntities.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </FilterSelect>
        )}
        <div className="flex items-center gap-[4px]">
          <input
            type="date"
            aria-label="From date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-md border border-xyne-border bg-xyne-surface px-[8px] py-[4px] text-[11px] text-xyne-fg-secondary focus:outline-none focus:ring-1 focus:ring-xyne-border-strong"
          />
          <span className="text-[11px] text-xyne-fg-muted">→</span>
          <input
            type="date"
            aria-label="To date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-md border border-xyne-border bg-xyne-surface px-[8px] py-[4px] text-[11px] text-xyne-fg-secondary focus:outline-none focus:ring-1 focus:ring-xyne-border-strong"
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { setDateFrom(""); setDateTo(""); }}
              aria-label="Clear date filter"
              className="rounded-md px-[5px] py-[4px] text-[11px] text-xyne-fg-muted transition hover:text-xyne-fg-secondary"
            >
              clear
            </button>
          )}
        </div>
        <span className="ml-auto text-[11px] text-xyne-fg-tertiary">
          {filtersActive ? `${filtered.length} of ${total}` : `${total} ${total === 1 ? "memory" : "memories"}`}
        </span>
      </div>

      {/* Graph on top — full-width constellation + timeline. Connected memories
          live in a tab below (not a side panel). Same filters as the list. */}
      {(() => {
        const graphRegion = (
          <div className="flex flex-col gap-[8px]">
            {graphTruncated && (
              <div className="flex items-start gap-[6px] rounded-lg border border-xyne-border bg-xyne-surface-sunken px-[10px] py-[6px] text-[11px] text-xyne-fg-tertiary">
                <InfoIcon size={13} className="mt-[1px] shrink-0 text-xyne-fg-muted" />
                <span>
                  Showing the <span className="font-medium text-xyne-fg-secondary">{GRAPH_NODE_CAP} latest</span> of{" "}
                  {filtered.length} memories in this range. Narrow the date range to explore older memories on the graph — the list below shows all {filtered.length}.
                </span>
              </div>
            )}
            <div className="min-w-0" style={{ height: expanded ? "calc(100vh - 150px)" : "380px" }}>
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
              />
            </div>
            {tMax > tMin && (
              <div className="flex items-center gap-[10px] rounded-lg border border-xyne-border bg-xyne-surface-sunken px-[10px] py-[6px]">
                <button
                  onClick={() => {
                    if (!playing && (timeCutoff == null || timeCutoff >= tMax)) setTimeCutoff(tMin);
                    setPlaying((p) => !p);
                  }}
                  title={playing ? "Pause" : "Play — watch memories appear over time"}
                  className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border border-xyne-border bg-xyne-surface text-xyne-fg-secondary transition hover:text-xyne-fg-primary"
                >
                  {playing ? <PauseIcon size={12} weight="fill" /> : <PlayIcon size={12} weight="fill" />}
                </button>
                <span className="shrink-0 text-[10px] uppercase tracking-[0.06em] text-xyne-fg-muted">timeline</span>
                <input
                  type="range"
                  min={tMin}
                  max={tMax}
                  step={DAY_MS}
                  value={timeCutoff ?? tMax}
                  onChange={(e) => { setPlaying(false); setTimeCutoff(Number(e.target.value)); }}
                  className="h-[3px] flex-1 cursor-pointer accent-xyne-fg-secondary"
                />
                <span className="w-[92px] shrink-0 text-right font-mono text-[10px] text-xyne-fg-tertiary">{timelineLabel}</span>
              </div>
            )}
          </div>
        );
        return expanded
          ? <div className="fixed inset-0 z-50 overflow-auto bg-xyne-surface px-[16px] py-[12px]">{graphRegion}</div>
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
      {/* Collapsible category legend */}
      {visibleCategories.size > 0 && (
        <div className="rounded-lg border border-xyne-border bg-xyne-surface-sunken">
          <button
            onClick={() => setLegendOpen((o) => !o)}
            className="flex w-full items-center justify-between px-[10px] py-[6px] text-left"
          >
            <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-xyne-fg-tertiary">
              Category guide
            </span>
            {legendOpen ? (
              <CaretUpIcon size={12} className="text-xyne-fg-tertiary" />
            ) : (
              <CaretDownIcon size={12} className="text-xyne-fg-tertiary" />
            )}
          </button>
          {legendOpen && (
            <div className="flex flex-col gap-[6px] border-t border-xyne-border px-[10px] py-[8px]">
              {CATEGORY_LEGEND.filter((row) => visibleCategories.has(row.key)).map((row) => (
                <div key={row.key} className="flex items-start gap-[8px]">
                  <CategoryBadge category={row.key} />
                  <span className="text-[11px] text-xyne-fg-secondary">{row.description}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
  );
}

function MemoryCard({
  memory,
  onDelete,
  onViewReasoning,
}: {
  memory: MemoryBankMemory;
  onDelete: (id: string) => void;
  userId?: string;
  onViewReasoning?: (pipelineEventId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const cleanText = cleanMemoryText(memory.content);
  const sub = subsystemOf(memory);
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
          </div>
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
            onClick={() => onDelete(memory.hindsightMemoryId)}
            className="text-xyne-fg-tertiary hover:text-xyne-error-fg"
            title="Delete memory"
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
    async (hindsightMemoryId: string) => {
      if (
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
      } catch {
        showSnackbar({ variant: "error", title: "Failed to delete memory" });
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
                  onClick={() => handleDelete(m.hindsightMemoryId)}
                  className="shrink-0 text-xyne-fg-tertiary hover:text-xyne-error-fg"
                  title="Delete memory"
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
