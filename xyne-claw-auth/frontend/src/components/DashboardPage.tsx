import { useState, useEffect, useCallback } from "react";
import {
  listServers,
  listConnections,
  createConnection,
  createServer,
  deleteConnection,
  getCredentialFields,
  listGateways,
  createGateway,
  deleteGateway,
  linkIdentity,
  listAgents,
  listSkills,
  createSkill,
  updateSkill,
  deleteSkill,
  submitSkillRequest,
  type Skill,
} from "../lib/api";
import type { McpServer, UserConnection, CredentialField, Gateway, Agent } from "../lib/types";
import { ConnectionList } from "./ConnectionList";
import { AddConnectionDialog } from "./AddConnectionDialog";
import { GatewayList } from "./GatewayList";
import { AddGatewayDialog } from "./AddGatewayDialog";
import { LinkIdentityDialog } from "./LinkIdentityDialog";
import { AgentList } from "./AgentList";
import { CreateAgentModal } from "./CreateAgentModal";
import { SettingsTab } from "./SettingsTab";
import { ActivityTab } from "./ActivityTab";

function SkillCard({ skill, canDelete, canEdit, canRequestGlobal, deletingSkill, savingSkill, onDelete, onSave, onRequestGlobal }: {
  skill: Skill; canDelete: boolean; canEdit: boolean; canRequestGlobal: boolean;
  deletingSkill: string | null;
  savingSkill: string | null;
  onDelete: () => void;
  onSave?: (patch: { name?: string; description?: string; content?: string }) => Promise<void>;
  onRequestGlobal?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(skill.name);
  const [draftDescription, setDraftDescription] = useState(skill.description ?? "");
  const [draftContent, setDraftContent] = useState(skill.content);
  const isSaving = savingSkill === skill.slug;

  const startEdit = () => {
    setDraftName(skill.name);
    setDraftDescription(skill.description ?? "");
    setDraftContent(skill.content);
    setEditing(true);
    setExpanded(true);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  const handleSave = async () => {
    if (!onSave) return;
    const patch: { name?: string; description?: string; content?: string } = {};
    if (draftName !== skill.name) patch.name = draftName;
    if (draftDescription !== (skill.description ?? "")) patch.description = draftDescription;
    if (draftContent !== skill.content) patch.content = draftContent;
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    await onSave(patch);
    setEditing(false);
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900">
      <div className="flex cursor-pointer items-start justify-between p-4" onClick={() => !editing && setExpanded(!expanded)}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-zinc-500 transition ${expanded ? "rotate-90" : ""}`}><polyline points="9 18 15 12 9 6"/></svg>
            {editing ? (
              <input value={draftName} onChange={(e) => setDraftName(e.target.value)} onClick={(e) => e.stopPropagation()}
                className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-sm font-medium text-zinc-200 focus:border-zinc-500 focus:outline-none" />
            ) : (
              <span className="font-medium text-zinc-200">{skill.label || skill.name}</span>
            )}
            <span className="text-xs text-zinc-600">{skill.slug}</span>
            <span className={`rounded px-1.5 py-0.5 text-xs ${skill.scope === "global" ? "bg-green-950 text-green-400" : "bg-zinc-800 text-zinc-400"}`}>{skill.scope}</span>
            {skill.source !== "user-created" && <span className="rounded px-1.5 py-0.5 text-xs bg-blue-950 text-blue-400">{skill.source}</span>}
          </div>
          {editing ? (
            <textarea value={draftDescription} onChange={(e) => setDraftDescription(e.target.value)} onClick={(e) => e.stopPropagation()}
              placeholder="Description (≤1024 chars — what triggers this skill)"
              className="mt-2 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none" rows={3} />
          ) : (
            skill.description && <p className="mt-1 text-sm text-zinc-400">{skill.description}</p>
          )}
          {!expanded && !editing && <p className="mt-1 text-xs text-zinc-600">{skill.content.length} chars</p>}
        </div>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {!editing && canRequestGlobal && onRequestGlobal && (
            <button onClick={onRequestGlobal}
              className="rounded p-1.5 text-zinc-600 transition hover:bg-green-950 hover:text-green-400" title="Request: Push to Global">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            </button>
          )}
          {!editing && canEdit && onSave && (
            <button onClick={startEdit}
              className="rounded p-1.5 text-zinc-600 transition hover:bg-blue-950 hover:text-blue-400" title="Edit skill">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
            </button>
          )}
          {editing && (
            <>
              <button onClick={handleSave} disabled={isSaving}
                className="rounded bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-900 transition hover:bg-white disabled:opacity-50">
                {isSaving ? "Saving…" : "Save"}
              </button>
              <button onClick={cancelEdit} disabled={isSaving}
                className="rounded px-2 py-1 text-xs text-zinc-400 transition hover:text-zinc-200 disabled:opacity-50">
                Cancel
              </button>
            </>
          )}
          {!editing && canDelete && (
            <button onClick={onDelete} disabled={deletingSkill === skill.slug}
              className="rounded p-1.5 text-zinc-600 transition hover:bg-red-950 hover:text-red-400 disabled:opacity-50" title="Delete skill">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          )}
        </div>
      </div>
      {(expanded || editing) && (
        <div className="border-t border-zinc-800 p-4">
          {editing ? (
            <>
              <textarea value={draftContent} onChange={(e) => setDraftContent(e.target.value)}
                className="max-h-[60vh] min-h-[12rem] w-full overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-3 font-mono text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                spellCheck={false} />
              <p className="mt-2 text-xs text-zinc-600">{draftContent.length} chars · markdown body (frontmatter at top is parsed by the agent loader)</p>
            </>
          ) : (
            <>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-3 font-mono text-xs text-zinc-300">{skill.content}</pre>
              <p className="mt-2 text-xs text-zinc-600">{skill.content.length} chars</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface Props {
  userId: string;
  isAdmin?: boolean;
}

export function DashboardPage({ userId, isAdmin }: Props) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [connections, setConnections] = useState<UserConnection[]>([]);
  const [credentialFields, setCredentialFields] = useState<Record<string, CredentialField[]>>({});
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);
  const [gatewaysLoading, setGatewaysLoading] = useState(false);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dashboardTab, setDashboardTab] = useState<"agents" | "skills" | "gateways" | "settings" | "activity">("agents");
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [showCreateSkill, setShowCreateSkill] = useState(false);
  const [newSkill, setNewSkill] = useState({ slug: "", description: "", content: "" });
  const [savingSkill, setSavingSkill] = useState(false);
  const [deletingSkill, setDeletingSkill] = useState<string | null>(null);
  const [editingSkill, setEditingSkill] = useState<string | null>(null);
  const [showAddConnection, setShowAddConnection] = useState(false);
  const [editConnectionServerId, setEditConnectionServerId] = useState<string | undefined>(undefined);
  const [editDefinitionServerId, setEditDefinitionServerId] = useState<string | undefined>(undefined);
  const [showAddGateway, setShowAddGateway] = useState(false);
  const [linkGatewayId, setLinkGatewayId] = useState<string | null>(null);

  const loadServers = useCallback(async () => {
    try {
      const [serverList, fields] = await Promise.all([listServers(userId), getCredentialFields()]);
      setServers(serverList);
      setCredentialFields(fields);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load servers");
    }
  }, [userId]);

  const loadConnections = useCallback(async () => {
    setLoading(true);
    try {
      setConnections(await listConnections(userId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load connections");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const loadGateways = useCallback(async () => {
    setGatewaysLoading(true);
    try {
      setGateways(await listGateways());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load gateways");
    } finally {
      setGatewaysLoading(false);
    }
  }, []);

  const loadAgents = useCallback(async () => {
    setAgentsLoading(true);
    try {
      setAgents(await listAgents(userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setAgentsLoading(false);
    }
  }, [userId]);

  const loadSkills = useCallback(async () => {
    setSkillsLoading(true);
    try {
      setSkills(await listSkills(userId));
    } catch (err) {
      console.error("[dashboard] load skills error:", err);
    } finally {
      setSkillsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadConnections();
    loadServers();
    loadGateways();
    loadAgents();
    loadSkills();
  }, [loadConnections, loadServers, loadGateways, loadAgents, loadSkills]);

  const handleAddConnection = useCallback(async (mcpServerId: string, credentials: Record<string, string>) => {
    try {
      // If the server is Google, trigger OAuth re-auth instead of normal credential save
      const server = servers.find((s) => s.id === mcpServerId);
      if (server?.type === "google") {
        setShowAddConnection(false);
        setEditConnectionServerId(undefined);
        const { connectGoogle } = await import("../lib/api");
        const authUrl = await connectGoogle(userId);
        window.location.href = authUrl;
        return;
      }
      // If the server is Microsoft, trigger OAuth re-auth instead of normal credential save
      if (server?.type === "microsoft") {
        setShowAddConnection(false);
        setEditConnectionServerId(undefined);
        const { connectMicrosoft } = await import("../lib/api");
        const authUrl = await connectMicrosoft(userId);
        window.location.href = authUrl;
        return;
      }
      await createConnection(userId, { mcpServerId, credentials });
      setShowAddConnection(false);
      setEditConnectionServerId(undefined);
      await loadConnections();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create connection");
    }
  }, [userId, loadConnections, servers]);

  const handleDeleteConnection = useCallback(async (id: string) => {
    try {
      await deleteConnection(userId, id);
      await loadConnections();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete connection");
    }
  }, [userId, loadConnections]);

  const handleAddGateway = useCallback(async (type: string, name: string) => {
    try {
      await createGateway({ type, name });
      setShowAddGateway(false);
      await loadGateways();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create gateway");
    }
  }, [loadGateways]);

  const handleDeleteGateway = useCallback(async (id: string) => {
    try {
      await deleteGateway(id);
      await loadGateways();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete gateway");
    }
  }, [loadGateways]);

  const handleLinkIdentity = useCallback(async (externalUserId: string, targetUserId: string) => {
    if (!linkGatewayId) return;
    try {
      await linkIdentity(linkGatewayId, { externalUserId, userId: targetUserId });
      setLinkGatewayId(null);
      await loadGateways();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to link identity");
    }
  }, [linkGatewayId, loadGateways]);

  return (
    <>
      {error && (
        <div className="mb-4 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-200">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-200">✕</button>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-medium">MCP Integrations</h2>
        <button
          onClick={() => setShowAddConnection(true)}
          className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-300"
        >
          Add Integration
        </button>
      </div>

      <ConnectionList
        connections={connections}
        loading={loading}
        userId={userId}
        onDelete={handleDeleteConnection}
        onEdit={(conn) => {
          setEditConnectionServerId(conn.mcpServerId);
          setEditDefinitionServerId(undefined);
          setShowAddConnection(true);
        }}
        onEditDefinition={(conn) => {
          setEditDefinitionServerId(conn.mcpServerId);
          setEditConnectionServerId(undefined);
          setShowAddConnection(true);
        }}
        onUpdate={loadConnections}
      />

      {/* Tab bar */}
      <div className="mb-6 mt-10 flex items-center justify-between">
        <div className="flex gap-1 border-b border-zinc-800">
          {(["agents", "skills", "gateways", "activity", "settings"] as const).map((t) => (
            <button key={t} onClick={() => setDashboardTab(t)}
              className={`px-4 py-2 text-sm font-medium capitalize transition ${dashboardTab === t ? "border-b-2 border-zinc-100 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}>
              {t === "agents" ? `Agents (${agents.length})` : t === "skills" ? `Skills (${skills.length})` : t === "gateways" ? `Gateways (${gateways.length})` : t === "activity" ? "Control Center" : "Settings"}
            </button>
          ))}
        </div>
        {dashboardTab === "agents" && (
          <button onClick={() => setShowCreateAgent(true)}
            className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 transition hover:bg-white">
            + Create Agent
          </button>
        )}
        {dashboardTab === "skills" && (
          <button onClick={() => setShowCreateSkill(true)}
            className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 transition hover:bg-white">
            + Create Skill
          </button>
        )}
        {dashboardTab === "gateways" && (
          <button onClick={() => setShowAddGateway(true)}
            className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 transition hover:bg-white">
            + Add Gateway
          </button>
        )}
      </div>

      {/* Agents tab */}
      {dashboardTab === "agents" && (
        <>
          {showCreateAgent && (
            <CreateAgentModal
              userId={userId}
              onClose={() => setShowCreateAgent(false)}
              onCreated={() => { setShowCreateAgent(false); loadAgents(); }}
            />
          )}
          <AgentList
            agents={agents}
            loading={agentsLoading}
            onUpdate={loadAgents}
            userId={userId}
            isAdmin={isAdmin}
          />
        </>
      )}

      {/* Skills tab */}
      {dashboardTab === "skills" && (
        <div className="space-y-3">
          {showCreateSkill && (
            <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4">
              <h3 className="mb-3 text-sm font-semibold text-zinc-200">New Skill</h3>
              <input
                value={newSkill.slug}
                onChange={(e) => setNewSkill((s) => ({ ...s, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-{2,}/g, "-") }))}
                placeholder="Slug (e.g. code-reviewer) — identifier, lowercase a-z + hyphens"
                className="mb-3 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-purple-500 focus:outline-none"
              />
              <input
                value={newSkill.description}
                onChange={(e) => setNewSkill((s) => ({ ...s, description: e.target.value }))}
                placeholder="Short description (optional, used only if content has no inline frontmatter)"
                className="mb-3 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-purple-500 focus:outline-none"
              />
              <textarea
                value={newSkill.content}
                onChange={(e) => setNewSkill((s) => ({ ...s, content: e.target.value }))}
                rows={10}
                placeholder="Skill content (markdown; may include --- frontmatter --- with name/description)"
                className="mb-3 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-200 placeholder-zinc-600 focus:border-purple-500 focus:outline-none"
              />
              <div className="flex gap-2">
                <button onClick={async () => {
                  if (!newSkill.slug || !newSkill.content) return;
                  setSavingSkill(true);
                  try {
                    await createSkill(newSkill);
                    setShowCreateSkill(false);
                    setNewSkill({ slug: "", description: "", content: "" });
                    loadSkills();
                  } catch (err) { console.error("[dashboard] create skill error:", err); }
                  finally { setSavingSkill(false); }
                }} disabled={savingSkill || !newSkill.slug || !newSkill.content}
                  className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-white disabled:opacity-50">
                  {savingSkill ? "Creating..." : "Create"}
                </button>
                <button onClick={() => { setShowCreateSkill(false); setNewSkill({ slug: "", description: "", content: "" }); }}
                  className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 transition hover:text-zinc-200">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {skillsLoading ? (
            <p className="text-sm text-zinc-500">Loading skills...</p>
          ) : skills.length === 0 ? (
            <p className="text-sm text-zinc-500">No skills yet. Create one to get started.</p>
          ) : (
            <>
              {/* My Skills */}
              {skills.filter((s) => s.ownerUserId === userId).length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-medium text-zinc-400">My Skills</h3>
                  <div className="space-y-2">
                    {skills.filter((s) => s.ownerUserId === userId).map((skill) => (
                      <SkillCard key={skill.id} skill={skill} canDelete canEdit canRequestGlobal={skill.scope !== "global"} deletingSkill={deletingSkill} savingSkill={editingSkill}
                        onDelete={async () => {
                          if (!confirm(`Delete skill "${skill.label || skill.name}"?`)) return;
                          setDeletingSkill(skill.slug);
                          try { await deleteSkill(skill.slug); loadSkills(); } catch (err) { console.error("[dashboard] delete skill error:", err); }
                          finally { setDeletingSkill(null); }
                        }}
                        onSave={async (patch) => {
                          setEditingSkill(skill.slug);
                          try { await updateSkill(skill.slug, patch); loadSkills(); }
                          catch (err) { console.error("[dashboard] update skill error:", err); setError(err instanceof Error ? err.message : "Failed to update skill"); }
                          finally { setEditingSkill(null); }
                        }}
                        onRequestGlobal={async () => {
                          try { await submitSkillRequest(skill.slug, userId); loadSkills(); } catch (err) { console.error("[dashboard] skill request error:", err); }
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
              {/* Global Skills */}
              {skills.filter((s) => s.scope === "global").length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-medium text-zinc-400">Global Skills</h3>
                  <div className="space-y-2">
                    {skills.filter((s) => s.scope === "global").map((skill) => {
                      const canManage = skill.ownerUserId === userId || !!isAdmin;
                      return (
                        <SkillCard key={skill.id} skill={skill} canDelete={canManage} canEdit={canManage} canRequestGlobal={false} deletingSkill={deletingSkill} savingSkill={editingSkill}
                          onDelete={async () => {
                            if (!confirm(`Delete skill "${skill.label || skill.name}"?`)) return;
                            setDeletingSkill(skill.slug);
                            try { await deleteSkill(skill.slug); loadSkills(); } catch (err) { console.error("[dashboard] delete skill error:", err); }
                            finally { setDeletingSkill(null); }
                          }}
                          onSave={async (patch) => {
                            setEditingSkill(skill.slug);
                            try { await updateSkill(skill.slug, patch); loadSkills(); }
                            catch (err) { console.error("[dashboard] update skill error:", err); setError(err instanceof Error ? err.message : "Failed to update skill"); }
                            finally { setEditingSkill(null); }
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Gateways tab */}
      {dashboardTab === "gateways" && (
        <GatewayList
          gateways={gateways}
          loading={gatewaysLoading}
          onDelete={handleDeleteGateway}
          onLinkIdentity={setLinkGatewayId}
        />
      )}

      {/* Activity tab (Agent Control Center) */}
      {dashboardTab === "activity" && (
        <ActivityTab userId={userId} />
      )}

      {/* Settings tab */}
      {dashboardTab === "settings" && (
        <SettingsTab userId={userId} />
      )}

      <AddConnectionDialog
        open={showAddConnection}
        onOpenChange={(open) => {
          setShowAddConnection(open);
          if (!open) {
            setEditConnectionServerId(undefined);
            setEditDefinitionServerId(undefined);
          }
        }}
        onSubmit={handleAddConnection}
        onCreateServer={async (payload) => {
          const created = await createServer(payload, userId);
          await loadServers();
          return created;
        }}
        servers={servers}
        credentialFields={credentialFields}
        editServerId={editConnectionServerId}
        editDefinitionServerId={editDefinitionServerId}
      />

      <AddGatewayDialog
        open={showAddGateway}
        onOpenChange={setShowAddGateway}
        onSubmit={handleAddGateway}
      />

      <LinkIdentityDialog
        open={linkGatewayId !== null}
        onOpenChange={(open) => { if (!open) setLinkGatewayId(null); }}
        onSubmit={handleLinkIdentity}
        currentUserId={userId}
      />
    </>
  );
}
