import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listAgentMcpConnections,
  upsertAgentMcpConnection,
  deleteAgentMcpConnection,
  listServers,
  getCredentialFields,
  listSubagents,
  forkSubagentForInstance,
  checkAgentMcpConnectionHealth,
  type AgentMcpConnectionMeta,
  type SubagentDef,
} from "../../../../lib/api";
import type { McpServer, CredentialField, HealthResult } from "../../../../lib/types";

interface Props {
  agentSlug: string;
  userId: string;
  canEdit: boolean;
}

// Slug constraint, mirrored on the backend (SLUG_RE in routes/agents.ts).
// Auto-generated from displayName for new instances; user can override.
const SLUG_FROM_NAME = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "default";

const SLUG_VALID = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** A connector can be "pinned" to the agent with no credentials when it
 *  publishes no credential schema AND isn't an OAuth connector — e.g. an HTTP
 *  connector whose token is baked into its httpConfigTemplate, or a no-auth
 *  server. The `oauth` flag is set by the backend (canonical OAuth set /
 *  connectorMeta.authMethod), so the frontend doesn't hardcode a list. */
function canPinWithoutCreds(server: McpServer, fieldCount: number): boolean {
  return fieldCount === 0 && server.oauth !== true;
}

/** Identifies a row in editing mode. `slug: null` means "creating a new
 *  instance of this server type" (allow slug + displayName edits). Editing
 *  an existing instance has the row's slug here and locks the slug field. */
interface EditingKey {
  serverType: string;
  slug: string | null;
}

/** On-demand health status for one agent-pinned MCP instance. */
interface InstanceHealth {
  status: "checking" | "healthy" | "unhealthy";
  message?: string;
  latencyMs?: number;
}

/**
 * Per-agent MCP credentials, multi-instance.
 *
 * Resolution at session time: `agent > user > global`. When the agent has
 * multiple instances configured for the same server type, each instance is
 * spawned as its own MCP process and its tools are surfaced under a slug
 * prefix (e.g. `grafana-prod__query` vs `grafana-staging__query`). The agent
 * picks which to call by tool name.
 *
 * UI: one section per server type. Inside the section, a list of configured
 * instances and an "Add another" button. Each row has Edit (creds-only
 * update) and Remove. Creating a new instance also asks for slug +
 * displayName.
 *
 * POST is paste-once (no read-back). Delete tears down a single instance;
 * other instances on the same server type are unaffected.
 */
export function AgentMcpTabV3({ agentSlug, userId, canEdit }: Props) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [credentialFields, setCredentialFields] = useState<Record<string, CredentialField[]>>({});
  const [connections, setConnections] = useState<AgentMcpConnectionMeta[]>([]);
  /** All subagent definitions — read once on mount, used to render the
   *  "Used by subagents: X, Y" badge per instance and to populate the
   *  "fork source" dropdown in the fork modal. */
  const [subagents, setSubagents] = useState<SubagentDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingKey | null>(null);
  const [editingDraft, setEditingDraft] = useState<Record<string, string>>({});
  /** For new-instance create only — separate so editing an existing instance
   *  can't accidentally rewrite the slug. */
  const [newInstanceMeta, setNewInstanceMeta] = useState<{ slug: string; displayName: string }>({
    slug: "",
    displayName: "",
  });
  const [saving, setSaving] = useState(false);
  /** Fork modal state. Null when closed; otherwise carries which instance
   *  we're forking for + the user's source/name picks. */
  const [forkModal, setForkModal] = useState<ForkModalState | null>(null);
  /** On-demand health per instance id. Never auto-run on mount — the operator
   *  clicks "Check" so opening the tab does not spawn N MCP child processes. */
  const [healthByInstance, setHealthByInstance] = useState<Record<string, InstanceHealth>>({});

  const runHealthCheck = useCallback(async (inst: AgentMcpConnectionMeta) => {
    setHealthByInstance((prev) => ({ ...prev, [inst.id]: { status: "checking" } }));
    try {
      const result: HealthResult = await checkAgentMcpConnectionHealth(
        agentSlug,
        userId,
        inst.mcpServerType,
        inst.slug,
      );
      setHealthByInstance((prev) => ({
        ...prev,
        [inst.id]: {
          status: result.healthy ? "healthy" : "unhealthy",
          message: result.message,
          latencyMs: result.latencyMs,
        },
      }));
    } catch (err) {
      setHealthByInstance((prev) => ({
        ...prev,
        [inst.id]: { status: "unhealthy", message: err instanceof Error ? err.message : String(err) },
      }));
    }
  }, [agentSlug, userId]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [srv, fields, conns, subs] = await Promise.all([
        listServers(userId),
        getCredentialFields(),
        listAgentMcpConnections(agentSlug, userId),
        // listSubagents fails non-fatally — the badge just shows empty.
        listSubagents().catch(() => [] as SubagentDef[]),
      ]);
      setServers(srv.filter((s) => s.enabled));
      setCredentialFields(fields);
      setConnections(conns);
      setSubagents(subs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [agentSlug, userId]);

  useEffect(() => { void reload(); }, [reload]);

  const connectionsByType = useMemo(() => {
    const m = new Map<string, AgentMcpConnectionMeta[]>();
    for (const c of connections) {
      const arr = m.get(c.mcpServerType) ?? [];
      arr.push(c);
      m.set(c.mcpServerType, arr);
    }
    return m;
  }, [connections]);

  const startEditInstance = (mcpServerType: string, slug: string) => {
    setEditing({ serverType: mcpServerType, slug });
    setEditingDraft({});
    setNewInstanceMeta({ slug: "", displayName: "" });
    setSlugDirty(false);
    setError(null);
  };

  const startNewInstance = (mcpServerType: string) => {
    setEditing({ serverType: mcpServerType, slug: null });
    setEditingDraft({});
    // Reset slugDirty so the auto-fill-from-name behavior works again, even
    // if the user previously typed a slug manually then cancelled.
    setSlugDirty(false);
    // First instance for this server type: pre-fill slug='default' AND the
    // display name with the server's stock name. User can save immediately
    // — single-instance use case stays one-click. Adding ANOTHER instance
    // means the user is forking; we leave both fields blank to force a
    // distinct name + slug.
    const existing = connectionsByType.get(mcpServerType) ?? [];
    const server = servers.find((s) => s.type === mcpServerType);
    setNewInstanceMeta(
      existing.length === 0
        ? { slug: "default", displayName: server?.name ?? "" }
        : { slug: "", displayName: "" },
    );
    setError(null);
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditingDraft({});
    setNewInstanceMeta({ slug: "", displayName: "" });
    setSlugDirty(false);
  };

  /** When the user types into displayName for a NEW instance, auto-fill the
   *  slug if they haven't typed one yet. Once they edit slug manually,
   *  detach the auto-fill so we don't keep overwriting. */
  const [slugDirty, setSlugDirty] = useState(false);
  const onNewDisplayNameChange = (name: string) => {
    setNewInstanceMeta((m) => ({
      displayName: name,
      slug: slugDirty ? m.slug : SLUG_FROM_NAME(name),
    }));
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const isNew = editing.slug === null;
      const slug = isNew ? newInstanceMeta.slug.trim() : editing.slug!;
      if (isNew) {
        if (!slug) {
          setError("Slug is required (e.g. 'prod', 'staging').");
          setSaving(false);
          return;
        }
        if (!SLUG_VALID.test(slug)) {
          setError("Slug must be lowercase alphanumeric + hyphen, 1-32 chars.");
          setSaving(false);
          return;
        }
        const existing = connectionsByType.get(editing.serverType) ?? [];
        if (existing.some((c) => c.slug === slug)) {
          setError(`An instance with slug "${slug}" already exists for this server. Pick a different slug.`);
          setSaving(false);
          return;
        }
      }
      await upsertAgentMcpConnection(
        agentSlug,
        userId,
        editing.serverType,
        editingDraft,
        {
          slug,
          ...(isNew && newInstanceMeta.displayName.trim()
            ? { displayName: newInstanceMeta.displayName.trim() }
            : {}),
        },
      );
      await reload();
      cancelEdit();
      setSlugDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  // ── Forking ─────────────────────────────────────────────────────────────
  // The "fork subagent for this MCP instance" workflow lives ENTIRELY on
  // this tab — picking a source subagent here also pins it to a specific
  // instance and enables it on this agent in one shot.

  /** Reverse-lookup: subagents that have this instance pinned via
   *  `mcpInstanceMap[server.type] === instance.slug`. Renders as a "Used by"
   *  badge per row so admins can see at a glance which subagents will be
   *  affected if they remove or rotate creds. */
  const subagentsPinnedTo = useCallback(
    (serverType: string, slug: string): SubagentDef[] =>
      subagents.filter((s) => (s.mcpInstanceMap?.[serverType] ?? null) === slug),
    [subagents],
  );

  /** Forkable sources = ALL subagents (custom + builtin). Builtin forks are
   *  supported on the backend; the new custom subagent inherits the builtin's
   *  prompt + param shape and starts with an empty tools palette that the
   *  admin can edit. */
  const forkableSubagents = useMemo(
    () => subagents,
    [subagents],
  );

  const openForkModal = (instance: AgentMcpConnectionMeta) => {
    const firstSource = forkableSubagents[0]?.name ?? "";
    setForkModal({
      instance,
      sourceName: firstSource,
      // Auto-suggest "<source>-<instance.slug>", refined as user edits source.
      newName: firstSource ? `${firstSource}-${instance.slug}` : "",
      enableOnAgent: true,
      submitting: false,
      error: null,
    });
  };

  const closeForkModal = () => setForkModal(null);

  const submitFork = async () => {
    if (!forkModal) return;
    const { instance, sourceName, newName, enableOnAgent } = forkModal;
    if (!sourceName || !newName.trim()) {
      setForkModal((m) => (m ? { ...m, error: "Source subagent and new name are required" } : m));
      return;
    }
    setForkModal((m) => (m ? { ...m, submitting: true, error: null } : m));
    try {
      await forkSubagentForInstance(agentSlug, userId, {
        sourceName,
        newName: newName.trim(),
        mcpInstanceMap: { [instance.mcpServerType]: instance.slug },
        enableOnAgent,
      });
      await reload();
      closeForkModal();
    } catch (err) {
      setForkModal((m) =>
        m ? { ...m, submitting: false, error: err instanceof Error ? err.message : String(err) } : m,
      );
    }
  };

  const remove = async (conn: AgentMcpConnectionMeta) => {
    if (!confirm(
      `Remove the ${conn.displayName} instance? Tools prefixed with "${conn.mcpServerType}-${conn.slug}__" will stop working for this agent.`,
    )) return;
    try {
      await deleteAgentMcpConnection(agentSlug, userId, conn.mcpServerType, conn.slug);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading) {
    return <div className="py-10 text-center text-sm text-xyne-fg-tertiary">Loading MCP connections…</div>;
  }

  return (
    // Outer page padding so cards don't butt against the column edge —
    // matches the spacing used in other tabs (px-4 py-4).
    <div className="space-y-3 p-4">
      <div className="rounded-lg border border-xyne-border bg-xyne-surface-elevated p-4 text-xs text-xyne-fg-tertiary">
        Pin MCP credentials to this agent. Resolution at session time:
        <span className="ml-1 font-mono text-xyne-fg-secondary">agent → user → global</span>.
        You can configure multiple named instances of the same MCP (e.g. two Grafanas with
        different credentials) — each gets its own tool prefix at runtime.
        Anyone who can invoke this agent will use these credentials for tool calls — never
        paste secrets here you wouldn't share with every user of the agent.
      </div>

      {error && <p className="text-sm text-xyne-error">{error}</p>}

      <div className="space-y-2">
        {servers.map((server) => {
          const instances = connectionsByType.get(server.type) ?? [];
          const fields = credentialFields[server.type] ?? [];
          const isCreatingNew = editing?.serverType === server.type && editing?.slug === null;
          return (
            <div key={server.id} className="rounded-lg border border-xyne-border bg-xyne-surface-elevated p-4">
              {/* Title row: name + type + instance count on the left,
                    Connect/Add affordance pinned to the right and vertically
                    centered with the title. Pulled up from the bottom of
                    the card so the affordance is reachable without
                    scrolling/scanning past credential rows. */}
              <div className="mb-2 flex items-center gap-2">
                <span className="font-medium text-xyne-fg-primary">{server.name}</span>
                <span className="font-mono text-[10px] text-xyne-fg-muted">{server.type}</span>
                <span className="rounded bg-xyne-surface-sunken px-1.5 py-0.5 text-[10px] uppercase text-xyne-fg-muted">
                  {instances.length} instance{instances.length === 1 ? "" : "s"}
                </span>
                {canEdit && !isCreatingNew && (
                  <button
                    onClick={() => startNewInstance(server.type)}
                    className="ml-auto rounded border border-dashed border-xyne-border-subtle px-3 py-1 text-xs text-xyne-fg-secondary hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary transition-colors"
                  >
                    + {instances.length === 0 ? "Connect" : "Add another"}
                  </button>
                )}
              </div>

              {/* Configured instances */}
              {instances.length > 0 && (
                <div className="space-y-1.5">
                  {instances.map((inst) => {
                    const isEditingThis = editing?.serverType === server.type && editing?.slug === inst.slug;
                    return (
                      <div key={inst.id} className="rounded border border-xyne-border bg-xyne-surface p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-xyne-fg-primary">{inst.displayName}</span>
                              <span className="rounded bg-xyne-surface-sunken px-1.5 py-0.5 font-mono text-[10px] text-xyne-fg-tertiary">{inst.slug}</span>
                              {(() => {
                                const h = healthByInstance[inst.id];
                                if (!h) {
                                  return <span title="Health not checked yet - click Check" className="rounded bg-xyne-surface-sunken px-1.5 py-0.5 text-[10px] uppercase text-xyne-fg-tertiary">unknown</span>;
                                }
                                if (h.status === "checking") {
                                  return <span className="rounded bg-xyne-surface-sunken px-1.5 py-0.5 text-[10px] uppercase text-xyne-fg-tertiary">checking</span>;
                                }
                                if (h.status === "healthy") {
                                  return <span title={h.message} className="rounded bg-xyne-success-bg px-1.5 py-0.5 text-[10px] uppercase text-xyne-success">healthy</span>;
                                }
                                return <span title={h.message} className="rounded bg-xyne-error-bg px-1.5 py-0.5 text-[10px] uppercase text-xyne-error">unhealthy</span>;
                              })()}
                            </div>
                            <p className="mt-1 text-[11px] text-xyne-fg-muted">
                              Tool prefix: <span className="font-mono text-xyne-fg-tertiary">{`${server.type}-${inst.slug}__`}</span>
                              {" · "}Pinned by user {inst.createdByUserId ?? "unknown"}
                              {" · "}last updated {new Date(inst.updatedAt).toLocaleString()}
                            </p>
                            {(() => {
                              const h = healthByInstance[inst.id];
                              if (!h || !h.message || h.status === "checking") return null;
                              return (
                                <p className={`mt-1 text-[11px] ${h.status === "healthy" ? "text-xyne-success" : "text-xyne-error"}`}>
                                  {h.message}{typeof h.latencyMs === "number" ? ` (${h.latencyMs}ms)` : ""}
                                </p>
                              );
                            })()}
                            {/* Reverse-lookup: which subagents have THIS
                                instance pinned via mcpInstanceMap. Lets the
                                operator see at a glance the blast radius of
                                removing this instance. */}
                            {(() => {
                              const pinned = subagentsPinnedTo(server.type, inst.slug);
                              if (pinned.length === 0) return null;
                              return (
                                <p className="mt-1 text-[11px] text-xyne-fg-muted">
                                  Used by subagents:{" "}
                                  {pinned.map((s, i) => (
                                    <span key={s.id ?? s.name}>
                                      <span className="rounded bg-purple-950 px-1 py-0.5 font-mono text-[10px] text-xyne-brand">
                                        {s.name}
                                      </span>
                                      {i < pinned.length - 1 ? " " : ""}
                                    </span>
                                  ))}
                                </p>
                              );
                            })()}
                          </div>
                          {canEdit && !isEditingThis && (
                            <div className="flex shrink-0 gap-2">
                              <button
                                onClick={() => void runHealthCheck(inst)}
                                disabled={healthByInstance[inst.id]?.status === "checking"}
                                title="Check whether this instance's pinned credentials are actually reachable"
                                className="rounded border border-xyne-border-subtle px-2 py-1 text-xs text-xyne-fg-secondary hover:bg-xyne-surface-sunken disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                {healthByInstance[inst.id]?.status === "checking" ? "Checking" : "Check"}
                              </button>
                              <button
                                onClick={() => openForkModal(inst)}
                                disabled={forkableSubagents.length === 0}
                                title={forkableSubagents.length === 0
                                  ? "No custom subagents available to fork. Create one in the Subagents admin first."
                                  : "Fork a subagent pinned to this instance"}
                                className="rounded border border-xyne-brand px-2 py-1 text-xs text-xyne-brand hover:bg-xyne-brand-ghost disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                Fork subagent
                              </button>
                              <button
                                onClick={() => startEditInstance(server.type, inst.slug)}
                                className="rounded border border-xyne-border-subtle px-2 py-1 text-xs text-xyne-fg-secondary hover:bg-xyne-surface-sunken"
                              >
                                Update creds
                              </button>
                              <button
                                onClick={() => remove(inst)}
                                className="rounded border border-xyne-error-border px-2 py-1 text-xs text-xyne-error hover:bg-xyne-error-bg"
                              >
                                Remove
                              </button>
                            </div>
                          )}
                        </div>

                        {isEditingThis && (
                          <EditForm
                            fields={fields}
                            draft={editingDraft}
                            setDraft={setEditingDraft}
                            saving={saving}
                            onSave={save}
                            onCancel={cancelEdit}
                            ctaLabel="Update credentials"
                            allowEmptyPin={canPinWithoutCreds(server, fields.length)}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* The Connect / Add-another affordance moved up into the
                    title row. Only the new-instance form remains here. */}

              {isCreatingNew && (() => {
                const isFirstInstance = instances.length === 0;
                return (
                  <div className="mt-2 rounded border border-xyne-brand bg-xyne-surface p-3">
                    {isFirstInstance && (
                      <p className="mb-3 text-[11px] text-xyne-fg-muted">
                        Single instance? Just paste the credentials below and save —
                        the defaults work. Set a custom display name + slug only if you
                        plan to add a second {server.name} later.
                      </p>
                    )}
                    <div className="space-y-2">
                      <div>
                        <label className="mb-1 block text-xs text-xyne-fg-tertiary">
                          Display name {isFirstInstance && <span className="text-xyne-fg-muted">(optional)</span>}
                        </label>
                        <input
                          type="text"
                          value={newInstanceMeta.displayName}
                          onChange={(e) => onNewDisplayNameChange(e.target.value)}
                          placeholder={isFirstInstance ? server.name : `e.g. ${server.name} Prod`}
                          className="w-full rounded-md border border-xyne-border-subtle bg-xyne-surface-sunken px-2 py-1.5 text-sm text-xyne-fg-primary placeholder-xyne-fg-muted focus:border-xyne-brand focus:ring-1 focus:ring-xyne-brand"
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-xyne-fg-tertiary">
                          Slug <span className="text-xyne-fg-muted">
                            ({isFirstInstance ? "leave as 'default' unless you'll fork" : "short id used in tool names"})
                          </span>
                        </label>
                        <input
                          type="text"
                          value={newInstanceMeta.slug}
                          onChange={(e) => {
                            setSlugDirty(true);
                            setNewInstanceMeta((m) => ({ ...m, slug: e.target.value }));
                          }}
                          placeholder={isFirstInstance ? "default" : "prod"}
                          className="w-full rounded-md border border-xyne-border-subtle bg-xyne-surface-sunken px-2 py-1.5 font-mono text-sm text-xyne-fg-primary placeholder-xyne-fg-muted focus:border-xyne-brand focus:ring-1 focus:ring-xyne-brand"
                          autoComplete="off"
                          spellCheck={false}
                        />
                        <p className="mt-1 text-[10px] text-xyne-fg-muted">
                          Lowercase alphanumeric + hyphen. Tools will be prefixed{" "}
                          <span className="font-mono text-xyne-fg-tertiary">{`${server.type}-${newInstanceMeta.slug || "<slug>"}__`}</span>.
                        </p>
                      </div>
                    </div>
                    <EditForm
                      fields={fields}
                      draft={editingDraft}
                      setDraft={setEditingDraft}
                      saving={saving}
                      onSave={save}
                      onCancel={cancelEdit}
                      ctaLabel={isFirstInstance ? "Connect" : "Save instance"}
                      allowEmptyPin={canPinWithoutCreds(server, fields.length)}
                    />
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      {forkModal && (
        <ForkSubagentModal
          state={forkModal}
          setState={setForkModal}
          sources={forkableSubagents}
          onSubmit={submitFork}
          onClose={closeForkModal}
        />
      )}
    </div>
  );
}

interface ForkModalState {
  instance: AgentMcpConnectionMeta;
  sourceName: string;
  newName: string;
  enableOnAgent: boolean;
  submitting: boolean;
  error: string | null;
}

/** Modal for "Fork & connect a subagent to this MCP instance". The subagent
 *  itself is global, but it's pinned to this specific (serverType, slug)
 *  combination via `mcpInstanceMap`, and (by default) auto-enabled on the
 *  current agent. Source selector is restricted to custom subagents — the
 *  backend rejects builtin sources for now. */
function ForkSubagentModal({
  state,
  setState,
  sources,
  onSubmit,
  onClose,
}: {
  state: ForkModalState;
  setState: React.Dispatch<React.SetStateAction<ForkModalState | null>>;
  sources: SubagentDef[];
  onSubmit: () => void;
  onClose: () => void;
}) {
  const { instance, sourceName, newName, enableOnAgent, submitting, error } = state;
  /** Auto-update the suggested newName when the source changes — only if the
   *  user hasn't customised newName beyond the auto-suggest yet (cheap
   *  heuristic: still matches `<previousSource>-<instanceSlug>`). */
  const onSourceChange = (next: string) => {
    setState((m) => {
      if (!m) return m;
      const previousAutoSuggest = m.sourceName ? `${m.sourceName}-${m.instance.slug}` : "";
      const newSuggest = next ? `${next}-${m.instance.slug}` : "";
      return {
        ...m,
        sourceName: next,
        newName: m.newName === previousAutoSuggest ? newSuggest : m.newName,
      };
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={submitting ? undefined : onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-xyne-border-subtle bg-xyne-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-base font-semibold text-xyne-fg-primary">
          Fork a subagent for{" "}
          <span className="font-mono text-xyne-brand">{instance.displayName}</span>
        </h3>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-xyne-fg-tertiary">Source subagent</label>
            {sources.length === 0 ? (
              <p className="text-xs text-xyne-fg-muted">
                No custom subagents available. Create one from the Subagents admin tab first.
              </p>
            ) : (
              <select
                value={sourceName}
                onChange={(e) => onSourceChange(e.target.value)}
                className="w-full rounded-md border border-xyne-border-subtle bg-xyne-surface-sunken px-2 py-1.5 text-sm text-xyne-fg-primary focus:border-xyne-brand focus:ring-1 focus:ring-xyne-brand"
              >
                {sources.map((s) => (
                  <option key={s.id ?? s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs text-xyne-fg-tertiary">New subagent name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setState((m) => (m ? { ...m, newName: e.target.value } : m))}
              placeholder="e.g. grafana-watchdog-prod"
              className="w-full rounded-md border border-xyne-border-subtle bg-xyne-surface-sunken px-2 py-1.5 font-mono text-sm text-xyne-fg-primary placeholder-xyne-fg-muted focus:border-xyne-brand focus:ring-1 focus:ring-xyne-brand"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="mt-1 text-[11px] text-xyne-fg-muted">
              Auto-suggested from <span className="font-mono">&lt;source&gt;-&lt;instance slug&gt;</span>. Lowercase letters, digits, hyphens.
            </p>
          </div>

          <div className="rounded border border-xyne-border bg-xyne-surface-elevated p-3 text-[11px] text-xyne-fg-tertiary">
            The new subagent will be a copy of <span className="font-mono text-xyne-fg-primary">{sourceName || "<source>"}</span> with{" "}
            <span className="font-mono text-xyne-fg-secondary">
              mcpInstanceMap = {`{ ${instance.mcpServerType}: "${instance.slug}" }`}
            </span>
            . It will only see tools prefixed{" "}
            <span className="font-mono text-xyne-fg-secondary">{`${instance.mcpServerType}-${instance.slug}__`}</span> at runtime.
          </div>

          <label className="flex items-center gap-2 text-xs text-xyne-fg-secondary">
            <input
              type="checkbox"
              checked={enableOnAgent}
              onChange={(e) => setState((m) => (m ? { ...m, enableOnAgent: e.target.checked } : m))}
              className="h-3.5 w-3.5"
            />
            Enable on this agent immediately
          </label>

          {error && <p className="text-xs text-xyne-error">{error}</p>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded px-3 py-1.5 text-xs text-xyne-fg-tertiary hover:text-xyne-fg-primary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={submitting || sources.length === 0 || !sourceName || !newName.trim()}
            className="rounded bg-xyne-brand px-3 py-1.5 text-xs font-medium text-xyne-fg-inverse hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Forking…" : "Fork & Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Inline cred-fields editor. Shared between "create new instance" and
 *  "update existing instance" — same fields, same save/cancel buttons. */
function EditForm({
  fields,
  draft,
  setDraft,
  saving,
  onSave,
  onCancel,
  ctaLabel,
  allowEmptyPin = false,
}: {
  fields: CredentialField[];
  draft: Record<string, string>;
  setDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  ctaLabel: string;
  /** When true, a no-field connector can still be saved (pinned) with empty
   *  credentials — for credential-less, non-OAuth connectors. */
  allowEmptyPin?: boolean;
}) {
  return (
    <div className="mt-3">
      {fields.length === 0 ? (
        <p className="text-xs text-xyne-fg-muted">
          {allowEmptyPin
            ? "This connector needs no credentials — pin it to the agent."
            : "No credential schema published for this MCP. Skip for now."}
        </p>
      ) : (
        <div className="space-y-2">
          {fields.map((field) => (
            <div key={field.name}>
              <label className="mb-1 block text-xs text-xyne-fg-tertiary">
                {field.label || field.name}
                {field.optional ? " (optional)" : ""}
              </label>
              <input
                type={field.type === "password" ? "password" : "text"}
                value={draft[field.name] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [field.name]: e.target.value }))}
                placeholder={field.placeholder ?? ""}
                className="w-full rounded-md border border-xyne-border-subtle bg-xyne-surface-sunken px-2 py-1.5 text-sm text-xyne-fg-primary placeholder-xyne-fg-muted focus:border-xyne-brand focus:ring-1 focus:ring-xyne-brand"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button
          onClick={onSave}
          disabled={saving || (fields.length === 0 && !allowEmptyPin)}
          className="rounded bg-xyne-fg-primary px-3 py-1 text-xs font-medium text-xyne-surface transition hover:bg-xyne-surface-elevated disabled:opacity-50"
        >
          {saving ? "Saving…" : ctaLabel}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="rounded px-3 py-1 text-xs text-xyne-fg-tertiary hover:text-xyne-fg-primary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
