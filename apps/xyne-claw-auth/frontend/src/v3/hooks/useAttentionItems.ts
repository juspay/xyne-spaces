/**
 * useAttentionItems — derives a unified "needs attention" feed from HomeData.
 *
 * The feed is a discriminated union (AttentionItem) so the renderer can switch
 * per `kind`. Severity buckets drive visual grouping; freshest-first within bucket.
 *
 * Sources today:
 *   - failure   ← runs[status="failed"]
 *   - approval  ← approvals[]
 *   - agent_approval ← clone/delegation requests for agents I administer
 *   - outlier   ← dashboard30d.agentTable (success-rate threshold)
 *   - dt_review ← (no API yet — emitted empty)
 *   - workflow  ← (no signal on ChainWorkflow yet — emitted empty)
 *   - ack       ← (no signal yet — emitted empty)
 */

import type { HomeData } from "./useHomeData";

export type AttentionSeverity = "high" | "medium" | "low";

interface AttentionBase {
  id: string;
  severity: AttentionSeverity;
  occurredAt: string;
  dismissible: boolean;
}

export interface FailureAttentionItem extends AttentionBase {
  kind: "failure";
  agentSlug: string;
  agentName: string;
  sessionId: string;
  errorSummary: string;
}

export interface ApprovalAttentionItem extends AttentionBase {
  kind: "approval";
  approvalId: string;
  agentSlug: string;
  agentName: string;
  sessionId: string;
  action: string;
  targetSystem: string;
  canQuickApprove: boolean;
}

export interface AgentApprovalAttentionItem extends AttentionBase {
  kind: "agent_approval";
  requestKind: "clone" | "delegation";
  agentSlug: string;
  agentName: string;
  requesterName: string;
}

export interface OutlierAttentionItem extends AttentionBase {
  kind: "outlier";
  agentSlug: string;
  agentName: string;
  metric: "success_rate" | "latency" | "fallback_rate";
  value: number;
  threshold: number;
  windowDays: number;
}

export interface DtReviewAttentionItem extends AttentionBase {
  kind: "dt_review";
  pendingCount: number;
}

export interface WorkflowAttentionItem extends AttentionBase {
  kind: "workflow";
  failedCount: number;
}

export interface AckAttentionItem extends AttentionBase {
  kind: "ack";
  taskName: string;
  completedAt: string;
  resultSummary: string;
  runId?: string;
}

export type AttentionItem =
  | FailureAttentionItem
  | ApprovalAttentionItem
  | AgentApprovalAttentionItem
  | OutlierAttentionItem
  | DtReviewAttentionItem
  | WorkflowAttentionItem
  | AckAttentionItem;

const SEVERITY_RANK: Record<AttentionSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const OUTLIER_THRESHOLD = 0.85;
const MIN_RUNS_FOR_OUTLIER = 5;

export interface UseAttentionItemsResult {
  items: AttentionItem[];
  countsBySeverity: Record<AttentionSeverity, number>;
  total: number;
}

export function deriveAttentionItems(data: HomeData): UseAttentionItemsResult {
  const items: AttentionItem[] = [];

  // ── Failures: failed runs in last 7 days ──────────────────────────
  // Reads recentRuns (full payload, limit 10) instead of runs (light) because
  // we need r.id, r.error, r.task — none of which are on AgentRunLight.
  // Limit 10 caps how many failures we can show, which matches the UI
  // (attention list never renders more than a handful anyway).
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  data.recentRuns
    .filter(
      (r) =>
        r.status === "failed" &&
        new Date(r.startedAt).getTime() >= sevenDaysAgo,
    )
    .forEach((r) => {
      const agent = data.agents.find((a) => a.slug === r.agentSlug);
      items.push({
        kind: "failure",
        id: `failure-${r.id}`,
        severity: "high",
        occurredAt: r.startedAt,
        dismissible: true,
        agentSlug: r.agentSlug,
        agentName: agent?.name ?? r.agentSlug,
        sessionId: r.sessionId,
        errorSummary:
          r.error?.slice(0, 80) ?? r.task?.slice(0, 80) ?? "Run failed",
      });
    });

  // ── Approvals: HITL gates ─────────────────────────────────────
  data.approvals.forEach((a) => {
    items.push({
      kind: "approval",
      id: `approval-${a.id}`,
      severity: "high",
      occurredAt: a.createdAt,
      dismissible: false,
      approvalId: a.id,
      agentSlug: a.agentSlug,
      agentName: a.agentName,
      sessionId: a.sessionId,
      action: a.action,
      targetSystem: a.targetSystem,
      canQuickApprove: !a.action.toLowerCase().includes("edit"),
    });
  });

  // ── Agent approvals: clone and A2A delegation requests ───────────
  data.cloneApprovals.forEach((r) => {
    items.push({
      kind: "agent_approval",
      id: `clone-approval-${r.id}`,
      severity: "high",
      occurredAt: r.createdAt,
      dismissible: false,
      requestKind: "clone",
      agentSlug: r.agentSlug ?? r.agentId ?? r.id,
      agentName: r.agentName ?? r.agentSlug ?? "Agent",
      requesterName: r.requesterName || r.requesterEmail || r.requesterId,
    });
  });

  data.delegationApprovals.forEach((r) => {
    const callee = r.callee;
    const caller = r.caller;
    items.push({
      kind: "agent_approval",
      id: `delegation-approval-${r.id}`,
      severity: "high",
      occurredAt: r.createdAt,
      dismissible: false,
      requestKind: "delegation",
      agentSlug: callee?.slug ?? r.calleeAgentId,
      agentName: callee?.name ?? r.calleeAgentId,
      requesterName: caller?.name ?? caller?.slug ?? r.callerAgentId,
    });
  });

  // ── Outliers: success rate below threshold (30d) ──────────────
  const agentTable = data.dashboard30d?.agentTable ?? [];
  agentTable
    .filter((row) => row.totalRuns >= MIN_RUNS_FOR_OUTLIER)
    .forEach((row) => {
      const rate =
        row.totalRuns > 0 ? row.completedRuns / row.totalRuns : 1;
      if (rate < OUTLIER_THRESHOLD) {
        items.push({
          kind: "outlier",
          id: `outlier-${row.agentSlug}`,
          severity: "medium",
          occurredAt: new Date().toISOString(),
          dismissible: true,
          agentSlug: row.agentSlug,
          agentName: row.agentName,
          metric: "success_rate",
          value: Math.round(rate * 100),
          threshold: Math.round(OUTLIER_THRESHOLD * 100),
          windowDays: 30,
        });
      }
    });

  // ── DT review: pending candidates awaiting approval ────────────
  const dtStatus = data.digitalTwin;
  if (dtStatus?.enabled && (dtStatus.pendingCandidates ?? 0) > 0) {
    items.push({
      kind: "dt_review",
      id: "dt_review",
      severity: "medium",
      occurredAt: new Date().toISOString(),
      dismissible: false,
      pendingCount: dtStatus.pendingCandidates,
    });
  }

  // ── Workflow failures: scheduled runs that failed today ─────────
  if (data.failedScheduledRunsToday > 0) {
    items.push({
      kind: "workflow",
      id: "workflow_failures",
      severity: "high",
      occurredAt: new Date().toISOString(),
      dismissible: true,
      failedCount: data.failedScheduledRunsToday,
    });
  }

  // ── Paused scheduled jobs ───────────────────────────────────────
  if (data.pausedScheduledJobs > 0) {
    items.push({
      kind: "ack",
      id: "paused_jobs",
      severity: "low",
      occurredAt: new Date().toISOString(),
      dismissible: true,
      taskName: `${data.pausedScheduledJobs} scheduled job${data.pausedScheduledJobs > 1 ? "s" : ""} paused`,
      completedAt: new Date().toISOString(),
      resultSummary: "Scheduled jobs are paused and won't run until resumed.",
    });
  }

  // ── Ack — empty until signal exists ───────────────────────────
  // (Paused jobs uses ack slot above.)

  // ── Sort: severity bucket, then freshest first ────────────────
  items.sort((a, b) => {
    const sevDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return (
      new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
    );
  });

  const countsBySeverity: Record<AttentionSeverity, number> = {
    high: 0,
    medium: 0,
    low: 0,
  };
  items.forEach((it) => {
    countsBySeverity[it.severity] += 1;
  });
 
  return {
    items,
    countsBySeverity,
    total: items.length,
  };
}

export function useAttentionItems(data: HomeData): UseAttentionItemsResult {
  return deriveAttentionItems(data);
}
