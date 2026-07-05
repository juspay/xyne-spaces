import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  BrainIcon,
  FireIcon,
  MagnifyingGlassIcon,
  TreeStructureIcon,
  TrashIcon,
  SpinnerGapIcon,
  ArrowClockwiseIcon,
  ArrowsClockwiseIcon,
  CaretDownIcon,
  CaretUpIcon,
  CheckIcon,
  XIcon,
  ClipboardTextIcon,
} from "@phosphor-icons/react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node as RFNode,
  type Edge as RFEdge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import {
  listDigitalTwinMemories,
  deleteDigitalTwinMemory,
  getDigitalTwinStats,
  recallDigitalTwinMemory,
  getDigitalTwinSubsystemGraph,
  type DigitalTwinSubsystemNode,
  type DigitalTwinSubsystemEdge,
} from "../../../lib/api";
import type {
  MemoryBankMemory,
  MemoryBankStats,
  RecallResult,
} from "../../../lib/api";
import { useSnackbar } from "../ui/Snackbar";
import { Search } from "../ui/Search";
import { Skeleton } from "../ui/Skeleton";
import { Button } from "../ui/Button";
import { Tooltip } from "../ui/Tooltip";
import { EnableModal } from "./EnableModal";
import { DigitalTwinReviewTab } from "./DigitalTwinReviewTab";

type SubTab = "all" | "hot" | "proposals" | "tester" | "graph";

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
}

export function DigitalTwinMemoriesTab({ userId, onCandidateApproved }: DigitalTwinMemoriesTabProps) {
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
          <SubTabBtn
            active={sub === "graph"}
            onClick={() => setSub("graph")}
            icon={<TreeStructureIcon size={13} />}
          >
            Graph
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

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-[20px] py-[16px]">
        {sub === "all"      && <AllSubtab   key={`all-${refreshKey}-${approvalKey}`}   userId={userId} />}
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
        {sub === "graph"    && <GraphSubtab  key={`graph-${refreshKey}-${approvalKey}`}   userId={userId} />}
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

function AllSubtab({ userId }: { userId: string }) {
  const { show: showSnackbar } = useSnackbar();
  const [memories, setMemories] = useState<MemoryBankMemory[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    listDigitalTwinMemories(userId)
      .then((data) => {
        setMemories(data?.memories ?? []);
        setTotal(data?.total ?? data?.memories?.length ?? 0);
      })
      .catch(() => showSnackbar({ variant: "error", title: "Failed to load memories" }))
      .finally(() => setLoading(false));
  }, [userId, showSnackbar]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return memories;
    return memories.filter((m) => m.content.toLowerCase().includes(q));
  }, [memories, search]);

  const handleDelete = useCallback(
    async (hindsightMemoryId: string) => {
      if (!window.confirm("Delete this memory? This removes it from Hindsight and marks all related review rows as rejected. Recall-hit history is retained.")) {
        return;
      }
      try {
        await deleteDigitalTwinMemory(userId, hindsightMemoryId);
        setMemories((prev) => prev.filter((m) => m.hindsightMemoryId !== hindsightMemoryId));
        setTotal((t) => Math.max(0, t - 1));
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
      <div className="flex flex-wrap items-center gap-[12px]">
        <Search
          value={search}
          onChange={setSearch}
          placeholder="Search memories…"
          className="w-full sm:w-[320px]"
        />
        <span className="text-[11px] text-xyne-fg-tertiary">
          {search.trim()
            ? `${filtered.length} of ${memories.length} loaded · ${total} total`
            : `${memories.length} of ${total} memories`}
        </span>
      </div>

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

      {filtered.length === 0 && search.trim() && (
        <p className="py-[16px] text-center text-[12px] text-xyne-fg-muted">
          No memories match &ldquo;{search}&rdquo;
        </p>
      )}
      <div className="flex flex-col gap-[6px]">
        {filtered.map((memory) => (
          <MemoryCard key={memory.hindsightMemoryId} memory={memory} onDelete={handleDelete} userId={userId} />
        ))}
      </div>
    </div>
  );
}

function MemoryCard({
  memory,
  onDelete,
  userId,
}: {
  memory: MemoryBankMemory;
  onDelete: (id: string) => void;
  userId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const isLong = memory.content.length > MEMORY_TRUNCATE_AT;
  const visibleText =
    expanded || !isLong
      ? memory.content
      : memory.content.slice(0, MEMORY_TRUNCATE_AT) + "…";

  return (
    <div className="rounded-lg border border-xyne-border bg-xyne-surface-sunken p-[10px]">
      <div className="flex items-start gap-[8px]">
        <div className="flex-1 min-w-0">
          <p className="whitespace-pre-wrap text-[12px] text-xyne-fg-primary">
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
            <CategoryBadge category={memory.category} />
            {memory.recallHits7d > 0 && (
              <span>
                {memory.recallHits7d} recall{memory.recallHits7d !== 1 ? "s" : ""} (7d)
              </span>
            )}
            <span>created {fmtRelative(memory.createdAt)}</span>
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
        <div className="flex shrink-0 items-center gap-[6px]">
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

// ══════════════════════════════════════════════════════════════════════
// Graph sub-tab
// ══════════════════════════════════════════════════════════════════════

function GraphSubtab({ userId }: { userId: string }) {
  const { show: showSnackbar } = useSnackbar();
  const [nodes, setNodes] = useState<RFNode[]>([]);
  const [edges, setEdges] = useState<RFEdge[]>([]);
  const [loading, setLoading] = useState(false);
  /** Subsystem id selected via node click — drives the right-side panel. */
  const [selectedSubsystem, setSelectedSubsystem] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getDigitalTwinSubsystemGraph(userId)
      .then((data) => {
        setNodes(layoutSubsystems(data.subsystems, data.edges));
        setEdges(makeSubsystemEdges(data.edges));
      })
      .catch(() => showSnackbar({ variant: "error", title: "Failed to load graph" }))
      .finally(() => setLoading(false));
  }, [userId, showSnackbar]);

  if (loading) {
    return (
      <div className="flex h-[400px] items-center justify-center rounded-lg border border-xyne-border bg-xyne-surface">
        <SpinnerGapIcon size={20} className="animate-spin text-xyne-fg-muted" />
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="flex h-[400px] flex-col items-center justify-center gap-[8px] rounded-lg border border-dashed border-xyne-border">
        <p className="text-[13px] text-xyne-fg-secondary">No graph data</p>
        <p className="text-[12px] text-xyne-fg-tertiary">
          The subsystem graph will appear once you have approved memories
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[10px]">
      <div className="h-[400px] rounded-lg border border-xyne-border bg-xyne-surface">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          attributionPosition="bottom-left"
          onNodeClick={(_, node) => setSelectedSubsystem(node.id)}
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
      {selectedSubsystem && (
        <SubsystemMemoriesPanel
          userId={userId}
          subsystem={selectedSubsystem}
          onClose={() => setSelectedSubsystem(null)}
        />
      )}
    </div>
  );
}

function SubsystemMemoriesPanel({
  userId,
  subsystem,
  onClose,
}: {
  userId: string;
  subsystem: string;
  onClose: () => void;
}) {
  const [memories, setMemories] = useState<MemoryBankMemory[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setMemories(null);
    setErr(null);
    listDigitalTwinMemories(userId, { limit: 200, subsystem })
      .then((data) => setMemories(data?.memories ?? []))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [userId, subsystem]);

  return (
    <div className="rounded-lg border border-xyne-brand bg-xyne-surface">
      <div className="flex items-center gap-[8px] border-b border-xyne-border px-[12px] py-[8px]">
        <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-xyne-fg-tertiary">
          Subsystem
        </span>
        <span className="font-mono text-[12px] font-semibold text-xyne-brand">{subsystem}</span>
        {memories && (
          <span className="text-[11px] text-xyne-fg-tertiary">
            · {memories.length} {memories.length === 1 ? "memory" : "memories"}
          </span>
        )}
        <button
          onClick={onClose}
          aria-label="Close subsystem panel"
          className="ml-auto rounded p-[2px] text-xyne-fg-tertiary hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
        >
          ×
        </button>
      </div>
      <div className="flex flex-col gap-[6px] p-[12px]">
        {!memories && !err && (
          <div className="flex items-center gap-[8px] py-[12px] text-[12px] text-xyne-fg-muted">
            <SpinnerGapIcon size={13} className="animate-spin" />
            Loading…
          </div>
        )}
        {err && (
          <div className="rounded-lg border border-xyne-border bg-xyne-error-bg p-[8px] text-[11px] text-xyne-error-fg">
            {err}
          </div>
        )}
        {memories && memories.length === 0 && (
          <p className="py-[12px] text-center text-[12px] text-xyne-fg-secondary">
            No memories tagged{" "}
            <span className="font-mono text-xyne-fg-primary">subsystem:{subsystem}</span>
          </p>
        )}
        {memories?.map((m) => (
          <div
            key={m.hindsightMemoryId}
            className="rounded-lg border border-xyne-border bg-xyne-surface-sunken p-[8px]"
          >
            <p className="text-[12px] text-xyne-fg-primary">{m.content}</p>
            <div className="mt-[4px] flex flex-wrap items-center gap-[8px] text-[10px] text-xyne-fg-tertiary">
              <CategoryBadge category={m.category} />
              <span>created {fmtRelative(m.createdAt)}</span>
              {m.lastRecalledAt && (
                <span>· last recalled {fmtRelative(m.lastRecalledAt)}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Subsystem graph layout (dagre) — matches V1/V2's GraphView.
//
// The backend returns { subsystems, edges }; each node is a curated
// subsystem and each edge connects subsystems that share source sessions.
// We use dagre for a left-to-right hierarchical layout (far more readable
// than a naive grid) and scale node saturation by memory count.

const NODE_WIDTH = 220;
const NODE_HEIGHT = 88;

function layoutSubsystems(
  subsystems: DigitalTwinSubsystemNode[],
  edges: DigitalTwinSubsystemEdge[],
): RFNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 120, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  subsystems.forEach((s) => g.setNode(s.name, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((e) => {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  });
  dagre.layout(g);

  const maxMemoryCount = Math.max(1, ...subsystems.map((s) => s.memoryCount));

  return subsystems.map((s) => {
    const pos = g.node(s.name);
    const sat = 0.4 + 0.5 * (s.memoryCount / maxMemoryCount);
    return {
      id: s.name,
      position: { x: (pos?.x ?? 0) - NODE_WIDTH / 2, y: (pos?.y ?? 0) - NODE_HEIGHT / 2 },
      data: {
        label: (
          <div style={{ textAlign: "left", lineHeight: 1.25 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{s.name}</div>
            <div style={{ fontSize: 10, opacity: 0.75, marginTop: 2 }}>
              {s.memoryCount} {s.memoryCount === 1 ? "memory" : "memories"} · {s.sessionCount}{" "}
              {s.sessionCount === 1 ? "session" : "sessions"}
            </div>
            <div
              style={{
                fontSize: 10,
                opacity: 0.55,
                marginTop: 4,
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical" as const,
              }}
            >
              {s.sampleContent}
            </div>
          </div>
        ),
      },
      style: {
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        background: `rgba(99,102,241,${0.12 + 0.18 * sat})`,
        border: `1.5px solid rgba(165,180,252,${sat})`,
        borderRadius: 10,
        padding: "8px 12px",
        display: "flex",
        alignItems: "flex-start",
        boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
        cursor: "pointer",
      },
    };
  });
}

function makeSubsystemEdges(edges: DigitalTwinSubsystemEdge[]): RFEdge[] {
  if (edges.length === 0) return [];
  const maxShared = Math.max(1, ...edges.map((e) => e.sharedSessions));
  return edges.map((e) => ({
    id: `${e.source}::${e.target}`,
    source: e.source,
    target: e.target,
    type: "smoothstep",
    animated: false,
    style: {
      stroke: "rgba(165,180,252,0.55)",
      strokeWidth: Math.max(1.5, (e.sharedSessions / maxShared) * 3.5),
    },
    label: `${e.sharedSessions} shared`,
    labelStyle: { fontSize: 10, fill: "rgb(165,180,252)" },
    labelBgStyle: { fill: "rgb(24,24,27)", fillOpacity: 0.85 },
    labelBgPadding: [4, 4] as [number, number],
    labelBgBorderRadius: 4,
  }));
}
