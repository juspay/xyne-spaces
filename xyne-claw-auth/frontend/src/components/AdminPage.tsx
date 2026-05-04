import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Shield, Trash2, UserPlus, ArrowUpCircle, ArrowDownCircle, ChevronLeft, CheckCircle, XCircle, Loader2, Plug, Image as ImageIcon } from "lucide-react";
import {
  listAdminRoles, grantAdmin, revokeAdmin, listAuditLogs, listAgents,
  promoteAgent, demoteAgent, deleteAgent,
  listPendingRequests, approveRequest, rejectRequest,
  createAgentApp, installAgentApp, configureAgentWebhook, uploadAgentPicture, getAgentDetail,
  listAgentRatingStats, listRecentDownRuns,
  listAdminScheduledJobs, deleteScheduledJob,
  listMcpPublishRequests, approveServerPublish, rejectServerPublish,
  type AdminRole, type AuditLogEntry, type AgentRequestItem,
  type AgentRatingStat, type RecentDownRun, type AdminScheduledJob,
} from "../lib/api";
import type { Agent, McpServer } from "../lib/types";

interface Props {
  userId: string;
}

export function AdminPage({ userId }: Props) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"requests" | "connectors" | "agents" | "admins" | "audit" | "ratings" | "scheduled">("requests");
  const [mcpRequests, setMcpRequests] = useState<McpServer[]>([]);
  const [mcpRequestsLoading, setMcpRequestsLoading] = useState(false);
  const [mcpRejectingId, setMcpRejectingId] = useState<string | null>(null);
  const [mcpRejectNote, setMcpRejectNote] = useState("");
  const [ratingStats, setRatingStats] = useState<AgentRatingStat[]>([]);
  const [recentDowns, setRecentDowns] = useState<RecentDownRun[]>([]);
  const [ratingRange, setRatingRange] = useState<7 | 30 | "all">(30);
  const [ratingLoading, setRatingLoading] = useState(false);
  const [scheduledJobs, setScheduledJobs] = useState<AdminScheduledJob[]>([]);
  const [scheduledTotal, setScheduledTotal] = useState(0);
  const [scheduledOffset, setScheduledOffset] = useState(0);
  const [scheduledStatusFilter, setScheduledStatusFilter] = useState<"" | "active" | "completed" | "cancelled">("");
  const [scheduledLoading, setScheduledLoading] = useState(false);
  const SCHEDULED_PAGE_SIZE = 50;
  const [agents, setAgents] = useState<Agent[]>([]);
  const [admins, setAdmins] = useState<AdminRole[]>([]);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [requests, setRequests] = useState<AgentRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newAdminId, setNewAdminId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, r, l, reqs] = await Promise.all([
        listAgents(userId),
        listAdminRoles(userId).catch(() => []),
        listAuditLogs(userId).catch(() => []),
        listPendingRequests(userId).catch(() => []),
      ]);
      setAgents(a);
      setAdmins(r);
      setLogs(l);
      setRequests(reqs);
    } catch (err) { console.error("[admin] load error:", err); } finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const loadRatings = useCallback(async () => {
    setRatingLoading(true);
    try {
      const [stats, downs] = await Promise.all([
        listAgentRatingStats(userId, ratingRange).catch(() => []),
        listRecentDownRuns(userId, ratingRange, 50).catch(() => []),
      ]);
      setRatingStats(stats);
      setRecentDowns(downs);
    } finally {
      setRatingLoading(false);
    }
  }, [userId, ratingRange]);

  useEffect(() => {
    if (tab === "ratings") loadRatings();
  }, [tab, loadRatings]);

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
    } catch (err) { console.error("[admin] grant error:", err); }
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
      <button onClick={() => navigate("/")} className="mb-4 flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200">
        <ChevronLeft size={16} /> Back to Dashboard
      </button>

      <div className="mb-6 flex items-center gap-3">
        <Shield size={24} className="text-red-400" />
        <h1 className="text-xl font-semibold">Admin Panel</h1>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 border-b border-zinc-800">
        {(["requests", "connectors", "agents", "admins", "audit", "ratings", "scheduled"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition ${tab === t ? "border-b-2 border-zinc-100 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}>
            {t === "requests" ? `Requests${requests.length > 0 ? ` (${requests.length})` : ""}`
              : t === "connectors" ? `MCP Publish${mcpRequests.length > 0 ? ` (${mcpRequests.length})` : ""}`
              : t === "agents" ? `All Agents (${agents.length})`
              : t === "admins" ? `Admins (${admins.length})`
              : t === "audit" ? `Audit Log (${logs.length})`
              : t === "ratings" ? "Ratings"
              : `Scheduled Jobs${scheduledTotal > 0 ? ` (${scheduledTotal})` : ""}`}
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
                  </div>
                  <div className="flex items-center gap-2">
                    {r.targetType === "skill" ? (
                      <button onClick={async () => { try { await approveRequest(r.id, userId); load(); } catch (err) { console.error("[admin] approve error:", err); } }}
                        className="flex items-center gap-1 rounded px-3 py-1.5 text-sm text-green-400 transition hover:bg-green-950" title="Approve">
                        <CheckCircle size={16} /> Approve
                      </button>
                    ) : r.requestType === "push_to_spaces" ? (
                      <button onClick={() => startSpacesFlow(r.id, r.agentSlug!)}
                        className="flex items-center gap-1 rounded px-3 py-1.5 text-sm text-green-400 transition hover:bg-green-950" title="Approve & Setup Spaces App">
                        <CheckCircle size={16} /> Approve & Setup
                      </button>
                    ) : (
                      <button onClick={async () => { try { await approveRequest(r.id, userId); load(); } catch (err) { console.error("[admin] approve error:", err); } }}
                        className="flex items-center gap-1 rounded px-3 py-1.5 text-sm text-green-400 transition hover:bg-green-950" title="Approve">
                        <CheckCircle size={16} /> Approve
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
              placeholder="User ID to grant CLAW_ADMIN"
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
        <div className="space-y-1">
          {logs.length === 0 ? (
            <p className="text-sm text-zinc-500">No audit logs yet.</p>
          ) : (
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
          )}
        </div>
      )}

      {/* ── Ratings Tab ── */}
      {tab === "ratings" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-500">Thumbs-up / thumbs-down aggregated per agent. Sorted by 👎 count.</p>
            <select
              value={String(ratingRange)}
              onChange={(e) => setRatingRange(e.target.value === "all" ? "all" : Number(e.target.value) as 7 | 30)}
              className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200"
            >
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="all">All time</option>
            </select>
          </div>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Per-agent stats</h3>
            {ratingLoading ? (
              <p className="text-sm text-zinc-500">Loading…</p>
            ) : ratingStats.length === 0 ? (
              <p className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-center text-sm text-zinc-500">No runs in this window.</p>
            ) : (
              <div className="rounded-lg border border-zinc-800 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-xs text-zinc-500">
                      <th className="px-3 py-2">Agent</th>
                      <th className="px-3 py-2 text-right">Runs</th>
                      <th className="px-3 py-2 text-right">Rated</th>
                      <th className="px-3 py-2 text-right">👍</th>
                      <th className="px-3 py-2 text-right">👎</th>
                      <th className="px-3 py-2">Neg rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ratingStats.map((s) => (
                      <tr key={s.agentSlug} className="border-b border-zinc-800/50 hover:bg-zinc-900/50">
                        <td className="px-3 py-2 font-medium text-zinc-200">{s.agentSlug}</td>
                        <td className="px-3 py-2 text-right font-mono text-zinc-400">{s.totalRuns}</td>
                        <td className="px-3 py-2 text-right font-mono text-zinc-500">{s.ratedCount}</td>
                        <td className="px-3 py-2 text-right font-mono text-green-400">{s.upCount || ""}</td>
                        <td className="px-3 py-2 text-right font-mono text-red-400">{s.downCount || ""}</td>
                        <td className="px-3 py-2">
                          {s.ratedCount === 0 ? (
                            <span className="text-xs text-zinc-600">—</span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-24 rounded-full bg-zinc-800 overflow-hidden">
                                <div className="h-full bg-red-500" style={{ width: `${s.negativeRate * 100}%` }} />
                              </div>
                              <span className="min-w-[3ch] text-right font-mono text-xs text-zinc-400">{Math.round(s.negativeRate * 100)}%</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Recent thumbs-downs {recentDowns.length > 0 && <span className="ml-1 text-zinc-600">({recentDowns.length})</span>}
            </h3>
            {ratingLoading ? null : recentDowns.length === 0 ? (
              <p className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-center text-sm text-zinc-500">No thumbs-downs yet.</p>
            ) : (
              <div className="space-y-2">
                {recentDowns.map((d) => (
                  <div key={d.sessionId} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded bg-red-950 px-1.5 py-0.5 text-red-400">👎</span>
                      <span className="font-medium text-zinc-200">{d.agentSlug}</span>
                      <span className="text-zinc-600">·</span>
                      <span className="text-zinc-500">{d.userEmail ?? d.userId}</span>
                      <span className="ml-auto text-zinc-600">{new Date(d.ratedAt).toLocaleString()}</span>
                    </div>
                    <p className="mt-2 truncate text-sm text-zinc-400" title={d.task}>
                      <span className="text-zinc-600">task:</span> {d.task}
                    </p>
                    {d.ratingComment ? (
                      <p className="mt-1 border-l-2 border-red-900/50 pl-2 text-sm text-red-300">"{d.ratingComment}"</p>
                    ) : (
                      <p className="mt-1 text-xs italic text-zinc-600">(no comment)</p>
                    )}
                    <p className="mt-1 font-mono text-[10px] text-zinc-700">session: {d.sessionId}</p>
                  </div>
                ))}
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
    </div>
  );
}
