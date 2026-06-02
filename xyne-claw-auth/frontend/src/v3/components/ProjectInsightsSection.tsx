/**
 * ProjectInsightsSection — per-project analytics embedded in the
 * Dashboard.
 *
 * Originally lived at /v3/projects as a standalone page; now mounted as
 * one section of /v3/dashboard so users have a single analytics surface.
 *
 * The time-window state (`days`) is owned by the parent Dashboard so the
 * donut, the stat cards, and the drill-down tables all respect the same
 * filter. This component receives `days` and an optional `setDays`
 * callback (used by the "Show all time" affordance in the
 * window-empty state).
 *
 * Two visual modes:
 *   • default     — donut card fills the section
 *   • drilled-in  — compact donut on the left, drill-down tables on
 *                   the right
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import {
  FolderOpenIcon,
  SpinnerGapIcon,
  ArrowsOutIcon,
  CaretDownIcon,
  CheckIcon,
  WarningCircleIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { Menu, MenuItem } from "./ui/Menu";
import {
  getProjectList,
  getProjectInsights,
  type ProjectSummary,
  type ProjectInsightsData,
  type DashboardAgentRow,
  type AdminUserActivityRow,
  type SkillUsageRow,
  type SubagentUsageRow,
} from "../../lib/api";
import {
  AgentTable,
  UnifiedUsersTable,
  SkillUsageTable,
  SubagentUsageTable,
} from "./AgentsDashboardPageV3";
import { ProjectsDonut, type DonutMetric } from "./ProjectsDonut";

type DaysProp = number | "all";

/**
 * Per-metric "empty in this window" copy. Distinguishes a healthy zero
 * (no failures = good) from a likely data-pipeline gap (no tokens =
 * probably not being logged).
 */
const METRIC_EMPTY_COPY: Record<
  DonutMetric,
  { title: string; body: string; tone: "healthy" | "neutral" }
> = {
  runs: {
    title: "No runs in this window",
    body: "Projects exist, but no agent runs landed in the selected time range. Try a wider window.",
    tone: "neutral",
  },
  tokens: {
    title: "No tokens recorded",
    body: "Projects exist, but no token usage was logged in this window. This usually means token accounting isn't wired up for the agents in use.",
    tone: "neutral",
  },
  failures: {
    title: "No failed runs",
    body: "Every run in this window completed successfully. Looks healthy.",
    tone: "healthy",
  },
  users: {
    title: "No users recorded",
    body: "Projects exist, but no user activity was attributed in this window.",
    tone: "neutral",
  },
};

/** Rendered inside the donut card when every project has 0 for the
 *  chosen metric. The donut itself would just be blank — this turns the
 *  dead space into a friendly message. */
function MetricEmptyState({
  metric,
  daysLabel,
  compact,
}: {
  metric: DonutMetric;
  daysLabel: string;
  compact?: boolean;
}) {
  const copy = METRIC_EMPTY_COPY[metric];
  const Icon = copy.tone === "healthy" ? CheckCircleIcon : WarningCircleIcon;
  const iconClass =
    copy.tone === "healthy" ? "text-emerald-500" : "text-xyne-fg-tertiary";
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
      <Icon size={compact ? 22 : 28} className={iconClass} />
      <div className="flex flex-col gap-1">
        <h3 className={`font-semibold text-xyne-fg-primary ${compact ? "text-[13px]" : "text-[15px]"}`}>
          {copy.title}
        </h3>
        <p className={`text-xyne-fg-tertiary ${compact ? "text-[11px]" : "text-[13px]"}`}>
          {copy.body} <span className="text-xyne-fg-muted">({daysLabel})</span>
        </p>
      </div>
    </div>
  );
}

interface Props {
  userId: string;
  /** Time window inherited from the parent (Dashboard). */
  days: DaysProp;
  /** Optional setter so the "Show all time" CTA in the window-empty
   *  state can flip the parent's filter. If omitted, the CTA is hidden. */
  setDays?: (d: DaysProp) => void;
}

export function ProjectInsightsSection({ userId, days, setDays }: Props) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [insights, setInsights] = useState<ProjectInsightsData | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  /** Project-list fetch error. Lets us tell the user "couldn't load"
   *  instead of silently rendering as if the DB really was empty. */
  const [listError, setListError] = useState<string | null>(null);
  /** True when the most recent fetch returned `[]`. Tracks "we've
   *  actually heard back from the server" so we don't flash an empty
   *  state on the initial pre-fetch render. */
  const [hasFetched, setHasFetched] = useState(false);
  /** Whether a project is currently being explored. When true, the
   *  layout switches from "default donut" to "two-column drill-down". */
  const [drilledIn, setDrilledIn] = useState(false);
  /** Which lens the donut is currently showing — see METRIC_EMPTY_COPY
   *  and ProjectsDonut for what each one means visually. */
  const [metric, setMetric] = useState<DonutMetric>("runs");
  /** Lifted out of `AgentTable` so we can render the search input
   *  inline with the "Agent Usage" section heading instead of stacked
   *  above the table on its own line. */
  const [agentSearch, setAgentSearch] = useState("");

  const handleSelectProject = (id: string) => {
    setSelectedProjectId(id);
    setDrilledIn(true);
  };

  const handleZoomOut = () => {
    setSelectedProjectId("");
    setDrilledIn(false);
  };

  // Refetch project aggregates whenever the time window changes. The
  // donut metrics (runs / tokens / users / failures) all come from this
  // single endpoint and must stay consistent with the rest of the page.
  const loadProjects = useCallback(async () => {
    setListError(null);
    try {
      const list = await getProjectList(userId, days);
      setProjects(list);
    } catch (err) {
      setProjects([]);
      setListError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setHasFetched(true);
    }
  }, [userId, days]);
  useEffect(() => { loadProjects(); }, [loadProjects]);

  useEffect(() => {
    if (!selectedProjectId) { setInsights(null); return; }
    setInsightsLoading(true);
    getProjectInsights(userId, selectedProjectId, days)
      .then(setInsights)
      .catch(() => setInsights(null))
      .finally(() => setInsightsLoading(false));
  }, [userId, selectedProjectId, days]);

  const agentTableRows: DashboardAgentRow[] = useMemo(
    () =>
      (insights?.agentUsage ?? []).map((r) => ({
        agentSlug: r.agentSlug,
        agentName: r.agentName,
        agentScope: r.agentScope,
        agentEnabled: r.agentEnabled,
        agentRegistered: false,
        ownerEmail: null,
        totalRuns: r.totalRuns,
        uniqueUsers: r.uniqueUsers,
        completedRuns: r.completedRuns,
        failedRuns: r.failedRuns,
        avgDurationMs: r.avgDurationMs,
        totalTokensIn: r.totalTokensIn,
        totalTokensOut: r.totalTokensOut,
        upCount: 0,
        downCount: 0,
        ratedCount: 0,
        negativeRate: 0,
      })),
    [insights],
  );

  const userTableRows: AdminUserActivityRow[] = useMemo(
    () =>
      (insights?.topUsers ?? []).map((u) => ({
        userId: u.userId,
        name: u.name,
        email: u.email,
        totalRuns: u.runCount,
        uniqueAgents: u.uniqueAgents,
        totalTokensIn: u.totalTokensIn,
        totalTokensOut: u.totalTokensOut,
        agents: u.agents,
      })),
    [insights],
  );

  const skillTableRows: SkillUsageRow[] = insights?.skillUsage ?? [];
  const subagentTableRows: SubagentUsageRow[] = insights?.subagentUsage ?? [];

  /** Metric-empty detection: projects exist but the chosen metric is
   *  zero everywhere. The donut would render nothing; we show a
   *  friendly "looks healthy" / "no data" message instead. */
  const metricValueOf = (p: ProjectSummary): number => {
    switch (metric) {
      case "runs":     return p.runCount;
      case "tokens":   return p.totalTokens;
      case "failures": return p.failedRuns;
      case "users":    return p.uniqueUsers;
    }
  };
  const metricTotal = projects.reduce((sum, p) => sum + metricValueOf(p), 0);
  const isMetricEmpty = projects.length > 0 && metricTotal === 0;

  /** Window-empty: server confirmed empty but only for the current
   *  time slice. The user might just be looking at too narrow a window. */
  const isWindowEmpty = hasFetched && !listError && projects.length === 0 && days !== "all";
  /** Globally empty: empty even with the "All time" filter. The DB has
   *  no project-tagged runs at all. */
  const isGloballyEmpty = hasFetched && !listError && projects.length === 0 && days === "all";

  /** Human label for the current days window — used in empty-state copy. */
  const daysLabel = days === "all" ? "all time" : `the last ${days} days`;

  /** Project picker — design-system Menu (Base UI underneath) with a
   *  themed surface, smooth open/close animation, keyboard nav,
   *  click-outside dismissal, and a checkmark on the selected item. */
  const currentProjectLabel = selectedProjectId
    ? (projects.find((p) => p.projectId === selectedProjectId)?.projectName ?? selectedProjectId)
    : "All projects";

  /** Empty spacer rendered where a checkmark would sit on unselected
   *  rows — keeps every row's text left-aligned to the same column. */
  const checkSlot = (active: boolean) =>
    active ? (
      <CheckIcon size={13} className="text-xyne-brand" />
    ) : (
      <span aria-hidden className="inline-block w-[13px]" />
    );

  const projectPicker = projects.length > 0 ? (
    <Menu
      side="bottom"
      align="end"
      trigger={(triggerProps) => (
        <button
          {...(triggerProps as React.ButtonHTMLAttributes<HTMLButtonElement>)}
          className="flex h-10 min-w-[260px] max-w-[360px] items-center gap-2 rounded-xl border border-xyne-border bg-xyne-surface px-3.5 text-[14px] font-medium text-xyne-fg-primary shadow-sm transition-colors hover:bg-xyne-surface-sunken focus:outline-none data-[popup-open]:bg-xyne-surface-sunken"
        >
          <FolderOpenIcon size={16} className="text-xyne-fg-tertiary" />
          <span className="flex-1 truncate text-left">{currentProjectLabel}</span>
          <CaretDownIcon size={14} className="text-xyne-fg-tertiary" />
        </button>
      )}
    >
      <MenuItem
        leading={checkSlot(!selectedProjectId)}
        onSelect={handleZoomOut}
        selected={!selectedProjectId}
      >
        All projects
      </MenuItem>
      {projects.map((p) => (
        <MenuItem
          key={p.projectId}
          leading={checkSlot(selectedProjectId === p.projectId)}
          onSelect={() => handleSelectProject(p.projectId)}
          selected={selectedProjectId === p.projectId}
        >
          {p.projectName ?? p.projectId}
        </MenuItem>
      ))}
    </Menu>
  ) : null;

  /** Metric toggle that sits directly above the donut. Same shape, four
   * lenses — picking a tab changes what the donut "answers". */
  const METRIC_TABS: { value: DonutMetric; label: string; tooltip: string }[] = [
    { value: "runs",     label: "Runs",     tooltip: "Share of agent runs per project" },
    { value: "tokens",   label: "Tokens",   tooltip: "Share of total tokens (in + out) per project" },
    { value: "failures", label: "Failures", tooltip: "Share of failed runs per project" },
    { value: "users",    label: "Users",    tooltip: "Distinct users per project (a person in two projects counts in both slices)" },
  ];

  const metricToggle = (
    <div
      data-id="donut-metric-toggle"
      className="inline-flex items-center gap-1 rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle p-0.5"
      role="tablist"
      aria-label="Donut metric"
    >
      {METRIC_TABS.map((tab) => {
        const isActive = metric === tab.value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            title={tab.tooltip}
            onClick={() => setMetric(tab.value)}
            className={`rounded-md px-3 py-1 text-[12px] font-medium transition-colors ${
              isActive
                ? "bg-xyne-surface text-xyne-fg-primary shadow-sm"
                : "text-xyne-fg-muted hover:text-xyne-fg-primary"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Header row: the section title (prominent — this is the
          headline of the merged Dashboard) sits left, project picker
          sits right on the same line. Caption hint appears under the
          title only when we have projects to drill into. */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-[18px] font-semibold leading-tight text-xyne-fg-primary">
            Project Overview
          </h2>
          {projects.length > 0 && (
            <p className="text-[12px] text-xyne-fg-tertiary">
              {drilledIn
                ? "Drilling into one project. Use ↗ on the donut to return to the overview."
                : "Click a slice or pick a project to drill into its details."}
            </p>
          )}
        </div>
        {projectPicker}
      </div>

      {/* Network-error state — always shown BEFORE the empty states so
          the user isn't told "no projects yet" when really the fetch
          failed. */}
      {listError && (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-red-500/30 bg-xyne-surface p-6 text-center shadow-sm">
          <WarningCircleIcon size={24} className="text-red-500" />
          <div className="flex flex-col gap-1">
            <h3 className="text-[14px] font-semibold text-xyne-fg-primary">
              Couldn't load projects
            </h3>
            <p className="text-[12px] text-xyne-fg-tertiary">{listError}</p>
          </div>
          <button
            type="button"
            onClick={loadProjects}
            className="inline-flex h-8 items-center justify-center rounded-lg border border-xyne-border bg-xyne-surface px-3 text-[12px] font-medium text-xyne-fg-primary transition-colors hover:bg-xyne-surface-sunken"
          >
            Retry
          </button>
        </div>
      )}

      {/* Window-empty: projects exist all-time but not in the current
          window. Suggest widening, don't show the same message as
          "truly empty." */}
      {isWindowEmpty && (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-xyne-border-subtle bg-xyne-surface p-6 text-center shadow-sm">
          <ClockCounterClockwiseIcon size={24} className="text-xyne-fg-tertiary" />
          <div className="flex flex-col gap-1">
            <h3 className="text-[14px] font-semibold text-xyne-fg-primary">
              No projects in {daysLabel}
            </h3>
            <p className="text-[12px] text-xyne-fg-tertiary">
              Try a wider window to see historical data.
            </p>
          </div>
          {setDays && (
            <button
              type="button"
              onClick={() => setDays("all")}
              className="inline-flex h-8 items-center justify-center rounded-lg bg-xyne-brand px-3 text-[12px] font-medium text-xyne-fg-inverse transition-colors hover:bg-xyne-brand-hover"
            >
              Show all time
            </button>
          )}
        </div>
      )}

      {/* Globally empty: DB has no project-tagged runs at all. */}
      {isGloballyEmpty && (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-xyne-border-subtle bg-xyne-surface p-6 text-center shadow-sm">
          <FolderOpenIcon size={24} className="text-xyne-fg-tertiary" />
          <div className="flex flex-col gap-1">
            <h3 className="text-[14px] font-semibold text-xyne-fg-primary">
              No projects yet
            </h3>
            <p className="text-[12px] text-xyne-fg-tertiary">
              Projects appear here once agent runs are tagged with a projectId — usually set by the integration that triggered the run (Slack, API, scheduled job).
            </p>
          </div>
        </div>
      )}

      {/* Default mode: donut card fills the section. Metric toggle
          floats centered at the top of the card; donut centers in the
          remaining space. */}
      {projects.length > 0 && !drilledIn && (
        <div
          data-id="projects-donut-default"
          className="relative flex items-center justify-center rounded-2xl border border-xyne-border-subtle bg-xyne-surface p-5 shadow-sm"
          style={{ minHeight: 440 }}
        >
          <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2">
            {metricToggle}
          </div>
          {isMetricEmpty ? (
            <MetricEmptyState metric={metric} daysLabel={daysLabel} />
          ) : (
            <ProjectsDonut
              projects={projects}
              metric={metric}
              onSelect={handleSelectProject}
              variant="hero"
            />
          )}
        </div>
      )}

      {/* Drilled-in mode: two-column — donut left (30%), tables right. */}
      {projects.length > 0 && drilledIn && (
        <div className="flex min-h-0 gap-3">
          {/* Left column — compact donut */}
          <aside className="flex w-[30%] min-w-[260px] max-w-[420px] shrink-0 flex-col gap-3">
            <div
              data-id="projects-donut-compact"
              className="relative flex flex-col gap-3 rounded-2xl border border-xyne-border-subtle bg-xyne-surface p-3 shadow-sm"
            >
              {/* Zoom-out icon — clear selection, return to overview. */}
              <button
                type="button"
                onClick={handleZoomOut}
                title="Back to overview"
                aria-label="Back to overview"
                className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-lg border border-xyne-border bg-xyne-surface text-xyne-fg-tertiary transition-colors hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
              >
                <ArrowsOutIcon size={13} />
              </button>
              <div className="flex justify-center pr-9">{metricToggle}</div>
              <div className="h-[320px]">
                {isMetricEmpty ? (
                  <MetricEmptyState metric={metric} daysLabel={daysLabel} compact />
                ) : (
                  <ProjectsDonut
                    projects={projects}
                    metric={metric}
                    selectedProjectId={selectedProjectId || undefined}
                    onSelect={handleSelectProject}
                    variant="compact"
                  />
                )}
              </div>
            </div>
          </aside>

          {/* Right column — drill-down tables for the selected project.
              px-6 keeps the table contents inset from both edges so they
              don't feel stretched to the card border. */}
          <div className="flex min-w-0 flex-1 flex-col gap-6 px-6">
            {selectedProjectId && insightsLoading && (
              <div className="flex items-center gap-2 py-4 text-[13px] text-xyne-fg-muted">
                <SpinnerGapIcon size={16} className="animate-spin" />
                Loading project insights…
              </div>
            )}

            {selectedProjectId && !insightsLoading && insights && (
              <>
                <section className="flex flex-col gap-3">
                  {/* Heading row: title left, search far right. The search
                      field is lifted out of AgentTable via controlled-search
                      props so it can live inline with the heading. */}
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-[13px] font-semibold text-xyne-fg-secondary">
                      Agent Usage
                    </h2>
                    <div className="relative w-56">
                      <MagnifyingGlassIcon
                        size={13}
                        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xyne-fg-tertiary"
                      />
                      <input
                        type="text"
                        placeholder="Search agents…"
                        value={agentSearch}
                        onChange={(e) => setAgentSearch(e.target.value)}
                        className="h-8 w-full rounded-lg border border-xyne-border bg-xyne-surface pl-7 pr-3 text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-tertiary focus:border-xyne-brand focus:outline-none focus-visible:outline-none focus:shadow-none focus:ring-0"
                        style={{ outline: "none", boxShadow: "none" }}
                      />
                    </div>
                  </div>
                  <AgentTable
                    rows={agentTableRows}
                    search={agentSearch}
                    onSearchChange={setAgentSearch}
                  />
                </section>

                <section className="flex flex-col gap-3">
                  <h2 className="text-[13px] font-semibold text-xyne-fg-secondary">Top Users</h2>
                  <UnifiedUsersTable rows={userTableRows} />
                </section>

                <section className="flex flex-col gap-3">
                  <h2 className="text-[13px] font-semibold text-xyne-fg-secondary">Skill Adoption</h2>
                  <SkillUsageTable rows={skillTableRows} />
                </section>

                <section className="flex flex-col gap-3">
                  <h2 className="text-[13px] font-semibold text-xyne-fg-secondary">Subagent Adoption</h2>
                  <SubagentUsageTable rows={subagentTableRows} />
                </section>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
