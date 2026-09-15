import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listSubagentMcpConnections,
  upsertSubagentMcpConnection,
  deleteSubagentMcpConnection,
  listServers,
  getCredentialFields,
  type SubagentMcpConnectionMeta,
} from "../../../lib/api";
import type { McpServer, CredentialField } from "../../../lib/types";

interface Props {
  subagentName: string;
  userId: string;
  canEdit: boolean;
  isBuiltIn: boolean;
}

const SLUG_FROM_NAME = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "default";

const SLUG_VALID = /^[a-z0-9][a-z0-9-]{0,31}$/;

function canPinWithoutCreds(server: McpServer, fieldCount: number): boolean {
  return fieldCount === 0 && server.oauth !== true;
}

interface EditingKey {
  serverType: string;
  slug: string | null;
}

export function SubagentMcpTabV3({ subagentName, userId, canEdit, isBuiltIn }: Props) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [credentialFields, setCredentialFields] = useState<Record<string, CredentialField[]>>({});
  const [connections, setConnections] = useState<SubagentMcpConnectionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingKey | null>(null);
  const [editingDraft, setEditingDraft] = useState<Record<string, string>>({});
  const [newInstanceMeta, setNewInstanceMeta] = useState<{
    slug: string;
    displayName: string;
    nonOverridable: boolean;
  }>({ slug: "", displayName: "", nonOverridable: true });
  const [saving, setSaving] = useState(false);
  const [slugDirty, setSlugDirty] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [srv, fields, conns] = await Promise.all([
        listServers(userId),
        getCredentialFields(),
        listSubagentMcpConnections(subagentName, userId),
      ]);
      setServers(srv.filter((s) => s.enabled));
      setCredentialFields(fields);
      setConnections(conns);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [subagentName, userId]);

  useEffect(() => { void reload(); }, [reload]);

  const connectionsByType = useMemo(() => {
    const m = new Map<string, SubagentMcpConnectionMeta[]>();
    for (const c of Array.isArray(connections) ? connections : []) {
      const arr = m.get(c.mcpServerType) ?? [];
      arr.push(c);
      m.set(c.mcpServerType, arr);
    }
    return m;
  }, [connections]);

  const startEditInstance = (mcpServerType: string, slug: string, nonOverridable: boolean) => {
    setEditing({ serverType: mcpServerType, slug });
    setEditingDraft({});
    setNewInstanceMeta({ slug: "", displayName: "", nonOverridable });
    setSlugDirty(false);
    setError(null);
  };

  const startNewInstance = (mcpServerType: string) => {
    setEditing({ serverType: mcpServerType, slug: null });
    setEditingDraft({});
    setSlugDirty(false);
    const existing = connectionsByType.get(mcpServerType) ?? [];
    const server = servers.find((s) => s.type === mcpServerType);
    setNewInstanceMeta(
      existing.length === 0
        ? { slug: "default", displayName: server?.name ?? "", nonOverridable: true }
        : { slug: "", displayName: "", nonOverridable: true },
    );
    setError(null);
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditingDraft({});
    setNewInstanceMeta({ slug: "", displayName: "", nonOverridable: true });
    setSlugDirty(false);
  };

  const onNewDisplayNameChange = (name: string) => {
    setNewInstanceMeta((m) => ({
      ...m,
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
          setError(`An instance with slug "${slug}" already exists for this subagent. Pick a different slug.`);
          setSaving(false);
          return;
        }
      }
      await upsertSubagentMcpConnection(
        subagentName,
        userId,
        editing.serverType,
        editingDraft,
        {
          slug,
          nonOverridable: newInstanceMeta.nonOverridable,
          ...(isNew && newInstanceMeta.displayName.trim()
            ? { displayName: newInstanceMeta.displayName.trim() }
            : {}),
        },
      );
      await reload();
      cancelEdit();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (conn: SubagentMcpConnectionMeta) => {
    if (!confirm(
      `Remove the ${conn.displayName} instance? Tools prefixed with "${conn.mcpServerType}-${conn.slug}__" will stop working for this subagent.`,
    )) return;
    try {
      await deleteSubagentMcpConnection(subagentName, userId, conn.mcpServerType, conn.slug);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (isBuiltIn) {
    return (
      <div className="rounded-lg border border-xyne-border bg-xyne-surface-elevated p-4 text-sm text-xyne-fg-tertiary">
        MCP credentials can only be pinned to custom subagents. Fork this built-in subagent to configure its own credentials.
      </div>
    );
  }

  if (loading) {
    return <div className="py-10 text-center text-sm text-xyne-fg-tertiary">Loading MCP connections…</div>;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-xyne-border bg-xyne-surface-elevated p-4 text-xs text-xyne-fg-tertiary">
        Pin MCP credentials to this subagent. A credential set here resolves
        <span className="mx-1 font-mono text-xyne-fg-secondary">above</span>
        the agent → user → global cascade — whenever this subagent runs, it authenticates with
        these credentials. Keep <span className="font-mono text-xyne-fg-secondary">Non-overridable</span>
        on to force a fixed identity; turn it off to let it fall through to the cascade when no
        matching credential is pinned. Credentials are paste-once and never read back.
      </div>

      {error && <p className="text-sm text-xyne-error">{error}</p>}

      <div className="space-y-2">
        {servers.map((server) => {
          const instances = connectionsByType.get(server.type) ?? [];
          const fields = credentialFields[server.type] ?? [];
          const isCreatingNew = editing?.serverType === server.type && editing?.slug === null;
          return (
            <div key={server.id} className="rounded-lg border border-xyne-border bg-xyne-surface-elevated p-4">
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
                              {inst.nonOverridable ? (
                                <span title="This subagent always authenticates with these credentials" className="rounded bg-xyne-brand-ghost px-1.5 py-0.5 text-[10px] uppercase text-xyne-brand">pinned</span>
                              ) : (
                                <span title="Falls through to agent → user → global when unset" className="rounded bg-xyne-surface-sunken px-1.5 py-0.5 text-[10px] uppercase text-xyne-fg-tertiary">soft</span>
                              )}
                            </div>
                            <p className="mt-1 text-[11px] text-xyne-fg-muted">
                              Tool prefix: <span className="font-mono text-xyne-fg-tertiary">{`${server.type}-${inst.slug}__`}</span>
                              {" · "}Pinned by user {inst.createdByUserId ?? "unknown"}
                              {" · "}last updated {new Date(inst.updatedAt).toLocaleString()}
                            </p>
                          </div>
                          {canEdit && !isEditingThis && (
                            <div className="flex shrink-0 gap-2">
                              <button
                                onClick={() => startEditInstance(server.type, inst.slug, inst.nonOverridable)}
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
                            nonOverridable={newInstanceMeta.nonOverridable}
                            onNonOverridableChange={(v) => setNewInstanceMeta((m) => ({ ...m, nonOverridable: v }))}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

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
                            ({isFirstInstance ? "leave as 'default' unless you'll add more" : "short id used in tool names"})
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
                      nonOverridable={newInstanceMeta.nonOverridable}
                      onNonOverridableChange={(v) => setNewInstanceMeta((m) => ({ ...m, nonOverridable: v }))}
                    />
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EditForm({
  fields,
  draft,
  setDraft,
  saving,
  onSave,
  onCancel,
  ctaLabel,
  allowEmptyPin = false,
  nonOverridable,
  onNonOverridableChange,
}: {
  fields: CredentialField[];
  draft: Record<string, string>;
  setDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  ctaLabel: string;
  allowEmptyPin?: boolean;
  nonOverridable: boolean;
  onNonOverridableChange: (value: boolean) => void;
}) {
  return (
    <div className="mt-3">
      {fields.length === 0 ? (
        <p className="text-xs text-xyne-fg-muted">
          {allowEmptyPin
            ? "This connector needs no credentials — pin it to the subagent."
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
      <label className="mt-3 flex items-start gap-2 text-xs text-xyne-fg-secondary">
        <input
          type="checkbox"
          checked={nonOverridable}
          onChange={(e) => onNonOverridableChange(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5"
        />
        <span>
          Non-overridable
          <span className="block text-[11px] text-xyne-fg-muted">
            Always authenticate with these credentials. Uncheck to fall through to the
            agent → user → global cascade when no credential is pinned.
          </span>
        </span>
      </label>
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
