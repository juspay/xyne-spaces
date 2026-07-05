import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Shield, Trash2, UserPlus, ArrowUpCircle, ArrowDownCircle, ChevronLeft, CheckCircle, XCircle, Loader2, Plug, Image as ImageIcon, Key, Save, ChevronDown, ChevronRight, Eye } from "lucide-react";
import {
  listAdminRoles, grantAdmin, revokeAdmin, listAuditLogsPaged, listAgents,
  promoteAgent, demoteAgent, deleteAgent,
  listPendingRequests, approveRequest, rejectRequest,
  createAgentApp, installAgentApp, configureAgentWebhook, uploadAgentPicture, getAgentDetail,
  listAgentUsageStats,
  listAdminScheduledJobs, deleteScheduledJob,
  listMcpPublishRequests, approveServerPublish, rejectServerPublish,
  listMcpEditRequests, approveServerEdit, rejectServerEdit,
  type McpEditRequest,
  listWorkflowGlobalRequests, approveWorkflowGlobalRequest, rejectWorkflowGlobalRequest,
  type WorkflowGlobalRequest,
  listAdminMcpServers, getAdminMcpGlobalCreds, setAdminMcpGlobalCreds,
  deleteAdminMcpGlobalCreds, setAdminMcpFallbackFlag,
  getCredentialFields,
  type AdminRole, type AuditLogEntry, type AgentRequestItem,
  type AgentUsageStat, type AdminScheduledJob,
  type AdminMcpServerSummary, type AdminMcpGlobalCredsDetail,
} from "../lib/api";
import type { Agent, McpServer, CredentialField } from "../lib/types";

interface Props {
  userId: string;
}

export function AdminPage({ userId }: Props) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"requests" | "connectors" | "mcpedits" | "workflowreqs" | "agents" | "admins" | "audit" | "usage" | "scheduled" | "globalmcp">("requests");
  const [mcpRequests, setMcpRequests] = useState<McpServer[]>([]);
  const [mcpRequestsLoading, setMcpRequestsLoading] = useState(false);
  const [mcpRejectingId, setMcpRejectingId] = useState<string | null>(null);
  const [mcpRejectNote, setMcpRejectNote] = useState("");
  const [mcpEditRequests, setMcpEditRequests] = useState<McpEditRequest[]>([]);
  const [mcpEditRequestsLoading, setMcpEditRequestsLoading] = useState(false);
  const [mcpEditRejectingId, setMcpEditRejectingId] = useState<string | null>(null);
  const [mcpEditRejectNote, setMcpEditRejectNote] = useState("");
  const [mcpEditExpandedId, setMcpEditExpandedId] = useState<string | null>(null);
  const [workflowRequests, setWorkflowRequests] = useState<WorkflowGlobalRequest[]>([]);
  const [workflowRequestsLoading, setWorkflowRequestsLoading] = useState(false);
  const [workflowRejectingId, setWorkflowRejectingId] = useState<string | null>(null);
  const [workflowRejectNote, setWorkflowRejectNote] = useState("");
  const [usageStats, setUsageStats] = useState<AgentUsageStat[]>([]);
  const [usageRange, setUsageRange] = useState<7 | 30 | "all">(30);
  const [usageLoading, setUsageLoading] = useState(false);
  const [scheduledJobs, setScheduledJobs] = useState<AdminScheduledJob[]>([]);
  const [scheduledTotal, setScheduledTotal] = useState(0);
  const [scheduledOffset, setScheduledOffset] = useState(0);
  const [scheduledStatusFilter, setScheduledStatusFilter] = useState<"" | "active" | "completed" | "cancelled">("");
  const [scheduledLoading, setScheduledLoading] = useState(false);
  const SCHEDULED_PAGE_SIZE = 50;
  const [agents, setAgents] = useState<Agent[]>([]);
  const [admins, setAdmins] = useState<AdminRole[]>([]);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditOffset, setAuditOffset] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);
  const AUDIT_PAGE_SIZE = 50;
  const [requests, setRequests] = useState<AgentRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newAdminId, setNewAdminId] = useState("");
  // View-agent modal (for inspecting an agent attached to a pending request)
  const [viewingAgentSlug, setViewingAgentSlug] = useState<string | null>(null);
  const [viewingAgent, setViewingAgent] = useState<Agent | null>(null);
  const [viewingLoading, setViewingLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, r, reqs] = await Promise.all([
        // Admin panel: the full roster across all users (server enforces admin).
        listAgents(userId, true),
        listAdminRoles(userId).catch(() => []),
        listPendingRequests(userId).catch(() => []),
      ]);
      setAgents(a);
      setAdmins(r);
      setRequests(reqs);
    } catch (err) { console.error("[admin] load error:", err); } finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const loadAuditLogs = useCallback(async () => {
    setAuditLoading(true);
    try {
      const { rows, total } = await listAuditLogsPaged(userId, { limit: AUDIT_PAGE_SIZE, offset: auditOffset });
      setLogs(rows);
      setAuditTotal(total);
    } catch (err) {
      console.error("[admin] audit logs load error:", err);
    } finally {
      setAuditLoading(false);
    }
  }, [userId, auditOffset]);

  useEffect(() => {
    if (tab === "audit") loadAuditLogs();
  }, [tab, loadAuditLogs]);

  const loadUsage = useCallback(async () => {
    setUsageLoading(true);
    try {
      const stats = await listAgentUsageStats(userId, usageRange).catch(() => []);
      setUsageStats(stats);
    } finally {
      setUsageLoading(false);
    }
  }, [userId, usageRange]);

  useEffect(() => {
    if (tab === "usage") loadUsage();
  }, [tab, loadUsage]);

  const loadMcpRequests = useCallback(async () => {
    setMcpRequestsLoading(true);
    try {
      const rows = await listMcpPublishRequests(userId);
      setMcpRequests(rows);
    } catch (err) {
      console.error("[admin] mcp publish-requests load error:", err);
    } finally {
      setMcpRequestsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (tab === "connectors") loadMcpRequests();
  }, [tab, loadMcpRequests]);

  const handleApproveMcp = async (id: string) => {
    try {
      await approveServerPublish(id, userId);
      loadMcpRequests();
    } catch (err) {
      console.error("[admin] approve mcp publish error:", err);
      alert(err instanceof Error ? err.message : "Failed to approve");
    }
  };

  const handleRejectMcp = async (id: string) => {
    try {
      await rejectServerPublish(id, userId, mcpRejectNote.trim() || undefined);
      setMcpRejectingId(null);
      setMcpRejectNote("");
      loadMcpRequests();
    } catch (err) {
      console.error("[admin] reject mcp publish error:", err);
      alert(err instanceof Error ? err.message : "Failed to reject");
    }
  };

  // Edit-request queue — distinct from the publish queue above. Loaded on
  // tab switch so we don't poll until the admin actually opens this view.
  const loadMcpEditRequests = useCallback(async () => {
    setMcpEditRequestsLoading(true);
    try {
      const rows = await listMcpEditRequests(userId);
      setMcpEditRequests(rows);
    } catch (err) {
      console.error("[admin] mcp edit-requests load error:", err);
    } finally {
      setMcpEditRequestsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (tab === "mcpedits") loadMcpEditRequests();
  }, [tab, loadMcpEditRequests]);

  const handleApproveMcpEdit = async (id: string) => {
    try {
      await approveServerEdit(id, userId);
      loadMcpEditRequests();
    } catch (err) {
      console.error("[admin] approve mcp edit error:", err);
      alert(err instanceof Error ? err.message : "Failed to approve");
    }
  };

  const handleRejectMcpEdit = async (id: string) => {
    try {
      await rejectServerEdit(id, userId, mcpEditRejectNote.trim() || undefined);
      setMcpEditRejectingId(null);
      setMcpEditRejectNote("");
      loadMcpEditRequests();
    } catch (err) {
      console.error("[admin] reject mcp edit error:", err);
      alert(err instanceof Error ? err.message : "Failed to reject");
    }
  };

  // "Push to Global" workflow promotion queue.
  const loadWorkflowRequests = useCallback(async () => {
    setWorkflowRequestsLoading(true);
    try {
      const rows = await listWorkflowGlobalRequests(userId);
      setWorkflowRequests(rows);
    } catch (err) {
      console.error("[admin] workflow global-requests load error:", err);
    } finally {
      setWorkflowRequestsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (tab === "workflowreqs") loadWorkflowRequests();
  }, [tab, loadWorkflowRequests]);

  const handleApproveWorkflow = async (id: string) => {
    try {
      await approveWorkflowGlobalRequest(id, userId);
      loadWorkflowRequests();
    } catch (err) {
      console.error("[admin] approve workflow global error:", err);
      alert(err instanceof Error ? err.message : "Failed to approve");
    }
  };

  const handleRejectWorkflow = async (id: string) => {
    try {
      await rejectWorkflowGlobalRequest(id, userId, workflowRejectNote.trim() || undefined);
      setWorkflowRejectingId(null);
      setWorkflowRejectNote("");
      loadWorkflowRequests();
    } catch (err) {
      console.error("[admin] reject workflow global error:", err);
      alert(err instanceof Error ? err.message : "Failed to reject");
    }
  };

  const loadScheduledJobs = useCallback(async () => {
    setScheduledLoading(true);
    try {
      const result = await listAdminScheduledJobs(userId, {
        status: scheduledStatusFilter || undefined,
        limit: SCHEDULED_PAGE_SIZE,
        offset: scheduledOffset,
      });
      setScheduledJobs(result.rows);
      setScheduledTotal(result.total);
    } catch (err) {
      console.error("[admin] scheduled-jobs load error:", err);
    } finally {
      setScheduledLoading(false);
    }
  }, [userId, scheduledStatusFilter, scheduledOffset]);

  useEffect(() => {
    if (tab === "scheduled") loadScheduledJobs();
  }, [tab, loadScheduledJobs]);

  // ── Global MCP credentials state ────────────────────────────────────────
  const [globalMcpServers, setGlobalMcpServers] = useState<AdminMcpServerSummary[]>([]);
  const [globalMcpLoading, setGlobalMcpLoading] = useState(false);
  const [globalMcpFields, setGlobalMcpFields] = useState<Record<string, readonly CredentialField[]>>({});
  /** type → form values keyed by field name. Open if key present. */
  const [globalMcpForms, setGlobalMcpForms] = useState<Record<string, Record<string, string>>>({});
  const [globalMcpExistingKeys, setGlobalMcpExistingKeys] = useState<Record<string, string[]>>({});
  const [globalMcpSaving, setGlobalMcpSaving] = useState<string | null>(null);
  const [globalMcpFormErrors, setGlobalMcpFormErrors] = useState<Record<string, string>>({});

  const loadGlobalMcpServers = useCallback(async () => {
    setGlobalMcpLoading(true);
    try {
      const [rows, fields] = await Promise.all([
        listAdminMcpServers(userId),
        getCredentialFields().catch(() => ({} as Record<string, readonly CredentialField[]>)),
      ]);
      setGlobalMcpServers(rows);
      setGlobalMcpFields(fields);
    } catch (err) {
      console.error("[admin] global-mcp load error:", err);
    } finally {
      setGlobalMcpLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (tab === "globalmcp") loadGlobalMcpServers();
  }, [tab, loadGlobalMcpServers]);

  const handleToggleFallback = async (server: AdminMcpServerSummary, allow: boolean) => {
    try {
      await setAdminMcpFallbackFlag(userId, server.type, allow);
      loadGlobalMcpServers();
    } catch (err) {
      console.error("[admin] toggle fallback error:", err);
      alert(err instanceof Error ? err.message : "Failed to update fallback setting");
    }
  };

  const handleOpenForm = useCallback(async (server: AdminMcpServerSummary) => {
    const fields = globalMcpFields[server.type] ?? [];
    const initial: Record<string, string> = {};
    for (const f of fields) initial[f.name] = "";
    setGlobalMcpForms((prev) => ({ ...prev, [server.type]: initial }));
    setGlobalMcpFormErrors((prev) => ({ ...prev, [server.type]: "" }));
    if (server.hasGlobalCredentials) {
      try {
        const detail: AdminMcpGlobalCredsDetail = await getAdminMcpGlobalCreds(userId, server.type);
        setGlobalMcpExistingKeys((prev) => ({ ...prev, [server.type]: detail.credentialKeys ?? [] }));
      } catch (err) {
        setGlobalMcpFormErrors((prev) => ({
          ...prev,
          [server.type]: err instanceof Error ? err.message : "Failed to load existing keys",
        }));
      }
    } else {
      setGlobalMcpExistingKeys((prev) => ({ ...prev, [server.type]: [] }));
    }
  }, [userId, globalMcpFields]);

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
      loadGlobalMcpServers();
    } catch (err) {
      console.error("[admin] save global creds error:", err);
      setGlobalMcpFormErrors((prev) => ({
        ...prev,
        [server.type]: err instanceof Error ? err.message : "Save failed",
      }));
    } finally {
      setGlobalMcpSaving(null);
    }
  };

  const handleDeleteCreds = async (server: AdminMcpServerSummary) => {
    if (!confirm(`Delete global credentials for ${server.name}? Users without personal connections will lose access until you set new ones.`)) return;
    try {
      await deleteAdminMcpGlobalCreds(userId, server.type);
      loadGlobalMcpServers();
    } catch (err) {
      console.error("[admin] delete global creds error:", err);
      alert(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const handleCancelScheduledJob = async (job: AdminScheduledJob) => {
    if (!window.confirm(`Cancel scheduled job "${job.label ?? job.id}" for ${job.user?.email ?? job.userId}?`)) return;
    try {
      await deleteScheduledJob(job.id);
      loadScheduledJobs();
    } catch (err) {
      console.error("[admin] scheduled-jobs cancel error:", err);
      alert(err instanceof Error ? err.message : "Failed to cancel");
    }
  };

  const handleGrant = async () => {
    if (!newAdminId.trim()) return;
    try {
      await grantAdmin(userId, newAdminId.trim());
      setNewAdminId("");
      load();
    } catch (err) {
      console.error("[admin] grant error:", err);
      // Surface the backend's error to the user — previously this was
      // swallowed to console, which is why typing "mudit" + clicking Grant
      // appeared to do nothing.
      alert(err instanceof Error ? err.message : "Failed to grant admin");
    }
  };

  const handleRevoke = async (targetId: string) => {
    if (!confirm("Revoke CLAW_ADMIN from this user?")) return;
    try { await revokeAdmin(userId, targetId); load(); } catch (err) { console.error("[admin] revoke error:", err); }
  };

  const handlePromote = async (slug: string) => {
    if (!confirm(`Promote "${slug}" to global?`)) return;
    try { await promoteAgent(slug, userId); load(); } catch (err) { console.error("[admin] promote error:", err); }
  };

  const handleDemote = async (slug: string) => {
    if (!confirm(`Demote "${slug}" to personal?`)) return;
    try { await demoteAgent(slug, userId); load(); } catch (err) { console.error("[admin] demote error:", err); }
  };

  const handleDelete = async (agent: Agent) => {
    if (!confirm(`Delete "${agent.name}"? This cannot be undone.`)) return;
    try { await deleteAgent(agent.slug, userId); load(); } catch (err) { console.error("[admin] delete error:", err); }
  };

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

  // Spaces registration flow state: tracks which request is doing Create→Install→Configure
  const [spacesFlow, setSpacesFlow] = useState<{ requestId: string; agentSlug: string; step: "creating" | "create" | "installing" | "install" | "configuring" | "configure" | "upload" | "uploading" | "done"; error?: string } | null>(null);
  const pictureInputRef = useRef<HTMLInputElement | null>(null);
  // Standalone per-row picture upload (outside the spaces-flow wizard) — lets admins
  // change a registered agent's picture any time.
  const rowPictureInputRef = useRef<HTMLInputElement | null>(null);
  const [rowUploadSlug, setRowUploadSlug] = useState<string | null>(null);
  const [rowUploadError, setRowUploadError] = useState<string | null>(null);

  const startSpacesFlow = useCallback(async (requestId: string, agentSlug: string) => {
    // First approve the request
    try {
      await approveRequest(requestId, userId);
    } catch (err) {
      console.error("[admin] approve error:", err);
      return;
    }
    // Check if agent already has a Spaces App
    try {
      const agent = await getAgentDetail(agentSlug);
      if (agent.spacesAppId && agent.spacesAppToken) {
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
  }, [userId, load]);

  const handleSpacesStep = useCallback(async (step: "create" | "install" | "configure") => {
    if (!spacesFlow) return;
    const { agentSlug } = spacesFlow;
    setSpacesFlow((f) => f ? { ...f, step: step === "create" ? "creating" : step === "install" ? "installing" : "configuring", error: undefined } : f);
    try {
      if (step === "create") {
        await createAgentApp(agentSlug);
        setSpacesFlow((f) => f ? { ...f, step: "install" } : f);
      } else if (step === "install") {
        await installAgentApp(agentSlug);
        setSpacesFlow((f) => f ? { ...f, step: "configure" } : f);
      } else {
        await configureAgentWebhook(agentSlug);
        // Webhook configured — advance to optional picture upload step.
        setSpacesFlow((f) => f ? { ...f, step: "upload" } : f);
      }
      load();
    } catch (err) {
      console.error(`[admin] spaces ${step} error:`, err);
      setSpacesFlow((f) => f ? { ...f, step, error: `Failed to ${step}. Try again.` } : f);
    }
  }, [spacesFlow, load]);

  const handlePictureFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!spacesFlow) return;
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setSpacesFlow((f) => f ? { ...f, error: "Please pick an image file" } : f);
      return;
    }
    const { agentSlug } = spacesFlow;
    setSpacesFlow((f) => f ? { ...f, step: "uploading", error: undefined } : f);
    try {
      await uploadAgentPicture(agentSlug, file);
      setSpacesFlow((f) => f ? { ...f, step: "done" } : f);
      load();
    } catch (err) {
      console.error("[admin] spaces upload-picture error:", err);
      setSpacesFlow((f) => f ? { ...f, step: "upload", error: err instanceof Error ? err.message : "Upload failed" } : f);
    }
  }, [spacesFlow, load]);

  const handleSkipUpload = useCallback(() => {
    setSpacesFlow((f) => f ? { ...f, step: "done" } : f);
  }, []);

  const openRowPicturePicker = useCallback((slug: string) => {
    setRowUploadSlug(slug);
    setRowUploadError(null);
    rowPictureInputRef.current?.click();
  }, []);

  const handleRowPictureChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const slug = rowUploadSlug;
    const file = e.target.files?.[0];
    e.target.value = "";
    setRowUploadSlug(null);
    if (!slug || !file) return;
    if (!file.type.startsWith("image/")) {
      setRowUploadError(`${slug}: image file required`);
      return;
    }
    try {
      await uploadAgentPicture(slug, file);
      load();
    } catch (err) {
      console.error("[admin] row picture upload error:", err);
      setRowUploadError(err instanceof Error ? `${slug}: ${err.message}` : `${slug}: upload failed`);
    }
  }, [rowUploadSlug, load]);

  if (loading) return <p className="text-sm text-zinc-500">Loading admin panel...</p>;

  const globalAgents = agents.filter((a) => a.scope === "global");
  const personalAgents = agents.filter((a) => a.scope !== "global");

  return (
    <div>
      <button onClick={() => navigate("/v1")} className="mb-4 flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200">
        <ChevronLeft size={16} /> Back to Dashboard
      </button>

      <div className="mb-6 flex items-center gap-3">
        <Shield size={24} className="text-red-400" />
        <h1 className="text-xl font-semibold">Admin Panel</h1>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 border-b border-zinc-800">
        {(["requests", "connectors", "mcpedits", "workflowreqs", "agents", "admins", "audit", "usage", "scheduled", "globalmcp"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition ${tab === t ? "border-b-2 border-zinc-100 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}>
            {t === "requests" ? `Requests${requests.length > 0 ? ` (${requests.length})` : ""}`
              : t === "connectors" ? `MCP Publish${mcpRequests.length > 0 ? ` (${mcpRequests.length})` : ""}`
              : t === "mcpedits" ? `MCP Edits${mcpEditRequests.length > 0 ? ` (${mcpEditRequests.length})` : ""}`
              : t === "workflowreqs" ? `Workflow Requests${workflowRequests.length > 0 ? ` (${workflowRequests.length})` : ""}`
              : t === "agents" ? `All Agents (${agents.length})`
              : t === "admins" ? `Admins (${admins.length})`
              : t === "audit" ? `Audit Log${auditTotal > 0 ? ` (${auditTotal})` : ""}`
              : t === "usage" ? "Usage"
              : t === "scheduled" ? `Scheduled Jobs${scheduledTotal > 0 ? ` (${scheduledTotal})` : ""}`
              : "Global MCP Creds"}
          </button>
        ))}
      </div>

      {/* ── Requests Tab ── */}
      {tab === "requests" && (
        <div className="space-y-3">
          {requests.length === 0 && !spacesFlow ? (
            <p className="text-sm text-zinc-500">No pending requests.</p>
          ) : (
            requests.map((r) => (
              <div key={r.id} className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${r.targetType === "skill" ? "bg-amber-950 text-amber-400" : "bg-purple-950 text-purple-400"}`}>
                        {r.targetType === "skill" ? "Skill" : "Agent"}
                      </span>
                      <span className={`rounded px-1.5 py-0.5 text-xs ${r.requestType === "push_to_global" ? "bg-green-950 text-green-400" : "bg-blue-950 text-blue-400"}`}>
                        {r.requestType === "push_to_global" ? "Push to Global" : "Push to Spaces"}
                      </span>
                      <span className="font-medium">{r.targetType === "skill" ? (r.skillName ?? r.skillSlug) : (r.agentName ?? r.agentSlug)}</span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      by {r.requesterName ?? r.requesterId} ({r.requesterEmail ?? ""}) · {new Date(r.createdAt).toLocaleString()}
                    </p>
                    {r.agentOwnerName && (
                      <p className="mt-0.5 text-xs text-zinc-600">
                        Agent created by: {r.agentOwnerName}{r.agentOwnerEmail ? ` (${r.agentOwnerEmail})` : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {r.targetType === "agent" && r.agentSlug && (
                      <button onClick={() => handleViewAgent(r.agentSlug!)}
                        className="flex items-center gap-1 rounded px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-zinc-800" title="View agent details">
                        <Eye size={16} /> View
                      </button>
                    )}
                    {r.targetType === "skill" ? (
                      <button onClick={async () => { try { await approveRequest(r.id, userId); load(); } catch (err) { console.error("[admin] approve error:", err); } }}
                        className="flex items-center gap-1 rounded px-3 py-1.5 text-sm text-green-400 transition hover:bg-green-950" title="Approve">
                        <CheckCircle size={16} /> Approve
                      </button>
                    ) : (
                      // Unified approval flow for agents: always run the Spaces app
                      // wizard. startSpacesFlow approves the request first (which
                      // promotes scope to global for push_to_global) and then walks
                      // through Create → Install → Configure → Photo as needed.
                      <button onClick={() => startSpacesFlow(r.id, r.agentSlug!)}
                        className="flex items-center gap-1 rounded px-3 py-1.5 text-sm text-green-400 transition hover:bg-green-950" title="Approve & Setup">
                        <CheckCircle size={16} /> Approve & Setup
                      </button>
                    )}
                    <button onClick={async () => { const note = prompt("Rejection reason (optional):"); try { await rejectRequest(r.id, userId, note ?? undefined); load(); } catch (err) { console.error("[admin] reject error:", err); } }}
                      className="flex items-center gap-1 rounded px-3 py-1.5 text-sm text-red-400 transition hover:bg-red-950" title="Reject">
                      <XCircle size={16} /> Reject
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}

          {/* Spaces App Registration Flow */}
          {spacesFlow && (
            <div className="rounded-lg border border-blue-800 bg-blue-950/20 px-5 py-4">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-blue-300">Spaces App Setup — {spacesFlow.agentSlug}</h4>
                {spacesFlow.step === "done" && (
                  <button onClick={() => setSpacesFlow(null)} className="text-xs text-zinc-500 hover:text-zinc-300">Dismiss</button>
                )}
              </div>

              {spacesFlow.error && (
                <p className="mb-3 text-xs text-red-400">{spacesFlow.error}</p>
              )}

              <div className="flex items-center gap-3">
                {/* Step 1: Create App */}
                <button
                  onClick={() => handleSpacesStep("create")}
                  disabled={spacesFlow.step !== "create"}
                  className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition ${
                    spacesFlow.step === "create" ? "bg-blue-600 text-white hover:bg-blue-500" :
                    spacesFlow.step === "creating" ? "bg-blue-600/50 text-blue-200" :
                    "bg-zinc-800 text-green-400"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {spacesFlow.step === "creating" ? <Loader2 size={14} className="animate-spin" /> :
                   spacesFlow.step === "create" ? "1. Create App" :
                   <><CheckCircle size={14} /> Created</>}
                </button>

                <span className="text-zinc-600">→</span>

                {/* Step 2: Install App */}
                <button
                  onClick={() => handleSpacesStep("install")}
                  disabled={spacesFlow.step !== "install"}
                  className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition ${
                    spacesFlow.step === "install" ? "bg-blue-600 text-white hover:bg-blue-500" :
                    spacesFlow.step === "installing" ? "bg-blue-600/50 text-blue-200" :
                    ["configure", "configuring", "upload", "uploading", "done"].includes(spacesFlow.step) ? "bg-zinc-800 text-green-400" :
                    "bg-zinc-800 text-zinc-500"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {spacesFlow.step === "installing" ? <Loader2 size={14} className="animate-spin" /> :
                   spacesFlow.step === "install" ? "2. Install App" :
                   ["configure", "configuring", "upload", "uploading", "done"].includes(spacesFlow.step) ? <><CheckCircle size={14} /> Installed</> :
                   "2. Install App"}
                </button>

                <span className="text-zinc-600">→</span>

                {/* Step 3: Configure Webhook */}
                <button
                  onClick={() => handleSpacesStep("configure")}
                  disabled={spacesFlow.step !== "configure"}
                  className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition ${
                    spacesFlow.step === "configure" ? "bg-blue-600 text-white hover:bg-blue-500" :
                    spacesFlow.step === "configuring" ? "bg-blue-600/50 text-blue-200" :
                    ["upload", "uploading", "done"].includes(spacesFlow.step) ? "bg-zinc-800 text-green-400" :
                    "bg-zinc-800 text-zinc-500"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {spacesFlow.step === "configuring" ? <Loader2 size={14} className="animate-spin" /> :
                   spacesFlow.step === "configure" ? "3. Configure Webhook" :
                   ["upload", "uploading", "done"].includes(spacesFlow.step) ? <><CheckCircle size={14} /> Configured</> :
                   "3. Configure Webhook"}
                </button>

                <span className="text-zinc-600">→</span>

                {/* Step 4: Upload Picture (optional) */}
                <input
                  ref={pictureInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePictureFileChange}
                />
                <button
                  onClick={() => pictureInputRef.current?.click()}
                  disabled={!["upload", "uploading", "done"].includes(spacesFlow.step)}
                  className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition ${
                    spacesFlow.step === "upload" ? "bg-blue-600 text-white hover:bg-blue-500" :
                    spacesFlow.step === "uploading" ? "bg-blue-600/50 text-blue-200" :
                    spacesFlow.step === "done" ? "bg-zinc-800 text-green-400" :
                    "bg-zinc-800 text-zinc-500"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {spacesFlow.step === "uploading" ? <Loader2 size={14} className="animate-spin" /> :
                   spacesFlow.step === "upload" ? "4. Upload Picture" :
                   spacesFlow.step === "done" ? <><CheckCircle size={14} /> Picture Set</> :
                   "4. Upload Picture"}
                </button>

                {spacesFlow.step === "upload" && (
                  <button
                    onClick={handleSkipUpload}
                    className="rounded-lg px-3 py-2 text-xs text-zinc-400 transition hover:text-zinc-200"
                  >
                    Skip
                  </button>
                )}
              </div>

              {spacesFlow.step === "done" && (
                <p className="mt-3 text-xs text-green-400">Agent is live on Spaces.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── MCP Connector Publish Requests Tab ── */}
      {tab === "connectors" && (
        <div className="space-y-3">
          {mcpRequestsLoading ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : mcpRequests.length === 0 ? (
            <p className="text-sm text-zinc-500">No pending MCP connector publish requests.</p>
          ) : (
            mcpRequests.map((s) => {
              const meta = (s.connectorMeta ?? {}) as {
                ownerUserId?: string;
                publishRequestedAt?: string;
              };
              return (
                <div key={s.id} className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-zinc-100">{s.name}</span>
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">{s.type}</span>
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">{s.transport ?? "stdio"}</span>
                      </div>
                      {s.description && (
                        <p className="mt-1 text-sm text-zinc-500">{s.description}</p>
                      )}
                      <p className="mt-1 text-xs text-zinc-500">
                        Owner: <span className="text-zinc-400">{meta.ownerUserId ?? "unknown"}</span>
                        {meta.publishRequestedAt && (
                          <> · Requested {new Date(meta.publishRequestedAt).toLocaleString()}</>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        onClick={() => handleApproveMcp(s.id)}
                        className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-500"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => { setMcpRejectingId(s.id); setMcpRejectNote(""); }}
                        className="rounded-md px-3 py-1.5 text-sm text-red-400 transition hover:bg-red-950 hover:text-red-300"
                      >
                        Reject
                      </button>
                    </div>
                  </div>

                  {mcpRejectingId === s.id && (
                    <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950 p-3">
                      <textarea
                        value={mcpRejectNote}
                        onChange={(e) => setMcpRejectNote(e.target.value)}
                        rows={3}
                        placeholder="Reason for rejection (shown to the connector author)…"
                        className="w-full rounded border border-zinc-700 bg-zinc-900 p-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-red-500 focus:outline-none"
                      />
                      <div className="mt-2 flex items-center justify-end gap-2">
                        <button
                          onClick={() => { setMcpRejectingId(null); setMcpRejectNote(""); }}
                          className="rounded px-3 py-1 text-sm text-zinc-400 transition hover:text-zinc-200"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleRejectMcp(s.id)}
                          className="rounded bg-red-600 px-3 py-1 text-sm font-medium text-white transition hover:bg-red-500"
                        >
                          Confirm Reject
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Connector definition snapshot for quick review */}
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-300">View connector definition</summary>
                    <pre className="mt-2 max-h-72 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-2 text-xs text-zinc-300">
{JSON.stringify({
  type: s.type,
  transport: s.transport,
  credentialForm: s.credentialForm,
  launchConfigTemplate: s.launchConfigTemplate,
  httpConfigTemplate: s.httpConfigTemplate,
  healthcheckSpec: s.healthcheckSpec,
  writeToolPolicy: s.writeToolPolicy,
}, null, 2)}
                    </pre>
                  </details>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── MCP Connector Edit Requests Tab ── */}
      {/* Global connectors can't be edited directly — every form-save queues
       *  an `McpConnectorEditRequest` in `pending` state. This tab lists them
       *  with a diff-style snapshot and Approve/Reject actions. Until this
       *  panel existed, clearing the queue required hand-rolled curl or SQL. */}
      {tab === "mcpedits" && (
        <div className="space-y-3">
          {mcpEditRequestsLoading ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : mcpEditRequests.length === 0 ? (
            <p className="text-sm text-zinc-500">No pending MCP connector edit requests.</p>
          ) : (
            mcpEditRequests.map((req) => {
              const proposed = req.proposedFields ?? {};
              const expanded = mcpEditExpandedId === req.id;
              return (
                <div key={req.id} className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-zinc-100">{req.mcpServer.name}</span>
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">{req.mcpServer.type}</span>
                        <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-xs text-amber-300">edit</span>
                      </div>
                      <p className="mt-1 text-xs text-zinc-500">
                        Proposed by <span className="text-zinc-400">{req.proposedByUserId}</span>
                        {" · "}
                        {new Date(req.proposedAt).toLocaleString()}
                      </p>
                      <p className="mt-1 text-xs text-zinc-600 font-mono">{req.id}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        onClick={() => setMcpEditExpandedId(expanded ? null : req.id)}
                        className="rounded-md px-3 py-1.5 text-sm text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
                      >
                        {expanded ? "Hide" : "View"}
                      </button>
                      <button
                        onClick={() => handleApproveMcpEdit(req.id)}
                        className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-500"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => { setMcpEditRejectingId(req.id); setMcpEditRejectNote(""); }}
                        className="rounded-md px-3 py-1.5 text-sm text-red-400 transition hover:bg-red-950 hover:text-red-300"
                      >
                        Reject
                      </button>
                    </div>
                  </div>

                  {mcpEditRejectingId === req.id && (
                    <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950 p-3">
                      <textarea
                        value={mcpEditRejectNote}
                        onChange={(e) => setMcpEditRejectNote(e.target.value)}
                        rows={3}
                        placeholder="Reason for rejection (shown in audit log)…"
                        className="w-full rounded border border-zinc-700 bg-zinc-900 p-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-red-500 focus:outline-none"
                      />
                      <div className="mt-2 flex items-center justify-end gap-2">
                        <button
                          onClick={() => { setMcpEditRejectingId(null); setMcpEditRejectNote(""); }}
                          className="rounded px-3 py-1 text-sm text-zinc-400 transition hover:text-zinc-200"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleRejectMcpEdit(req.id)}
                          className="rounded bg-red-600 px-3 py-1 text-sm font-medium text-white transition hover:bg-red-500"
                        >
                          Confirm Reject
                        </button>
                      </div>
                    </div>
                  )}

                  {expanded && (
                    <pre className="mt-3 max-h-96 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-2 text-xs text-zinc-300">
{JSON.stringify(proposed, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Workflow Requests Tab (Push to Global) ── */}
      {tab === "workflowreqs" && (
        <div className="space-y-3">
          {workflowRequestsLoading ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : workflowRequests.length === 0 ? (
            <p className="text-sm text-zinc-500">No pending workflow promotion requests.</p>
          ) : (
            workflowRequests.map((req) => {
              const channels = Array.from(
                new Set((req.workflow.bindings ?? []).map((b) => b.channelId)),
              );
              return (
                <div key={req.id} className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-zinc-100">{req.workflow.name}</span>
                        <span className="rounded bg-green-900/40 px-1.5 py-0.5 text-xs text-green-300">push to global</span>
                      </div>
                      <p className="mt-1 text-xs text-zinc-500">
                        Requested by{" "}
                        <span className="text-zinc-400">
                          {req.requestedByUser?.name || req.requestedByUser?.email || req.requestedByUserId}
                        </span>
                        {" · "}
                        {new Date(req.createdAt).toLocaleString()}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        Will wire to all users on{" "}
                        {channels.length > 0
                          ? channels.map((c) => (
                              <code key={c} className="mr-1 rounded bg-zinc-950 px-1 text-zinc-400">{c === "*" ? "all channels" : c}</code>
                            ))
                          : <span className="text-amber-400">no bound channels (nothing to wire)</span>}
                      </p>
                      <p className="mt-1 text-xs text-zinc-600 font-mono">{req.id}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        onClick={() => handleApproveWorkflow(req.id)}
                        className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-500"
                      >
                        Allow
                      </button>
                      <button
                        onClick={() => { setWorkflowRejectingId(req.id); setWorkflowRejectNote(""); }}
                        className="rounded-md px-3 py-1.5 text-sm text-red-400 transition hover:bg-red-950 hover:text-red-300"
                      >
                        Reject
                      </button>
                    </div>
                  </div>

                  {workflowRejectingId === req.id && (
                    <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950 p-3">
                      <textarea
                        value={workflowRejectNote}
                        onChange={(e) => setWorkflowRejectNote(e.target.value)}
                        rows={3}
                        placeholder="Reason for rejection (optional)…"
                        className="w-full rounded border border-zinc-700 bg-zinc-900 p-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-red-500 focus:outline-none"
                      />
                      <div className="mt-2 flex items-center justify-end gap-2">
                        <button
                          onClick={() => { setWorkflowRejectingId(null); setWorkflowRejectNote(""); }}
                          className="rounded px-3 py-1 text-sm text-zinc-400 transition hover:text-zinc-200"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleRejectWorkflow(req.id)}
                          className="rounded bg-red-600 px-3 py-1 text-sm font-medium text-white transition hover:bg-red-500"
                        >
                          Confirm Reject
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Agents Tab ── */}
      {tab === "agents" && (
        <div className="space-y-6">
          {/* Spaces App Registration Flow (shared with Requests tab, fires from Register button below) */}
          {spacesFlow && (
            <div className="rounded-lg border border-blue-800 bg-blue-950/20 px-5 py-4">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-blue-300">Spaces App Setup — {spacesFlow.agentSlug}</h4>
                {spacesFlow.step === "done" && (
                  <button onClick={() => setSpacesFlow(null)} className="text-xs text-zinc-500 hover:text-zinc-300">Dismiss</button>
                )}
              </div>
              {spacesFlow.error && <p className="mb-3 text-xs text-red-400">{spacesFlow.error}</p>}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleSpacesStep("create")}
                  disabled={spacesFlow.step !== "create"}
                  className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition ${spacesFlow.step === "create" ? "bg-blue-600 text-white hover:bg-blue-500" : spacesFlow.step === "creating" ? "bg-blue-600/50 text-blue-200" : "bg-zinc-800 text-green-400"} disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {spacesFlow.step === "creating" ? <Loader2 size={14} className="animate-spin" /> : spacesFlow.step === "create" ? "1. Create App" : <><CheckCircle size={14} /> Created</>}
                </button>
                <span className="text-zinc-600">→</span>
                <button
                  onClick={() => handleSpacesStep("install")}
                  disabled={spacesFlow.step !== "install"}
                  className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition ${spacesFlow.step === "install" ? "bg-blue-600 text-white hover:bg-blue-500" : spacesFlow.step === "installing" ? "bg-blue-600/50 text-blue-200" : ["configure", "configuring", "done"].includes(spacesFlow.step) ? "bg-zinc-800 text-green-400" : "bg-zinc-800 text-zinc-500"} disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {spacesFlow.step === "installing" ? <Loader2 size={14} className="animate-spin" /> : spacesFlow.step === "install" ? "2. Install App" : ["configure", "configuring", "done"].includes(spacesFlow.step) ? <><CheckCircle size={14} /> Installed</> : "2. Install App"}
                </button>
                <span className="text-zinc-600">→</span>
                <button
                  onClick={() => handleSpacesStep("configure")}
                  disabled={spacesFlow.step !== "configure"}
                  className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition ${spacesFlow.step === "configure" ? "bg-blue-600 text-white hover:bg-blue-500" : spacesFlow.step === "configuring" ? "bg-blue-600/50 text-blue-200" : spacesFlow.step === "done" ? "bg-zinc-800 text-green-400" : "bg-zinc-800 text-zinc-500"} disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {spacesFlow.step === "configuring" ? <Loader2 size={14} className="animate-spin" /> : spacesFlow.step === "configure" ? "3. Configure Webhook" : spacesFlow.step === "done" ? <><CheckCircle size={14} /> Done</> : "3. Configure Webhook"}
                </button>
              </div>
              {spacesFlow.step === "done" && <p className="mt-3 text-xs text-green-400">Agent is live on Spaces.</p>}
            </div>
          )}

          {/* Global */}
          <div>
            <h3 className="mb-2 text-sm font-medium text-zinc-400">Global Agents ({globalAgents.length})</h3>
            <div className="space-y-2">
              {globalAgents.map((a) => {
                const registered = Boolean(a.spacesAppId && a.spacesAppToken);
                const hasApp = Boolean(a.spacesAppId);
                return (
                  <div key={a.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: a.color }} />
                      <div>
                        <span className="font-medium">{a.name}</span>
                        <span className="ml-2 text-xs text-zinc-500">{a.slug}</span>
                        <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${registered ? "bg-green-950 text-green-400" : "bg-amber-950 text-amber-400"}`}>
                          {registered ? "Registered" : "Not registered"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!registered && (
                        <button
                          onClick={() => setSpacesFlow({ requestId: "", agentSlug: a.slug, step: hasApp ? "install" : "create" })}
                          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-blue-400 hover:bg-zinc-800"
                          title={hasApp ? "Continue setup (install + webhook)" : "Register this agent with Spaces"}
                        >
                          <Plug size={14} /> {hasApp ? "Resume setup" : "Register"}
                        </button>
                      )}
                      {registered && (
                        <button
                          onClick={() => openRowPicturePicker(a.slug)}
                          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-purple-400 hover:bg-zinc-800"
                          title="Upload / change agent picture"
                        >
                          <ImageIcon size={14} /> Upload Photo
                        </button>
                      )}
                      <button onClick={() => handleDemote(a.slug)} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-orange-400 hover:bg-zinc-800" title="Demote to personal">
                        <ArrowDownCircle size={14} /> Demote
                      </button>
                      <button onClick={() => handleDelete(a)} className="rounded p-1 text-zinc-600 hover:bg-red-950 hover:text-red-400" title="Delete">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Single hidden input shared across row upload buttons */}
          <input
            ref={rowPictureInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleRowPictureChange}
          />
          {rowUploadError && (
            <p className="text-xs text-red-400">{rowUploadError}</p>
          )}

          {/* Personal */}
          <div>
            <h3 className="mb-2 text-sm font-medium text-zinc-400">Personal Agents ({personalAgents.length})</h3>
            {personalAgents.length === 0 ? (
              <p className="text-xs text-zinc-600">No personal agents.</p>
            ) : (
              <div className="space-y-2">
                {personalAgents.map((a) => {
                  const pRegistered = Boolean(a.spacesAppId && a.spacesAppToken);
                  return (
                  <div key={a.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: a.color }} />
                      <div>
                        <span className="font-medium">{a.name}</span>
                        <span className="ml-2 text-xs text-zinc-500">{a.slug}</span>
                        {a.ownerUserId && <span className="ml-2 text-xs text-zinc-600">owner: {a.ownerUserId.slice(0, 8)}...</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {pRegistered && (
                        <button
                          onClick={() => openRowPicturePicker(a.slug)}
                          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-purple-400 hover:bg-zinc-800"
                          title="Upload / change agent picture"
                        >
                          <ImageIcon size={14} /> Upload Photo
                        </button>
                      )}
                      <button onClick={() => handlePromote(a.slug)} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-green-400 hover:bg-zinc-800" title="Promote to global">
                        <ArrowUpCircle size={14} /> Promote
                      </button>
                      <button onClick={() => handleDelete(a)} className="rounded p-1 text-zinc-600 hover:bg-red-950 hover:text-red-400" title="Delete">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Admins Tab ── */}
      {tab === "admins" && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input value={newAdminId} onChange={(e) => setNewAdminId(e.target.value)}
              placeholder="User ID or email (e.g. john.doe@gmail.com) to grant CLAW_ADMIN"
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-purple-500 focus:outline-none"
              onKeyDown={(e) => { if (e.key === "Enter") handleGrant(); }} />
            <button onClick={handleGrant} disabled={!newAdminId.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-purple-500 disabled:opacity-50">
              <UserPlus size={14} /> Grant Admin
            </button>
          </div>

          <div className="space-y-2">
            {admins.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
                <div>
                  <span className="font-medium">{r.user.name}</span>
                  <span className="ml-2 text-sm text-zinc-500">{r.user.email}</span>
                  <span className="ml-2 text-xs text-zinc-600">granted {new Date(r.createdAt).toLocaleDateString()}</span>
                </div>
                <button onClick={() => handleRevoke(r.userId)}
                  disabled={r.userId === userId}
                  className="rounded p-1.5 text-zinc-600 transition hover:bg-red-950 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
                  title={r.userId === userId ? "Cannot revoke yourself" : "Revoke admin"}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Audit Log Tab ── */}
      {tab === "audit" && (
        <div className="space-y-3">
          {auditLoading ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : logs.length === 0 ? (
            <p className="text-sm text-zinc-500">No audit logs yet.</p>
          ) : (
            <>
              <div className="rounded-lg border border-zinc-800 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-xs text-zinc-500">
                      <th className="px-3 py-2">Time</th>
                      <th className="px-3 py-2">Event</th>
                      <th className="px-3 py-2">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((l) => (
                      <tr key={l.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/50">
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-zinc-600">{new Date(l.createdAt).toLocaleString()}</td>
                        <td className="px-3 py-2">
                          <span className={`rounded px-1.5 py-0.5 text-xs ${
                            l.eventType.includes("PROMOTED") || l.eventType.includes("GRANTED") ? "bg-green-950 text-green-400" :
                            l.eventType.includes("DEMOTED") || l.eventType.includes("REVOKED") ? "bg-orange-950 text-orange-400" :
                            l.eventType.includes("DELETED") ? "bg-red-950 text-red-400" :
                            "bg-zinc-800 text-zinc-400"
                          }`}>{l.eventType}</span>
                        </td>
                        <td className="px-3 py-2 text-zinc-400">{l.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between text-xs text-zinc-500">
                <span>
                  Showing {auditOffset + 1}–{Math.min(auditOffset + logs.length, auditTotal)} of {auditTotal}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setAuditOffset((o) => Math.max(0, o - AUDIT_PAGE_SIZE))}
                    disabled={auditOffset === 0 || auditLoading}
                    className="rounded border border-zinc-700 px-3 py-1 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <button
                    onClick={() => setAuditOffset((o) => o + AUDIT_PAGE_SIZE)}
                    disabled={auditOffset + logs.length >= auditTotal || auditLoading}
                    className="rounded border border-zinc-700 px-3 py-1 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Usage Tab ── (replaces former Ratings tab) */}
      {tab === "usage" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-500">Run counts and token consumption aggregated per agent. Sorted by total tokens (in + out).</p>
            <select
              value={String(usageRange)}
              onChange={(e) => setUsageRange(e.target.value === "all" ? "all" : Number(e.target.value) as 7 | 30)}
              className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200"
            >
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="all">All time</option>
            </select>
          </div>

          {/* Summary cards */}
          {(() => {
            const totals = usageStats.reduce(
              (acc, s) => ({
                runs: acc.runs + s.runs,
                tokensIn: acc.tokensIn + s.tokensIn,
                tokensOut: acc.tokensOut + s.tokensOut,
              }),
              { runs: 0, tokensIn: 0, tokensOut: 0 },
            );
            const fmt = (n: number) => n.toLocaleString();
            return (
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Total Runs</p>
                  <p className="mt-1 font-mono text-xl text-zinc-100">{fmt(totals.runs)}</p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Tokens In</p>
                  <p className="mt-1 font-mono text-xl text-zinc-100">{fmt(totals.tokensIn)}</p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Tokens Out</p>
                  <p className="mt-1 font-mono text-xl text-zinc-100">{fmt(totals.tokensOut)}</p>
                </div>
              </div>
            );
          })()}

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Per-agent usage</h3>
            {usageLoading ? (
              <p className="text-sm text-zinc-500">Loading…</p>
            ) : usageStats.length === 0 ? (
              <p className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-center text-sm text-zinc-500">No runs in this window.</p>
            ) : (
              <div className="rounded-lg border border-zinc-800 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-xs text-zinc-500">
                      <th className="px-3 py-2">Agent</th>
                      <th className="px-3 py-2 text-right">Runs</th>
                      <th className="px-3 py-2 text-right">Tokens In</th>
                      <th className="px-3 py-2 text-right">Tokens Out</th>
                      <th className="px-3 py-2 text-right">Cache Read</th>
                      <th className="px-3 py-2 text-right">Cache Write</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageStats.map((s) => (
                      <tr key={s.agentSlug} className="border-b border-zinc-800/50 hover:bg-zinc-900/50">
                        <td className="px-3 py-2 font-medium text-zinc-200">{s.agentSlug}</td>
                        <td className="px-3 py-2 text-right font-mono text-zinc-400">{s.runs.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-mono text-blue-400">{s.tokensIn.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-mono text-purple-400">{s.tokensOut.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-mono text-zinc-500">{s.tokensCacheRead.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-mono text-zinc-500">{s.tokensCacheWrite.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ── Scheduled Jobs Tab ── */}
      {tab === "scheduled" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-500">All scheduled jobs across users. Cancel stops cron execution and removes the BullMQ scheduler.</p>
            <select
              value={scheduledStatusFilter}
              onChange={(e) => { setScheduledOffset(0); setScheduledStatusFilter(e.target.value as typeof scheduledStatusFilter); }}
              className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {scheduledLoading ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : scheduledJobs.length === 0 ? (
            <p className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-center text-sm text-zinc-500">No scheduled jobs.</p>
          ) : (
            <>
              <div className="rounded-lg border border-zinc-800 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-xs text-zinc-500">
                      <th className="px-3 py-2">User</th>
                      <th className="px-3 py-2">Agent</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Schedule</th>
                      <th className="px-3 py-2">Next / Last run</th>
                      <th className="px-3 py-2">Runs</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {scheduledJobs.map((j) => (
                      <tr key={j.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/50">
                        <td className="px-3 py-2 text-zinc-300">
                          <div className="truncate max-w-[18ch]" title={j.user?.email ?? j.userId}>{j.user?.email ?? j.userId}</div>
                          {j.user?.name && <div className="truncate text-xs text-zinc-500 max-w-[18ch]">{j.user.name}</div>}
                        </td>
                        <td className="px-3 py-2 font-medium text-zinc-200">{j.agentSlug}</td>
                        <td className="px-3 py-2">
                          <span className={`rounded px-1.5 py-0.5 text-xs ${j.type === "cron" ? "bg-blue-950 text-blue-400" : "bg-purple-950 text-purple-400"}`}>{j.type}</span>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-zinc-400">
                          {j.type === "cron" ? (j.cronExpression ?? "—") : (j.delayMs != null ? `${Math.round(j.delayMs / 1000)}s delay` : "—")}
                          {j.label && <div className="mt-0.5 font-sans text-zinc-500 not-italic">{j.label}</div>}
                        </td>
                        <td className="px-3 py-2 text-xs text-zinc-500">
                          <div>next: {j.nextRunAt ? new Date(j.nextRunAt).toLocaleString() : "—"}</div>
                          <div>last: {j.lastRunAt ? new Date(j.lastRunAt).toLocaleString() : "—"}</div>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-zinc-400">{j.runCount}{j.maxRuns != null ? ` / ${j.maxRuns}` : ""}</td>
                        <td className="px-3 py-2">
                          <span className={`rounded px-1.5 py-0.5 text-xs ${
                            j.status === "active" ? "bg-green-950 text-green-400" :
                            j.status === "completed" ? "bg-zinc-800 text-zinc-400" :
                            j.status === "cancelled" ? "bg-orange-950 text-orange-400" :
                            "bg-zinc-800 text-zinc-400"
                          }`}>{j.status}</span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => handleCancelScheduledJob(j)}
                            disabled={j.status !== "active"}
                            className="rounded-md px-2 py-1 text-xs text-red-400 transition hover:bg-zinc-800 hover:text-red-300 disabled:text-zinc-700 disabled:hover:bg-transparent"
                            title="Cancel job"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between text-xs text-zinc-500">
                <span>
                  {scheduledTotal === 0 ? "0" : `${scheduledOffset + 1}–${Math.min(scheduledOffset + SCHEDULED_PAGE_SIZE, scheduledTotal)}`} of {scheduledTotal}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setScheduledOffset(Math.max(0, scheduledOffset - SCHEDULED_PAGE_SIZE))}
                    disabled={scheduledOffset === 0}
                    className="rounded-md border border-zinc-700 px-3 py-1 text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:text-zinc-600"
                  >Prev</button>
                  <button
                    onClick={() => setScheduledOffset(scheduledOffset + SCHEDULED_PAGE_SIZE)}
                    disabled={scheduledOffset + SCHEDULED_PAGE_SIZE >= scheduledTotal}
                    className="rounded-md border border-zinc-700 px-3 py-1 text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:text-zinc-600"
                  >Next</button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Global MCP Credentials Tab ── */}
      {tab === "globalmcp" && (
        <div className="space-y-3">
          <p className="text-xs text-zinc-500">
            Admin-managed fallback credentials for MCP servers. At call time the user's personal connection is preferred; if absent, these are used. Disable "Allow fallback" for servers where each user MUST have their own auth (e.g. Google, Microsoft, Xyne Spaces).
          </p>

          {globalMcpLoading ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : globalMcpServers.length === 0 ? (
            <p className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-center text-sm text-zinc-500">No MCP servers registered.</p>
          ) : (
            <div className="space-y-2">
              {globalMcpServers.map((s) => {
                const fields = globalMcpFields[s.type] ?? [];
                const formOpen = Boolean(globalMcpForms[s.type]);
                const formValues = globalMcpForms[s.type] ?? {};
                const existingKeys = globalMcpExistingKeys[s.type] ?? [];
                const formError = globalMcpFormErrors[s.type] ?? "";
                const isSaving = globalMcpSaving === s.type;
                return (
                  <div key={s.id} className="rounded-lg border border-zinc-800 bg-zinc-900">
                    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-zinc-100">{s.name}</span>
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs font-mono text-zinc-400">{s.type}</span>
                          {s.hasGlobalCredentials ? (
                            <span className="rounded bg-green-950 px-1.5 py-0.5 text-xs text-green-400" title={s.globalCredentialsUpdatedAt ? `Updated ${new Date(s.globalCredentialsUpdatedAt).toLocaleString()}` : undefined}>
                              Creds set
                            </span>
                          ) : (
                            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-500">No creds</span>
                          )}
                        </div>
                        {s.description && (
                          <p className="mt-1 text-xs text-zinc-500">{s.description}</p>
                        )}
                      </div>
                      <label className="inline-flex shrink-0 cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={s.allowGlobalFallback}
                          onChange={(e) => handleToggleFallback(s, e.target.checked)}
                          className="h-4 w-4 cursor-pointer accent-purple-500"
                        />
                        <span className={`text-xs ${s.allowGlobalFallback ? "text-green-400" : "text-zinc-500"}`}>
                          Allow fallback
                        </span>
                      </label>
                      <button
                        onClick={() => (formOpen ? handleCloseForm(s.type) : handleOpenForm(s))}
                        className="flex shrink-0 items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500"
                      >
                        {formOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <Key size={14} />
                        {s.hasGlobalCredentials ? "Update creds" : "Set creds"}
                      </button>
                      {s.hasGlobalCredentials && (
                        <button
                          onClick={() => handleDeleteCreds(s)}
                          className="shrink-0 rounded p-1.5 text-zinc-600 transition hover:bg-red-950 hover:text-red-400"
                          title="Delete global credentials"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>

                    {formOpen && (
                      <div className="border-t border-zinc-800 bg-zinc-950 px-4 py-4">
                        {fields.length === 0 ? (
                          <p className="text-xs text-zinc-500">
                            No connector definition found for <span className="font-mono">{s.type}</span> — credential schema is unavailable on this server.
                          </p>
                        ) : (
                          <>
                            {existingKeys.length > 0 && (
                              <p className="mb-3 text-xs text-zinc-500">
                                Replacing existing creds: <span className="font-mono text-zinc-400">{existingKeys.join(", ")}</span>. Saving overwrites all fields.
                              </p>
                            )}
                            <div className="space-y-3">
                              {fields.map((f) => (
                                <div key={f.name}>
                                  <label className="mb-1 block text-xs font-medium text-zinc-300">
                                    {f.label}
                                    {!f.optional && <span className="ml-1 text-red-400">*</span>}
                                    <span className="ml-2 font-mono text-zinc-600">({f.name})</span>
                                  </label>
                                  <input
                                    type={f.type === "password" ? "password" : "text"}
                                    value={formValues[f.name] ?? ""}
                                    onChange={(e) => handleFormChange(s.type, f.name, e.target.value)}
                                    placeholder={f.placeholder}
                                    spellCheck={false}
                                    autoComplete="off"
                                    className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
                                  />
                                </div>
                              ))}
                            </div>
                          </>
                        )}

                        {formError && (
                          <p className="mt-3 text-xs text-red-400">{formError}</p>
                        )}

                        <div className="mt-4 flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleCloseForm(s.type)}
                            disabled={isSaving}
                            className="rounded-md px-3 py-1.5 text-xs text-zinc-400 transition hover:text-zinc-200 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleSaveForm(s)}
                            disabled={isSaving || fields.length === 0}
                            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
                          >
                            {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                            Save credentials
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* View-agent modal (shown when admin clicks View on a pending request) */}
      {viewingAgentSlug && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={handleCloseViewAgent}
        >
          <div
            className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
              <h3 className="text-sm font-semibold text-zinc-200">
                Agent: <span className="font-mono text-zinc-400">{viewingAgentSlug}</span>
              </h3>
              <button onClick={handleCloseViewAgent} className="text-zinc-500 hover:text-zinc-200">
                <XCircle size={18} />
              </button>
            </div>
            <div className="max-h-[75vh] overflow-y-auto px-5 py-4">
              {viewingLoading ? (
                <p className="text-sm text-zinc-500">Loading agent details…</p>
              ) : !viewingAgent ? (
                <p className="text-sm text-red-400">Failed to load agent.</p>
              ) : (
                <div className="space-y-4 text-sm">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-zinc-500">Name</p>
                    <p className="mt-1 text-zinc-100">{viewingAgent.name}</p>
                  </div>
                  {viewingAgent.description && (
                    <div>
                      <p className="text-xs uppercase tracking-wide text-zinc-500">Description</p>
                      <p className="mt-1 whitespace-pre-wrap text-zinc-300">{viewingAgent.description}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-zinc-500">Scope</p>
                      <p className="mt-1 font-mono text-zinc-300">{viewingAgent.scope}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-zinc-500">Model</p>
                      <p className="mt-1 font-mono text-zinc-300">{viewingAgent.modelId ?? "—"}</p>
                    </div>
                  </div>
                  {viewingAgent.systemPrompt ? (
                    <div>
                      <p className="text-xs uppercase tracking-wide text-zinc-500">System Prompt</p>
                      <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-300">
                        {viewingAgent.systemPrompt}
                      </pre>
                    </div>
                  ) : null}
                  {(() => {
                    // Subagents are stored under config.tools.subagents (array of subagent names).
                    const cfgTools = (viewingAgent.config as { tools?: { subagents?: string[]; direct?: string[]; custom?: string[] } } | undefined)?.tools;
                    const subagents = cfgTools?.subagents ?? [];
                    return subagents.length > 0 ? (
                      <div>
                        <p className="text-xs uppercase tracking-wide text-zinc-500">Subagents ({subagents.length})</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {subagents.map((s) => (
                            <span key={s} className="rounded bg-purple-950 px-1.5 py-0.5 font-mono text-[11px] text-purple-300">{s}</span>
                          ))}
                        </div>
                      </div>
                    ) : null;
                  })()}
                  {viewingAgent.tools && viewingAgent.tools.length > 0 ? (
                    <div>
                      <p className="text-xs uppercase tracking-wide text-zinc-500">Tools ({viewingAgent.tools.length})</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {viewingAgent.tools.map((t) => (
                          <span
                            key={t.id}
                            className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300"
                            title={t.tool.description ?? t.tool.slug}
                          >
                            {t.tool.name || t.tool.slug}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {viewingAgent.skills && viewingAgent.skills.length > 0 ? (
                    <div>
                      <p className="text-xs uppercase tracking-wide text-zinc-500">Skills ({viewingAgent.skills.length})</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {viewingAgent.skills.map((s) => (
                          <span
                            key={s.id}
                            className="rounded bg-amber-950 px-1.5 py-0.5 font-mono text-[11px] text-amber-300"
                            title={s.skill.description ?? s.skill.slug}
                          >
                            {s.skill.name || s.skill.slug}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
