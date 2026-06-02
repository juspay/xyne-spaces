import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brain, Flame, Inbox, FlaskConical, Loader2, Search, Trash2, RefreshCw, History, X, Power, Sparkles, Check, AlertTriangle, Network } from "lucide-react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node as RFNode,
  type Edge as RFEdge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";

interface Props {
  agentSlug: string;
  canDelete?: boolean;
  /**
   * Optional per-user scope tag for the digital-twin bank. When set, every
   * bank API call appends `?userTag=<value>` so the backend filters to
   * memories tagged for this specific user. Required by the backend
   * privacy gate when `agentSlug === "digital-twin"`; ignored on other
   * agent banks (assistant, doctor, etc.) which are shared/agent-scoped.
   * Format: "user:<userId>".
   */
  userTag?: string;
}

type Sub = "all" | "hot" | "pending" | "candidates" | "graph" | "tester";

interface Memory {
  id: string;
  hindsightMemoryId: string;
  category: string | null;
  content: string;
  curatorReasoning: string | null;
  curatorConfidence: number | null;
  createdAt: string;
  recallHits7d: number;
  lastRecalledAt: string | null;
}

interface HotMemory {
  hindsightMemoryId: string;
  hits: number;
  lastRecalledAt: string | null;
  content: string;
  category: string | null;
  status: string | null;
  createdAt: string | null;
}

interface Stats {
  range: string;
  totals: {
    approved: number;
    pending: number;
    recallsInRange: number;
  };
  hot: HotMemory[];
}

interface PendingReview {
  id: string;
  agentSlug: string;
  hindsightMemoryId: string | null;
  content: string;
  category: string | null;
  subsystem: string | null;
  action: "create" | "update" | null;
  replacesMemoryId: string | null;
  isNewSubsystem: boolean;
  curatorReasoning: string | null;
  curatorConfidence: number | null;
  sessionId: string | null;
  createdAt: string;
}

interface RecallResult {
  id?: string;
  text?: string;
  fact_type?: string;
}

const BASE = "/claw/api/v1/memory";

/* Friendly labels for the memory approval strategy enum. The raw values
   (HUMAN_ONLY / EVALS_ONLY / EVALS_THEN_HUMAN) are operational
   identifiers — fine in audit logs, too dense for the status banner. */
const APPROVAL_LABELS: Record<string, string> = {
  HUMAN_ONLY:       "Human review",
  EVALS_ONLY:       "Auto via evals",
  EVALS_THEN_HUMAN: "Evals, then human",
};

// ── helpers ─────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 14) return `${diffDay}d ago`;
  return d.toLocaleDateString();
}

// Hindsight categorizes each extracted fact into one of these classes. Tooltip
// text comes straight from the upstream Hindsight model — we don't redefine.
const CATEGORY_META: Record<string, { label: string; cls: string; tip: string }> = {
  world: {
    label: "WORLD",
    cls: "border-emerald-800/60 bg-emerald-950/40 text-emerald-300",
    tip: "Durable, objective fact about the codebase or system. The kind of memory worth keeping long-term.",
  },
  experience: {
    label: "EXPERIENCE",
    cls: "border-blue-800/60 bg-blue-950/40 text-blue-300",
    tip: "Something the agent observed during its own work — what it tried, what happened, what worked.",
  },
  observation: {
    label: "OBSERVATION",
    cls: "border-amber-800/60 bg-amber-950/40 text-amber-300",
    tip: "Hindsight's secondary extraction pass — often a near-duplicate rephrasing of a WORLD fact. Disabled by default on new banks; rows you see here are from before the toggle landed.",
  },
  mental_model: {
    label: "MENTAL MODEL",
    cls: "border-violet-800/60 bg-violet-950/40 text-violet-300",
    tip: "Higher-order pattern Hindsight synthesised from existing memories via its reflect operation.",
  },
};

function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return null;
  const meta = CATEGORY_META[category.toLowerCase()];
  if (!meta) {
    return (
      <span
        title={`Hindsight category "${category}" — unknown to this UI.`}
        className="rounded border border-zinc-700 bg-zinc-800/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400"
      >
        {category}
      </span>
    );
  }
  return (
    <span
      title={meta.tip}
      className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${meta.cls}`}
    >
      {meta.label}
    </span>
  );
}

/**
 * Compact legend explaining what each Hindsight category badge means.
 * Renders above the memory list so admins know what they're looking at
 * without needing to hover every badge.
 */
function CategoryLegend({ visibleCategories }: { visibleCategories: Set<string> }) {
  const shown = (Object.keys(CATEGORY_META) as Array<keyof typeof CATEGORY_META>).filter((k) =>
    visibleCategories.has(k),
  );
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-[11px] text-zinc-400">
      <span className="text-zinc-500">Categories:</span>
      {shown.map((k) => {
        const m = CATEGORY_META[k]!;
        return (
          <span key={k} className="flex items-center gap-1.5">
            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${m.cls}`}>
              {m.label}
            </span>
            <span className="text-zinc-500">{m.tip.split(".")[0]}.</span>
          </span>
        );
      })}
    </div>
  );
}

function HitsBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 border border-rose-200">
      <Flame size={10} /> {count}
    </span>
  );
}

/**
 * EmptyState — shared empty/fallback for memory sub-views.
 *
 * Centers vertically + horizontally within its parent (the sub-view's
 * scrolling area), shows a soft icon bubble, a short title, and an
 * optional description. Used by All / Hot / Batches / Candidates so
 * every tab's fallback reads with the same rhythm.
 */
function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  description?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-xyne-surface-subtle text-xyne-fg-tertiary">
        <Icon size={22} />
      </div>
      <p className="text-[14px] font-medium text-xyne-fg-secondary">{title}</p>
      {description && (
        <p className="max-w-[320px] text-[12px] leading-relaxed text-xyne-fg-tertiary">
          {description}
        </p>
      )}
    </div>
  );
}

/**
 * SubNavBtn — bubble-style sub-nav button. Default state: round icon-only
 * bubble. Hover/focus: expands rightward into a labeled pill (`(icon) Hot`).
 * Active state stays expanded so the current selection is always readable
 * without hovering. Mirrors the right-column bubble strip pattern.
 */
function SubNavBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={[
        "group/subnav relative inline-flex h-9 items-center justify-start rounded-full",
        "transition-all duration-200 ease-out",
        "shadow-[0_1px_4px_-1px_rgba(16,24,40,0.06),0_2px_8px_-2px_rgba(16,24,40,0.04)]",
        "hover:shadow-[0_2px_8px_-2px_rgba(16,24,40,0.10),0_4px_12px_-4px_rgba(16,24,40,0.06)]",
        active
          ? "bg-xyne-fg-primary text-xyne-fg-inverse"
          : "bg-xyne-surface border border-xyne-border-subtle text-xyne-fg-secondary hover:text-xyne-fg-primary hover:border-xyne-border",
      ].join(" ")}
    >
      <span className="w-9 h-9 flex items-center justify-center shrink-0">
        {icon}
      </span>
      <span
        className={[
          "overflow-hidden whitespace-nowrap text-[12px] font-medium",
          "transition-[max-width,padding] duration-200 ease-out",
          active
            ? "max-w-[140px] pl-0 pr-3"
            : "max-w-0 group-hover/subnav:max-w-[140px] group-hover/subnav:pr-3 group-focus-visible/subnav:max-w-[140px] group-focus-visible/subnav:pr-3",
        ].join(" ")}
      >
        {children}
      </span>
    </button>
  );
}

// ── memory tab ───────────────────────────────────────────────────────────

interface MemoryStatusFlags {
  memoryEnabled: boolean;
  memorySharedAllowed: boolean;
  memoryApprovalStrategy: "HUMAN_ONLY" | "EVALS_ONLY" | "EVALS_THEN_HUMAN";
}

export function MemoryTab({ agentSlug, canDelete = false, userTag }: Props) {
  const [sub, setSub] = useState<Sub>("all");
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsRange, setStatsRange] = useState<"7d" | "30d" | "90d">("7d");
  const [showBackfill, setShowBackfill] = useState(false);
  const [status, setStatus] = useState<MemoryStatusFlags | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  // Confirm dialog for the disable action — replaces the native browser
  // confirm() popup which clashed with V3's surface aesthetic.
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);

  // Helper: append &userTag=... when set. Used by every bank API call so
  // the backend's privacy gate (digital-twin requires userTag matching the
  // requester) can authorize correctly.
  const tagParam = userTag ? `&userTag=${encodeURIComponent(userTag)}` : "";
  const tagParamFirst = userTag ? `?userTag=${encodeURIComponent(userTag)}` : "";

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res = await fetch(`${BASE}/banks/${encodeURIComponent(agentSlug)}/status${tagParamFirst}`);
      const data = await res.json();
      if (data.success) setStatus(data.data);
    } finally {
      setStatusLoading(false);
    }
  }, [agentSlug, tagParamFirst]);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await fetch(`${BASE}/banks/${encodeURIComponent(agentSlug)}/stats?range=${statsRange}${tagParam}`);
      const data = await res.json();
      if (data.success) setStats(data.data);
    } finally {
      setStatsLoading(false);
    }
  }, [agentSlug, statsRange, tagParam]);

  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => {
    // Load stats when the bank's memory toggle is on (admin agent view) OR
    // we're in per-user view (Digital Twin) where the toggle is bypassed.
    if (status?.memoryEnabled || userTag) loadStats();
  }, [loadStats, status?.memoryEnabled, userTag]);

  async function toggleMemory(enable: boolean): Promise<void> {
    setToggling(true);
    try {
      const action = enable ? "enable" : "disable";
      const res = await fetch(`${BASE}/banks/${encodeURIComponent(agentSlug)}/${action}`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setStatus(data.data);
      } else {
        alert(`Failed to ${action} memory: ${data.error ?? res.status}`);
      }
    } finally {
      setToggling(false);
    }
  }

  async function handleDelete(hindsightMemoryId: string): Promise<void> {
    if (!canDelete) return;
    if (!confirm("Delete this memory? This removes it from Hindsight and marks all related review rows as rejected. Recall-hit history is retained.")) return;
    const res = await fetch(`${BASE}/banks/${encodeURIComponent(agentSlug)}/memories/${encodeURIComponent(hindsightMemoryId)}`, { method: "DELETE" });
    if (res.ok) await loadStats();
    else alert(`Delete failed: ${res.status}`);
  }

  const memoryOn = status?.memoryEnabled === true;
  // When MemoryTab is used in a per-user context (userTag set, e.g. on the
  // Digital Twin page), the bank-level enable/disable toggle is the WRONG
  // surface to expose:
  //   - It controls the agent bank globally — toggling off would disable
  //     memory collection for every user in the digital-twin bank, not
  //     just the current user.
  //   - The per-user opt-in is `users.digitalTwinEnabled`, surfaced by the
  //     DigitalTwinSection banner that sits above this component on the
  //     Digital Twin page.
  // So we suppress the toggle row entirely when userTag is set, and assume
  // memory is "always on" for the personal view (the bank is enabled at the
  // org level; we don't show its state per-user).
  const isPerUserView = Boolean(userTag);
  const effectiveMemoryOn = isPerUserView ? true : memoryOn;

  return (
    // Wrapped in proper outer padding so cards don't butt against the
    // right column's edges. Matches the rhythm of other tabs (RunHistory,
    // Contributors) which use p-4.
    <div className="space-y-4 p-4">
      {/* Enrolment toggle — hidden in per-user view (Digital Twin), where
          the toggle would be misleading + dangerous to expose. Restyled
          with xyne tokens so it harmonises with the V3 detail surface. */}
      {!isPerUserView && (
        <div
          className={`flex flex-wrap items-center gap-3 rounded-xl border p-4 ${
            memoryOn
              ? "border-xyne-success-fg/30 bg-xyne-success-bg/40"
              : "border-xyne-border-subtle bg-xyne-surface-subtle"
          }`}
        >
          <div className={`flex items-center justify-center w-9 h-9 rounded-full shrink-0 ${
            memoryOn
              ? "bg-xyne-success text-xyne-fg-inverse"
              : "bg-xyne-surface-sunken text-xyne-fg-tertiary"
          }`}>
            <Power size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-xyne-fg-primary">
              Memory: {statusLoading ? "…" : memoryOn ? "Enabled" : "Disabled"}
            </div>
            <div className="text-[12px] text-xyne-fg-tertiary">
              {memoryOn
                ? `${APPROVAL_LABELS[status?.memoryApprovalStrategy ?? "HUMAN_ONLY"]} · auto-enrolling new sessions`
                : "Enable to collect transcripts and route them through the review pipeline."}
            </div>
          </div>
          {/* Banner-right action cluster. Backfill + Refresh live here so
                they don't orphan their own row below the sub-nav. Disable /
                Enable is the primary action and sits last on the right. */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowBackfill(true)}
              title="Trigger batch creation for past sessions (bootstrap initial memory)"
              className="inline-flex items-center gap-1.5 rounded-full border border-xyne-border-subtle bg-xyne-surface px-3 py-1.5 text-[12px] font-medium text-xyne-fg-secondary hover:text-xyne-fg-primary hover:border-xyne-border"
            >
              <History size={12} /> Backfill
            </button>
            <button
              onClick={loadStats}
              disabled={statsLoading}
              aria-label="Refresh"
              title="Refresh stats"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-xyne-border-subtle bg-xyne-surface text-xyne-fg-tertiary hover:text-xyne-fg-primary hover:border-xyne-border disabled:opacity-50"
            >
              {statsLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            </button>
            {!statusLoading && (
              memoryOn ? (
                /* Disable — icon-only at rest, expands into a labeled pill
                     on hover (matches the bubble pattern elsewhere). Click
                     opens the styled confirm dialog rendered below. */
                <button
                  onClick={() => setShowDisableConfirm(true)}
                  disabled={toggling}
                  aria-label="Disable memory"
                  className={[
                    "group/disable inline-flex h-9 items-center justify-start rounded-full shrink-0",
                    "transition-all duration-200 ease-out",
                    "border border-xyne-error-fg/30 bg-xyne-surface text-xyne-error-fg",
                    "hover:bg-xyne-error-bg hover:border-xyne-error-fg/50",
                    "disabled:opacity-50",
                  ].join(" ")}
                >
                  <span className="w-9 h-9 flex items-center justify-center shrink-0">
                    {toggling ? <Loader2 size={13} className="animate-spin" /> : <Power size={14} />}
                  </span>
                  <span className="max-w-0 overflow-hidden whitespace-nowrap text-[12px] font-medium transition-[max-width,padding] duration-200 ease-out group-hover/disable:max-w-[100px] group-hover/disable:pr-3 group-focus-visible/disable:max-w-[100px] group-focus-visible/disable:pr-3">
                    Disable
                  </span>
                </button>
              ) : (
                <button
                  onClick={() => toggleMemory(true)}
                  disabled={toggling}
                  className="inline-flex items-center gap-1.5 rounded-full bg-xyne-success px-4 py-1.5 text-[12px] font-medium text-xyne-fg-inverse hover:bg-xyne-success-fg disabled:opacity-50"
                >
                  {toggling ? <Loader2 size={11} className="animate-spin" /> : <Power size={12} />}
                  Enable memory
                </button>
              )
            )}
          </div>
        </div>
      )}

      {/* Styled disable-memory confirm — replaces the browser-native
            confirm() popup. Lightweight overlay using V3 tokens; matches
            ConfirmDialog elsewhere in spirit without an extra import. */}
      {showDisableConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowDisableConfirm(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-xyne-border bg-xyne-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[14px] font-semibold text-xyne-fg-primary">
              Disable memory?
            </h3>
            <p className="mt-1.5 text-[12px] leading-relaxed text-xyne-fg-tertiary">
              Existing memories stay in the provider, but new sessions for this agent won&apos;t be enrolled going forward. You can re-enable any time.
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowDisableConfirm(false)}
                className="rounded-lg border border-xyne-border bg-xyne-surface px-3 py-1.5 text-[12px] font-medium text-xyne-fg-secondary hover:bg-xyne-surface-subtle"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowDisableConfirm(false);
                  void toggleMemory(false);
                }}
                disabled={toggling}
                className="rounded-lg bg-xyne-error px-3 py-1.5 text-[12px] font-medium text-xyne-fg-inverse hover:bg-xyne-error-fg disabled:opacity-50"
              >
                Disable
              </button>
            </div>
          </div>
        </div>
      )}

      {/* When disabled, hide all sub-views and stats. The toggle above is the
          only thing the admin should interact with. In per-user view we
          always show sub-views (memory is conceptually always-on for the
          personal Twin — the user's own opt-in is handled by DigitalTwinSection). */}
      {!effectiveMemoryOn && !statusLoading && (
        <div className="rounded-xl border border-dashed border-xyne-border-subtle py-12 text-center text-[13px] text-xyne-fg-tertiary">
          Enable memory above to see stats, pending review batches, and recall hot lists.
        </div>
      )}

      {effectiveMemoryOn && (
      <>
      {/* Stats summary */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Total" value={stats?.totals.approved ?? "—"} />
        <StatCard label="Pending" value={stats?.totals.pending ?? "—"} highlight={(stats?.totals.pending ?? 0) > 0} />
        <StatCard label={`Recalls ${statsRange}`} value={stats?.totals.recallsInRange ?? "—"} />
      </div>

      {/* Sub-nav — bubble strip. Backfill + Refresh moved up into the
            status banner; the only contextual action left here is the
            `last 7d` range filter, which renders alongside the bubbles
            only when Hot is the active sub-view. No more orphan row. */}
      <div className="flex flex-wrap items-center gap-2 pt-2">
        <SubNavBtn active={sub === "all"} onClick={() => setSub("all")} icon={<Brain size={14} />}>All</SubNavBtn>
        <SubNavBtn active={sub === "hot"} onClick={() => setSub("hot")} icon={<Flame size={14} />}>Hot</SubNavBtn>
        <SubNavBtn active={sub === "pending"} onClick={() => setSub("pending")} icon={<Inbox size={14} />}>Batches</SubNavBtn>
        <SubNavBtn active={sub === "candidates"} onClick={() => setSub("candidates")} icon={<Sparkles size={14} />}>Candidates</SubNavBtn>
        <SubNavBtn active={sub === "graph"} onClick={() => setSub("graph")} icon={<Network size={14} />}>Graph</SubNavBtn>
        <SubNavBtn active={sub === "tester"} onClick={() => setSub("tester")} icon={<FlaskConical size={14} />}>Recall Tester</SubNavBtn>

        {sub === "hot" && (
          <select
            value={statsRange}
            onChange={(e) => setStatsRange(e.target.value as "7d" | "30d" | "90d")}
            className="ml-auto rounded-full border border-xyne-border-subtle bg-xyne-surface px-3 py-1.5 text-[12px] text-xyne-fg-secondary focus:outline-none focus:border-xyne-border-focus"
          >
            <option value="7d">last 7d</option>
            <option value="30d">last 30d</option>
            <option value="90d">last 90d</option>
          </select>
        )}
      </div>

      {sub === "all" && <AllMemories agentSlug={agentSlug} userTag={userTag} canDelete={canDelete} onDelete={handleDelete} />}
      {sub === "hot" && <HotMemories hot={stats?.hot ?? []} loading={statsLoading} canDelete={canDelete} onDelete={handleDelete} />}
      {sub === "pending" && <PendingBatches agentSlug={agentSlug} onChange={loadStats} />}
      {sub === "candidates" && <CandidatesView agentSlug={agentSlug} onChange={loadStats} />}
      {sub === "graph" && <GraphView agentSlug={agentSlug} userTag={userTag} />}
      {sub === "tester" && <RecallTester agentSlug={agentSlug} userTag={userTag} />}
      </>
      )}

      {showBackfill && (
        <BackfillModal
          agentSlug={agentSlug}
          onClose={() => setShowBackfill(false)}
          onDone={() => {
            setShowBackfill(false);
            setSub("pending");
            loadStats();
          }}
        />
      )}
    </div>
  );
}

interface BackfillResult {
  daysProcessed: number;
  daysWithTranscripts: number;
  batchesCreated: number;
  sessionsIncluded: number;
  sessionsSkipped: number;
  skippedDays: string[];
  from: string;
  to: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function BackfillModal({
  agentSlug,
  onClose,
  onDone,
}: {
  agentSlug: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [from, setFrom] = useState(daysAgoIso(7));
  const [to, setTo] = useState(todayIso());
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BackfillResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  const spanDays =
    Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs >= fromMs
      ? Math.floor((toMs - fromMs) / 86_400_000) + 1
      : 0;
  const rangeInvalid = !Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs || spanDays > 30;

  async function run(): Promise<void> {
    setRunning(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch(`/claw/api/v1/memory/banks/${encodeURIComponent(agentSlug)}/backfill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setErr(data.error ?? `Backfill failed: ${res.status}`);
      } else {
        setResult(data.data);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-xyne-border bg-xyne-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <History size={16} className="text-xyne-fg-secondary" />
          <h3 className="text-[14px] font-semibold text-xyne-fg-primary">
            Backfill memory from past sessions
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded-md p-1 text-xyne-fg-tertiary hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <p className="mb-4 text-[12px] leading-relaxed text-xyne-fg-tertiary">
          Runs the batch-creation cron across a date range of transcripts for{" "}
          <span className="font-mono text-xyne-fg-secondary">{agentSlug}</span>.
          Creates pending batches you can approve in the Pending Review tab.{" "}
          <strong className="font-semibold text-xyne-fg-secondary">Idempotent:</strong>{" "}
          existing approved or rejected batches are preserved. Days without
          transcripts on disk (older than the 14-day retention window) are
          silently skipped.
        </p>

        {!result && (
          <>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-xyne-fg-tertiary">
              Date range
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                disabled={running}
                max={to || todayIso()}
                className="rounded-lg border border-xyne-border bg-xyne-surface-subtle px-2.5 py-1.5 text-[13px] text-xyne-fg-primary focus:bg-xyne-surface focus:border-xyne-border-focus focus:shadow-[var(--comp-focus-ring)] focus:outline-none disabled:opacity-50"
              />
              <span className="text-xyne-fg-tertiary">→</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                disabled={running}
                min={from}
                max={todayIso()}
                className="rounded-lg border border-xyne-border bg-xyne-surface-subtle px-2.5 py-1.5 text-[13px] text-xyne-fg-primary focus:bg-xyne-surface focus:border-xyne-border-focus focus:shadow-[var(--comp-focus-ring)] focus:outline-none disabled:opacity-50"
              />
              <span className={`text-[12px] ${rangeInvalid ? "text-xyne-error-fg" : "text-xyne-fg-tertiary"}`}>
                {rangeInvalid
                  ? spanDays > 30
                    ? "max 30 days"
                    : "invalid range"
                  : `${spanDays} day${spanDays === 1 ? "" : "s"}`}
              </span>
            </div>

            {/* Date-range shortcut presets — pill row sits beneath the
                inputs and lets the user pick a common window in one click. */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {[1, 3, 7, 14, 30].map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={running}
                  onClick={() => {
                    setTo(todayIso());
                    setFrom(daysAgoIso(n - 1));
                  }}
                  className="rounded-full border border-xyne-border-subtle bg-xyne-surface px-2.5 py-1 text-[11px] font-medium text-xyne-fg-secondary transition-colors hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary hover:border-xyne-border disabled:opacity-50"
                >
                  last {n}d
                </button>
              ))}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                onClick={run}
                disabled={running || rangeInvalid}
                className="inline-flex items-center gap-1.5 rounded-full bg-xyne-fg-primary px-4 py-1.5 text-[12px] font-medium text-xyne-fg-inverse hover:bg-xyne-fg-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {running ? <Loader2 size={12} className="animate-spin" /> : <History size={12} />}
                {running ? "Running…" : "Start backfill"}
              </button>
            </div>
          </>
        )}

        {err && (
          <div className="mt-3 rounded-lg border border-xyne-error-fg/30 bg-xyne-error-bg p-2.5 text-[12px] text-xyne-error-fg">
            {err}
          </div>
        )}

        {result && (
          <div className="mt-3 space-y-3 text-[12px] text-xyne-fg-secondary">
            <div className="rounded-lg border border-xyne-success-fg/30 bg-xyne-success-bg p-3 text-xyne-success-fg font-medium">
              ✅ Backfill complete · {result.from} → {result.to}
            </div>
            <ul className="space-y-1 leading-relaxed">
              <li>Days processed: <strong className="font-semibold text-xyne-fg-primary">{result.daysProcessed}</strong></li>
              <li>Days with transcripts: <strong className="font-semibold text-xyne-fg-primary">{result.daysWithTranscripts}</strong></li>
              <li>Batches created: <strong className="font-semibold text-xyne-fg-primary">{result.batchesCreated}</strong></li>
              <li>Sessions included for review: <strong className="font-semibold text-xyne-fg-primary">{result.sessionsIncluded}</strong></li>
              <li>Sessions skipped by heuristic: <strong className="font-semibold text-xyne-fg-primary">{result.sessionsSkipped}</strong></li>
              {result.skippedDays.length > 0 && (
                <li className="text-xyne-fg-tertiary">
                  No transcripts for: {result.skippedDays.slice(0, 5).join(", ")}
                  {result.skippedDays.length > 5 ? ` (+${result.skippedDays.length - 5} more)` : ""}
                </li>
              )}
            </ul>
            <div className="pt-1 flex justify-end">
              <button
                onClick={onDone}
                className="inline-flex items-center gap-1.5 rounded-full bg-xyne-fg-primary px-4 py-1.5 text-[12px] font-medium text-xyne-fg-inverse hover:bg-xyne-fg-secondary transition-colors"
              >
                Open Pending Review →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, highlight = false }: { label: string; value: number | string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${
      highlight
        ? "border-xyne-warning-fg/30 bg-xyne-warning-bg/50"
        : "border-xyne-border-subtle bg-xyne-surface-subtle"
    }`}>
      <div className="text-[10px] uppercase tracking-[0.06em] font-medium text-xyne-fg-tertiary">{label}</div>
      <div className="mt-0.5 text-[20px] font-semibold tabular-nums text-xyne-fg-primary">{value}</div>
    </div>
  );
}

// ── All Memories sub-view ────────────────────────────────────────────────

function AllMemories({ agentSlug, userTag, canDelete, onDelete }: { agentSlug: string; userTag?: string; canDelete: boolean; onDelete: (id: string) => void }) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50", status: "approved" });
      if (search.trim()) params.set("search", search.trim());
      if (userTag) params.set("userTag", userTag);
      const res = await fetch(`${BASE}/banks/${encodeURIComponent(agentSlug)}/memories?${params}`);
      const data = await res.json();
      if (data.success) {
        setMemories(data.data);
        setTotal(data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [agentSlug, search, userTag]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      {/* Centered, shorter search — sits as a single compact pill above
            the memory list rather than a full-width bar. */}
      <div className="flex justify-center pt-1">
        <div className="relative w-full max-w-[360px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-xyne-fg-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") load(); }}
            placeholder="Search memory content…"
            className="w-full rounded-full border border-xyne-border-subtle bg-xyne-surface-subtle pl-8 pr-3 py-1.5 text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-tertiary focus:bg-xyne-surface focus:border-xyne-border-focus focus:shadow-[var(--comp-focus-ring)] focus:outline-none"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-[13px] text-xyne-fg-tertiary"><Loader2 size={14} className="animate-spin mr-2" /> Loading memories…</div>
      ) : memories.length === 0 ? (
        search.trim() ? (
          <EmptyState
            icon={Search}
            title={`No memories matching "${search}"`}
            description="Try a different keyword or clear the search."
          />
        ) : (
          <EmptyState
            icon={Brain}
            title="No memories yet"
            description="Memories appear here after the curator approves them at the nightly review."
          />
        )
      ) : (
        <>
          <div className="text-xs text-zinc-500">{memories.length} of {total} memories</div>
          <CategoryLegend
            visibleCategories={
              new Set(
                memories
                  .map((m) => (m.category ?? "").toLowerCase())
                  .filter((c): c is string => !!c && c in CATEGORY_META),
              )
            }
          />
          <div className="space-y-2">
            {memories.map((m) => (
              <MemoryRow key={m.id} m={m} canDelete={canDelete} onDelete={onDelete} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MemoryRow({ m, canDelete, onDelete }: { m: Memory; canDelete: boolean; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = m.content.length > 160;
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <CategoryBadge category={m.category} />
        <HitsBadge count={m.recallHits7d} />
        <span className="text-zinc-500">created {fmtDate(m.createdAt)}</span>
        {m.lastRecalledAt && <span className="text-zinc-500">· last recalled {fmtDate(m.lastRecalledAt)}</span>}
        {canDelete && (
          <button onClick={() => onDelete(m.hindsightMemoryId)} className="ml-auto inline-flex items-center gap-1 rounded border border-red-900/60 px-1.5 py-0.5 text-red-400 hover:bg-red-950/40">
            <Trash2 size={11} /> Delete
          </button>
        )}
      </div>
      <div className="mt-1.5 text-sm text-zinc-100">
        {expanded || !isLong ? m.content : m.content.slice(0, 160) + "…"}
        {isLong && (
          <button onClick={() => setExpanded(!expanded)} className="ml-1 text-xs text-zinc-500 hover:text-zinc-100 underline">
            {expanded ? "show less" : "show more"}
          </button>
        )}
      </div>
      {m.curatorReasoning && (
        <div className="mt-2 rounded bg-zinc-800/60 px-2 py-1.5 text-xs text-zinc-500">
          <span className="font-medium">Curator:</span> {m.curatorReasoning}
          {typeof m.curatorConfidence === "number" && <span className="ml-2 text-zinc-500">(confidence {m.curatorConfidence.toFixed(2)})</span>}
        </div>
      )}
    </div>
  );
}

// ── Hot Memories sub-view ────────────────────────────────────────────────

function HotMemories({ hot, loading, canDelete, onDelete }: { hot: HotMemory[]; loading: boolean; canDelete: boolean; onDelete: (id: string) => void }) {
  if (loading) return <div className="flex items-center justify-center py-8 text-sm text-zinc-500"><Loader2 size={14} className="animate-spin mr-2" /> Loading…</div>;
  if (hot.length === 0) return (
    <EmptyState
      icon={Flame}
      title="No recall hits yet"
      description="Memories that get pulled into agent runs in the selected window will show up here, ranked by hit count."
    />
  );
  return (
    <ol className="space-y-2">
      {hot.map((h, idx) => (
        <li key={h.hindsightMemoryId} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center justify-center min-w-[20px] rounded-full bg-zinc-100 text-zinc-900 text-[10px] font-bold px-1.5 py-0.5">#{idx + 1}</span>
            <HitsBadge count={h.hits} />
            <CategoryBadge category={h.category} />
            {h.lastRecalledAt && <span className="text-zinc-500">last recalled {fmtDate(h.lastRecalledAt)}</span>}
            {h.status === "rejected" && <span className="text-rose-500">(deleted from Hindsight)</span>}
            {canDelete && h.status !== "rejected" && (
              <button onClick={() => onDelete(h.hindsightMemoryId)} className="ml-auto inline-flex items-center gap-1 rounded border border-red-900/60 px-1.5 py-0.5 text-red-400 hover:bg-red-950/40">
                <Trash2 size={11} /> Delete
              </button>
            )}
          </div>
          <div className="mt-1.5 text-sm text-zinc-100">{h.content}</div>
        </li>
      ))}
    </ol>
  );
}

// ── Pending Batches sub-view ─────────────────────────────────────────────
//
// One batch per (agent, night). Approving the batch retains its transcripts
// to the memory provider (Hindsight extracts entities + facts post-approval).
// Rejecting drops them — no provider tokens spent.

interface BatchRow {
  id: string;
  agentSlug: string;
  reviewDate: string;
  status: "pending" | "approved" | "rejected" | "partial";
  sessionIds: string[];
  approvedSessionIds: string[];
  heuristicSkipped: Array<{ sessionId: string; reason: string }> | null;
  approvalStrategy: string;
  spacesMessageId: string | null;
  createdAt: string;
  /** True while a background approve is running on the server for this batch.
   *  The list shows a "processing" badge and we poll every 5s until it flips. */
  processing?: boolean;
}

interface SessionPreview {
  sessionId: string;
  task: string;
  toolsUsed: string[];
  tokensIn: number;
  tokensOut: number;
  missing?: boolean;
}

function PendingBatches({ agentSlug, onChange }: { agentSlug: string; onChange: () => void }) {
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [actingBatchId, setActingBatchId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/claw/api/v1/memory/batches?agentSlug=${encodeURIComponent(agentSlug)}&status=pending&limit=30`);
      const data = await res.json();
      if (data.success) setBatches(data.data);
    } finally {
      setLoading(false);
    }
  }, [agentSlug]);

  useEffect(() => { load(); }, [load]);

  // Poll the list every 5s while any batch is being processed in the
  // background. The server returns 202 from POST /approve and flips
  // batch.processing back to false when the work finishes — then the batch
  // either disappears from the pending list (status→approved) or stays
  // (status→partial), and the badge clears.
  const anyProcessing = batches.some((b) => b.processing);
  useEffect(() => {
    if (!anyProcessing) return;
    const id = setInterval(() => {
      load();
      onChange();
    }, 5000);
    return () => clearInterval(id);
  }, [anyProcessing, load, onChange]);

  async function approveBatch(batchId: string, sessionIds?: string[]): Promise<void> {
    setActingBatchId(batchId);
    try {
      const res = await fetch(`/claw/api/v1/memory/batches/${batchId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sessionIds ? { sessionIds } : {}),
      });
      if (res.ok) {
        // 202 Accepted — work runs in background. Optimistically mark the
        // row processing so the polling effect kicks in immediately.
        setBatches((prev) => prev.map((b) => (b.id === batchId ? { ...b, processing: true } : b)));
        await load();
        onChange();
      } else {
        alert(`Approve failed: ${res.status}`);
      }
    } finally {
      setActingBatchId(null);
    }
  }

  async function rejectBatch(batchId: string): Promise<void> {
    if (!confirm("Reject this entire batch? No memories will be created from these sessions.")) return;
    setActingBatchId(batchId);
    try {
      const res = await fetch(`/claw/api/v1/memory/batches/${batchId}/reject`, { method: "POST" });
      if (res.ok) {
        await load();
        onChange();
      } else {
        alert(`Reject failed: ${res.status}`);
      }
    } finally {
      setActingBatchId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-zinc-500">
        <Loader2 size={14} className="animate-spin mr-2" /> Loading batches…
      </div>
    );
  }
  if (batches.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="No batches awaiting review"
        description="The nightly cron creates review batches from yesterday's sessions. Check back in the morning."
      />
    );
  }

  return (
    <div className="space-y-3">
      {batches.map((b) => (
        <BatchCard
          key={b.id}
          batch={b}
          expanded={expandedBatchId === b.id}
          acting={actingBatchId === b.id}
          onToggle={() => setExpandedBatchId(expandedBatchId === b.id ? null : b.id)}
          onApproveAll={() => approveBatch(b.id)}
          onApproveSelected={(ids) => approveBatch(b.id, ids)}
          onReject={() => rejectBatch(b.id)}
        />
      ))}
    </div>
  );
}

function BatchCard({
  batch,
  expanded,
  acting,
  onToggle,
  onApproveAll,
  onApproveSelected,
  onReject,
}: {
  batch: BatchRow;
  expanded: boolean;
  acting: boolean;
  onToggle: () => void;
  onApproveAll: () => void;
  onApproveSelected: (sessionIds: string[]) => void;
  onReject: () => void;
}) {
  const [previews, setPreviews] = useState<SessionPreview[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingPreviews, setLoadingPreviews] = useState(false);

  useEffect(() => {
    if (!expanded || previews !== null) return;
    setLoadingPreviews(true);
    fetch(`/claw/api/v1/memory/batches/${batch.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setPreviews(data.data.sessions);
          setSelected(new Set(data.data.sessions.map((s: SessionPreview) => s.sessionId)));
        }
      })
      .finally(() => setLoadingPreviews(false));
  }, [expanded, batch.id, previews]);

  const sessionCount = batch.sessionIds.length;
  const skippedCount = batch.heuristicSkipped?.length ?? 0;

  return (
    <div className="rounded-lg border border-amber-900/60 bg-amber-950/20 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-zinc-100">{batch.reviewDate}</span>
        <span className="rounded bg-amber-950/50 px-1.5 py-0.5 font-medium text-amber-300 border border-amber-800/60">
          {sessionCount} session{sessionCount === 1 ? "" : "s"} to review
        </span>
        {skippedCount > 0 && (
          <span className="text-zinc-500">· {skippedCount} skipped by heuristic</span>
        )}
        <span className="text-zinc-500">· strategy: {batch.approvalStrategy}</span>
        <button onClick={onToggle} className="ml-auto text-zinc-500 hover:text-zinc-100 underline">
          {expanded ? "collapse" : "expand"}
        </button>
      </div>

      {!expanded && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            onClick={onApproveAll}
            disabled={acting || batch.processing}
            className="rounded border border-emerald-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-950/40 disabled:opacity-50"
          >
            {acting || batch.processing ? <Loader2 size={11} className="inline animate-spin mr-1" /> : "✅ "}
            {batch.processing ? "Processing…" : "Approve all"}
          </button>
          <button
            onClick={onReject}
            disabled={acting || batch.processing}
            className="rounded border border-red-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-950/40 disabled:opacity-50"
          >
            ❌ Reject all
          </button>
          {batch.processing && (
            <span className="text-xs text-amber-400">
              Retaining {sessionCount} session{sessionCount === 1 ? "" : "s"} — keep this tab open or come back later.
            </span>
          )}
        </div>
      )}

      {expanded && (
        <div className="mt-3 space-y-2">
          {loadingPreviews && (
            <div className="flex items-center justify-center py-4 text-xs text-zinc-500">
              <Loader2 size={12} className="animate-spin mr-2" /> Loading session previews…
            </div>
          )}

          {previews && previews.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-zinc-500">
                <button
                  onClick={() => setSelected(new Set(previews.map((p) => p.sessionId)))}
                  className="hover:text-zinc-100 underline"
                >
                  Select all
                </button>
                <span>·</span>
                <button
                  onClick={() => setSelected(new Set())}
                  className="hover:text-zinc-100 underline"
                >
                  Select none
                </button>
                <span className="ml-auto text-zinc-500">{selected.size} of {previews.length} selected</span>
              </div>

              {previews.map((p) => (
                <label
                  key={p.sessionId}
                  className={`flex items-start gap-2 rounded border bg-zinc-900 p-2 text-xs cursor-pointer hover:border-zinc-700 ${selected.has(p.sessionId) ? "border-emerald-700" : "border-zinc-800"} ${p.missing ? "opacity-50" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(p.sessionId)}
                    disabled={p.missing}
                    onChange={(e) => {
                      const s = new Set(selected);
                      if (e.target.checked) s.add(p.sessionId);
                      else s.delete(p.sessionId);
                      setSelected(s);
                    }}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
                      <span className="font-mono">{p.sessionId.slice(0, 12)}…</span>
                      {p.toolsUsed.length > 0 && (
                        <span>tools: {p.toolsUsed.slice(0, 3).join(", ")}{p.toolsUsed.length > 3 ? "…" : ""}</span>
                      )}
                      {!p.missing && <span>{p.tokensIn} in / {p.tokensOut} out</span>}
                      {p.missing && <span className="text-rose-500">transcript missing</span>}
                    </div>
                    <div className="mt-0.5 text-zinc-200 line-clamp-2">{p.task}</div>
                  </div>
                </label>
              ))}
            </div>
          )}

          {batch.heuristicSkipped && batch.heuristicSkipped.length > 0 && (
            <details className="mt-2 rounded bg-zinc-800/40 p-2 text-xs">
              <summary className="cursor-pointer text-zinc-500">
                {batch.heuristicSkipped.length} sessions auto-skipped by heuristic
              </summary>
              <ul className="mt-1.5 space-y-0.5 text-[11px] text-zinc-500">
                {batch.heuristicSkipped.map((s) => (
                  <li key={s.sessionId}>
                    <span className="font-mono">{s.sessionId.slice(0, 12)}…</span> — {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              onClick={() => onApproveSelected(Array.from(selected))}
              disabled={acting || batch.processing || selected.size === 0}
              className="rounded border border-emerald-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-950/40 disabled:opacity-50"
            >
              {acting || batch.processing ? <Loader2 size={11} className="inline animate-spin mr-1" /> : "✅ "}
              {batch.processing ? "Processing…" : `Approve selected (${selected.size})`}
            </button>
            <button
              onClick={onReject}
              disabled={acting || batch.processing}
              className="rounded border border-red-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-950/40 disabled:opacity-50"
            >
              ❌ Reject all
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Candidates sub-view (curator-emitted subsystem updates) ─────────────

function CandidatesView({ agentSlug, onChange }: { agentSlug: string; onChange: () => void }) {
  const [candidates, setCandidates] = useState<PendingReview[]>([]);
  const [existing, setExisting] = useState<Map<string, Memory>>(new Map());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [revRes, memRes] = await Promise.all([
        fetch(`${BASE}/reviews?agentSlug=${encodeURIComponent(agentSlug)}&status=pending&limit=50`),
        fetch(`${BASE}/banks/${encodeURIComponent(agentSlug)}/memories?limit=200&status=approved`),
      ]);
      const rev = await revRes.json();
      const mem = await memRes.json();
      if (!rev.success) throw new Error(rev.error ?? "Failed to load candidates");
      setCandidates(rev.data ?? []);
      const map = new Map<string, Memory>();
      if (mem.success && Array.isArray(mem.data)) {
        for (const m of mem.data as Memory[]) {
          if (m.hindsightMemoryId) map.set(m.hindsightMemoryId, m);
        }
      }
      setExisting(map);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [agentSlug]);

  useEffect(() => { load(); }, [load]);

  async function decide(id: string, action: "approve" | "reject"): Promise<void> {
    try {
      const res = await fetch(`${BASE}/review/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setErr(data.error ?? `${action} failed: ${res.status}`);
        return;
      }
      await load();
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const grouped = useMemo(() => {
    const out = new Map<string, PendingReview[]>();
    for (const c of candidates) {
      const key = c.subsystem ?? "(unspecified)";
      const arr = out.get(key) ?? [];
      arr.push(c);
      out.set(key, arr);
    }
    return [...out.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [candidates]);

  return (
    <div className="space-y-3">
      {/* Local refresh button was removed — the global Refresh button in
            the sub-nav already exists and duplicating it here was
            visually noisy. Auto-reload still fires on mount + after each
            approve/reject. */}
      {candidates.length > 0 && (
        <div className="text-[12px] text-xyne-fg-tertiary">
          {candidates.length} pending candidate{candidates.length === 1 ? "" : "s"}
          {grouped.length > 0 ? ` across ${grouped.length} subsystem${grouped.length === 1 ? "" : "s"}` : ""}
        </div>
      )}

      {err && (
        <div className="rounded-lg border border-rose-800/60 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">{err}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-[13px] text-xyne-fg-tertiary"><Loader2 size={14} className="animate-spin mr-2" /> Loading candidates…</div>
      ) : candidates.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No pending candidates"
          description={
            <>
              Approve a batch in the{" "}
              <strong className="font-medium text-xyne-fg-secondary">Batches</strong>{" "}
              tab to trigger the curator.
            </>
          }
        />
      ) : (
        <div className="space-y-4">
          {grouped.map(([subsystem, items]) => (
            <div key={subsystem} className="space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="rounded border border-violet-800/60 bg-violet-950/40 px-2 py-0.5 font-medium uppercase tracking-wide text-violet-300">
                  {subsystem}
                </span>
                <span className="text-zinc-500">{items.length} candidate{items.length === 1 ? "" : "s"}</span>
              </div>
              <div className="space-y-2">
                {items.map((c) => (
                  <CandidateCard
                    key={c.id}
                    candidate={c}
                    replacedMemory={c.replacesMemoryId ? existing.get(c.replacesMemoryId) ?? null : null}
                    onApprove={() => decide(c.id, "approve")}
                    onReject={() => decide(c.id, "reject")}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CandidateCard({
  candidate,
  replacedMemory,
  onApprove,
  onReject,
}: {
  candidate: PendingReview;
  replacedMemory: Memory | null;
  onApprove: () => void;
  onReject: () => void;
}) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [showOld, setShowOld] = useState(false);

  async function go(which: "approve" | "reject"): Promise<void> {
    setBusy(which);
    try {
      if (which === "approve") await onApprove();
      else await onReject();
    } finally {
      setBusy(null);
    }
  }

  const isUpdate = candidate.action === "update";
  const isCreate = candidate.action === "create";
  const conf = candidate.curatorConfidence;
  const confTone =
    conf == null ? "text-zinc-500" : conf >= 0.85 ? "text-emerald-300" : conf >= 0.75 ? "text-amber-300" : "text-rose-300";

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {candidate.isNewSubsystem && (
          <span className="inline-flex items-center gap-1 rounded border border-amber-700 bg-amber-950/60 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300">
            <AlertTriangle size={10} /> New subsystem
          </span>
        )}
        {isCreate && !candidate.isNewSubsystem && (
          <span className="rounded border border-emerald-800/60 bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
            Create
          </span>
        )}
        {isUpdate && (
          <span className="rounded border border-blue-800/60 bg-blue-950/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-300">
            Update
          </span>
        )}
        <span className={`text-[10px] font-mono ${confTone}`}>
          {conf == null ? "—" : `${(conf * 100).toFixed(0)}%`} conf
        </span>
        <span className="text-[10px] text-zinc-500 ml-auto">{fmtDate(candidate.createdAt)}</span>
      </div>

      {candidate.curatorReasoning && (
        <div className="mb-2 rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-xs text-zinc-400 italic">
          {candidate.curatorReasoning}
        </div>
      )}

      <div className="mb-2">
        <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Proposed memory</div>
        <pre className="whitespace-pre-wrap break-words rounded border border-zinc-800 bg-zinc-900/40 p-2.5 text-xs text-zinc-200 font-sans leading-relaxed">
          {candidate.content}
        </pre>
      </div>

      {isUpdate && replacedMemory && (
        <div className="mb-2">
          <button
            onClick={() => setShowOld((v) => !v)}
            className="text-[11px] text-zinc-400 hover:text-zinc-200 underline"
          >
            {showOld ? "Hide" : "Show"} current memory being replaced
          </button>
          {showOld && (
            <pre className="mt-1 whitespace-pre-wrap break-words rounded border border-zinc-800 bg-zinc-900/20 p-2.5 text-xs text-zinc-500 font-sans leading-relaxed">
              {replacedMemory.content}
            </pre>
          )}
        </div>
      )}

      {isUpdate && !replacedMemory && candidate.replacesMemoryId && (
        <div className="mb-2 text-[11px] text-zinc-500">
          Replaces memory <code className="text-zinc-400">{candidate.replacesMemoryId.slice(0, 10)}…</code> (not loaded — refresh)
        </div>
      )}

      {candidate.sessionId && (
        <div className="text-[10px] text-zinc-500 mb-2">
          From session <code className="text-zinc-400">{candidate.sessionId.slice(0, 10)}…</code>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={() => go("approve")}
          disabled={busy !== null}
          className="inline-flex items-center gap-1 rounded-lg border border-emerald-800/60 bg-emerald-950/40 px-3 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-50"
        >
          {busy === "approve" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Approve
        </button>
        <button
          onClick={() => go("reject")}
          disabled={busy !== null}
          className="inline-flex items-center gap-1 rounded-lg border border-rose-800/60 bg-rose-950/40 px-3 py-1 text-xs font-medium text-rose-300 hover:bg-rose-900/40 disabled:opacity-50"
        >
          {busy === "reject" ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />} Reject
        </button>
      </div>
    </div>
  );
}

// ── Graph sub-view (subsystem-level graph) ─────────────────────────────
//
// Shows the agent's CURATED subsystems as nodes (not Hindsight's raw
// entities). Edges connect subsystems that share contributing sessions —
// i.e., the same agent_runs session produced memories in both subsystems.
//
// Much more meaningful than the entity graph: every node is something the
// admin explicitly approved, edges reflect cross-subsystem investigations.

interface SubsystemNode {
  name: string;
  memoryCount: number;
  sessionCount: number;
  sampleContent: string;
  lastUpdated: string | null;
}
interface SubsystemEdge {
  source: string;
  target: string;
  sharedSessions: number;
}

const NODE_WIDTH = 220;
const NODE_HEIGHT = 88;

function layoutSubsystems(subsystems: SubsystemNode[], edges: SubsystemEdge[]): RFNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 120, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  subsystems.forEach((s) => g.setNode(s.name, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((e) => {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  });
  dagre.layout(g);

  // Scale memory-count to a 0-1 saturation. Single-memory subsystems are
  // dim; ones with many memories are vivid. Solely visual cue, not a value
  // judgement.
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
            <div style={{ fontWeight: 600, fontSize: 13, color: "rgb(228,228,231)" }}>{s.name}</div>
            <div style={{ fontSize: 10, color: "rgb(161,161,170)", marginTop: 2 }}>
              {s.memoryCount} {s.memoryCount === 1 ? "memory" : "memories"} · {s.sessionCount}{" "}
              {s.sessionCount === 1 ? "session" : "sessions"}
            </div>
            <div
              style={{
                fontSize: 10,
                color: "rgb(113,113,122)",
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

function makeSubsystemEdges(edges: SubsystemEdge[]): RFEdge[] {
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

function GraphView({ agentSlug, userTag }: { agentSlug: string; userTag?: string }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [raw, setRaw] = useState<{ subsystems: SubsystemNode[]; edges: SubsystemEdge[] }>({
    subsystems: [],
    edges: [],
  });
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge>([]);
  const [selectedSubsystem, setSelectedSubsystem] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const tagQs = userTag ? `?userTag=${encodeURIComponent(userTag)}` : "";
      const res = await fetch(`${BASE}/banks/${encodeURIComponent(agentSlug)}/subsystem-graph${tagQs}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "Failed to load subsystem graph");
      setRaw({ subsystems: data.data.subsystems ?? [], edges: data.data.edges ?? [] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [agentSlug, userTag]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (raw.subsystems.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }
    setNodes(layoutSubsystems(raw.subsystems, raw.edges));
    setEdges(makeSubsystemEdges(raw.edges));
  }, [raw, setNodes, setEdges]);

  const totalMemories = useMemo(
    () => raw.subsystems.reduce((sum, s) => sum + s.memoryCount, 0),
    [raw.subsystems],
  );

  return (
    <div className="space-y-3">
      {/* Stats line — restyled to xyne tokens. Hint about the edge
            semantic moves to a quieter second line so the counts read
            cleanly. Local refresh button removed (the sub-nav already
            has a global Refresh; the duplicate was visual noise). */}
      {raw.subsystems.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <div className="text-[12px] text-xyne-fg-secondary tabular-nums">
            <span className="font-medium text-xyne-fg-primary">
              {raw.subsystems.length}
            </span>{" "}
            {raw.subsystems.length === 1 ? "subsystem" : "subsystems"}
            <span className="mx-1.5 text-xyne-fg-muted">·</span>
            <span className="font-medium text-xyne-fg-primary">{totalMemories}</span>{" "}
            {totalMemories === 1 ? "memory" : "memories"}
            <span className="mx-1.5 text-xyne-fg-muted">·</span>
            <span className="font-medium text-xyne-fg-primary">{raw.edges.length}</span>{" "}
            {raw.edges.length === 1 ? "cross-link" : "cross-links"}
          </div>
          <div className="text-[11px] text-xyne-fg-tertiary">
            Edges connect subsystems touched in the same session — click a node to drill in.
          </div>
        </div>
      )}

      {err && (
        <div className="rounded-lg border border-xyne-error-fg/30 bg-xyne-error-bg px-3 py-2 text-[12px] text-xyne-error-fg">
          {err}
        </div>
      )}

      {raw.subsystems.length === 0 && !loading && !err ? (
        <EmptyState
          icon={Network}
          title="No subsystems yet"
          description={
            <>
              Approve some memory candidates in the{" "}
              <strong className="font-medium text-xyne-fg-secondary">Candidates</strong>{" "}
              tab to start building the bank.
            </>
          }
        />
      ) : raw.subsystems.length === 1 ? (
        <>
          <div className="rounded-lg border border-xyne-warning-fg/30 bg-xyne-warning-bg/40 px-3 py-2 text-[12px] text-xyne-warning-fg">
            Only one subsystem — no cross-links yet. Approve memories in different subsystems from
            sessions that share work to see this graph come alive.
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950" style={{ height: 600 }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={(_, node) => setSelectedSubsystem(node.id)}
              fitView
              fitViewOptions={{ padding: 0.3, maxZoom: 1.2 }}
              minZoom={0.3}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
              colorMode="dark"
            >
              <Background gap={20} size={1} color="rgba(82,82,91,0.3)" />
              <Controls className="!bg-zinc-900 !border-zinc-700" />
            </ReactFlow>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950" style={{ height: 600 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={(_, node) => setSelectedSubsystem(node.id)}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.2}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
            colorMode="dark"
          >
            <Background gap={20} size={1} color="rgba(82,82,91,0.3)" />
            <Controls className="!bg-zinc-900 !border-zinc-700" />
            <MiniMap
              nodeColor={(n) => (n.style?.background as string) ?? "rgba(99,102,241,0.3)"}
              maskColor="rgba(0,0,0,0.6)"
              className="!bg-zinc-900 !border-zinc-700"
            />
          </ReactFlow>
        </div>
      )}

      {selectedSubsystem && (
        <SubsystemMemoriesPanel
          agentSlug={agentSlug}
          userTag={userTag}
          subsystem={selectedSubsystem}
          onClose={() => setSelectedSubsystem(null)}
        />
      )}
    </div>
  );
}

function SubsystemMemoriesPanel({
  agentSlug,
  userTag,
  subsystem,
  onClose,
}: {
  agentSlug: string;
  userTag?: string;
  subsystem: string;
  onClose: () => void;
}) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams({ limit: "200", subsystem });
      if (userTag) params.set("userTag", userTag);
      const res = await fetch(`${BASE}/banks/${encodeURIComponent(agentSlug)}/memories?${params}`);
      const data = await res.json();
      if (data.success) setMemories(data.data);
      else setErr(data.error ?? "Failed to load memories");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [agentSlug, userTag, subsystem]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [subsystem]);

  return (
    <div ref={panelRef} className="rounded-xl border border-indigo-800/60 bg-zinc-950">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <span className="text-xs uppercase tracking-wide text-zinc-500">Subsystem</span>
        <span className="font-mono text-sm font-semibold text-indigo-300">{subsystem}</span>
        <span className="text-xs text-zinc-500">· {memories.length} {memories.length === 1 ? "memory" : "memories"}</span>
        <button
          onClick={onClose}
          className="ml-auto rounded p-1 text-zinc-500 hover:bg-zinc-800"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>
      <div className="space-y-2 p-3">
        {loading && <div className="flex items-center gap-2 py-4 text-sm text-zinc-500"><Loader2 size={13} className="animate-spin" /> Loading…</div>}
        {err && <div className="rounded border border-rose-800/60 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">{err}</div>}
        {!loading && !err && memories.length === 0 && (
          <div className="rounded-xl border border-dashed border-zinc-800 py-8 text-center text-sm text-zinc-500">
            No memories tagged <span className="font-mono">subsystem:{subsystem}</span>
          </div>
        )}
        {memories.map((m) => (
          <MemoryRow key={m.id} m={m} canDelete={false} onDelete={() => {}} />
        ))}
      </div>
    </div>
  );
}

// ── Recall Tester sub-view ───────────────────────────────────────────────

function RecallTester({ agentSlug, userTag }: { agentSlug: string; userTag?: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RecallResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(): Promise<void> {
    if (!query.trim()) return;
    setLoading(true);
    setErr(null);
    setResults(null);
    try {
      // The digital-twin recall endpoint forces user-scope from the
      // requester's x-user-id server-side, so we don't need to send
      // scope/userId from here. userTag is also kept on the query string
      // for parity with other bank routes (the backend ignores it on
      // recall — it always uses x-user-id — but harmless to include).
      const tagQs = userTag ? `?userTag=${encodeURIComponent(userTag)}` : "";
      const res = await fetch(`${BASE}/banks/${encodeURIComponent(agentSlug)}/recall${tagQs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim(), budget: "low" }),
      });
      const data = await res.json();
      if (data.success) setResults(data.data.memories);
      else setErr(data.error ?? "Recall failed");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Query card — restyled to xyne tokens. Textarea is the focal
            point with the helper text moved BELOW the action row so the
            input + Test recall button read as one unit. */}
      <div className="rounded-xl border border-xyne-border-subtle bg-xyne-surface-subtle p-4">
        <label className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-xyne-fg-tertiary mb-1.5">
          Query
        </label>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="What would the agent be doing? e.g. 'help me debug a flaky test in the payments service'"
          rows={2}
          className="w-full resize-none rounded-lg border border-xyne-border bg-xyne-surface px-3 py-2 text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-tertiary focus:border-xyne-border-focus focus:shadow-[var(--comp-focus-ring)] focus:outline-none"
        />
        <div className="mt-3 flex items-center justify-end">
          <button
            onClick={run}
            disabled={loading || !query.trim()}
            className="inline-flex items-center gap-1.5 rounded-full bg-xyne-fg-primary px-4 py-1.5 text-[12px] font-medium text-xyne-fg-inverse transition-colors hover:bg-xyne-fg-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <FlaskConical size={12} />}
            Test recall
          </button>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-xyne-fg-tertiary">
          Read-only Hindsight query — it doesn&apos;t affect hot-memory counts. All memory is agent-wide, so no scope filter is needed.
        </p>
      </div>

      {err && (
        <div className="rounded-lg border border-xyne-error-fg/30 bg-xyne-error-bg p-2.5 text-[12px] text-xyne-error-fg">
          {err}
        </div>
      )}

      {results !== null && (
        results.length === 0
          ? (
              <EmptyState
                icon={FlaskConical}
                title="No matches"
                description="Hindsight returned no memories for this query. Try rephrasing, or run a Backfill if the bank is still empty."
              />
            )
          : (
              <div className="space-y-2">
                <div className="text-[12px] text-xyne-fg-tertiary">
                  {results.length} result{results.length === 1 ? "" : "s"}
                </div>
                {results.map((r, i) => (
                  <div
                    key={r.id ?? i}
                    className="rounded-xl border border-xyne-border-subtle bg-xyne-surface p-3"
                  >
                    <div className="flex items-center gap-2 text-[11px] text-xyne-fg-tertiary">
                      <span className="font-semibold text-xyne-fg-secondary">#{i + 1}</span>
                      {r.fact_type && (
                        <span className="rounded-full border border-xyne-border-subtle bg-xyne-surface-subtle px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.05em]">
                          {r.fact_type}
                        </span>
                      )}
                      {r.id && (
                        <span className="font-mono text-[10px] text-xyne-fg-muted">
                          {r.id.slice(0, 12)}…
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 text-[13px] leading-relaxed text-xyne-fg-primary">
                      {r.text}
                    </div>
                  </div>
                ))}
              </div>
            )
      )}
    </div>
  );
}
