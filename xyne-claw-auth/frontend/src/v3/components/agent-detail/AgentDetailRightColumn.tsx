import { useCallback, useEffect, useState } from "react";
import {
  ClockIcon,
  UsersThreeIcon,
  BrainIcon,
  CalendarIcon,
  FlowArrowIcon,
  PlugsConnectedIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckCircleIcon,
  WarningCircleIcon,
  CircleDashedIcon,
  CpuIcon,
  CopyIcon,
} from "@phosphor-icons/react";
import type { Agent } from "../../../lib/types";
import type { ScheduledJob } from "../../../lib/types";
import type { ChainWorkflow, DashboardAgentRow, CloneRequestItem } from "../../../lib/api";
import {
  requestWorkflowGlobal,
  listIncomingCloneRequests,
  approveCloneRequest,
  rejectCloneRequest,
} from "../../../lib/api";
import { withAdminRequestAlert } from "../../../lib/admin-request-notice";
import type { AgentPermissions } from "../../lib/agentPermissions";
import { useSnackbar } from "../ui/Snackbar";
import { RunHistoryTab } from "./tabs/RunHistoryTab";
import { ContributorsTab } from "./tabs/ContributorsTab";
import { MemoryTab } from "./tabs/MemoryTab";
import { ScheduledJobsTab } from "./tabs/ScheduledJobsTab";
import { WorkflowsTab } from "./tabs/WorkflowsTab";
import { AgentMcpTabV3 } from "./tabs/AgentMcpTabV3";
import { ProviderTabV3 } from "./tabs/ProviderTabV3";
import { CloneRequestsTab } from "./tabs/CloneRequestsTab";

// The right column is the "observe & manage" surface. Its resting state is a
// calm status dashboard ("Running well") — a health line plus a grid of cards
// that summarize the agent's activity, memory, people, connections, schedules
// and workflows. Selecting a card drops into that panel full-bleed with a back
// affordance. (The old floating bubble-rail navigation was replaced by this
// dashboard. "Model & provider" — the runtime engine — also lives here as a
// card; owners get the full provider/model editor, others a read-only note.)

export type TabId =
  | "overview"
  | "run-history"
  | "contributors"
  | "memory"
  | "scheduled-jobs"
  | "workflows"
  | "mcp"
  | "model"
  | "requests";

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

interface Props {
  agent: Agent;
  userId: string;
  permissions: AgentPermissions;
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  scheduledJobs: ScheduledJob[];
  onJobsChange: (jobs: ScheduledJob[]) => void;
  agentStats: DashboardAgentRow | null;
  /** People with explicit access (excludes the implicit owner). */
  shareCount: number;
  workflows: ChainWorkflow[];
  workflowsLoading: boolean;
  onCreateWorkflow: () => void;
  onEditWorkflow: (w: ChainWorkflow) => void;
  onDeleteWorkflow: (w: ChainWorkflow) => void;
}

interface CardDef {
  id: Exclude<TabId, "overview">;
  label: string;
  /** One-line status shown under the label. */
  status: string;
  icon: React.ComponentType<{ size?: number; weight?: "regular" | "fill" | "bold" }>;
  /** Optional count notch, top-right. */
  badge?: number;
  /** Hidden from the dashboard grid unless true (still reachable if active). */
  show: boolean;
}

export function AgentDetailRightColumn({
  agent,
  userId,
  permissions,
  activeTab,
  onTabChange,
  scheduledJobs,
  onJobsChange,
  agentStats,
  shareCount,
  workflows,
  workflowsLoading,
  onCreateWorkflow,
  onEditWorkflow,
  onDeleteWorkflow,
}: Props) {
  const runs = agentStats?.totalRuns ?? 0;
  const completed = agentStats?.completedRuns ?? 0;
  const failed = agentStats?.failedRuns ?? 0;

  // ── Pending clone requests (owner inbox) ──────────────────────────
  // Only the real owner reviews clone requests for this agent. We fetch here so
  // the dashboard card badge and the Requests panel stay in sync (single source
  // of truth), mirroring the Spaces Approve/Decline DM — resolving in either
  // place resolves everywhere.
  const isActualOwner = !!userId && agent.ownerUserId === userId;
  const { show: showSnackbar } = useSnackbar();
  const [cloneRequests, setCloneRequests] = useState<CloneRequestItem[]>([]);
  const [cloneBusyId, setCloneBusyId] = useState<string | null>(null);
  const [cloneLoading, setCloneLoading] = useState(false);

  const loadCloneRequests = useCallback(async () => {
    if (!isActualOwner) {
      setCloneRequests([]);
      return;
    }
    setCloneLoading(true);
    try {
      const all = await listIncomingCloneRequests(userId);
      setCloneRequests(all.filter((r) => r.agentId === agent.id && r.status === "pending"));
    } catch {
      // Non-fatal — leave the list as-is.
    } finally {
      setCloneLoading(false);
    }
  }, [isActualOwner, userId, agent.id]);

  useEffect(() => {
    void loadCloneRequests();
  }, [loadCloneRequests]);

  const resolveCloneRequest = useCallback(
    async (req: CloneRequestItem, decision: "approve" | "reject") => {
      if (cloneBusyId) return;
      setCloneBusyId(req.id);
      const who = req.requesterName || req.requesterEmail || "the requester";
      try {
        if (decision === "approve") {
          await approveCloneRequest(req.id, userId);
          showSnackbar({ variant: "success", title: `Clone approved for ${who}` });
        } else {
          await rejectCloneRequest(req.id, userId);
          showSnackbar({ variant: "info", title: `Clone request from ${who} declined` });
        }
        setCloneRequests((prev) => prev.filter((r) => r.id !== req.id));
      } catch (err) {
        showSnackbar({
          variant: "error",
          title: decision === "approve" ? "Approve failed" : "Decline failed",
          description: err instanceof Error ? err.message : undefined,
        });
      } finally {
        setCloneBusyId(null);
      }
    },
    [cloneBusyId, userId, showSnackbar],
  );

  // Health verdict drives the dashboard headline + status glyph.
  const health: { label: string; tone: "ok" | "warn" | "idle" } =
    failed > 0
      ? { label: "Needs a look", tone: "warn" }
      : runs > 0
        ? { label: "Running well", tone: "ok" }
        : { label: "Not run yet", tone: "idle" };

  const summary =
    runs > 0
      ? `Ran ${fmtNum(runs)}×${completed ? ` · ${fmtNum(completed)} succeeded` : ""}${failed ? ` · ${fmtNum(failed)} failed` : ""}.`
      : "This agent hasn't been used yet — it'll show activity here once it runs.";

  const peopleStatus = shareCount > 0 ? `You + ${shareCount} ${shareCount === 1 ? "person" : "people"}` : "Just you";

  const cards: CardDef[] = [
    {
      id: "model",
      label: "Model & provider",
      status: "The engine that runs every reply",
      icon: CpuIcon,
      show: true,
    },
    {
      id: "run-history",
      label: "Activity",
      status: runs > 0 ? `${fmtNum(runs)} runs` : "No runs yet",
      icon: ClockIcon,
      badge: runs || undefined,
      show: true,
    },
    {
      id: "memory",
      label: "Memory",
      status: "Long-term memory",
      icon: BrainIcon,
      show: true,
    },
    {
      id: "contributors",
      label: "People",
      status: peopleStatus,
      icon: UsersThreeIcon,
      show: true,
    },
    {
      id: "mcp",
      label: "Connections",
      status: "MCP servers",
      icon: PlugsConnectedIcon,
      // Per-agent MCP connections are an editor capability.
      show: permissions.canEdit,
    },
    {
      id: "scheduled-jobs",
      label: "Scheduled",
      status: scheduledJobs.length > 0 ? `${scheduledJobs.length} scheduled` : "No schedules",
      icon: CalendarIcon,
      badge: scheduledJobs.length || undefined,
      show: true,
    },
    {
      id: "workflows",
      label: "Workflows",
      status: workflows.length > 0 ? `${workflows.length} ${workflows.length === 1 ? "workflow" : "workflows"}` : "Appears when used",
      icon: FlowArrowIcon,
      badge: workflows.length || undefined,
      // Mirrors the inspo: workflows surface only once the agent is in one.
      show: workflows.length > 0,
    },
    {
      id: "requests",
      label: "Requests",
      status:
        cloneRequests.length > 0
          ? `${cloneRequests.length} pending clone ${cloneRequests.length === 1 ? "request" : "requests"}`
          : "No pending requests",
      icon: CopyIcon,
      badge: cloneRequests.length || undefined,
      // Owner-only inbox. Always visible to the owner so there's a persistent
      // place to check for clone requests — the badge appears only when some
      // are pending, and the panel shows an empty state otherwise. Kept last so
      // it sits at the end of the dashboard grid.
      show: isActualOwner,
    },
  ];

  const activeCard = cards.find((c) => c.id === activeTab);

  /* ── panel mode ─────────────────────────────────────────────────── */
  if (activeTab !== "overview" && activeCard) {
    const PanelIcon = activeCard.icon;
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Panel header — back to the dashboard + the panel's own title. */}
        <div className="flex shrink-0 items-center gap-2 border-b border-xyne-border-subtle px-4 py-3">
          <button
            type="button"
            onClick={() => onTabChange("overview")}
            className="group/back inline-flex items-center gap-1 rounded-full border border-xyne-border-subtle bg-xyne-surface px-2.5 py-1 text-[12px] font-medium text-xyne-fg-secondary transition-colors hover:border-xyne-border hover:text-xyne-fg-primary"
            aria-label="Back to overview"
          >
            <CaretLeftIcon size={13} weight="bold" />
            Overview
          </button>
          <span className="mx-1 h-4 w-px bg-xyne-border-subtle" />
          <PanelIcon size={15} />
          <span className="text-[13px] font-semibold text-xyne-fg-primary">{activeCard.label}</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {activeTab === "requests" && (
            <CloneRequestsTab
              requests={cloneRequests}
              busyId={cloneBusyId}
              loading={cloneLoading}
              onResolve={resolveCloneRequest}
            />
          )}
          {activeTab === "run-history" && <RunHistoryTab agentSlug={agent.slug} userId={userId} />}
          {activeTab === "contributors" && (
            <ContributorsTab agent={agent} userId={userId} permissions={permissions} />
          )}
          {activeTab === "memory" && <MemoryTab agentSlug={agent.slug} canDelete={permissions.canEdit} />}
          {activeTab === "scheduled-jobs" && (
            <ScheduledJobsTab jobs={scheduledJobs} onJobsChange={onJobsChange} />
          )}
          {activeTab === "workflows" && (
            <WorkflowsTab
              workflows={workflows}
              loading={workflowsLoading}
              onCreate={onCreateWorkflow}
              onEdit={onEditWorkflow}
              onDelete={onDeleteWorkflow}
              onRequestGlobal={(w) => {
                void withAdminRequestAlert(() => requestWorkflowGlobal(w.id, userId));
              }}
            />
          )}
          {activeTab === "mcp" && (
            <AgentMcpTabV3 agentSlug={agent.slug} userId={userId} canEdit={permissions.canEdit} />
          )}
          {activeTab === "model" &&
            (permissions.role === "owner" ? (
              <div className="px-4 py-4">
                <ProviderTabV3 agent={agent} userId={userId} />
              </div>
            ) : (
              <p className="px-4 py-4 text-[12px] leading-relaxed text-xyne-fg-tertiary">
                This agent runs on the workspace default model. Only the owner can change the model or provider.
              </p>
            ))}
        </div>
      </div>
    );
  }

  /* ── overview (dashboard) mode ──────────────────────────────────── */
  const HealthGlyph = health.tone === "ok" ? CheckCircleIcon : health.tone === "warn" ? WarningCircleIcon : CircleDashedIcon;
  const healthColor =
    health.tone === "ok"
      ? "text-xyne-success-fg"
      : health.tone === "warn"
        ? "text-xyne-warning-fg"
        : "text-xyne-fg-tertiary";

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[460px] flex-col gap-5 px-6 py-7">
        {/* Health headline + one-line summary. */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <HealthGlyph size={20} weight="fill" className={healthColor} />
            <span className="text-[16px] font-semibold text-xyne-fg-primary">{health.label}</span>
          </div>
          <p className="text-[13px] leading-relaxed text-xyne-fg-secondary">{summary}</p>
        </div>

        {/* Status cards — each opens its panel. */}
        <div className="grid grid-cols-2 gap-3">
          {cards
            .filter((c) => c.show)
            .map((c) => {
              const Icon = c.icon;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onTabChange(c.id)}
                  className="group/card relative flex flex-col gap-3 rounded-xl border border-xyne-border-subtle bg-xyne-surface-subtle p-4 text-left transition-all hover:border-xyne-border-strong hover:bg-xyne-surface hover:shadow-[0_4px_14px_-4px_rgba(16,24,40,0.10)]"
                >
                  <div className="flex items-start justify-between">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-xyne-surface text-xyne-fg-secondary group-hover/card:text-xyne-fg-primary transition-colors">
                      <Icon size={18} />
                    </span>
                    {c.badge !== undefined && c.badge > 0 && (
                      <span className="min-w-[20px] rounded-full bg-xyne-fg-primary px-1.5 py-0.5 text-center text-[10px] font-semibold tabular-nums text-xyne-fg-inverse">
                        {fmtNum(c.badge)}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-semibold text-xyne-fg-primary">{c.label}</span>
                    <span className="text-[11.5px] text-xyne-fg-tertiary">{c.status}</span>
                  </div>
                  <CaretRightIcon
                    size={13}
                    weight="bold"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xyne-fg-muted opacity-0 transition-opacity group-hover/card:opacity-100"
                  />
                </button>
              );
            })}
        </div>

        {/* Workflows hint when none yet — mirrors the inspo's "appears when
            used" affordance so the surface stays calm until it's relevant. */}
        {workflows.length === 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-dashed border-xyne-border-subtle px-4 py-3 text-[12px] text-xyne-fg-tertiary">
            <FlowArrowIcon size={15} />
            <span>Workflows · appears when this agent joins one</span>
            {permissions.canEdit && (
              <button
                type="button"
                onClick={() => onTabChange("workflows")}
                className="ml-auto text-[12px] font-medium text-xyne-fg-secondary hover:text-xyne-fg-primary"
              >
                Create
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
