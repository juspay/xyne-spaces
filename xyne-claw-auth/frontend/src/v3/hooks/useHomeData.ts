import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../hooks/useAuth";
import { useAdminStatus } from "./useAdminStatus";
import type {
  AgentLight,
  McpServer,
  Gateway,
  UserConnection,
  ScheduledJob,
} from "../../lib/types";
import {
  type Skill,
  type AgentRun,
  type AgentRunLight,
  type UserDashboardData,
  type UserDashboardAgentRow,
  type ChainWorkflow,
  type Approval,
  type CloneRequestItem,
  type AgentDelegationPendingRequest,
  type DigitalTwinStatus,
  type MemoryBankStats,
  ApiError,
  listAgents,
  listSkills,
  listServers,
  listGateways,
  listRuns,
  listRunsLight,
  getUserDashboard,
  listChainWorkflows,
  listPendingApprovals,
  listIncomingCloneRequests,
  listPendingDelegationRequestsForMe,
  getDigitalTwinStatus,
  getDigitalTwinStats,
  listConnections,
  listScheduledJobs,
} from "../../lib/api";

function isPermissionDenied(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 403 || err.status === 401);
}

export interface Nudge {
  id: string;
  message: string;
  priority: 1 | 2 | 3;
  action?: { label: string; href: string };
}

export interface OutlierAgent {
  slug: string;
  name: string;
  successRate: number;
  totalRuns: number;
}

export interface NewSinceLastVisit {
  agents: number;
  skills: number;
  mcps: number;
}

export interface HomeData {
  agents: AgentLight[];
  skills: Skill[];
  servers: McpServer[];
  gateways: Gateway[];
  /** Lightweight projection — 8 fields per row, see AgentRunLight. Drives
   *  the activity chart, top-agent stats, lastRun deep-link. */
  runs: AgentRunLight[];
  /** Full payload, small limit. RecentRunsCard + useAttentionItems read
   *  heavy fields (`result`, `task`, `error`, `toolsUsed`) for previews and
   *  failure surfacing — keep this list short so it stays cheap. */
  recentRuns: AgentRun[];
  dashboard1d: UserDashboardData | null;
  dashboard30d: UserDashboardData | null;
  workflows: ChainWorkflow[];
  approvals: Approval[];
  cloneApprovals: CloneRequestItem[];
  delegationApprovals: AgentDelegationPendingRequest[];
  /** Full Digital Twin status (pendingCandidates, approvedCandidates, etc). */
  digitalTwin: DigitalTwinStatus | null;
  /** Digital Twin memory bank stats for the past 7 days. Null if DT disabled or unavailable. */
  dtStats: MemoryBankStats | null;
  userConnections: UserConnection[];
  scheduledJobs: ScheduledJob[];
  activeAgents: number;
  unusedSkills: number;
  /** Servers with catalog enabled=true and visible to this user. Misleading on its own. */
  enabledMcps: number;
  /** MCPs the user has actually connected (UserConnection rows). */
  connectedMcps: number;
  enabledGateways: number;
  activeWorkflows: number;
  /** Count of runs that started today by calendar day (server-local). */
  todayCalendarRuns: number;
  /** Unique conversation sessions that ran today. */
  uniqueSessionsToday: number;
  /** Runs triggered by a scheduled job that started today. */
  scheduledRunsToday: number;
  /** Failed runs from scheduled jobs today (workflow step failures). */
  failedScheduledRunsToday: number;
  /** Scheduled jobs currently paused. */
  pausedScheduledJobs: number;
  /** Soonest upcoming scheduled job in the user's queue, or null. */
  nextScheduledJob: ScheduledJob | null;
  /** Agents created by the current user (ownerUserId === userId). */
  personalAgents: number;
  /** Agents owned by others or shipped with the workspace. */
  sharedAgents: number;
  /** Skills created by the current user (ownerUserId === userId). */
  personalSkills: number;
  /** Skills shipped with the product (ownerUserId !== userId). */
  inBuiltSkills: number;
  /** Top-run agent for the user today (from dashboard1d.agentTable). */
  topAgentToday: UserDashboardAgentRow | null;
  /** Run streak: consecutive calendar days the user had at least one run (from timeSeries). */
  streak: number;
  /** Total runs yesterday (from dashboard30d.timeSeries). */
  yesterdayRuns: number;
  /** Items created after the last home-page visit (stored in localStorage). */
  newSinceLastVisit: NewSinceLastVisit;
  todayRuns: number;
  todaySuccessRate: number | null;
  topAgents: AgentLight[];
  lastRun: AgentRunLight | null;
  nudges: Nudge[];
  outlierAgent: OutlierAgent | null;
  isLoading: boolean;
  error: string | null;
  /** True only when the attention-critical sources (runs or approvals) failed to load. */
  attentionLoadError: boolean;
  reload: () => void;
}

export function useHomeData(): HomeData {
  const auth = useAuth();
  const { isAdmin, isAdminLoading } = useAdminStatus();
  const userId = auth.status === "authenticated" ? auth.user.id : null;

  const [agents, setAgents] = useState<AgentLight[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [runs, setRuns] = useState<AgentRunLight[]>([]);
  const [recentRuns, setRecentRuns] = useState<AgentRun[]>([]);
  const [dashboard1d, setDashboard1d] = useState<UserDashboardData | null>(null);
  const [dashboard30d, setDashboard30d] = useState<UserDashboardData | null>(null);
  const [workflows, setWorkflows] = useState<ChainWorkflow[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [cloneApprovals, setCloneApprovals] = useState<CloneRequestItem[]>([]);
  const [delegationApprovals, setDelegationApprovals] = useState<AgentDelegationPendingRequest[]>([]);
  const [digitalTwin, setDigitalTwin] = useState<DigitalTwinStatus | null>(null);
  const [dtStats, setDtStats] = useState<MemoryBankStats | null>(null);
  const [userConnections, setUserConnections] = useState<UserConnection[]>([]);
  const [scheduledJobs, setScheduledJobs] = useState<ScheduledJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attentionLoadError, setAttentionLoadError] = useState(false);

  const load = useCallback(async () => {
    if (!userId || isAdminLoading) return;
    setIsLoading(true);
    setError(null);
    setAttentionLoadError(false);

    const results = await Promise.allSettled([
      listAgents(userId),
      listSkills(userId),
      listServers(userId),
      listGateways(),
      // Activity chart + insight strip — lightweight projection (no heavy
      // text fields). 7-day window self-limits row count for normal users;
      // limit 500 is the defensive ceiling — see runs.ts /light.
      listRunsLight(userId, { sinceDays: 7, limit: 500 }),
      // Recent runs card + attention items — full payload but limit=10. These
      // consumers render task/result/error/toolsUsed previews, so they need
      // the full row. Keeping the limit small keeps total payload ~1-2 MB
      // instead of 10-40 MB. The card only shows ~5 visible anyway.
      listRuns(userId, { limit: 10 }),
      getUserDashboard(userId, 1),
      getUserDashboard(userId, 30),
      listChainWorkflows(),
      isAdmin ? listPendingApprovals() : Promise.resolve([]),
      listIncomingCloneRequests(userId),
      listPendingDelegationRequestsForMe(userId),
      getDigitalTwinStatus(userId),
      listConnections(userId),
      listScheduledJobs({ userId }),
    ]);

    const [
      agentsRes,
      skillsRes,
      serversRes,
      gatewaysRes,
      runsRes,
      recentRunsRes,
      dashboard1dRes,
      dashboard30dRes,
      workflowsRes,
      approvalsRes,
      cloneApprovalsRes,
      delegationApprovalsRes,
      digitalTwinRes,
      userConnectionsRes,
      scheduledJobsRes,
    ] = results;

    let hasError = false;

    if (agentsRes.status === "fulfilled") {
      setAgents(agentsRes.value);
    } else if (!isPermissionDenied(agentsRes.reason)) {
      console.error("useHomeData: failed to load agents", agentsRes.reason);
      hasError = true;
    }

    if (skillsRes.status === "fulfilled") {
      setSkills(skillsRes.value);
    } else if (!isPermissionDenied(skillsRes.reason)) {
      console.error("useHomeData: failed to load skills", skillsRes.reason);
      hasError = true;
    }

    if (serversRes.status === "fulfilled") {
      setServers(serversRes.value);
    } else if (!isPermissionDenied(serversRes.reason)) {
      console.error("useHomeData: failed to load servers", serversRes.reason);
      hasError = true;
    }

    if (gatewaysRes.status === "fulfilled") {
      setGateways(gatewaysRes.value);
    } else if (!isPermissionDenied(gatewaysRes.reason)) {
      console.error("useHomeData: failed to load gateways", gatewaysRes.reason);
      hasError = true;
    }

    if (runsRes.status === "fulfilled") {
      setRuns(runsRes.value);
    } else if (!isPermissionDenied(runsRes.reason)) {
      console.error("useHomeData: failed to load runs", runsRes.reason);
      hasError = true;
    }

    if (recentRunsRes.status === "fulfilled") {
      setRecentRuns(recentRunsRes.value);
    } else if (!isPermissionDenied(recentRunsRes.reason)) {
      console.error("useHomeData: failed to load recentRuns", recentRunsRes.reason);
      hasError = true;
    }

    if (dashboard1dRes.status === "fulfilled") {
      setDashboard1d(dashboard1dRes.value);
    } else if (!isPermissionDenied(dashboard1dRes.reason)) {
      console.error("useHomeData: failed to load dashboard1d", dashboard1dRes.reason);
      hasError = true;
    }

    if (dashboard30dRes.status === "fulfilled") {
      setDashboard30d(dashboard30dRes.value);
    } else if (!isPermissionDenied(dashboard30dRes.reason)) {
      console.error("useHomeData: failed to load dashboard30d", dashboard30dRes.reason);
      hasError = true;
    }

    if (workflowsRes.status === "fulfilled") {
      setWorkflows(workflowsRes.value as ChainWorkflow[]);
    } else if (!isPermissionDenied(workflowsRes.reason)) {
      console.error("useHomeData: failed to load workflows", workflowsRes.reason);
      hasError = true;
    }

    if (approvalsRes.status === "fulfilled") {
      setApprovals(approvalsRes.value);
    } else if (!isPermissionDenied(approvalsRes.reason)) {
      console.error("useHomeData: failed to load approvals", approvalsRes.reason);
      hasError = true;
    }

    if (cloneApprovalsRes.status === "fulfilled") {
      setCloneApprovals(cloneApprovalsRes.value.filter((r) => r.status === "pending"));
    } else if (!isPermissionDenied(cloneApprovalsRes.reason)) {
      console.error("useHomeData: failed to load clone approvals", cloneApprovalsRes.reason);
      hasError = true;
      setAttentionLoadError(true);
    }

    if (delegationApprovalsRes.status === "fulfilled") {
      setDelegationApprovals(delegationApprovalsRes.value.filter((r) => r.status === "pending"));
    } else if (!isPermissionDenied(delegationApprovalsRes.reason)) {
      console.error("useHomeData: failed to load delegation approvals", delegationApprovalsRes.reason);
      hasError = true;
      setAttentionLoadError(true);
    }

    if (digitalTwinRes.status === "fulfilled") {
      setDigitalTwin(digitalTwinRes.value);
      // Conditionally fetch DT stats only when DT is enabled (avoids 404 noise).
      if (digitalTwinRes.value.enabled) {
        getDigitalTwinStats(userId, "7d")
          .then(setDtStats)
          .catch(() => setDtStats(null));
      }
    } else if (!isPermissionDenied(digitalTwinRes.reason)) {
      console.error("useHomeData: failed to load digitalTwin", digitalTwinRes.reason);
      hasError = true;
    }

    if (userConnectionsRes.status === "fulfilled") {
      setUserConnections(userConnectionsRes.value);
    } else if (!isPermissionDenied(userConnectionsRes.reason)) {
      console.error("useHomeData: failed to load userConnections", userConnectionsRes.reason);
      hasError = true;
    }

    if (scheduledJobsRes.status === "fulfilled") {
      setScheduledJobs(scheduledJobsRes.value);
    } else if (!isPermissionDenied(scheduledJobsRes.reason)) {
      console.error("useHomeData: failed to load scheduledJobs", scheduledJobsRes.reason);
      hasError = true;
    }

    if (hasError) {
      setError("Some data failed to load. Showing available information.");
    }
    setIsLoading(false);
  }, [userId, isAdmin, isAdminLoading]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Calendar-day boundary ─────────────────────────────────────────
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfDayMs = startOfDay.getTime();

  const activeAgents = agents.filter((a) => a.enabled).length;

  const attachedSkillIds = new Set(
    agents.flatMap((a) => (a.skills ?? []).map((s) => s.skillId)),
  );
  const unusedSkills = skills.filter((s) => !attachedSkillIds.has(s.id)).length;

  const personalAgents = userId
    ? agents.filter((a) => a.ownerUserId === userId).length
    : 0;
  const sharedAgents = agents.length - personalAgents;
  const personalSkills = userId
    ? skills.filter((s) => s.ownerUserId === userId).length
    : 0;
  const inBuiltSkills = skills.length - personalSkills;

  const enabledMcps = servers.filter((s) => s.enabled === true).length;
  const connectedMcps = userConnections.length;
  const enabledGateways = gateways.filter((g) => g.enabled).length;
  const activeWorkflows = workflows.filter((w) => w.isPublished).length;

  // Calendar-day runs (since local midnight) — distinct from rolling-24h dashboard count.
  const todayRuns2 = runs.filter((r) => new Date(r.startedAt).getTime() >= startOfDayMs);
  const todayCalendarRuns = todayRuns2.length;

  // Unique sessions today.
  const sessionSet = new Set<string>();
  todayRuns2.forEach((r) => { if (r.sessionId) sessionSet.add(r.sessionId); });
  const uniqueSessionsToday = sessionSet.size;

  // Scheduled/workflow runs today.
  const scheduledToday = todayRuns2.filter((r) => r.triggerSource === "scheduled");
  const scheduledRunsToday = scheduledToday.length;
  const failedScheduledRunsToday = scheduledToday.filter((r) => r.status === "failed").length;

  // Paused scheduled jobs.
  const pausedScheduledJobs = scheduledJobs.filter((j) => j.status === "paused").length;

  // ── Top agent today (from 1-day dashboard) ───────────────────────
  const topAgentToday: UserDashboardAgentRow | null =
    (dashboard1d?.agentTable ?? [])
      .slice()
      .sort((a, b) => b.totalRuns - a.totalRuns)[0] ?? null;

  // ── Streak: consecutive calendar days with ≥1 run ────────────────
  // Uses dashboard30d.timeSeries (sorted ascending by day).
  const streak = (() => {
    const series = dashboard30d?.timeSeries ?? [];
    if (series.length === 0) return 0;
    // Build a Set of dates with activity in "YYYY-MM-DD" form.
    const active = new Set(
      series.filter((p) => p.total > 0).map((p) => p.day.slice(0, 10)),
    );
    let count = 0;
    const cursor = new Date();
    // Start from today, walk back until we hit a gap.
    for (let i = 0; i < 31; i++) {
      const key = cursor.toISOString().slice(0, 10);
      if (!active.has(key)) break;
      count++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return count;
  })();

  // ── Yesterday's run total ─────────────────────────────────────────
  const yesterdayRuns = (() => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const key = yesterday.toISOString().slice(0, 10);
    const entry = dashboard30d?.timeSeries?.find((p) => p.day.slice(0, 10) === key);
    return entry?.total ?? 0;
  })();

  // ── New since last home-page visit (localStorage) ─────────────────
  const newSinceLastVisit = (() => {
    const LS_KEY = "xyne_home_last_visited";
    const lastVisitedStr = typeof window !== "undefined"
      ? window.localStorage.getItem(LS_KEY)
      : null;
    const lastVisited = lastVisitedStr ? new Date(lastVisitedStr).getTime() : 0;
    // Update the timestamp each time we compute (i.e., each fresh load).
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LS_KEY, new Date().toISOString());
    }
    const newAgents = agents.filter(
      (a) => new Date(a.createdAt).getTime() > lastVisited,
    ).length;
    const newSkills = skills.filter(
      (s) => new Date(s.createdAt).getTime() > lastVisited,
    ).length;
    const newMcps = servers.filter(
      (s) => new Date(s.createdAt).getTime() > lastVisited,
    ).length;
    return { agents: newAgents, skills: newSkills, mcps: newMcps };
  })();

  // ── Soonest upcoming scheduled job ────────────────────────────────
  const nowMs = Date.now();
  const upcoming = scheduledJobs
    .filter((j) => j.nextRunAt && new Date(j.nextRunAt).getTime() > nowMs)
    .sort(
      (a, b) =>
        new Date(a.nextRunAt!).getTime() - new Date(b.nextRunAt!).getTime(),
    );
  const nextScheduledJob = upcoming[0] ?? null;

  const todayRuns = dashboard1d?.overview?.totalRuns ?? 0;
  const todaySuccessRate =
    todayRuns === 0
      ? null
      : Math.round(
          ((dashboard1d?.overview?.completedRuns ?? 0) / todayRuns) * 100,
        );

  const freq: Record<string, number> = {};
  runs.forEach((r) => {
    freq[r.agentSlug] = (freq[r.agentSlug] ?? 0) + 1;
  });
  const top3Slugs = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([slug]) => slug);
  const topAgents = top3Slugs
    .map((slug) => agents.find((a) => a.slug === slug))
    .filter((a): a is AgentLight => a !== undefined);

  const lastRun = runs[0] ?? null;

  const nudges: Nudge[] = [];
  const disabledCount = agents.filter((a) => !a.enabled).length;
  if (disabledCount > 0) {
    nudges.push({
      id: "disabled-agents",
      priority: 1,
      message: `${disabledCount} agent${disabledCount > 1 ? "s" : ""} paused`,
      action: { label: "View agents", href: "/v3/agents" },
    });
  }
  if (approvals.length > 0) {
    nudges.push({
      id: "pending-approvals",
      priority: 1,
      message: `${approvals.length} approval${approvals.length > 1 ? "s" : ""} pending`,
      action: { label: "Review", href: "/v3/control-center" },
    });
  }
  if (cloneApprovals.length + delegationApprovals.length > 0) {
    const count = cloneApprovals.length + delegationApprovals.length;
    nudges.push({
      id: "pending-agent-approvals",
      priority: 1,
      message: `${count} agent approval${count > 1 ? "s" : ""} pending`,
      action: { label: "Review", href: "/v3/agents" },
    });
  }

  const agentTable = dashboard30d?.agentTable ?? [];
  agentTable
    .filter((row) => row.totalRuns >= 5)
    .forEach((row) => {
      const rate = row.totalRuns > 0 ? row.completedRuns / row.totalRuns : 1;
      if (rate < 0.8) {
        nudges.push({
          id: `low-rate-${row.agentSlug}`,
          priority: 2,
          message: `${row.agentName} — ${Math.round(rate * 100)}% success rate`,
          action: { label: "View dashboard", href: "/v3/dashboard" },
        });
      }
    });

  if (unusedSkills > 0) {
    nudges.push({
      id: "unused-skills",
      priority: 3,
      message: `${unusedSkills} skill${unusedSkills > 1 ? "s" : ""} not attached to any agent`,
      action: { label: "View skills", href: "/v3/skills" },
    });
  }
  if (enabledGateways === 0 && gateways.length > 0) {
    nudges.push({
      id: "no-gateways",
      priority: 3,
      message: "No gateways are enabled",
      action: { label: "View gateways", href: "/v3/gateways" },
    });
  }

  nudges.sort((a, b) => a.priority - b.priority);

  const outlierAgent = (() => {
    const qualified = agentTable
      .filter((row) => row.totalRuns >= 5)
      .map((row) => ({
        slug: row.agentSlug,
        name: row.agentName,
        successRate: row.totalRuns > 0 ? row.completedRuns / row.totalRuns : 1,
        totalRuns: row.totalRuns,
      }))
      .filter((a) => a.successRate < 0.85)
      .sort((a, b) => a.successRate - b.successRate);
    return qualified[0] ?? null;
  })();

  if (!userId) {
    return {
      agents: [],
      skills: [],
      servers: [],
      gateways: [],
      runs: [],
      recentRuns: [],
      dashboard1d: null,
      dashboard30d: null,
      workflows: [],
      approvals: [],
      cloneApprovals: [],
      delegationApprovals: [],
      digitalTwin: null,
      dtStats: null,
      userConnections: [],
      scheduledJobs: [],
      activeAgents: 0,
      unusedSkills: 0,
      enabledMcps: 0,
      connectedMcps: 0,
      enabledGateways: 0,
      activeWorkflows: 0,
      todayCalendarRuns: 0,
      uniqueSessionsToday: 0,
      scheduledRunsToday: 0,
      failedScheduledRunsToday: 0,
      pausedScheduledJobs: 0,
      nextScheduledJob: null,
      personalAgents: 0,
      sharedAgents: 0,
      personalSkills: 0,
      inBuiltSkills: 0,
      topAgentToday: null,
      streak: 0,
      yesterdayRuns: 0,
      newSinceLastVisit: { agents: 0, skills: 0, mcps: 0 },
      todayRuns: 0,
      todaySuccessRate: null,
      topAgents: [],
      lastRun: null,
      nudges: [],
      outlierAgent: null,
      isLoading: true,
      error: null,
      attentionLoadError: false,
      reload: () => {},
    };
  }

  return {
    agents,
    skills,
    servers,
    gateways,
    runs,
    recentRuns,
    dashboard1d,
    dashboard30d,
    workflows,
    approvals,
    cloneApprovals,
    delegationApprovals,
    digitalTwin,
    dtStats,
    userConnections,
    scheduledJobs,
    activeAgents,
    unusedSkills,
    enabledMcps,
    connectedMcps,
    enabledGateways,
    activeWorkflows,
    todayCalendarRuns,
    uniqueSessionsToday,
    scheduledRunsToday,
    failedScheduledRunsToday,
    pausedScheduledJobs,
    nextScheduledJob,
    personalAgents,
    sharedAgents,
    personalSkills,
    inBuiltSkills,
    topAgentToday,
    streak,
    yesterdayRuns,
    newSinceLastVisit,
    todayRuns,
    todaySuccessRate,
    topAgents,
    lastRun,
    nudges: nudges.slice(0, 2),
    outlierAgent,
    isLoading,
    error,
    attentionLoadError,
    reload: () => void load(),
  };
}
