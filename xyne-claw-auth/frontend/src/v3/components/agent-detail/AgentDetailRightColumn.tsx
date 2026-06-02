import {
  ClockIcon,
  UsersThreeIcon,
  BrainIcon,
  CalendarIcon,
  FlowArrowIcon,
  PlugsConnectedIcon,
  CpuIcon,
} from "@phosphor-icons/react";
import type { Agent } from "../../../lib/types";
import type { ScheduledJob } from "../../../lib/types";
import type { ChainWorkflow, DashboardAgentRow } from "../../../lib/api";
import { requestWorkflowGlobal } from "../../../lib/api";
import { withAdminRequestAlert } from "../../../lib/admin-request-notice";
import type { AgentPermissions } from "../../lib/agentPermissions";
import { RunHistoryTab } from "./tabs/RunHistoryTab";
import { ContributorsTab } from "./tabs/ContributorsTab";
import { MemoryTab } from "./tabs/MemoryTab";
import { ScheduledJobsTab } from "./tabs/ScheduledJobsTab";
import { WorkflowsTab } from "./tabs/WorkflowsTab";
import { AgentMcpTabV3 } from "./tabs/AgentMcpTabV3";
import { ProviderTabV3 } from "./tabs/ProviderTabV3";

// Preview panel removed for now — see ./AgentPreviewPanel.tsx (orphaned).
// The default landing tab is "run-history" so the right column shows
// real activity instead of a static recap of the form.

export type TabId =
  | "run-history"
  | "contributors"
  | "memory"
  | "scheduled-jobs"
  | "workflows"
  | "mcp"
  | "provider";

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
  onToggleJob: (job: ScheduledJob, active: boolean) => void;
  agentStats: DashboardAgentRow | null;
  workflows: ChainWorkflow[];
  workflowsLoading: boolean;
  onCreateWorkflow: () => void;
  onEditWorkflow: (w: ChainWorkflow) => void;
  onDeleteWorkflow: (w: ChainWorkflow) => void;
}

interface BubbleItem {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ size?: number; weight?: "regular" | "fill" | "bold" }>;
  /** Optional small count to render in a top-right notch on the bubble. */
  badge?: number;
}

export function AgentDetailRightColumn({
  agent,
  userId,
  permissions,
  activeTab,
  onTabChange,
  scheduledJobs,
  onToggleJob,
  agentStats,
  workflows,
  workflowsLoading,
  onCreateWorkflow,
  onEditWorkflow,
  onDeleteWorkflow,
}: Props) {
  // Bubbles in stack order, top to bottom. Run History sits at the top
  // and is the default landing tab — see AgentDetailPageV3's initial
  // activeTab.
  const bubbles: BubbleItem[] = [
    {
      id: "run-history",
      label: "Run History",
      icon: ClockIcon,
      badge: agentStats?.totalRuns,
    },
    { id: "contributors", label: "Contributors", icon: UsersThreeIcon },
    { id: "memory", label: "Memory", icon: BrainIcon },
    {
      id: "scheduled-jobs",
      label: "Scheduled Jobs",
      icon: CalendarIcon,
      badge: scheduledJobs.length || undefined,
    },
    { id: "workflows", label: "Workflows", icon: FlowArrowIcon },
    ...(permissions.canEdit
      ? [{ id: "mcp" as TabId, label: "MCPs", icon: PlugsConnectedIcon }]
      : []),
    ...(permissions.role === "owner"
      ? [{ id: "provider" as TabId, label: "Provider", icon: CpuIcon }]
      : []),
  ];

  // Header above the content area shows which tab is active. Always
  // rendered now that preview (the only header-less tab) is gone.
  const activeBubble = bubbles.find((b) => b.id === activeTab);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Content area — renders the selected tab's component. */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {activeBubble && (
          <div className="flex shrink-0 items-center gap-2 border-b border-xyne-border-subtle px-5 py-3">
            <activeBubble.icon size={14} />
            <span className="text-[13px] font-medium text-xyne-fg-primary">
              {activeBubble.label}
            </span>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {activeTab === "run-history" && (
            <RunHistoryTab agentSlug={agent.slug} userId={userId} />
          )}
          {activeTab === "contributors" && (
            <ContributorsTab agent={agent} userId={userId} permissions={permissions} />
          )}
          {activeTab === "memory" && (
            <MemoryTab agentSlug={agent.slug} canDelete={permissions.canEdit} />
          )}
          {activeTab === "scheduled-jobs" && (
            <ScheduledJobsTab jobs={scheduledJobs} onToggle={onToggleJob} />
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
          {activeTab === "provider" && <ProviderTabV3 agent={agent} />}
        </div>
      </div>

      {/* Bubble strip — vertically centered in its 10% column, right-anchored
          so each bubble can expand into a pill *leftward* on hover without
          overflowing the page edge. No border or background on the column;
          each bubble carries its own soft shadow to read as "floating chips". */}
      {/* Bubble strip — uses justify-center *with* asymmetric padding to
          bias the stack upward. The right column sits below the page
          header (Save changes / Enabled / Delete bar, ~60px tall), so
          plain `justify-center` lands lower than the viewport's vertical
          center. Extra bottom padding pulls the centered content up by
          ~half the header height, so the stack visually anchors to the
          middle of the screen. */}
      <div className="w-[10%] shrink-0 flex flex-col items-end justify-center gap-3 pt-4 pb-[140px] pr-3">
        {bubbles.map((b) => {
          const Icon = b.icon;
          const active = activeTab === b.id;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onTabChange(b.id)}
              aria-label={b.label}
              aria-pressed={active}
              className={`group/bubble relative z-10 h-12 flex items-center justify-end rounded-full transition-all duration-200 ease-out shadow-[0_2px_8px_-2px_rgba(16,24,40,0.08),0_4px_12px_-4px_rgba(16,24,40,0.06)] hover:shadow-[0_4px_14px_-2px_rgba(16,24,40,0.14),0_8px_20px_-4px_rgba(16,24,40,0.10)] ${
                active
                  ? "bg-xyne-fg-primary text-xyne-fg-inverse"
                  : "bg-xyne-surface border border-xyne-border-subtle text-xyne-fg-secondary hover:text-xyne-fg-primary hover:border-xyne-border"
              }`}
            >
              {/* Label — appears on hover, expands leftward. Anchored before
                  the icon in flex order so the icon stays at the right edge
                  and the bubble grows toward the content area. */}
              <span
                className="overflow-hidden whitespace-nowrap text-[12px] font-medium max-w-0 group-hover/bubble:max-w-[160px] group-hover/bubble:pl-4 group-hover/bubble:pr-2 group-focus-visible/bubble:max-w-[160px] group-focus-visible/bubble:pl-4 group-focus-visible/bubble:pr-2 transition-[max-width,padding] duration-200 ease-out"
              >
                {b.label}
              </span>
              {/* Icon slot — fixed 48x48 square at the right edge keeps the
                  circular silhouette at rest. */}
              <span className="w-12 h-12 flex items-center justify-center flex-shrink-0">
                <Icon size={18} weight={active ? "fill" : "regular"} />
              </span>
              {b.badge !== undefined && b.badge > 0 && (
                <span
                  className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-medium tabular-nums flex items-center justify-center border-2 ${
                    active
                      ? "bg-xyne-fg-inverse text-xyne-fg-primary border-xyne-fg-primary"
                      : "bg-xyne-fg-primary text-xyne-fg-inverse border-xyne-surface"
                  }`}
                >
                  {fmtNum(b.badge)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
