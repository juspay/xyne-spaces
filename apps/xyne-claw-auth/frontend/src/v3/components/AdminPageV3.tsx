/**
 * AdminPageV3 — admin console for V3.
 *
 * Mirrors v1 AdminPage feature-set (requests, MCP publish review, agents,
 * admin roles, audit log, usage, scheduled jobs, global MCP credentials)
 * but uses V3 design tokens, primitives (PageLayout/PageHeader/Tabs/Badge/…)
 * and the SnackbarProvider for user feedback.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ShieldIcon,
  TrashIcon,
  UserPlusIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  CheckCircleIcon,
  XCircleIcon,
  SpinnerGapIcon,
  PlugIcon,
  ImageIcon,
  KeyIcon,
  FloppyDiskIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckIcon,
  EyeIcon,
  SlackLogoIcon,
} from "@phosphor-icons/react";

import { PageLayout } from "./ui/PageLayout";
import { PageHeader } from "./ui/PageHeader";
import { Tabs, type TabItem } from "./ui/Tabs";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { TextField } from "./ui/TextField";
import { Switch } from "./ui/Switch";
import { Dialog } from "./ui/Dialog";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { Menu, MenuItem } from "./ui/Menu";
import { useSnackbar } from "./ui/Snackbar";

import {
  listAdminRoles,
  grantAdmin,
  revokeAdmin,
  listAuditLogsPaged,
  listAgents,
  promoteAgent,
  demoteAgent,
  deleteAgent,
  listPendingRequests,
  approveRequest,
  rejectRequest,
  createAgentApp,
  installAgentApp,
  configureAgentWebhook,
  grantAgentPermissions,
  uploadAgentPicture,
  getAgentDetail,
  listAgentUsageStats,
  listAdminScheduledJobs,
  deleteScheduledJob,
  listMcpPublishRequests,
  approveServerPublish,
  rejectServerPublish,
  listMcpEditRequests,
  approveServerEdit,
  rejectServerEdit,
  type McpEditRequest,
  listAdminMcpServers,
  getAdminMcpGlobalCreds,
  setAdminMcpGlobalCreds,
  deleteAdminMcpGlobalCreds,
  setAdminMcpFallbackFlag,
  getCredentialFields,
  createSlackAgentApp,
  syncSlackAgentApp,
  listSlackAgentStatuses,
  registerSlackCommand,
  removeSlackAgentRegistration,
  listWorkflowGlobalRequests,
  approveWorkflowGlobalRequest,
  rejectWorkflowGlobalRequest,
  type WorkflowGlobalRequest,
  type AdminRole,
  type AdminOrgScope,
  type AuditLogEntry,
  type AgentRequestItem,
  type AgentUsageStat,
  type AdminScheduledJob,
  type AdminMcpServerSummary,
  type AdminMcpGlobalCredsDetail,
  type SlackAgentStatus,
} from "../../lib/api";
import type { Agent, AgentLight, McpServer, CredentialField } from "../../lib/types";

/* ── Types ─────────────────────────────────────────────────────────── */

type TabKey =
  | "requests"
  | "connectors"
  | "workflowreqs"
  | "agents"
  | "admins"
  | "audit"
  | "usage"
  | "scheduled"
  | "globalmcp";

interface Props {
  userId: string;
}

interface SpacesFlow {
  requestId: string;
  agentSlug: string;
  step:
    | "creating"
    | "create"
    | "installing"
    | "install"
    | "configuring"
    | "configure"
    | "granting"
    | "grant"
    | "upload"
    | "uploading"
    | "done";
  error?: string;
}

/* ── Component ─────────────────────────────────────────────────────── */

export function AdminPageV3({ userId }: Props) {
  const { show: showSnackbar } = useSnackbar();

  const [tab, setTab] = useState<TabKey>("requests");
  const [allOrgs, setAllOrgs] = useState(false);
  const adminOrgScope: AdminOrgScope = allOrgs ? "all" : "org";

  /* Common datasets */
  const [agents, setAgents] = useState<AgentLight[]>([]);
  const [admins, setAdmins] = useState<AdminRole[]>([]);
  const [searchEvalUsers, setSearchEvalUsers] = useState<AdminRole[]>([]);
  const [requests, setRequests] = useState<AgentRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newAdminId, setNewAdminId] = useState("");
  const [newSearchEvalUserId, setNewSearchEvalUserId] = useState("");

  /* MCP publish requests */
  const [mcpRequests, setMcpRequests] = useState<McpServer[]>([]);
  const [mcpRequestsLoading, setMcpRequestsLoading] = useState(false);
  const [workflowRequests, setWorkflowRequests] = useState<WorkflowGlobalRequest[]>([]);
  const [workflowRequestsLoading, setWorkflowRequestsLoading] = useState(false);
  const [workflowRejectingId, setWorkflowRejectingId] = useState<string | null>(null);
  const [workflowRejectNote, setWorkflowRejectNote] = useState("");
  const [mcpRejectingId, setMcpRejectingId] = useState<string | null>(null);
  const [mcpRejectNote, setMcpRejectNote] = useState("");
  const [mcpEditRequests, setMcpEditRequests] = useState<McpEditRequest[]>([]);
  const [mcpEditRequestsLoading, setMcpEditRequestsLoading] = useState(false);
  const [mcpEditRejectingId, setMcpEditRejectingId] = useState<string | null>(null);
  const [mcpEditRejectNote, setMcpEditRejectNote] = useState("");

  /* Audit logs */
  const AUDIT_PAGE_SIZE = 50;
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditOffset, setAuditOffset] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditEventFilter, setAuditEventFilter] = useState<string>("");   // "" = all events
  const [auditAgentFilter, setAuditAgentFilter] = useState<string>("");   // agent id → targetId
  const [auditRange, setAuditRange] = useState<"7" | "30" | "all">("all");

  /* Usage stats */
  const [usageStats, setUsageStats] = useState<AgentUsageStat[]>([]);
  const [usageRange, setUsageRange] = useState<7 | 30 | "all">(30);
  const [usageLoading, setUsageLoading] = useState(false);

  /* Scheduled jobs */
  const SCHEDULED_PAGE_SIZE = 50;
  const [scheduledJobs, setScheduledJobs] = useState<AdminScheduledJob[]>([]);
  const [scheduledTotal, setScheduledTotal] = useState(0);
  const [scheduledOffset, setScheduledOffset] = useState(0);
  const [scheduledStatusFilter, setScheduledStatusFilter] = useState<
    "" | "active" | "completed" | "cancelled"
  >("");
  const [scheduledAgentFilter, setScheduledAgentFilter] = useState<string>("");
  const [scheduledUserFilter, setScheduledUserFilter] = useState<string>("");
  // Accumulated (union) user options so the User dropdown doesn't collapse to a
  // single entry once a user filter is applied. Grows as pages/filters load.
  const [scheduledUserOptions, setScheduledUserOptions] = useState<
    { value: string; label: string }[]
  >([]);
  const [scheduledLoading, setScheduledLoading] = useState(false);
  const [cancelJobTarget, setCancelJobTarget] = useState<AdminScheduledJob | null>(null);

  /* View-agent modal */
  const [viewingAgentSlug, setViewingAgentSlug] = useState<string | null>(null);
  const [viewingAgent, setViewingAgent] = useState<Agent | null>(null);
  const [viewingLoading, setViewingLoading] = useState(false);

  /* Confirm dialogs */
  const [revokeTarget, setRevokeTarget] = useState<AdminRole | null>(null);
  const [revokeSearchEvalTarget, setRevokeSearchEvalTarget] = useState<AdminRole | null>(null);
  const [promoteTarget, setPromoteTarget] = useState<AgentLight | null>(null);
  const [demoteTarget, setDemoteTarget] = useState<AgentLight | null>(null);
  const [deleteAgentTarget, setDeleteAgentTarget] = useState<AgentLight | null>(null);
  const [deleteCredsTarget, setDeleteCredsTarget] = useState<AdminMcpServerSummary | null>(null);

  /* Reject request inline state */
  const [rejectingRequestId, setRejectingRequestId] = useState<string | null>(null);
  const [requestRejectNote, setRequestRejectNote] = useState("");

  /* Spaces App registration flow */
  const [spacesFlow, setSpacesFlow] = useState<SpacesFlow | null>(null);
  const [slackCreatingSlug, setSlackCreatingSlug] = useState<string | null>(null);
  const [slackAgentStatuses, setSlackAgentStatuses] = useState<Record<string, SlackAgentStatus>>({});
  const [slackStatusesReady, setSlackStatusesReady] = useState(false);
  const [slackInstall, setSlackInstall] = useState<{
    agent: AgentLight;
    appId: string;
  } | null>(null);
  /* Slack surface choice: command on the umbrella app vs a dedicated app */
  const [slackChoice, setSlackChoice] = useState<{
    agent: AgentLight;
    commandName: string;
  } | null>(null);
  const [slackRegisteringCommand, setSlackRegisteringCommand] = useState(false);
  const slackFocusListenerRef = useRef<(() => void) | null>(null);
  const pictureInputRef = useRef<HTMLInputElement | null>(null);
  const rowPictureInputRef = useRef<HTMLInputElement | null>(null);
  const [rowUploadSlug, setRowUploadSlug] = useState<string | null>(null);

  /* Global MCP credentials state */
  const [globalMcpServers, setGlobalMcpServers] = useState<AdminMcpServerSummary[]>([]);
  const [globalMcpLoading, setGlobalMcpLoading] = useState(false);
  const [globalMcpFields, setGlobalMcpFields] = useState<
    Record<string, readonly CredentialField[]>
  >({});
  const [globalMcpForms, setGlobalMcpForms] = useState<
    Record<string, Record<string, string>>
  >({});
  const [globalMcpExistingKeys, setGlobalMcpExistingKeys] = useState<
    Record<string, string[]>
  >({});
  const [globalMcpSaving, setGlobalMcpSaving] = useState<string | null>(null);
  const [globalMcpFormErrors, setGlobalMcpFormErrors] = useState<Record<string, string>>({});

  /* ── Data loaders ──────────────────────────────────────────────── */

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, r, sr, reqs] = await Promise.all([
        // Admin panel: the full roster across all users (server enforces admin).
        listAgents(userId, true, adminOrgScope),
        listAdminRoles(userId, adminOrgScope).catch(() => []),
        listAdminRoles(userId, adminOrgScope, "SEARCH_EVAL_ACCESS").catch(() => []),
        listPendingRequests(userId, adminOrgScope).catch(() => []),
      ]);
      setAgents(a);
      setAdmins(r);
      setSearchEvalUsers(sr);
      setRequests(reqs);
    } catch (err) {
      console.error("[admin] load error:", err);
      showSnackbar({ variant: "error", title: "Failed to load admin data" });
    } finally {
      setLoading(false);
    }
  }, [userId, adminOrgScope, showSnackbar]);

  useEffect(() => { load(); }, [load]);

  const loadSlackAgentStatuses = useCallback(async () => {
    setSlackStatusesReady(false);
    try {
      const orgIds = [...new Set(agents.map((agent) => agent.orgId))];
      const results = await Promise.allSettled(orgIds.map((orgId) => listSlackAgentStatuses(orgId)));
      const rows = results.flatMap((result, index) => {
        if (result.status === "fulfilled") return result.value;
        console.warn(`[admin] Slack agent status load failed for org ${orgIds[index]}`);
        return [];
      });
      setSlackAgentStatuses(Object.fromEntries(rows.map((status) => [status.agentId, status])));
      if (orgIds.length > 0 && results.every((result) => result.status === "rejected")) {
        showSnackbar({ variant: "error", title: "Failed to load Slack app status" });
      }
    } finally {
      setSlackStatusesReady(true);
    }
  }, [agents, showSnackbar]);

  useEffect(() => {
    if (tab === "agents") void loadSlackAgentStatuses();
  }, [tab, loadSlackAgentStatuses]);

  useEffect(() => () => {
    if (slackFocusListenerRef.current) {
      window.removeEventListener("focus", slackFocusListenerRef.current);
    }
  }, []);

  const loadAuditLogs = useCallback(async () => {
    setAuditLoading(true);
    try {
      const startDate =
        auditRange === "all"
          ? undefined
          : new Date(Date.now() - Number(auditRange) * 24 * 60 * 60 * 1000).toISOString();
      const { rows, total } = await listAuditLogsPaged(userId, {
        limit: AUDIT_PAGE_SIZE,
        offset: auditOffset,
        orgScope: adminOrgScope,
        eventType: auditEventFilter || undefined,
        targetId: auditAgentFilter || undefined,
        startDate,
      });
      setLogs(rows);
      setAuditTotal(total);
    } catch (err) {
      console.error("[admin] audit logs load error:", err);
      showSnackbar({ variant: "error", title: "Failed to load audit logs" });
    } finally {
      setAuditLoading(false);
    }
  }, [userId, auditOffset, adminOrgScope, auditEventFilter, auditAgentFilter, auditRange, showSnackbar]);

  useEffect(() => { if (tab === "audit") loadAuditLogs(); }, [tab, loadAuditLogs]);

  const loadUsage = useCallback(async () => {
    setUsageLoading(true);
    try {
      const stats = await listAgentUsageStats(userId, usageRange, adminOrgScope).catch(() => []);
      setUsageStats(stats);
    } finally {
      setUsageLoading(false);
    }
  }, [userId, usageRange, adminOrgScope]);

  useEffect(() => { if (tab === "usage") loadUsage(); }, [tab, loadUsage]);

  const loadMcpRequests = useCallback(async () => {
    setMcpRequestsLoading(true);
    try {
      const rows = await listMcpPublishRequests(userId);
      setMcpRequests(rows);
    } catch (err) {
      console.error("[admin] mcp publish-requests load error:", err);
      showSnackbar({ variant: "error", title: "Failed to load MCP publish requests" });
    } finally {
      setMcpRequestsLoading(false);
    }
  }, [userId, showSnackbar]);

  const loadMcpEditRequests = useCallback(async () => {
    setMcpEditRequestsLoading(true);
    try {
      const rows = await listMcpEditRequests(userId);
      setMcpEditRequests(rows);
    } catch (err) {
      console.error("[admin] mcp edit-requests load error:", err);
      showSnackbar({ variant: "error", title: "Failed to load MCP edit requests" });
    } finally {
      setMcpEditRequestsLoading(false);
    }
  }, [userId, showSnackbar]);

  useEffect(() => {
    if (tab === "connectors") {
      loadMcpRequests();
      loadMcpEditRequests();
    }
  }, [tab, loadMcpRequests, loadMcpEditRequests]);

  const loadWorkflowRequests = useCallback(async () => {
    setWorkflowRequestsLoading(true);
    try {
      setWorkflowRequests(await listWorkflowGlobalRequests(userId, adminOrgScope));
    } catch (err) {
      console.error("[admin] workflow global-requests load error:", err);
    } finally {
      setWorkflowRequestsLoading(false);
    }
  }, [userId, adminOrgScope]);
  useEffect(() => { if (tab === "workflowreqs") loadWorkflowRequests(); }, [tab, loadWorkflowRequests]);

  const handleApproveWorkflow = async (id: string) => {
    try {
      await approveWorkflowGlobalRequest(id, userId);
      showSnackbar({ variant: "success", title: "Workflow promoted to global" });
      loadWorkflowRequests();
    } catch (err) {
      showSnackbar({ variant: "error", title: err instanceof Error ? err.message : "Failed to approve" });
    }
  };

  const handleRejectWorkflow = async (id: string) => {
    try {
      await rejectWorkflowGlobalRequest(id, userId, workflowRejectNote.trim() || undefined);
      setWorkflowRejectingId(null);
      setWorkflowRejectNote("");
      loadWorkflowRequests();
    } catch (err) {
      showSnackbar({ variant: "error", title: err instanceof Error ? err.message : "Failed to reject" });
    }
  };

  const loadScheduledJobs = useCallback(async () => {
    setScheduledLoading(true);
    try {
      const result = await listAdminScheduledJobs(userId, {
        status: scheduledStatusFilter || undefined,
        agentSlug: scheduledAgentFilter || undefined,
        userId: scheduledUserFilter || undefined,
        limit: SCHEDULED_PAGE_SIZE,
        offset: scheduledOffset,
        orgScope: adminOrgScope,
      });
      setScheduledJobs(result.rows);
      setScheduledTotal(result.total);
      // Merge any newly-seen users into the (union) option list.
      setScheduledUserOptions((prev) => {
        const seen = new Set(prev.map((o) => o.value));
        const next = [...prev];
        for (const j of result.rows) {
          if (j.userId && !seen.has(j.userId)) {
            seen.add(j.userId);
            next.push({ value: j.userId, label: j.user?.email ?? j.userId });
          }
        }
        return next;
      });
    } catch (err) {
      console.error("[admin] scheduled-jobs load error:", err);
      showSnackbar({ variant: "error", title: "Failed to load scheduled jobs" });
    } finally {
      setScheduledLoading(false);
    }
  }, [userId, scheduledStatusFilter, scheduledAgentFilter, scheduledUserFilter, scheduledOffset, adminOrgScope, showSnackbar]);

  useEffect(() => {
    setAuditOffset(0);
    setScheduledOffset(0);
  }, [adminOrgScope]);

  useEffect(() => { if (tab === "scheduled") loadScheduledJobs(); }, [tab, loadScheduledJobs]);

  const loadGlobalMcpServers = useCallback(async () => {
    setGlobalMcpLoading(true);
    try {
      const [rows, fields] = await Promise.all([
        listAdminMcpServers(userId),
        getCredentialFields().catch(
          () => ({}) as Record<string, readonly CredentialField[]>,
        ),
      ]);
      setGlobalMcpServers(rows);
      setGlobalMcpFields(fields);
    } catch (err) {
      console.error("[admin] global-mcp load error:", err);
      showSnackbar({ variant: "error", title: "Failed to load MCP servers" });
    } finally {
      setGlobalMcpLoading(false);
    }
  }, [userId, showSnackbar]);

  useEffect(() => { if (tab === "globalmcp") loadGlobalMcpServers(); }, [tab, loadGlobalMcpServers]);

  /* ── MCP publish handlers ──────────────────────────────────────── */

  const handleApproveMcp = async (id: string) => {
    try {
      await approveServerPublish(id, userId);
      showSnackbar({ variant: "success", title: "MCP connector approved" });
      loadMcpRequests();
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: err instanceof Error ? err.message : "Failed to approve",
      });
    }
  };

  const handleRejectMcp = async (id: string) => {
    try {
      await rejectServerPublish(id, userId, mcpRejectNote.trim() || undefined);
      setMcpRejectingId(null);
      setMcpRejectNote("");
      showSnackbar({ variant: "success", title: "MCP connector rejected" });
      loadMcpRequests();
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: err instanceof Error ? err.message : "Failed to reject",
      });
    }
  };

  const handleApproveMcpEdit = async (id: string) => {
    try {
      await approveServerEdit(id, userId);
      showSnackbar({ variant: "success", title: "MCP edit approved" });
      loadMcpEditRequests();
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: err instanceof Error ? err.message : "Failed to approve",
      });
    }
  };

  const handleRejectMcpEdit = async (id: string) => {
    try {
      await rejectServerEdit(id, userId, mcpEditRejectNote.trim() || undefined);
      setMcpEditRejectingId(null);
      setMcpEditRejectNote("");
      showSnackbar({ variant: "success", title: "MCP edit rejected" });
      loadMcpEditRequests();
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: err instanceof Error ? err.message : "Failed to reject",
      });
    }
  };

  /* ── Global MCP credentials handlers ───────────────────────────── */

  const handleToggleFallback = async (server: AdminMcpServerSummary, allow: boolean) => {
    try {
      await setAdminMcpFallbackFlag(userId, server.type, allow);
      loadGlobalMcpServers();
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: err instanceof Error ? err.message : "Failed to update fallback setting",
      });
    }
  };

  const handleOpenForm = useCallback(
    async (server: AdminMcpServerSummary) => {
      const fields = globalMcpFields[server.type] ?? [];
      const initial: Record<string, string> = {};
      for (const f of fields) initial[f.name] = "";
      setGlobalMcpForms((prev) => ({ ...prev, [server.type]: initial }));
      setGlobalMcpFormErrors((prev) => ({ ...prev, [server.type]: "" }));
      if (server.hasGlobalCredentials) {
        try {
          const detail: AdminMcpGlobalCredsDetail = await getAdminMcpGlobalCreds(
            userId,
            server.type,
          );
          setGlobalMcpExistingKeys((prev) => ({
            ...prev,
            [server.type]: detail.credentialKeys ?? [],
          }));
        } catch (err) {
          setGlobalMcpFormErrors((prev) => ({
            ...prev,
            [server.type]:
              err instanceof Error ? err.message : "Failed to load existing keys",
          }));
        }
      } else {
        setGlobalMcpExistingKeys((prev) => ({ ...prev, [server.type]: [] }));
      }
    },
    [userId, globalMcpFields],
  );

  const handleCloseForm = (type: string) => {
    setGlobalMcpForms((prev) => {
      const next = { ...prev };
      delete next[type];
      return next;
    });
  };

  const handleFormChange = (type: string, fieldName: string, value: string) => {
    setGlobalMcpForms((prev) => ({
      ...prev,
      [type]: { ...(prev[type] ?? {}), [fieldName]: value },
    }));
  };

  const handleSaveForm = async (server: AdminMcpServerSummary) => {
    const formValues = globalMcpForms[server.type] ?? {};
    const fields = globalMcpFields[server.type] ?? [];
    const credentials: Record<string, string> = {};
    const missing: string[] = [];
    for (const f of fields) {
      const v = (formValues[f.name] ?? "").trim();
      if (v) credentials[f.name] = v;
      else if (!f.optional) missing.push(f.label);
    }
    if (missing.length > 0) {
      setGlobalMcpFormErrors((prev) => ({
        ...prev,
        [server.type]: `Missing required field(s): ${missing.join(", ")}`,
      }));
      return;
    }
    if (Object.keys(credentials).length === 0) {
      setGlobalMcpFormErrors((prev) => ({
        ...prev,
        [server.type]: "Provide at least one credential field",
      }));
      return;
    }
    setGlobalMcpSaving(server.type);
    setGlobalMcpFormErrors((prev) => ({ ...prev, [server.type]: "" }));
    try {
      await setAdminMcpGlobalCreds(userId, server.type, credentials);
      handleCloseForm(server.type);
      showSnackbar({ variant: "success", title: `${server.name} credentials saved` });
      loadGlobalMcpServers();
    } catch (err) {
      setGlobalMcpFormErrors((prev) => ({
        ...prev,
        [server.type]: err instanceof Error ? err.message : "Save failed",
      }));
    } finally {
      setGlobalMcpSaving(null);
    }
  };

  const confirmDeleteCreds = async () => {
    if (!deleteCredsTarget) return;
    try {
      await deleteAdminMcpGlobalCreds(userId, deleteCredsTarget.type);
      showSnackbar({
        variant: "success",
        title: `${deleteCredsTarget.name} credentials deleted`,
      });
      loadGlobalMcpServers();
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: err instanceof Error ? err.message : "Failed to delete",
      });
    } finally {
      setDeleteCredsTarget(null);
    }
  };

  /* ── Scheduled jobs handler ────────────────────────────────────── */

  const confirmCancelJob = async () => {
    if (!cancelJobTarget) return;
    try {
      await deleteScheduledJob(cancelJobTarget.id);
      showSnackbar({ variant: "success", title: "Scheduled job cancelled" });
      loadScheduledJobs();
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: err instanceof Error ? err.message : "Failed to cancel",
      });
    } finally {
      setCancelJobTarget(null);
    }
  };

  /* ── Admin role handlers ───────────────────────────────────────── */

  const handleGrant = async () => {
    if (!newAdminId.trim()) return;
    try {
      await grantAdmin(userId, newAdminId.trim());
      showSnackbar({ variant: "success", title: "Admin granted" });
      setNewAdminId("");
      load();
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: err instanceof Error ? err.message : "Failed to grant admin",
      });
    }
  };

  const confirmRevoke = async () => {
    if (!revokeTarget) return;
    try {
      await revokeAdmin(userId, revokeTarget.userId);
      showSnackbar({ variant: "success", title: "Admin revoked" });
      load();
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: err instanceof Error ? err.message : "Failed to revoke",
      });
    } finally {
      setRevokeTarget(null);
    }
  };

  const handleGrantSearchEval = async () => {
    if (!newSearchEvalUserId.trim()) return;
    try {
      await grantAdmin(userId, newSearchEvalUserId.trim(), "SEARCH_EVAL_ACCESS");
      showSnackbar({ variant: "success", title: "Search Eval access granted" });
      setNewSearchEvalUserId("");
      load();
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: err instanceof Error ? err.message : "Failed to grant access",
      });
    }
  };

  const confirmRevokeSearchEval = async () => {
    if (!revokeSearchEvalTarget) return;
    try {
      await revokeAdmin(userId, revokeSearchEvalTarget.userId, "SEARCH_EVAL_ACCESS");
      showSnackbar({ variant: "success", title: "Search Eval access revoked" });
      load();
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: err instanceof Error ? err.message : "Failed to revoke",
      });
    } finally {
      setRevokeSearchEvalTarget(null);
    }
  };

  /* ── Agent action handlers ─────────────────────────────────────── */

  const confirmPromote = async () => {
    if (!promoteTarget) return;
    try {
      await promoteAgent(promoteTarget.slug, userId);
      showSnackbar({ variant: "success", title: `${promoteTarget.name} promoted` });
      load();
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: err instanceof Error ? err.message : "Promote failed",
      });
    } finally {
      setPromoteTarget(null);
    }
  };

  const confirmDemote = async () => {
    if (!demoteTarget) return;
    try {
      await demoteAgent(demoteTarget.slug, userId);
      showSnackbar({ variant: "success", title: `${demoteTarget.name} demoted` });
      load();
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: err instanceof Error ? err.message : "Demote failed",
      });
    } finally {
      setDemoteTarget(null);
    }
  };

  const confirmDeleteAgent = async () => {
    if (!deleteAgentTarget) return;
    try {
      await deleteAgent(deleteAgentTarget.slug, userId);
      showSnackbar({ variant: "success", title: `${deleteAgentTarget.name} deleted` });
      load();
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: err instanceof Error ? err.message : "Delete failed",
      });
    } finally {
      setDeleteAgentTarget(null);
    }
  };

  /* ── View agent ────────────────────────────────────────────────── */

  const handleViewAgent = useCallback(async (slug: string) => {
    setViewingAgentSlug(slug);
    setViewingLoading(true);
    setViewingAgent(null);
    try {
      const agent = await getAgentDetail(slug);
      setViewingAgent(agent);
    } catch (err) {
      console.error("[admin] view agent error:", err);
    } finally {
      setViewingLoading(false);
    }
  }, []);

  const handleCloseViewAgent = useCallback(() => {
    setViewingAgentSlug(null);
    setViewingAgent(null);
  }, []);

  /* ── Spaces App flow ───────────────────────────────────────────── */

  const startSpacesFlow = useCallback(
    async (requestId: string, agentSlug: string) => {
      try {
        await approveRequest(requestId, userId);
      } catch (err) {
        showSnackbar({
          variant: "error",
          title: err instanceof Error ? err.message : "Approval failed",
        });
        return;
      }
      try {
        const agent = await getAgentDetail(agentSlug);
        if (agent.spacesAppId && agent.spacesAppTokenConfigured) {
          setSpacesFlow({ requestId, agentSlug, step: "done" });
        } else if (agent.spacesAppId) {
          setSpacesFlow({ requestId, agentSlug, step: "install" });
        } else {
          setSpacesFlow({ requestId, agentSlug, step: "create" });
        }
      } catch {
        setSpacesFlow({ requestId, agentSlug, step: "create" });
      }
      load();
    },
    [userId, load, showSnackbar],
  );

  const handleSpacesStep = useCallback(
    async (step: "create" | "install" | "configure" | "grant") => {
      if (!spacesFlow) return;
      const { agentSlug } = spacesFlow;
      const loadingStep =
        step === "create"
          ? "creating"
          : step === "install"
            ? "installing"
            : step === "configure"
              ? "configuring"
              : "granting";
      setSpacesFlow((f) => (f ? { ...f, step: loadingStep, error: undefined } : f));
      try {
        if (step === "create") {
          await createAgentApp(agentSlug);
          setSpacesFlow((f) => (f ? { ...f, step: "install" } : f));
        } else if (step === "install") {
          await installAgentApp(agentSlug);
          setSpacesFlow((f) => (f ? { ...f, step: "configure" } : f));
        } else if (step === "configure") {
          await configureAgentWebhook(agentSlug);
          setSpacesFlow((f) => (f ? { ...f, step: "grant" } : f));
        } else {
          await grantAgentPermissions(agentSlug);
          setSpacesFlow((f) => (f ? { ...f, step: "upload" } : f));
        }
        load();
      } catch (err) {
        console.error(`[admin] spaces ${step} error:`, err);
        setSpacesFlow((f) =>
          f ? { ...f, step, error: `Failed to ${step}. Try again.` } : f,
        );
      }
    },
    [spacesFlow, load],
  );

  const handlePictureFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!spacesFlow) return;
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setSpacesFlow((f) => (f ? { ...f, error: "Please pick an image file" } : f));
        return;
      }
      const { agentSlug } = spacesFlow;
      setSpacesFlow((f) => (f ? { ...f, step: "uploading", error: undefined } : f));
      try {
        await uploadAgentPicture(agentSlug, file);
        setSpacesFlow((f) => (f ? { ...f, step: "done" } : f));
        load();
      } catch (err) {
        setSpacesFlow((f) =>
          f
            ? {
                ...f,
                step: "upload",
                error: err instanceof Error ? err.message : "Upload failed",
              }
            : f,
        );
      }
    },
    [spacesFlow, load],
  );

  const handleSkipUpload = useCallback(() => {
    setSpacesFlow((f) => (f ? { ...f, step: "done" } : f));
  }, []);

  // Grant is recommended but skippable — a failed/deferred grant must not strand
  // the admin on the step. Skipping proceeds to the (optional) picture upload.
  const handleSkipGrant = useCallback(() => {
    setSpacesFlow((f) => (f ? { ...f, step: "upload" } : f));
  }, []);

  const handleCreateSlackApp = useCallback(async (agent: AgentLight) => {
    setSlackCreatingSlug(agent.slug);
    try {
      const created = await createSlackAgentApp(agent.slug, agent.orgId);
      setSlackAgentStatuses((current) => {
        const existing = current[agent.id];
        return {
          ...current,
          [agent.id]: created.reused && existing ? {
            ...existing,
            appId: created.appId,
            installUrl: created.installUrl,
          } : {
            agentId: agent.id,
            agentSlug: agent.slug,
            appId: created.appId,
            status: "created",
            installs: [],
            installUrl: created.installUrl,
            manifestStale: false,
          },
        };
      });
      setSlackInstall({ agent, appId: created.appId });
      showSnackbar({
        variant: "success",
        title: created.reused ? `Slack app ready for ${agent.name}` : `Slack app created for ${agent.name}`,
      });
    } catch (error) {
      showSnackbar({
        variant: "error",
        title: error instanceof Error ? error.message : "Failed to create Slack app",
      });
    } finally {
      setSlackCreatingSlug(null);
    }
  }, [showSnackbar]);

  const openFreshSlackInstall = useCallback(async (agent: AgentLight) => {
    setSlackCreatingSlug(agent.slug);
    try {
      const created = await createSlackAgentApp(agent.slug, agent.orgId);
      setSlackAgentStatuses((current) => {
        const existing = current[agent.id];
        return {
          ...current,
          [agent.id]: created.reused && existing ? {
            ...existing,
            appId: created.appId,
            installUrl: created.installUrl,
          } : {
            agentId: agent.id,
            agentSlug: agent.slug,
            appId: created.appId,
            status: "created",
            installs: [],
            installUrl: created.installUrl,
            manifestStale: false,
          },
        };
      });
      if (slackFocusListenerRef.current) {
        window.removeEventListener("focus", slackFocusListenerRef.current);
      }
      const refreshOnce = () => {
        window.removeEventListener("focus", refreshOnce);
        slackFocusListenerRef.current = null;
        void loadSlackAgentStatuses();
      };
      slackFocusListenerRef.current = refreshOnce;
      window.addEventListener("focus", refreshOnce, { once: true });
      window.open(created.installUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      showSnackbar({
        variant: "error",
        title: error instanceof Error ? error.message : "Failed to open Slack install",
      });
    } finally {
      setSlackCreatingSlug(null);
    }
  }, [loadSlackAgentStatuses, showSnackbar]);

  const updateSlackAppAndReinstall = useCallback(async (agent: AgentLight) => {
    setSlackCreatingSlug(agent.slug);
    try {
      const synced = await syncSlackAgentApp(agent.slug, agent.orgId);
      if (slackFocusListenerRef.current) {
        window.removeEventListener("focus", slackFocusListenerRef.current);
      }
      const refreshOnce = () => {
        window.removeEventListener("focus", refreshOnce);
        slackFocusListenerRef.current = null;
        void loadSlackAgentStatuses();
      };
      slackFocusListenerRef.current = refreshOnce;
      window.addEventListener("focus", refreshOnce, { once: true });
      window.open(synced.installUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      showSnackbar({
        variant: "error",
        title: error instanceof Error ? error.message : "Failed to update Slack app",
      });
    } finally {
      setSlackCreatingSlug(null);
    }
  }, [loadSlackAgentStatuses, showSnackbar]);

  const handleRemoveSlackRegistration = useCallback(async (agent: AgentLight) => {
    try {
      await removeSlackAgentRegistration(agent.slug, agent.orgId);
      setSlackAgentStatuses((current) => {
        const next = { ...current };
        delete next[agent.id];
        return next;
      });
      showSnackbar({
        variant: "success",
        title: `Slack registration removed for ${agent.name}`,
        description: "If the Slack app still exists, delete it in the Slack console too.",
      });
    } catch (error) {
      showSnackbar({
        variant: "error",
        title: error instanceof Error ? error.message : "Failed to remove Slack registration",
      });
    }
  }, [showSnackbar]);

  const handleSlackAction = useCallback((agent: AgentLight) => {
    const status = slackAgentStatuses[agent.id];
    if (status && status.status !== "command") {
      void openFreshSlackInstall(agent);
      return;
    }
    // New registration (or command-only so far): let the admin choose between
    // a slash command on the org's umbrella app and a dedicated Slack app.
    setSlackChoice({
      agent,
      commandName: status?.commandName ?? `/${agent.slug}`,
    });
  }, [openFreshSlackInstall, slackAgentStatuses]);

  const handleRegisterSlackCommand = useCallback(async () => {
    if (!slackChoice) return;
    const { agent, commandName } = slackChoice;
    setSlackRegisteringCommand(true);
    try {
      const registered = await registerSlackCommand(agent.slug, {
        ...(agent.orgId ? { orgId: agent.orgId } : {}),
        commandName,
      });
      setSlackAgentStatuses((current) => ({
        ...current,
        [agent.id]: {
          ...(current[agent.id] ?? {
            agentId: agent.id,
            agentSlug: agent.slug,
            appId: "",
            status: "command" as const,
            installs: [],
            installUrl: null,
            manifestStale: false,
          }),
          commandName: registered.commandName,
          ...(current[agent.id] ? {} : { status: "command" as const }),
        },
      }));
      showSnackbar({
        variant: "success",
        title: `${registered.commandName} is live in Slack`,
        description: `${agent.name} now answers ${registered.commandName} in every channel of the connected workspace.`,
      });
      setSlackChoice(null);
    } catch (error) {
      showSnackbar({
        variant: "error",
        title: error instanceof Error ? error.message : "Failed to register Slack command",
      });
    } finally {
      setSlackRegisteringCommand(false);
    }
  }, [showSnackbar, slackChoice]);

  const openRowPicturePicker = useCallback((slug: string) => {
    setRowUploadSlug(slug);
    rowPictureInputRef.current?.click();
  }, []);

  const handleRowPictureChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const slug = rowUploadSlug;
      const file = e.target.files?.[0];
      e.target.value = "";
      setRowUploadSlug(null);
      if (!slug || !file) return;
      if (!file.type.startsWith("image/")) {
        showSnackbar({ variant: "error", title: `${slug}: image file required` });
        return;
      }
      try {
        await uploadAgentPicture(slug, file);
        showSnackbar({ variant: "success", title: "Picture uploaded" });
        load();
      } catch (err) {
        showSnackbar({
          variant: "error",
          title: err instanceof Error ? `${slug}: ${err.message}` : `${slug}: upload failed`,
        });
      }
    },
    [rowUploadSlug, load, showSnackbar],
  );

  /* ── Request reject handler ───────────────────────────────────── */

  const handleConfirmRejectRequest = async () => {
    if (!rejectingRequestId) return;
    try {
      await rejectRequest(rejectingRequestId, userId, requestRejectNote.trim() || undefined);
      showSnackbar({ variant: "success", title: "Request rejected" });
      setRejectingRequestId(null);
      setRequestRejectNote("");
      load();
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: err instanceof Error ? err.message : "Reject failed",
      });
    }
  };

  /* ── Derived ──────────────────────────────────────────────────── */

  const globalAgents = useMemo(
    () => agents.filter((a) => a.scope === "global"),
    [agents],
  );
  const personalAgents = useMemo(
    () => agents.filter((a) => a.scope !== "global"),
    [agents],
  );

  const tabItems: TabItem<TabKey>[] = useMemo(
    () => [
      { id: "requests", label: requests.length > 0 ? `Requests (${requests.length})` : "Requests" },
      { id: "connectors", label: (mcpRequests.length + mcpEditRequests.length) > 0 ? `MCP Publish (${mcpRequests.length + mcpEditRequests.length})` : "MCP Publish" },
      { id: "workflowreqs", label: workflowRequests.length > 0 ? `Workflow Requests (${workflowRequests.length})` : "Workflow Requests" },
      { id: "agents", label: `Agents (${agents.length})` },
      { id: "admins", label: `Admins (${admins.length})` },
      { id: "audit", label: auditTotal > 0 ? `Audit (${auditTotal})` : "Audit" },
      { id: "usage", label: "Usage" },
      { id: "scheduled", label: scheduledTotal > 0 ? `Scheduled (${scheduledTotal})` : "Scheduled" },
      { id: "globalmcp", label: "Global MCP" },
    ],
    [requests.length, mcpRequests.length, mcpEditRequests.length, workflowRequests.length, agents.length, admins.length, auditTotal, scheduledTotal],
  );

  /* ── Render ───────────────────────────────────────────────────── */

  return (
    <>
      <PageLayout
        header={
          <div className="shrink-0 border-b border-xyne-border-subtle">
            <div className="mx-auto w-full px-[24px] py-xyne-header">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 inline-flex shrink-0 items-center justify-center">
                    <ShieldIcon
                      size={22}
                      weight="regular"
                      className="text-xyne-error-fg"
                    />
                  </span>
                  <div>
                    <h1 className="text-xl font-semibold text-xyne-fg-primary">
                      Admin Panel
                    </h1>
                    <p className="mt-1 text-[14px] text-xyne-fg-muted">
                      Manage requests, agents, admins, and platform settings
                    </p>
                  </div>
                </div>
                <label className="mt-1 flex shrink-0 items-center gap-2 text-[12px] text-xyne-fg-muted">
                  <Switch checked={allOrgs} onChange={setAllOrgs} />
                  All orgs
                </label>
              </div>
            </div>
          </div>
        }
        filterTab={
          <div className="mx-auto w-full px-[24px]">
            <Tabs
              items={tabItems}
              selected={tab}
              onSelect={(t) => setTab(t)}
              className="justify-center"
            />
          </div>
        }
        body={
          // Full-width body so admin tables (Audit, Scheduled, Usage) use the
          // whole panel; the left/right edges stay aligned with the header/tabs
          // above, which are also full width.
          <div className="mx-auto w-full px-[24px] pb-[24px]">
            {loading && agents.length === 0 ? (
              <div className="flex items-center gap-2 py-12 text-[13px] text-xyne-fg-muted">
                <SpinnerGapIcon size={16} className="animate-spin" />
                Loading admin panel…
              </div>
            ) : (
              <>
                {tab === "requests" && (
                  <RequestsTab
                    requests={requests}
                    spacesFlow={spacesFlow}
                    onView={handleViewAgent}
                    onApproveSkill={async (id) => {
                      try {
                        await approveRequest(id, userId);
                        showSnackbar({ variant: "success", title: "Skill approved" });
                        load();
                      } catch (err) {
                        showSnackbar({
                          variant: "error",
                          title: err instanceof Error ? err.message : "Approve failed",
                        });
                      }
                    }}
                    onStartSpacesFlow={startSpacesFlow}
                    onReject={(id) => {
                      setRejectingRequestId(id);
                      setRequestRejectNote("");
                    }}
                    onSpacesStep={handleSpacesStep}
                    onPictureClick={() => pictureInputRef.current?.click()}
                    onSkipUpload={handleSkipUpload}
                    onSkipGrant={handleSkipGrant}
                    onDismissSpaces={() => setSpacesFlow(null)}
                    pictureInputRef={pictureInputRef}
                    onPictureChange={handlePictureFileChange}
                    showOrgLabels={allOrgs}
                  />
                )}

                {tab === "connectors" && (
                  <ConnectorsTab
                    loading={mcpRequestsLoading}
                    mcpRequests={mcpRequests}
                    rejectingId={mcpRejectingId}
                    rejectNote={mcpRejectNote}
                    onRejectNoteChange={setMcpRejectNote}
                    onStartReject={(id) => {
                      setMcpRejectingId(id);
                      setMcpRejectNote("");
                    }}
                    onCancelReject={() => {
                      setMcpRejectingId(null);
                      setMcpRejectNote("");
                    }}
                    onApprove={handleApproveMcp}
                    onConfirmReject={handleRejectMcp}
                    editLoading={mcpEditRequestsLoading}
                    editRequests={mcpEditRequests}
                    editRejectingId={mcpEditRejectingId}
                    editRejectNote={mcpEditRejectNote}
                    onEditRejectNoteChange={setMcpEditRejectNote}
                    onEditStartReject={(id) => {
                      setMcpEditRejectingId(id);
                      setMcpEditRejectNote("");
                    }}
                    onEditCancelReject={() => {
                      setMcpEditRejectingId(null);
                      setMcpEditRejectNote("");
                    }}
                    onEditApprove={handleApproveMcpEdit}
                    onEditConfirmReject={handleRejectMcpEdit}
                  />
                )}

                {tab === "workflowreqs" && (
                  <WorkflowRequestsTab
                    loading={workflowRequestsLoading}
                    requests={workflowRequests}
                    rejectingId={workflowRejectingId}
                    rejectNote={workflowRejectNote}
                    onRejectNoteChange={setWorkflowRejectNote}
                    onStartReject={(id) => { setWorkflowRejectingId(id); setWorkflowRejectNote(""); }}
                    onCancelReject={() => { setWorkflowRejectingId(null); setWorkflowRejectNote(""); }}
                    onApprove={handleApproveWorkflow}
                    onConfirmReject={handleRejectWorkflow}
                    showOrgLabels={allOrgs}
                  />
                )}

                {tab === "agents" && (
                  <AgentsTab
                    globalAgents={globalAgents}
                    personalAgents={personalAgents}
                    spacesFlow={spacesFlow}
                    slackCreatingSlug={slackCreatingSlug}
                    slackAgentStatuses={slackAgentStatuses}
                    slackStatusesReady={slackStatusesReady}
                    onResumeSetup={(a, hasApp) =>
                      setSpacesFlow({
                        requestId: "",
                        agentSlug: a.slug,
                        step: hasApp ? "install" : "create",
                      })
                    }
                    onUploadPicture={openRowPicturePicker}
                    onSlackAction={handleSlackAction}
                    onUpdateSlackApp={updateSlackAppAndReinstall}
                    onRemoveSlack={handleRemoveSlackRegistration}
                    onPromote={setPromoteTarget}
                    onDemote={setDemoteTarget}
                    onDelete={setDeleteAgentTarget}
                    onSpacesStep={handleSpacesStep}
                    onDismissSpaces={() => setSpacesFlow(null)}
                    showOrgLabels={allOrgs}
                  />
                )}

                {tab === "admins" && (
                  <AdminsTab
                    admins={admins}
                    currentUserId={userId}
                    newAdminId={newAdminId}
                    onNewAdminIdChange={setNewAdminId}
                    onGrant={handleGrant}
                    onRevoke={setRevokeTarget}
                    searchEvalUsers={searchEvalUsers}
                    newSearchEvalUserId={newSearchEvalUserId}
                    onNewSearchEvalUserIdChange={setNewSearchEvalUserId}
                    onGrantSearchEval={handleGrantSearchEval}
                    onRevokeSearchEval={setRevokeSearchEvalTarget}
                    showOrgLabels={allOrgs}
                  />
                )}

                {tab === "audit" && (
                  <AuditTab
                    loading={auditLoading}
                    logs={logs}
                    total={auditTotal}
                    offset={auditOffset}
                    pageSize={AUDIT_PAGE_SIZE}
                    showOrgLabels={allOrgs}
                    agentOptions={agents.map((a) => ({ value: a.id, label: a.name }))}
                    eventFilter={auditEventFilter}
                    onEventFilterChange={(v) => {
                      setAuditOffset(0);
                      setAuditEventFilter(v);
                    }}
                    agentFilter={auditAgentFilter}
                    onAgentFilterChange={(v) => {
                      setAuditOffset(0);
                      setAuditAgentFilter(v);
                    }}
                    rangeFilter={auditRange}
                    onRangeFilterChange={(v) => {
                      setAuditOffset(0);
                      setAuditRange(v);
                    }}
                    onPrev={() => setAuditOffset((o) => Math.max(0, o - AUDIT_PAGE_SIZE))}
                    onNext={() => setAuditOffset((o) => o + AUDIT_PAGE_SIZE)}
                  />
                )}

                {tab === "usage" && (
                  <UsageTab
                    loading={usageLoading}
                    stats={usageStats}
                    range={usageRange}
                    onRangeChange={setUsageRange}
                    showOrgLabels={allOrgs}
                  />
                )}

                {tab === "scheduled" && (
                  <ScheduledTab
                    loading={scheduledLoading}
                    jobs={scheduledJobs}
                    total={scheduledTotal}
                    offset={scheduledOffset}
                    pageSize={SCHEDULED_PAGE_SIZE}
                    statusFilter={scheduledStatusFilter}
                    onStatusFilterChange={(s) => {
                      setScheduledOffset(0);
                      setScheduledStatusFilter(s);
                    }}
                    agentOptions={agents.map((a) => ({ value: a.slug, label: a.name }))}
                    agentFilter={scheduledAgentFilter}
                    onAgentFilterChange={(v) => {
                      setScheduledOffset(0);
                      setScheduledAgentFilter(v);
                    }}
                    userOptions={scheduledUserOptions}
                    userFilter={scheduledUserFilter}
                    onUserFilterChange={(v) => {
                      setScheduledOffset(0);
                      setScheduledUserFilter(v);
                    }}
                    onPrev={() =>
                      setScheduledOffset(Math.max(0, scheduledOffset - SCHEDULED_PAGE_SIZE))
                    }
                    onNext={() => setScheduledOffset(scheduledOffset + SCHEDULED_PAGE_SIZE)}
                    onCancel={setCancelJobTarget}
                    showOrgLabels={allOrgs}
                  />
                )}

                {tab === "globalmcp" && (
                  <GlobalMcpTab
                    loading={globalMcpLoading}
                    servers={globalMcpServers}
                    fields={globalMcpFields}
                    forms={globalMcpForms}
                    existingKeys={globalMcpExistingKeys}
                    formErrors={globalMcpFormErrors}
                    saving={globalMcpSaving}
                    onToggleFallback={handleToggleFallback}
                    onOpenForm={handleOpenForm}
                    onCloseForm={handleCloseForm}
                    onFormChange={handleFormChange}
                    onSave={handleSaveForm}
                    onDeleteCreds={setDeleteCredsTarget}
                  />
                )}
              </>
            )}

            {/* Hidden row picture input shared across agent rows */}
            <input
              ref={rowPictureInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleRowPictureChange}
            />
          </div>
        }
      />

      {/* View-agent modal */}
      <Dialog
        open={Boolean(viewingAgentSlug)}
        onOpenChange={(open) => {
          if (!open) handleCloseViewAgent();
        }}
        title={`Agent: ${viewingAgentSlug ?? ""}`}
        maxWidth={720}
      >
        {viewingLoading ? (
          <p className="text-[13px] text-xyne-fg-muted">Loading agent details…</p>
        ) : !viewingAgent ? (
          <p className="text-[13px] text-xyne-error-fg">Failed to load agent.</p>
        ) : (
          <ViewAgentBody agent={viewingAgent} />
        )}
      </Dialog>

      <Dialog
        open={slackInstall !== null}
        onOpenChange={(open) => { if (!open) setSlackInstall(null); }}
        title="Slack app created"
        description={slackInstall ? `${slackInstall.agent.name} is ready to install in a Slack workspace.` : undefined}
        footer={
          slackInstall ? (
            <Button
              variant="primary"
              leadingIcon={<SlackLogoIcon size={14} />}
              onClick={() => void openFreshSlackInstall(slackInstall.agent)}
            >
              Install to workspace
            </Button>
          ) : undefined
        }
      >
        <p className="text-[13px] text-xyne-fg-secondary">
          Slack app ID: <span className="font-mono text-xyne-fg-primary">{slackInstall?.appId}</span>
        </p>
      </Dialog>

      {/* Slack surface choice: umbrella command vs dedicated app */}
      <Dialog
        open={slackChoice !== null}
        onOpenChange={(open) => { if (!open) setSlackChoice(null); }}
        title={slackChoice ? `Add ${slackChoice.agent.name} to Slack` : "Add to Slack"}
        description="How should people reach this agent?"
      >
        {slackChoice ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-xyne-border-subtle p-3 flex flex-col gap-2">
              <p className="text-[13px] font-medium text-xyne-fg-primary">⚡ Command on the Xyne app (recommended)</p>
              <p className="text-[12px] text-xyne-fg-secondary">
                Works in every channel immediately — no install, no approval. Replies post
                in-channel; follow-ups continue in the thread.
              </p>
              <TextField
                label="Command"
                value={slackChoice.commandName}
                onChange={(e) => {
                  const value = e.target.value;
                  setSlackChoice((current) => current ? { ...current, commandName: value } : current);
                }}
                placeholder={`/${slackChoice.agent.slug}`}
              />
              <Button
                variant="primary"
                size="sm"
                disabled={slackRegisteringCommand}
                onClick={() => void handleRegisterSlackCommand()}
              >
                {slackRegisteringCommand ? "Registering…" : "Register command"}
              </Button>
            </div>
            <div className="rounded-lg border border-xyne-border-subtle p-3 flex flex-col gap-2">
              <p className="text-[13px] font-medium text-xyne-fg-primary">🤖 Its own Slack app</p>
              <p className="text-[12px] text-xyne-fg-secondary">
                A real @{slackChoice.agent.slug} bot: DM it, @mention it, its own name and avatar.
                Requires a workspace install (and possibly Slack-admin approval).
              </p>
              <Button
                variant="secondary"
                size="sm"
                disabled={slackRegisteringCommand}
                onClick={() => {
                  const agent = slackChoice.agent;
                  setSlackChoice(null);
                  void handleCreateSlackApp(agent);
                }}
              >
                Create dedicated app
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>

      {/* Reject request inline */}
      <Dialog
        open={rejectingRequestId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRejectingRequestId(null);
            setRequestRejectNote("");
          }
        }}
        title="Reject request"
        description="Optional rejection reason shown to the requester."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setRejectingRequestId(null);
                setRequestRejectNote("");
              }}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmRejectRequest}>
              Reject
            </Button>
          </>
        }
      >
        <TextField
          multiline
          rows={4}
          placeholder="Reason for rejection (optional)…"
          value={requestRejectNote}
          onChange={(e) => setRequestRejectNote(e.target.value)}
        />
      </Dialog>

      {/* Confirms */}
      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => { if (!open) setRevokeTarget(null); }}
        title="Revoke admin"
        description={
          revokeTarget
            ? `Revoke CLAW_ADMIN from ${revokeTarget.user.name} (${revokeTarget.user.email})?`
            : ""
        }
        confirmLabel="Revoke"
        danger
        onConfirm={confirmRevoke}
      />
      <ConfirmDialog
        open={Boolean(revokeSearchEvalTarget)}
        onOpenChange={(open) => { if (!open) setRevokeSearchEvalTarget(null); }}
        title="Revoke Search Eval access"
        description={
          revokeSearchEvalTarget
            ? `Revoke Search Eval access from ${revokeSearchEvalTarget.user.name} (${revokeSearchEvalTarget.user.email})?`
            : ""
        }
        confirmLabel="Revoke"
        danger
        onConfirm={confirmRevokeSearchEval}
      />
      <ConfirmDialog
        open={Boolean(promoteTarget)}
        onOpenChange={(open) => { if (!open) setPromoteTarget(null); }}
        title="Promote agent"
        description={promoteTarget ? `Promote "${promoteTarget.name}" to global?` : ""}
        confirmLabel="Promote"
        onConfirm={confirmPromote}
      />
      <ConfirmDialog
        open={Boolean(demoteTarget)}
        onOpenChange={(open) => { if (!open) setDemoteTarget(null); }}
        title="Demote agent"
        description={demoteTarget ? `Demote "${demoteTarget.name}" to personal?` : ""}
        confirmLabel="Demote"
        onConfirm={confirmDemote}
      />
      <ConfirmDialog
        open={Boolean(deleteAgentTarget)}
        onOpenChange={(open) => { if (!open) setDeleteAgentTarget(null); }}
        title="Delete agent"
        description={
          deleteAgentTarget
            ? `Delete "${deleteAgentTarget.name}"? This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        danger
        onConfirm={confirmDeleteAgent}
      />
      <ConfirmDialog
        open={Boolean(deleteCredsTarget)}
        onOpenChange={(open) => { if (!open) setDeleteCredsTarget(null); }}
        title="Delete global credentials"
        description={
          deleteCredsTarget
            ? `Delete global credentials for ${deleteCredsTarget.name}? Users without personal connections will lose access until you set new ones.`
            : ""
        }
        confirmLabel="Delete"
        danger
        onConfirm={confirmDeleteCreds}
      />
      <ConfirmDialog
        open={Boolean(cancelJobTarget)}
        onOpenChange={(open) => { if (!open) setCancelJobTarget(null); }}
        title="Cancel scheduled job"
        description={
          cancelJobTarget
            ? `Cancel "${cancelJobTarget.label ?? cancelJobTarget.id}" for ${cancelJobTarget.user?.email ?? cancelJobTarget.userId}?`
            : ""
        }
        confirmLabel="Cancel job"
        danger
        onConfirm={confirmCancelJob}
      />
    </>
  );
}

/* ════════════════════════════════════════════════════════════════════ */
/*  TAB SECTIONS                                                         */
/* ════════════════════════════════════════════════════════════════════ */

function RequestsTab({
  requests,
  spacesFlow,
  onView,
  onApproveSkill,
  onStartSpacesFlow,
  onReject,
  onSpacesStep,
  onPictureClick,
  onSkipUpload,
  onSkipGrant,
  onDismissSpaces,
  pictureInputRef,
  onPictureChange,
  showOrgLabels,
}: {
  requests: AgentRequestItem[];
  spacesFlow: SpacesFlow | null;
  onView: (slug: string) => void;
  onApproveSkill: (id: string) => void | Promise<void>;
  onStartSpacesFlow: (id: string, slug: string) => void;
  onReject: (id: string) => void;
  onSpacesStep: (step: "create" | "install" | "configure" | "grant") => void | Promise<void>;
  onPictureClick: () => void;
  onSkipUpload: () => void;
  onSkipGrant: () => void;
  onDismissSpaces: () => void;
  pictureInputRef: React.RefObject<HTMLInputElement | null>;
  onPictureChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  showOrgLabels: boolean;
}) {
  return (
    <div className="space-y-3 pt-4">
      {requests.length === 0 && !spacesFlow ? (
        <EmptyHint>No pending requests.</EmptyHint>
      ) : (
        requests.map((r) => (
          <div
            key={r.id}
            className="rounded-xl border border-xyne-border bg-xyne-surface px-4 py-3"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    as="span"
                    size="sm"
                    variant={r.targetType === "skill" ? "warning" : "info"}
                    label={r.targetType === "skill" ? "Skill" : "Agent"}
                  />
                  <Badge
                    as="span"
                    size="sm"
                    variant={r.requestType === "push_to_global" ? "success" : "info"}
                    label={r.requestType === "push_to_global" ? "Push to Global" : "Push to Spaces"}
                  />
                  <span className="text-[13px] font-medium text-xyne-fg-primary">
                    {r.targetType === "skill"
                      ? (r.skillName ?? r.skillSlug)
                      : (r.agentName ?? r.agentSlug)}
                  </span>
                  {showOrgLabels && <OrgBadge orgName={r.orgName} orgId={r.orgId} />}
                </div>
                <p className="mt-1 text-[11px] text-xyne-fg-tertiary">
                  by {r.requesterName ?? r.requesterId}
                  {r.requesterEmail ? ` (${r.requesterEmail})` : ""} ·{" "}
                  {new Date(r.createdAt).toLocaleString()}
                </p>
                {r.agentOwnerName && (
                  <p className="mt-0.5 text-[11px] text-xyne-fg-muted">
                    Agent created by: {r.agentOwnerName}
                    {r.agentOwnerEmail ? ` (${r.agentOwnerEmail})` : ""}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {r.targetType === "agent" && r.agentSlug && (
                  <Button
                    size="sm"
                    variant="ghost"
                    leadingIcon={<EyeIcon size={14} />}
                    onClick={() => onView(r.agentSlug!)}
                  >
                    View
                  </Button>
                )}
                {r.targetType === "skill" ? (
                  <Button
                    size="sm"
                    variant="primary"
                    leadingIcon={<CheckCircleIcon size={14} />}
                    onClick={() => onApproveSkill(r.id)}
                  >
                    Approve
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="primary"
                    leadingIcon={<CheckCircleIcon size={14} />}
                    onClick={() => onStartSpacesFlow(r.id, r.agentSlug!)}
                  >
                    Approve & Setup
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="destructive"
                  leadingIcon={<XCircleIcon size={14} />}
                  onClick={() => onReject(r.id)}
                >
                  Reject
                </Button>
              </div>
            </div>
          </div>
        ))
      )}

      {spacesFlow && (
        <SpacesFlowCard
          flow={spacesFlow}
          onStep={onSpacesStep}
          onPictureClick={onPictureClick}
          onSkipUpload={onSkipUpload}
          onSkipGrant={onSkipGrant}
          onDismiss={onDismissSpaces}
          showUploadStep
          pictureInputRef={pictureInputRef}
          onPictureChange={onPictureChange}
        />
      )}
    </div>
  );
}

function SpacesFlowCard({
  flow,
  onStep,
  onPictureClick,
  onSkipUpload,
  onSkipGrant,
  onDismiss,
  showUploadStep,
  pictureInputRef,
  onPictureChange,
}: {
  flow: SpacesFlow;
  onStep: (step: "create" | "install" | "configure" | "grant") => void | Promise<void>;
  onPictureClick?: () => void;
  onSkipUpload?: () => void;
  onSkipGrant?: () => void;
  onDismiss: () => void;
  showUploadStep?: boolean;
  pictureInputRef?: React.RefObject<HTMLInputElement | null>;
  onPictureChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const isDone = (s: SpacesFlow["step"], threshold: SpacesFlow["step"][]) =>
    threshold.includes(s);

  return (
    <div className="rounded-xl border border-xyne-info-border bg-xyne-info-bg px-5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-[13px] font-semibold text-xyne-info-fg">
          Spaces App Setup — {flow.agentSlug}
        </h4>
        {flow.step === "done" && (
          <button
            onClick={onDismiss}
            className="text-[11px] text-xyne-fg-muted hover:text-xyne-fg-primary"
          >
            Dismiss
          </button>
        )}
      </div>

      {flow.error && (
        <p className="mb-3 text-[11px] text-xyne-error-fg">{flow.error}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <StepButton
          label="1. Create App"
          doneLabel="Created"
          state={
            flow.step === "create"
              ? "active"
              : flow.step === "creating"
                ? "loading"
                : "done"
          }
          onClick={() => onStep("create")}
        />
        <span className="text-xyne-fg-muted">→</span>
        <StepButton
          label="2. Install App"
          doneLabel="Installed"
          state={
            flow.step === "install"
              ? "active"
              : flow.step === "installing"
                ? "loading"
                : isDone(flow.step, ["configure", "configuring", "upload", "uploading", "done"])
                  ? "done"
                  : "idle"
          }
          onClick={() => onStep("install")}
        />
        <span className="text-xyne-fg-muted">→</span>
        <StepButton
          label="3. Configure Webhook"
          doneLabel="Configured"
          state={
            flow.step === "configure"
              ? "active"
              : flow.step === "configuring"
                ? "loading"
                : isDone(flow.step, ["grant", "granting", "upload", "uploading", "done"])
                  ? "done"
                  : "idle"
          }
          onClick={() => onStep("configure")}
        />
        <span className="text-xyne-fg-muted">→</span>
        <StepButton
          label="4. Grant Permissions"
          doneLabel="Permissions Granted"
          state={
            flow.step === "grant"
              ? "active"
              : flow.step === "granting"
                ? "loading"
                : isDone(flow.step, ["upload", "uploading", "done"])
                  ? "done"
                  : "idle"
          }
          onClick={() => onStep("grant")}
        />
        {flow.step === "grant" && (
          <button
            onClick={onSkipGrant}
            className="rounded-full px-3 py-2 text-[11px] text-xyne-fg-muted hover:text-xyne-fg-primary"
          >
            Skip
          </button>
        )}
        {showUploadStep && (
          <>
            <span className="text-xyne-fg-muted">→</span>
            <input
              ref={pictureInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onPictureChange}
            />
            <StepButton
              label="5. Upload Picture"
              doneLabel="Picture Set"
              state={
                flow.step === "upload"
                  ? "active"
                  : flow.step === "uploading"
                    ? "loading"
                    : flow.step === "done"
                      ? "done"
                      : "idle"
              }
              onClick={() => onPictureClick?.()}
            />
            {flow.step === "upload" && (
              <button
                onClick={onSkipUpload}
                className="rounded-full px-3 py-2 text-[11px] text-xyne-fg-muted hover:text-xyne-fg-primary"
              >
                Skip
              </button>
            )}
          </>
        )}
      </div>

      {flow.step === "done" && (
        <p className="mt-3 text-[11px] text-xyne-success-fg">
          Agent is live on Spaces.
        </p>
      )}
    </div>
  );
}

function StepButton({
  label,
  doneLabel,
  state,
  onClick,
}: {
  label: string;
  doneLabel: string;
  state: "idle" | "active" | "loading" | "done";
  onClick: () => void;
}) {
  const isActive = state === "active";
  const isLoading = state === "loading";
  const isDone = state === "done";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!isActive}
      className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
        isActive
          ? "bg-xyne-brand text-xyne-fg-inverse hover:bg-xyne-brand-hover"
          : isLoading
            ? "bg-xyne-info-bg text-xyne-info-fg"
            : isDone
              ? "bg-xyne-success-bg text-xyne-success-fg"
              : "bg-xyne-surface-sunken text-xyne-fg-tertiary"
      }`}
    >
      {isLoading ? (
        <SpinnerGapIcon size={14} className="animate-spin" />
      ) : isDone ? (
        <>
          <CheckCircleIcon size={14} /> {doneLabel}
        </>
      ) : (
        label
      )}
    </button>
  );
}

/* ── Workflow "Push to Global" requests tab ─────────────────────── */

function WorkflowRequestsTab({
  loading,
  requests,
  rejectingId,
  rejectNote,
  onRejectNoteChange,
  onStartReject,
  onCancelReject,
  onApprove,
  onConfirmReject,
  showOrgLabels,
}: {
  loading: boolean;
  requests: WorkflowGlobalRequest[];
  rejectingId: string | null;
  rejectNote: string;
  onRejectNoteChange: (v: string) => void;
  onStartReject: (id: string) => void;
  onCancelReject: () => void;
  onApprove: (id: string) => void | Promise<void>;
  onConfirmReject: (id: string) => void | Promise<void>;
  showOrgLabels: boolean;
}) {
  if (loading) return <Loading text="Loading…" />;
  if (requests.length === 0)
    return <EmptyHint>No pending workflow promotion requests.</EmptyHint>;

  return (
    <div className="space-y-3 pt-4">
      {requests.map((req) => {
        const channels = Array.from(new Set((req.workflow.bindings ?? []).map((b) => b.channelId)));
        const who = req.requestedByUser?.name || req.requestedByUser?.email || req.requestedByUserId;
        return (
          <div key={req.id} className="rounded-xl border border-xyne-border bg-xyne-surface px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-xyne-fg-primary">{req.workflow.name}</span>
                  <Badge as="span" size="sm" variant="success" label="push to global" />
                  {showOrgLabels && <OrgBadge orgName={req.orgName} orgId={req.orgId} />}
                </div>
                <p className="mt-1 text-[11px] text-xyne-fg-tertiary">
                  Requested by <span className="text-xyne-fg-secondary">{who}</span>
                  {" · "}{new Date(req.createdAt).toLocaleString()}
                </p>
                <p className="mt-1 text-[12px] text-xyne-fg-muted">
                  {channels.length > 0 ? (
                    <>Wires to all users on {channels.map((c) => (
                      <code key={c} className="mr-1 rounded bg-xyne-surface-subtle px-1 text-xyne-fg-secondary">
                        {c === "*" ? "all channels" : c}
                      </code>
                    ))}</>
                  ) : (
                    <span className="text-xyne-warning-fg">No bound channels — nothing will be wired.</span>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button size="sm" variant="primary" onClick={() => onApprove(req.id)}>Allow</Button>
                <Button size="sm" variant="destructive" onClick={() => onStartReject(req.id)}>Reject</Button>
              </div>
            </div>

            {rejectingId === req.id && (
              <div className="mt-3 rounded-lg border border-xyne-border bg-xyne-surface-subtle p-3">
                <TextField
                  multiline
                  rows={3}
                  placeholder="Reason for rejection (optional)…"
                  value={rejectNote}
                  onChange={(e) => onRejectNoteChange(e.target.value)}
                />
                <div className="mt-2 flex items-center justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={onCancelReject}>Cancel</Button>
                  <Button size="sm" variant="destructive" onClick={() => onConfirmReject(req.id)}>Confirm Reject</Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Connectors tab ────────────────────────────────────────────── */

function ConnectorsTab({
  loading,
  mcpRequests,
  rejectingId,
  rejectNote,
  onRejectNoteChange,
  onStartReject,
  onCancelReject,
  onApprove,
  onConfirmReject,
  editLoading,
  editRequests,
  editRejectingId,
  editRejectNote,
  onEditRejectNoteChange,
  onEditStartReject,
  onEditCancelReject,
  onEditApprove,
  onEditConfirmReject,
}: {
  loading: boolean;
  mcpRequests: McpServer[];
  rejectingId: string | null;
  rejectNote: string;
  onRejectNoteChange: (v: string) => void;
  onStartReject: (id: string) => void;
  onCancelReject: () => void;
  onApprove: (id: string) => void | Promise<void>;
  onConfirmReject: (id: string) => void | Promise<void>;
  editLoading: boolean;
  editRequests: McpEditRequest[];
  editRejectingId: string | null;
  editRejectNote: string;
  onEditRejectNoteChange: (v: string) => void;
  onEditStartReject: (id: string) => void;
  onEditCancelReject: () => void;
  onEditApprove: (id: string) => void | Promise<void>;
  onEditConfirmReject: (id: string) => void | Promise<void>;
}) {
  if (loading || editLoading) return <Loading text="Loading…" />;
  if (mcpRequests.length === 0 && editRequests.length === 0)
    return <EmptyHint>No pending MCP connector publish or edit requests.</EmptyHint>;

  return (
    <div className="space-y-3 pt-4">
      {editRequests.map((r) => (
        <div
          key={r.id}
          className="rounded-xl border border-xyne-border bg-xyne-surface px-4 py-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium text-xyne-fg-primary">
                  {r.mcpServer.name}
                </span>
                <Badge as="span" size="sm" label={r.mcpServer.type} />
                <Badge as="span" size="sm" label="edit" />
              </div>
              <p className="mt-1 text-[11px] text-xyne-fg-tertiary">
                Proposed by <span className="text-xyne-fg-secondary">{r.proposedByUserId}</span>
                {r.proposedAt && (
                  <> · {new Date(r.proposedAt).toLocaleString()}</>
                )}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button size="sm" variant="primary" onClick={() => onEditApprove(r.id)}>
                Approve
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => onEditStartReject(r.id)}
              >
                Reject
              </Button>
            </div>
          </div>

          {editRejectingId === r.id && (
            <div className="mt-3 rounded-lg border border-xyne-border bg-xyne-surface-subtle p-3">
              <TextField
                multiline
                rows={3}
                placeholder="Reason for rejection (shown to the requester)…"
                value={editRejectNote}
                onChange={(e) => onEditRejectNoteChange(e.target.value)}
              />
              <div className="mt-2 flex items-center justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={onEditCancelReject}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => onEditConfirmReject(r.id)}
                >
                  Confirm Reject
                </Button>
              </div>
            </div>
          )}

          <details className="mt-3">
            <summary className="cursor-pointer text-[11px] text-xyne-fg-muted hover:text-xyne-fg-primary">
              View proposed changes
            </summary>
            <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-xyne-border bg-xyne-surface-subtle p-2 text-[11px] text-xyne-fg-secondary">
{JSON.stringify(r.proposedFields, null, 2)}
            </pre>
          </details>
        </div>
      ))}
      {mcpRequests.map((s) => {
        const meta = (s.connectorMeta ?? {}) as {
          ownerUserId?: string;
          publishRequestedAt?: string;
        };
        return (
          <div
            key={s.id}
            className="rounded-xl border border-xyne-border bg-xyne-surface px-4 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-xyne-fg-primary">
                    {s.name}
                  </span>
                  <Badge as="span" size="sm" label={s.type} />
                  <Badge as="span" size="sm" label={s.transport ?? "stdio"} />
                </div>
                {s.description && (
                  <p className="mt-1 text-[12px] text-xyne-fg-muted">
                    {s.description}
                  </p>
                )}
                <p className="mt-1 text-[11px] text-xyne-fg-tertiary">
                  Owner: <span className="text-xyne-fg-secondary">{meta.ownerUserId ?? "unknown"}</span>
                  {meta.publishRequestedAt && (
                    <> · Requested {new Date(meta.publishRequestedAt).toLocaleString()}</>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button size="sm" variant="primary" onClick={() => onApprove(s.id)}>
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => onStartReject(s.id)}
                >
                  Reject
                </Button>
              </div>
            </div>

            {rejectingId === s.id && (
              <div className="mt-3 rounded-lg border border-xyne-border bg-xyne-surface-subtle p-3">
                <TextField
                  multiline
                  rows={3}
                  placeholder="Reason for rejection (shown to the connector author)…"
                  value={rejectNote}
                  onChange={(e) => onRejectNoteChange(e.target.value)}
                />
                <div className="mt-2 flex items-center justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={onCancelReject}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => onConfirmReject(s.id)}
                  >
                    Confirm Reject
                  </Button>
                </div>
              </div>
            )}

            <details className="mt-3">
              <summary className="cursor-pointer text-[11px] text-xyne-fg-muted hover:text-xyne-fg-primary">
                View connector definition
              </summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-xyne-border bg-xyne-surface-subtle p-2 text-[11px] text-xyne-fg-secondary">
{JSON.stringify(
  {
    type: s.type,
    transport: s.transport,
    credentialForm: s.credentialForm,
    launchConfigTemplate: s.launchConfigTemplate,
    httpConfigTemplate: s.httpConfigTemplate,
    healthcheckSpec: s.healthcheckSpec,
    writeToolPolicy: s.writeToolPolicy,
  },
  null,
  2,
)}
              </pre>
            </details>
          </div>
        );
      })}
    </div>
  );
}

/* ── Agents tab ────────────────────────────────────────────────── */

function AgentsTab({
  globalAgents,
  personalAgents,
  spacesFlow,
  slackCreatingSlug,
  slackAgentStatuses,
  slackStatusesReady,
  onResumeSetup,
  onSlackAction,
  onUpdateSlackApp,
  onRemoveSlack,
  onUploadPicture,
  onPromote,
  onDemote,
  onDelete,
  onSpacesStep,
  onDismissSpaces,
  showOrgLabels,
}: {
  globalAgents: AgentLight[];
  personalAgents: AgentLight[];
  spacesFlow: SpacesFlow | null;
  slackCreatingSlug: string | null;
  slackAgentStatuses: Record<string, SlackAgentStatus>;
  slackStatusesReady: boolean;
  onResumeSetup: (a: AgentLight, hasApp: boolean) => void;
  onSlackAction: (a: AgentLight) => void;
  onUpdateSlackApp: (a: AgentLight) => void;
  onRemoveSlack: (a: AgentLight) => void;
  onUploadPicture: (slug: string) => void;
  onPromote: (a: AgentLight) => void;
  onDemote: (a: AgentLight) => void;
  onDelete: (a: AgentLight) => void;
  onSpacesStep: (step: "create" | "install" | "configure" | "grant") => void | Promise<void>;
  onDismissSpaces: () => void;
  showOrgLabels: boolean;
}) {
  return (
    <div className="space-y-6 pt-4">
      {spacesFlow && (
        <SpacesFlowCard
          flow={spacesFlow}
          onStep={onSpacesStep}
          onDismiss={onDismissSpaces}
        />
      )}

      <section>
        <h3 className="mb-2 text-[12px] font-medium text-xyne-fg-secondary">
          Global Agents ({globalAgents.length})
        </h3>
        <div className="space-y-2">
          {globalAgents.map((a) => {
            const registered = Boolean(a.spacesAppId && a.spacesAppTokenConfigured);
            const hasApp = Boolean(a.spacesAppId);
            const slackStatus = slackAgentStatuses[a.id];
            return (
              <div
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-xyne-border bg-xyne-surface px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="inline-block h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: a.color }}
                  />
                  <div className="min-w-0">
                    <span className="text-[13px] font-medium text-xyne-fg-primary">{a.name}</span>
                    <span className="ml-2 text-[11px] text-xyne-fg-tertiary">{a.slug}</span>
                    {showOrgLabels && <span className="ml-2"><OrgBadge orgName={a.orgName} orgId={a.orgId} /></span>}
                    <span className="ml-2 inline-block align-middle">
                      <Badge
                        as="span"
                        size="sm"
                        variant={registered ? "success" : "warning"}
                        label={registered ? "Registered" : "Not registered"}
                      />
                    </span>
                    {slackStatus && (
                      <span className="ml-2 inline-block align-middle">
                        <Badge
                          as="span"
                          size="sm"
                          variant={slackStatus.status === "installed" ? "success" : "info"}
                          label={slackStatus.status === "installed"
                            ? `Slack: ${slackStatus.installs.map((install) => install.teamName).join(", ") || "installed"}`
                            : "Slack app created"}
                        />
                      </span>
                    )}
                    {slackStatus?.manifestStale && (
                      <span className="ml-2 inline-block align-middle">
                        <Badge as="span" size="sm" variant="warning" label="Slack app update required" />
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {slackStatus && (
                    <Button
                      size="sm"
                      variant="ghost"
                      leadingIcon={<SlackLogoIcon size={13} />}
                      onClick={() => onSlackAction(a)}
                    >
                      {slackStatus.status === "installed" ? "Add to another workspace" : "Install to workspace"}
                    </Button>
                  )}
                  <Menu
                    align="end"
                    trigger={(props) => (
                      <button
                        {...(props as React.ButtonHTMLAttributes<HTMLButtonElement> & { ref?: React.Ref<HTMLButtonElement> })}
                        type="button"
                        disabled={slackCreatingSlug === a.slug}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-medium text-xyne-fg-secondary transition-colors hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary disabled:opacity-50"
                      >
                        {slackCreatingSlug === a.slug ? <SpinnerGapIcon size={13} className="animate-spin" /> : <PlugIcon size={13} />}
                        {hasApp && !registered ? "Resume setup" : "Register"}
                        <CaretDownIcon size={11} />
                      </button>
                    )}
                  >
                    <MenuItem
                      onSelect={() => onResumeSetup(a, hasApp)}
                      disabled={registered}
                      leading={<PlugIcon size={13} />}
                    >
                      {registered ? "Spaces (registered)" : hasApp ? "Spaces (resume setup)" : "Spaces"}
                    </MenuItem>
                    <MenuItem
                      onSelect={() => onSlackAction(a)}
                      disabled={!slackStatusesReady}
                      leading={<SlackLogoIcon size={13} />}
                    >
                      {!slackStatusesReady
                        ? "Slack (loading status)"
                        : slackStatus?.status === "installed"
                          ? "Slack (add workspace)"
                          : slackStatus?.status === "command"
                            ? `Slack (${slackStatus.commandName ?? "command"})`
                            : slackStatus
                              ? "Slack (install)"
                              : "Add to Slack"}
                    </MenuItem>
                    {slackStatus?.manifestStale ? (
                      <MenuItem
                        onSelect={() => onUpdateSlackApp(a)}
                        leading={<SlackLogoIcon size={13} />}
                      >
                        Slack (update app + reinstall)
                      </MenuItem>
                    ) : null}
                    {slackStatus ? (
                      <MenuItem
                        onSelect={() => void onRemoveSlack(a)}
                        leading={<SlackLogoIcon size={13} />}
                      >
                        Remove from Slack
                      </MenuItem>
                    ) : null}
                  </Menu>
                  {registered && (
                    <Button
                      size="sm"
                      variant="ghost"
                      leadingIcon={<ImageIcon size={13} />}
                      onClick={() => onUploadPicture(a.slug)}
                    >
                      Upload photo
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    leadingIcon={<ArrowDownIcon size={13} />}
                    onClick={() => onDemote(a)}
                  >
                    Demote
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Delete agent"
                    onClick={() => onDelete(a)}
                  >
                    <TrashIcon size={14} className="text-xyne-error-fg" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-[12px] font-medium text-xyne-fg-secondary">
          Personal Agents ({personalAgents.length})
        </h3>
        {personalAgents.length === 0 ? (
          <p className="text-[11px] text-xyne-fg-muted">No personal agents.</p>
        ) : (
          <div className="space-y-2">
            {personalAgents.map((a) => {
              const registered = Boolean(a.spacesAppId && a.spacesAppTokenConfigured);
              const hasApp = Boolean(a.spacesAppId);
              const slackStatus = slackAgentStatuses[a.id];
              return (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-xyne-border bg-xyne-surface px-4 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="inline-block h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: a.color }}
                    />
                    <div className="min-w-0">
                      <span className="text-[13px] font-medium text-xyne-fg-primary">{a.name}</span>
                      <span className="ml-2 text-[11px] text-xyne-fg-tertiary">{a.slug}</span>
                      {showOrgLabels && <span className="ml-2"><OrgBadge orgName={a.orgName} orgId={a.orgId} /></span>}
                      {a.ownerUserId && (
                        <span className="ml-2 text-[11px] text-xyne-fg-muted">
                          owner: {a.ownerUserId.slice(0, 8)}…
                        </span>
                      )}
                      {slackStatus && (
                        <span className="ml-2 inline-block align-middle">
                          <Badge
                            as="span"
                            size="sm"
                            variant={slackStatus.status === "installed" ? "success" : "info"}
                            label={slackStatus.status === "installed"
                              ? `Slack: ${slackStatus.installs.map((install) => install.teamName).join(", ") || "installed"}`
                              : "Slack app created"}
                          />
                        </span>
                      )}
                      {slackStatus?.manifestStale && (
                        <span className="ml-2 inline-block align-middle">
                          <Badge as="span" size="sm" variant="warning" label="Slack app update required" />
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {slackStatus && (
                      <Button
                        size="sm"
                        variant="ghost"
                        leadingIcon={<SlackLogoIcon size={13} />}
                        onClick={() => onSlackAction(a)}
                      >
                        {slackStatus.status === "installed" ? "Add to another workspace" : "Install to workspace"}
                      </Button>
                    )}
                    <Menu
                      align="end"
                      trigger={(props) => (
                        <button
                          {...(props as React.ButtonHTMLAttributes<HTMLButtonElement> & { ref?: React.Ref<HTMLButtonElement> })}
                          type="button"
                          disabled={slackCreatingSlug === a.slug}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-medium text-xyne-fg-secondary transition-colors hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary disabled:opacity-50"
                        >
                          {slackCreatingSlug === a.slug ? <SpinnerGapIcon size={13} className="animate-spin" /> : <PlugIcon size={13} />}
                          Register
                          <CaretDownIcon size={11} />
                        </button>
                      )}
                    >
                      <MenuItem
                        onSelect={() => onResumeSetup(a, hasApp)}
                        disabled={registered}
                        leading={<PlugIcon size={13} />}
                      >
                        {registered ? "Spaces (registered)" : hasApp ? "Spaces (resume setup)" : "Spaces"}
                      </MenuItem>
                      <MenuItem
                        onSelect={() => onSlackAction(a)}
                        disabled={!slackStatusesReady}
                        leading={<SlackLogoIcon size={13} />}
                      >
                        {!slackStatusesReady
                          ? "Slack (loading status)"
                          : slackStatus?.status === "installed"
                            ? "Slack (add workspace)"
                            : slackStatus
                              ? "Slack (install)"
                              : "Create Slack app"}
                      </MenuItem>
                      {slackStatus?.manifestStale ? (
                        <MenuItem
                          onSelect={() => onUpdateSlackApp(a)}
                          leading={<SlackLogoIcon size={13} />}
                        >
                          Slack (update app + reinstall)
                        </MenuItem>
                      ) : null}
                      {slackStatus ? (
                        <MenuItem
                          onSelect={() => void onRemoveSlack(a)}
                          leading={<SlackLogoIcon size={13} />}
                        >
                          Remove from Slack
                        </MenuItem>
                      ) : null}
                    </Menu>
                    {registered && (
                      <Button
                        size="sm"
                        variant="ghost"
                        leadingIcon={<ImageIcon size={13} />}
                        onClick={() => onUploadPicture(a.slug)}
                      >
                        Upload photo
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      leadingIcon={<ArrowUpIcon size={13} />}
                      onClick={() => onPromote(a)}
                    >
                      Promote
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Delete agent"
                      onClick={() => onDelete(a)}
                    >
                      <TrashIcon size={14} className="text-xyne-error-fg" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

/* ── Admins tab ────────────────────────────────────────────────── */

function AdminsTab({
  admins,
  currentUserId,
  newAdminId,
  onNewAdminIdChange,
  onGrant,
  onRevoke,
  searchEvalUsers,
  newSearchEvalUserId,
  onNewSearchEvalUserIdChange,
  onGrantSearchEval,
  onRevokeSearchEval,
  showOrgLabels,
}: {
  admins: AdminRole[];
  currentUserId: string;
  newAdminId: string;
  onNewAdminIdChange: (v: string) => void;
  onGrant: () => void | Promise<void>;
  onRevoke: (a: AdminRole) => void;
  searchEvalUsers: AdminRole[];
  newSearchEvalUserId: string;
  onNewSearchEvalUserIdChange: (v: string) => void;
  onGrantSearchEval: () => void | Promise<void>;
  onRevokeSearchEval: (a: AdminRole) => void;
  showOrgLabels: boolean;
}) {
  return (
    <div className="space-y-8 pt-4">
      <RoleAccessSection
        heading="Admins"
        grantLabel="Grant admin"
        grantButtonLabel="Grant admin"
        revokeLabel="Revoke admin"
        entries={admins}
        currentUserId={currentUserId}
        newUserId={newAdminId}
        onNewUserIdChange={onNewAdminIdChange}
        onGrant={onGrant}
        onRevoke={onRevoke}
        showOrgLabels={showOrgLabels}
      />
      <RoleAccessSection
        heading="Search Eval access"
        description="Lets someone use Search Evals (including its ACL-bypassing “without permission” mode) without granting full admin."
        grantLabel="Grant Search Eval access"
        grantButtonLabel="Grant access"
        revokeLabel="Revoke Search Eval access"
        entries={searchEvalUsers}
        currentUserId={currentUserId}
        newUserId={newSearchEvalUserId}
        onNewUserIdChange={onNewSearchEvalUserIdChange}
        onGrant={onGrantSearchEval}
        onRevoke={onRevokeSearchEval}
        showOrgLabels={showOrgLabels}
      />
    </div>
  );
}

function RoleAccessSection({
  heading,
  description,
  grantLabel,
  grantButtonLabel,
  revokeLabel,
  entries,
  currentUserId,
  newUserId,
  onNewUserIdChange,
  onGrant,
  onRevoke,
  showOrgLabels,
}: {
  heading: string;
  description?: string;
  grantLabel: string;
  grantButtonLabel: string;
  revokeLabel: string;
  entries: AdminRole[];
  currentUserId: string;
  newUserId: string;
  onNewUserIdChange: (v: string) => void;
  onGrant: () => void | Promise<void>;
  onRevoke: (a: AdminRole) => void;
  showOrgLabels: boolean;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[13px] font-medium text-xyne-fg-primary">{heading}</h3>
        {description && (
          <p className="mt-1 text-[12px] text-xyne-fg-tertiary">{description}</p>
        )}
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <TextField
            label={grantLabel}
            placeholder="User ID or email (e.g. user@example.com)"
            value={newUserId}
            onChange={(e) => onNewUserIdChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onGrant();
            }}
          />
        </div>
        <Button
          variant="primary"
          leadingIcon={<UserPlusIcon size={13} />}
          onClick={onGrant}
          disabled={!newUserId.trim()}
        >
          {grantButtonLabel}
        </Button>
      </div>

      <div className="space-y-2">
        {entries.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between rounded-xl border border-xyne-border bg-xyne-surface px-4 py-3"
          >
            <div>
              <span className="text-[13px] font-medium text-xyne-fg-primary">
                {r.user.name}
              </span>
              <span className="ml-2 text-[12px] text-xyne-fg-tertiary">
                {r.user.email}
              </span>
              {showOrgLabels && <span className="ml-2"><OrgBadge orgName={r.user.orgName} orgId={r.user.orgId} /></span>}
              <span className="ml-2 text-[11px] text-xyne-fg-muted">
                granted {new Date(r.createdAt).toLocaleDateString()}
              </span>
            </div>
            <Button
              size="icon"
              variant="ghost"
              disabled={r.userId === currentUserId}
              onClick={() => onRevoke(r)}
              aria-label={r.userId === currentUserId ? "Cannot revoke yourself" : revokeLabel}
            >
              <TrashIcon size={14} className="text-xyne-error-fg" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Audit log tab ─────────────────────────────────────────────── */

const AUDIT_EVENT_TYPES = [
  "AGENT_CREATED", "AGENT_UPDATED", "AGENT_DELETED", "AGENT_CONFIG_UPDATED",
  "AGENT_PROMOTED", "AGENT_DEMOTED", "AGENT_SHARED", "AGENT_UNSHARED",
  "ROLE_GRANTED", "ROLE_REVOKED",
  "REQUEST_CREATED", "REQUEST_APPROVED", "REQUEST_REJECTED",
  "MCP_GLOBAL_FALLBACK_ENABLED", "MCP_GLOBAL_FALLBACK_DISABLED",
  "MCP_GLOBAL_CREDENTIALS_SET", "MCP_GLOBAL_CREDENTIALS_REMOVED",
  "MCP_CONNECTOR_CREATED", "MCP_CONNECTOR_UPDATED", "MCP_CONNECTOR_DELETED",
  "MCP_CONNECTOR_EDIT_REQUESTED", "MCP_CONNECTOR_EDIT_APPROVED",
  "MCP_CONNECTOR_EDIT_REJECTED", "MCP_CONNECTOR_EDIT_SUPERSEDED",
  "MCP_CONNECTOR_EDIT_CANCELLED",
] as const;

function auditEventLabel(v: string): string {
  return v
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function AuditTab({
  loading,
  logs,
  total,
  offset,
  pageSize,
  onPrev,
  onNext,
  showOrgLabels,
  agentOptions,
  eventFilter,
  onEventFilterChange,
  agentFilter,
  onAgentFilterChange,
  rangeFilter,
  onRangeFilterChange,
}: {
  loading: boolean;
  logs: AuditLogEntry[];
  total: number;
  offset: number;
  pageSize: number;
  onPrev: () => void;
  onNext: () => void;
  showOrgLabels: boolean;
  agentOptions: { value: string; label: string }[];
  eventFilter: string;
  onEventFilterChange: (v: string) => void;
  agentFilter: string;
  onAgentFilterChange: (v: string) => void;
  rangeFilter: "7" | "30" | "all";
  onRangeFilterChange: (v: "7" | "30" | "all") => void;
}) {
  const filterBar = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <FilterDropdown<string>
        ariaLabel="Event filter"
        value={eventFilter}
        options={[
          { value: "", label: "All events" },
          ...AUDIT_EVENT_TYPES.map((e) => ({ value: e, label: auditEventLabel(e) })),
        ]}
        onChange={onEventFilterChange}
      />
      <FilterDropdown<string>
        ariaLabel="Agent filter"
        value={agentFilter}
        options={[{ value: "", label: "All agents" }, ...agentOptions]}
        onChange={onAgentFilterChange}
      />
      <FilterDropdown<"7" | "30" | "all">
        ariaLabel="Time range filter"
        value={rangeFilter}
        options={[
          { value: "all", label: "All time" },
          { value: "7", label: "Last 7 days" },
          { value: "30", label: "Last 30 days" },
        ]}
        onChange={onRangeFilterChange}
      />
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-3 pt-4">
        {filterBar}
        <Loading text="Loading audit logs…" />
      </div>
    );
  }
  if (logs.length === 0) {
    return (
      <div className="space-y-3 pt-4">
        {filterBar}
        <EmptyHint>No audit logs match these filters.</EmptyHint>
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-4">
      {filterBar}
      <div className="overflow-hidden rounded-xl border border-xyne-border">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-xyne-border bg-xyne-surface-subtle text-left text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">
              <th className="px-3 py-2 font-medium">Time</th>
              <th className="px-3 py-2 font-medium">Event</th>
              {showOrgLabels && <th className="px-3 py-2 font-medium">Org</th>}
              <th className="px-3 py-2 font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => {
              const variant: "success" | "warning" | "error" | "neutral" =
                l.eventType.includes("PROMOTED") || l.eventType.includes("GRANTED")
                  ? "success"
                  : l.eventType.includes("DEMOTED") || l.eventType.includes("REVOKED")
                    ? "warning"
                    : l.eventType.includes("DELETED")
                      ? "error"
                      : "neutral";
              return (
                <tr
                  key={l.id}
                  className="border-b border-xyne-border-subtle hover:bg-xyne-surface-subtle/40"
                >
                  <td className="whitespace-nowrap px-3 py-2 text-[11px] text-xyne-fg-muted">
                    {new Date(l.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      as="span"
                      size="sm"
                      variant={variant === "neutral" ? "neutral" : variant}
                      label={l.eventType}
                    />
                  </td>
                  {showOrgLabels && (
                    <td className="px-3 py-2">
                      <OrgBadge orgName={l.orgName} orgId={l.orgId ?? undefined} />
                    </td>
                  )}
                  <td className="px-3 py-2 text-xyne-fg-secondary">{l.description}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-[11px] text-xyne-fg-muted">
        <span>
          Showing {offset + 1}–{Math.min(offset + logs.length, total)} of {total}
        </span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={onPrev} disabled={offset === 0}>
            Prev
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={onNext}
            disabled={offset + logs.length >= total}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── Usage tab ─────────────────────────────────────────────────── */

function UsageTab({
  loading,
  stats,
  range,
  onRangeChange,
  showOrgLabels,
}: {
  loading: boolean;
  stats: AgentUsageStat[];
  range: 7 | 30 | "all";
  onRangeChange: (v: 7 | 30 | "all") => void;
  showOrgLabels: boolean;
}) {
  const totals = stats.reduce(
    (acc, s) => ({
      runs: acc.runs + s.runs,
      tokensIn: acc.tokensIn + s.tokensIn,
      tokensOut: acc.tokensOut + s.tokensOut,
    }),
    { runs: 0, tokensIn: 0, tokensOut: 0 },
  );
  const fmt = (n: number) => n.toLocaleString();

  return (
    <div className="space-y-6 pt-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-xyne-fg-muted">
          Run counts and token consumption per agent. Sorted by total tokens.
        </p>
        <FilterDropdown<"7" | "30" | "all">
          ariaLabel="Date range"
          value={String(range) as "7" | "30" | "all"}
          options={[
            { value: "7", label: "Last 7 days" },
            { value: "30", label: "Last 30 days" },
            { value: "all", label: "All time" },
          ]}
          onChange={(v) =>
            onRangeChange(v === "all" ? "all" : (Number(v) as 7 | 30))
          }
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total Runs" value={fmt(totals.runs)} />
        <StatCard label="Tokens In" value={fmt(totals.tokensIn)} />
        <StatCard label="Tokens Out" value={fmt(totals.tokensOut)} />
      </div>

      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">
          Per-agent usage
        </h3>
        {loading ? (
          <Loading text="Loading…" />
        ) : stats.length === 0 ? (
          <div className="rounded-xl border border-xyne-border bg-xyne-surface p-6 text-center text-[13px] text-xyne-fg-muted">
            No runs in this window.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-xyne-border">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-xyne-border bg-xyne-surface-subtle text-left text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">
                  <th className="px-3 py-2 font-medium">Agent</th>
                  {showOrgLabels && <th className="px-3 py-2 font-medium">Org</th>}
                  <th className="px-3 py-2 text-right font-medium">Runs</th>
                  <th className="px-3 py-2 text-right font-medium">Tokens In</th>
                  <th className="px-3 py-2 text-right font-medium">Tokens Out</th>
                  <th className="px-3 py-2 text-right font-medium">Cache Read</th>
                  <th className="px-3 py-2 text-right font-medium">Cache Write</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr
                    key={`${s.orgId ?? "org"}:${s.agentSlug}`}
                    className="border-b border-xyne-border-subtle hover:bg-xyne-surface-subtle/40"
                  >
                    <td className="px-3 py-2 font-medium text-xyne-fg-primary">
                      {s.agentSlug}
                    </td>
                    {showOrgLabels && (
                      <td className="px-3 py-2">
                        <OrgBadge orgName={s.orgName} orgId={s.orgId} />
                      </td>
                    )}
                    <td className="px-3 py-2 text-right font-mono text-xyne-fg-secondary">
                      {s.runs.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xyne-info-fg">
                      {s.tokensIn.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xyne-brand">
                      {s.tokensOut.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xyne-fg-muted">
                      {s.tokensCacheRead.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xyne-fg-muted">
                      {s.tokensCacheWrite.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-xyne-border bg-xyne-surface p-4">
      <p className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">{label}</p>
      <p className="mt-1 font-mono text-[20px] text-xyne-fg-primary">{value}</p>
    </div>
  );
}

function OrgBadge({ orgName, orgId }: { orgName?: string | null; orgId?: string | null }) {
  return (
    <Badge
      as="span"
      size="sm"
      variant="neutral"
      label={orgName ?? orgId ?? "unknown org"}
    />
  );
}

/* ── Scheduled jobs tab ────────────────────────────────────────── */

function ScheduledTab({
  loading,
  jobs,
  total,
  offset,
  pageSize,
  statusFilter,
  onStatusFilterChange,
  agentOptions,
  agentFilter,
  onAgentFilterChange,
  userOptions,
  userFilter,
  onUserFilterChange,
  onPrev,
  onNext,
  onCancel,
  showOrgLabels,
}: {
  loading: boolean;
  jobs: AdminScheduledJob[];
  total: number;
  offset: number;
  pageSize: number;
  statusFilter: "" | "active" | "completed" | "cancelled";
  onStatusFilterChange: (v: "" | "active" | "completed" | "cancelled") => void;
  agentOptions: { value: string; label: string }[];
  agentFilter: string;
  onAgentFilterChange: (v: string) => void;
  userOptions: { value: string; label: string }[];
  userFilter: string;
  onUserFilterChange: (v: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onCancel: (j: AdminScheduledJob) => void;
  showOrgLabels: boolean;
}) {
  return (
    <div className="space-y-3 pt-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-xyne-fg-muted">
          All scheduled jobs across users. Cancel stops cron execution and removes the BullMQ scheduler.
        </p>
        <div className="flex items-center gap-2">
          <FilterDropdown<string>
            ariaLabel="Agent filter"
            value={agentFilter}
            options={[{ value: "", label: "All agents" }, ...agentOptions]}
            onChange={onAgentFilterChange}
          />
          <FilterDropdown<string>
            ariaLabel="User filter"
            value={userFilter}
            options={[{ value: "", label: "All users" }, ...userOptions]}
            onChange={onUserFilterChange}
          />
          <FilterDropdown<"" | "active" | "completed" | "cancelled">
            ariaLabel="Status filter"
            value={statusFilter}
            options={[
              { value: "", label: "All statuses" },
              { value: "active", label: "Active" },
              { value: "completed", label: "Completed" },
              { value: "cancelled", label: "Cancelled" },
            ]}
            onChange={onStatusFilterChange}
          />
        </div>
      </div>

      {loading ? (
        <Loading text="Loading…" />
      ) : jobs.length === 0 ? (
        <div className="rounded-xl border border-xyne-border bg-xyne-surface p-6 text-center text-[13px] text-xyne-fg-muted">
          No scheduled jobs.
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-xyne-border">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-xyne-border bg-xyne-surface-subtle text-left text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">
                  <th className="px-3 py-2 font-medium">User</th>
                  {showOrgLabels && <th className="px-3 py-2 font-medium">Org</th>}
                  <th className="px-3 py-2 font-medium">Agent</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Schedule</th>
                  <th className="px-3 py-2 font-medium">Next / Last run</th>
                  <th className="px-3 py-2 font-medium">Runs</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr
                    key={j.id}
                    className="border-b border-xyne-border-subtle hover:bg-xyne-surface-subtle/40"
                  >
                    <td className="px-3 py-2 text-xyne-fg-secondary">
                      <div
                        className="max-w-[18ch] truncate"
                        title={j.user?.email ?? j.userId}
                      >
                        {j.user?.email ?? j.userId}
                      </div>
                      {j.user?.name && (
                        <div className="max-w-[18ch] truncate text-[11px] text-xyne-fg-tertiary">
                          {j.user.name}
                        </div>
                      )}
                    </td>
                    {showOrgLabels && (
                      <td className="px-3 py-2">
                        <OrgBadge orgName={j.orgName} orgId={j.orgId} />
                      </td>
                    )}
                    <td className="px-3 py-2 font-medium text-xyne-fg-primary">
                      {j.agentSlug}
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        as="span"
                        size="sm"
                        variant={j.type === "cron" ? "info" : "warning"}
                        label={j.type}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-xyne-fg-secondary">
                      {j.type === "cron"
                        ? (j.cronExpression ?? "—")
                        : j.delayMs != null
                          ? `${Math.round(j.delayMs / 1000)}s delay`
                          : "—"}
                      {j.label && (
                        <div className="mt-0.5 font-sans text-[11px] text-xyne-fg-tertiary">
                          {j.label}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-xyne-fg-tertiary">
                      <div>next: {j.nextRunAt ? new Date(j.nextRunAt).toLocaleString() : "—"}</div>
                      <div>last: {j.lastRunAt ? new Date(j.lastRunAt).toLocaleString() : "—"}</div>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-xyne-fg-secondary">
                      {j.runCount}
                      {j.maxRuns != null ? ` / ${j.maxRuns}` : ""}
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        as="span"
                        size="sm"
                        variant={
                          j.status === "active"
                            ? "success"
                            : j.status === "cancelled"
                              ? "warning"
                              : "neutral"
                        }
                        label={j.status}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={j.status !== "active"}
                        onClick={() => onCancel(j)}
                        aria-label="Cancel scheduled job"
                      >
                        <TrashIcon size={14} className="text-xyne-error-fg" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-[11px] text-xyne-fg-muted">
            <span>
              {total === 0
                ? "0"
                : `${offset + 1}–${Math.min(offset + pageSize, total)}`}{" "}
              of {total}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={onPrev} disabled={offset === 0}>
                Prev
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={onNext}
                disabled={offset + pageSize >= total}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Global MCP credentials tab ────────────────────────────────── */

function GlobalMcpTab({
  loading,
  servers,
  fields,
  forms,
  existingKeys,
  formErrors,
  saving,
  onToggleFallback,
  onOpenForm,
  onCloseForm,
  onFormChange,
  onSave,
  onDeleteCreds,
}: {
  loading: boolean;
  servers: AdminMcpServerSummary[];
  fields: Record<string, readonly CredentialField[]>;
  forms: Record<string, Record<string, string>>;
  existingKeys: Record<string, string[]>;
  formErrors: Record<string, string>;
  saving: string | null;
  onToggleFallback: (s: AdminMcpServerSummary, allow: boolean) => void | Promise<void>;
  onOpenForm: (s: AdminMcpServerSummary) => void | Promise<void>;
  onCloseForm: (type: string) => void;
  onFormChange: (type: string, fieldName: string, value: string) => void;
  onSave: (s: AdminMcpServerSummary) => void | Promise<void>;
  onDeleteCreds: (s: AdminMcpServerSummary) => void;
}) {
  if (loading) return <Loading text="Loading…" />;
  if (servers.length === 0)
    return <EmptyHint>No MCP servers registered.</EmptyHint>;

  return (
    <div className="space-y-3 pt-4">
      <p className="text-[11px] text-xyne-fg-muted">
        Admin-managed fallback credentials for MCP servers. At call time the
        user's personal connection is preferred; if absent, these are used.
        Disable "Allow fallback" for servers where each user MUST have their own auth.
      </p>

      <div className="space-y-2">
        {servers.map((s) => {
          const fieldDefs = fields[s.type] ?? [];
          const formOpen = Boolean(forms[s.type]);
          const formValues = forms[s.type] ?? {};
          const existing = existingKeys[s.type] ?? [];
          const formError = formErrors[s.type] ?? "";
          const isSaving = saving === s.type;

          return (
            <div
              key={s.id}
              className="rounded-xl border border-xyne-border bg-xyne-surface"
            >
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-xyne-fg-primary">
                      {s.name}
                    </span>
                    <Badge as="span" size="sm" label={s.type} />
                    {s.hasGlobalCredentials ? (
                      <span
                        title={
                          s.globalCredentialsUpdatedAt
                            ? `Updated ${new Date(s.globalCredentialsUpdatedAt).toLocaleString()}`
                            : undefined
                        }
                      >
                        <Badge as="span" size="sm" variant="success" label="Creds set" />
                      </span>
                    ) : (
                      <Badge as="span" size="sm" label="No creds" />
                    )}
                  </div>
                  {s.description && (
                    <p className="mt-1 text-[11px] text-xyne-fg-muted">{s.description}</p>
                  )}
                </div>
                <label className="inline-flex shrink-0 cursor-pointer items-center gap-2">
                  <Switch
                    checked={s.allowGlobalFallback}
                    onChange={(v) => onToggleFallback(s, v)}
                  />
                  <span
                    className={`text-[11px] ${
                      s.allowGlobalFallback
                        ? "text-xyne-success-fg"
                        : "text-xyne-fg-muted"
                    }`}
                  >
                    Allow fallback
                  </span>
                </label>
                <Button
                  size="sm"
                  variant="primary"
                  leadingIcon={
                    formOpen ? <CaretDownIcon size={13} /> : <CaretRightIcon size={13} />
                  }
                  onClick={() => (formOpen ? onCloseForm(s.type) : onOpenForm(s))}
                >
                  <KeyIcon size={13} className="mr-1" />
                  {s.hasGlobalCredentials ? "Update creds" : "Set creds"}
                </Button>
                {s.hasGlobalCredentials && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Delete global credentials"
                    onClick={() => onDeleteCreds(s)}
                  >
                    <TrashIcon size={14} className="text-xyne-error-fg" />
                  </Button>
                )}
              </div>

              {formOpen && (
                <div className="border-t border-xyne-border bg-xyne-surface-subtle px-4 py-4">
                  {fieldDefs.length === 0 ? (
                    <p className="text-[11px] text-xyne-fg-muted">
                      No connector definition found for{" "}
                      <span className="font-mono">{s.type}</span> — credential schema is
                      unavailable on this server.
                    </p>
                  ) : (
                    <>
                      {existing.length > 0 && (
                        <p className="mb-3 text-[11px] text-xyne-fg-muted">
                          Replacing existing creds:{" "}
                          <span className="font-mono text-xyne-fg-secondary">
                            {existing.join(", ")}
                          </span>
                          . Saving overwrites all fields.
                        </p>
                      )}
                      <div className="space-y-3">
                        {fieldDefs.map((f) => (
                          <TextField
                            key={f.name}
                            label={`${f.label}${!f.optional ? " *" : ""}`}
                            hint={f.name}
                            type={f.type === "password" ? "password" : "text"}
                            placeholder={f.placeholder}
                            value={formValues[f.name] ?? ""}
                            onChange={(e) => onFormChange(s.type, f.name, e.target.value)}
                            spellCheck={false}
                            autoComplete="off"
                          />
                        ))}
                      </div>
                    </>
                  )}

                  {formError && (
                    <p className="mt-3 text-[11px] text-xyne-error-fg">{formError}</p>
                  )}

                  <div className="mt-4 flex items-center justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isSaving}
                      onClick={() => onCloseForm(s.type)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={isSaving || fieldDefs.length === 0}
                      leadingIcon={
                        isSaving ? (
                          <SpinnerGapIcon size={13} className="animate-spin" />
                        ) : (
                          <FloppyDiskIcon size={13} />
                        )
                      }
                      onClick={() => onSave(s)}
                    >
                      Save credentials
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── View agent body ───────────────────────────────────────────── */

function ViewAgentBody({ agent }: { agent: Agent }) {
  const cfgTools = (
    agent.config as
      | { tools?: { subagents?: string[]; direct?: string[]; custom?: string[]; gateway?: string[]; callableAgents?: string[] } }
      | undefined
  )?.tools;
  const subagents = cfgTools?.subagents ?? [];
  const callableAgents = cfgTools?.callableAgents ?? [];

  return (
    <div className="space-y-4 text-[13px]">
      <div>
        <p className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">Name</p>
        <p className="mt-1 text-xyne-fg-primary">{agent.name}</p>
      </div>
      {agent.description && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">
            Description
          </p>
          <p className="mt-1 whitespace-pre-wrap text-xyne-fg-secondary">
            {agent.description}
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">Scope</p>
          <p className="mt-1 font-mono text-xyne-fg-secondary">{agent.scope}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">Model</p>
          <p className="mt-1 font-mono text-xyne-fg-secondary">{agent.modelId ?? "—"}</p>
        </div>
      </div>
      {agent.systemPrompt && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">
            System Prompt
          </p>
          <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-xyne-border bg-xyne-surface-subtle p-3 text-[11px] text-xyne-fg-secondary">
            {agent.systemPrompt}
          </pre>
        </div>
      )}
      {subagents.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">
            Subagents ({subagents.length})
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {subagents.map((s) => (
              <Badge key={s} as="span" size="sm" variant="info" label={s} />
            ))}
          </div>
        </div>
      )}
      {callableAgents.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">
            Agents ({callableAgents.length})
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {callableAgents.map((s) => (
              <Badge
                key={s}
                as="span"
                size="sm"
                variant="warning"
                label={`${s} · Agent · heavyweight`}
              />
            ))}
          </div>
        </div>
      )}
      {agent.tools && agent.tools.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">
            Tools ({agent.tools.length})
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {agent.tools.map((t) => (
              <Badge
                key={t.id}
                as="span"
                size="sm"
                label={t.tool.name || t.tool.slug}
                title={t.tool.description ?? t.tool.slug}
              />
            ))}
          </div>
        </div>
      )}
      {agent.skills && agent.skills.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">
            Skills ({agent.skills.length})
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {agent.skills.map((s) => (
              <Badge
                key={s.id}
                as="span"
                size="sm"
                variant="warning"
                label={s.skill.name || s.skill.slug}
                title={s.skill.description ?? s.skill.slug}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Common helpers ────────────────────────────────────────────── */

/* ── FilterDropdown — Menu-backed select alternative ───────────── */

function FilterDropdown<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  const selected = options.find((o) => o.value === value) ?? options[0];

  return (
    <Menu
      align="end"
      trigger={(props) => (
        <button
          {...(props as React.ButtonHTMLAttributes<HTMLButtonElement> & {
            ref?: React.Ref<HTMLButtonElement>;
          })}
          type="button"
          aria-label={ariaLabel}
          className="inline-flex h-8 items-center gap-2 rounded-lg border border-xyne-border bg-xyne-surface px-3 text-[13px] text-xyne-fg-primary transition-colors hover:border-xyne-border-strong focus:border-xyne-border-focus focus:outline-none data-[popup-open]:border-xyne-border-focus"
        >
          <span className="truncate">{selected?.label}</span>
          <CaretDownIcon
            size={12}
            className="shrink-0 text-xyne-fg-muted transition-transform data-[popup-open]:rotate-180"
          />
        </button>
      )}
    >
      {options.map((opt) => {
        const isSelected = opt.value === value;
        return (
          <MenuItem
            key={opt.value}
            selected={isSelected}
            onSelect={() => onChange(opt.value)}
            trailing={
              isSelected ? (
                <CheckIcon size={12} className="text-xyne-fg-primary" />
              ) : (
                <span className="inline-block w-3" />
              )
            }
          >
            {opt.label}
          </MenuItem>
        );
      })}
    </Menu>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 py-12 text-[13px] text-xyne-fg-muted">
      <SpinnerGapIcon size={14} className="animate-spin" />
      {text}
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-12 text-center text-[13px] text-xyne-fg-muted">{children}</p>
  );
}
