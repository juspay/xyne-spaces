import * as Dialog from "@radix-ui/react-dialog";
import { useState, useEffect, type FormEvent } from "react";
import type { McpServer, CredentialField } from "../lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (mcpServerId: string, credentials: Record<string, string>) => void;
  onCreateServer: (payload: {
    name: string;
    type: string;
    url: string;
    description?: string;
    transport: "stdio" | "http";
    credentialForm: { fields: CredentialField[] };
    launchConfigTemplate?: { cmd: string; args: string[]; env: Record<string, string> };
    httpConfigTemplate?: { url: string; headers: Record<string, string> };
    healthcheckSpec?: { name: string; params: Record<string, unknown> };
    writeToolPolicy?: { mode?: "allowlist" | "denylist" | "allAsk" | "allowAll"; tools?: string[] };
  }) => Promise<McpServer>;
  servers: McpServer[];
  credentialFields: Record<string, CredentialField[]>;
  editServerId?: string | undefined;
  editDefinitionServerId?: string | undefined;
}

type Mode = "existing" | "new";
type BuilderCredentialField = CredentialField & { optional?: boolean };
type BuilderKvRow = { key: string; value: string };

export function AddConnectionDialog({ open, onOpenChange, onSubmit, onCreateServer, servers, credentialFields, editServerId, editDefinitionServerId }: Props) {
  const [selectedServerId, setSelectedServerId] = useState("");
  const [mode, setMode] = useState<Mode>("existing");
  const [newServerName, setNewServerName] = useState("");
  const [newServerType, setNewServerType] = useState("");
  const [newServerUrl, setNewServerUrl] = useState("");
  const [newServerDescription, setNewServerDescription] = useState("");
  const [newServerTransport, setNewServerTransport] = useState<"stdio" | "http">("stdio");
  const [newCredentialFields, setNewCredentialFields] = useState<string>(JSON.stringify([
    { name: "apiKey", label: "API Key", type: "password", placeholder: "Enter API key" },
  ], null, 2));
  const [newLaunchConfig, setNewLaunchConfig] = useState<string>(JSON.stringify({
    cmd: "npx",
    args: ["-y", "your-mcp-package"],
    env: { API_KEY: "{{apiKey}}" },
  }, null, 2));
  const [newHttpConfig, setNewHttpConfig] = useState<string>(JSON.stringify({
    url: "https://your-mcp-endpoint.example.com/mcp",
    headers: { Authorization: "Bearer {{apiKey}}" },
  }, null, 2));
  const [newHealthcheck, setNewHealthcheck] = useState<string>(JSON.stringify({ name: "ping", params: {} }, null, 2));
  const [newWritePolicy, setNewWritePolicy] = useState<string>(JSON.stringify({ mode: "allowlist", tools: [] }, null, 2));
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdServer, setCreatedServer] = useState<McpServer | null>(null);
  const [builderEnabled, setBuilderEnabled] = useState(true);
  const [builderCredentialFields, setBuilderCredentialFields] = useState<BuilderCredentialField[]>([
    { name: "", label: "", type: "password", placeholder: "", optional: false },
  ]);
  const [builderCommandType, setBuilderCommandType] = useState<"npx" | "uvx" | "node" | "docker" | "binary">("npx");
  const [builderCommandTarget, setBuilderCommandTarget] = useState("");
  const [builderCommandArgsText, setBuilderCommandArgsText] = useState("");
  const [builderEnvRows, setBuilderEnvRows] = useState<BuilderKvRow[]>([{ key: "", value: "" }]);
  const [builderHttpUrl, setBuilderHttpUrl] = useState("");
  const [builderHeaderRows, setBuilderHeaderRows] = useState<BuilderKvRow[]>([{ key: "", value: "" }]);
  const [builderHealthMode, setBuilderHealthMode] = useState<"listTools" | "toolCall">("listTools");
  const [builderHealthTool, setBuilderHealthTool] = useState("");
  const [builderHealthParamsText, setBuilderHealthParamsText] = useState("{}");
  const [builderWriteMode, setBuilderWriteMode] = useState<"allowlist" | "denylist" | "allAsk" | "allowAll">("allowlist");
  const [builderWriteToolsText, setBuilderWriteToolsText] = useState("");

  const stringifyPretty = (value: unknown, fallback: string): string => {
    if (value === null || value === undefined) return fallback;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return fallback;
    }
  };

  useEffect(() => {
    if (open && editServerId) {
      setSelectedServerId(editServerId);
      setMode("existing");
    }
  }, [open, editServerId]);

  useEffect(() => {
    if (!(mode === "new" && !editServerId && builderEnabled)) return;
    const fields = builderCredentialFields
      .filter((f) => f.name.trim().length > 0)
      .map((f) => ({
        name: f.name.trim(),
        label: (f.label || f.name).trim(),
        type: f.type === "password" ? "password" : "text",
        placeholder: f.placeholder ?? "",
        optional: Boolean(f.optional ?? false),
      }));
    setNewCredentialFields(JSON.stringify(fields, null, 2));

    const extraArgs = builderCommandArgsText
      .split("\n")
      .map((a) => a.trim())
      .filter(Boolean);
    const target = builderCommandTarget.trim();
    let cmd: string = builderCommandType;
    let args: string[] = [];
    if (builderCommandType === "npx") args = target ? ["-y", target] : ["-y"];
    else if (builderCommandType === "uvx") args = target ? [target] : [];
    else if (builderCommandType === "node") args = target ? [target] : [];
    else if (builderCommandType === "docker") args = target ? ["run", "--rm", target] : ["run", "--rm"];
    else {
      cmd = target || "binary";
      args = [];
    }
    args = [...args, ...extraArgs];

    const env: Record<string, string> = {};
    for (const row of builderEnvRows) if (row.key.trim()) env[row.key.trim()] = row.value;
    setNewLaunchConfig(JSON.stringify({ cmd, args, env }, null, 2));

    const headers: Record<string, string> = {};
    for (const row of builderHeaderRows) if (row.key.trim()) headers[row.key.trim()] = row.value;
    setNewHttpConfig(JSON.stringify({ url: builderHttpUrl.trim(), headers }, null, 2));

    let params: Record<string, unknown> = {};
    try { params = JSON.parse(builderHealthParamsText) as Record<string, unknown>; } catch { params = {}; }
    const healthSpec = builderHealthMode === "listTools"
      ? { name: "__list_tools__", params: {} }
      : { name: builderHealthTool.trim() || "ping", params };
    setNewHealthcheck(JSON.stringify(healthSpec, null, 2));

    const writeTools = builderWriteToolsText
      .split(/[\n,]/g)
      .map((t) => t.trim())
      .filter(Boolean);
    setNewWritePolicy(JSON.stringify({ mode: builderWriteMode, tools: writeTools }, null, 2));
  }, [
    mode,
    editServerId,
    builderEnabled,
    builderCredentialFields,
    builderCommandType,
    builderCommandTarget,
    builderCommandArgsText,
    builderEnvRows,
    builderHttpUrl,
    builderHeaderRows,
    builderHealthMode,
    builderHealthTool,
    builderHealthParamsText,
    builderWriteMode,
    builderWriteToolsText,
  ]);

  useEffect(() => {
    if (!open || !editDefinitionServerId) return;
    const server = servers.find((s) => s.id === editDefinitionServerId);
    if (!server) return;

    const fallbackFields: CredentialField[] = [{
      name: "apiKey",
      label: "API Key",
      type: "password" as const,
      placeholder: "Enter API key",
      optional: false,
    }];
    const existingFields: CredentialField[] = credentialFields[server.type] ?? fallbackFields;
    setMode("new");
    setNewServerName(server.name ?? "");
    setNewServerType(server.type ?? "");
    setNewServerUrl(server.url ?? "");
    setNewServerDescription(server.description ?? "");
    setNewServerTransport(server.transport === "http" ? "http" : "stdio");
    setNewCredentialFields(stringifyPretty(server.credentialForm?.fields ?? existingFields, JSON.stringify(existingFields, null, 2)));
    setNewLaunchConfig(stringifyPretty(server.launchConfigTemplate ?? {
      cmd: "npx",
      args: ["-y", "your-mcp-package"],
      env: { API_KEY: "{{apiKey}}" },
    }, JSON.stringify({
      cmd: "npx",
      args: ["-y", "your-mcp-package"],
      env: { API_KEY: "{{apiKey}}" },
    }, null, 2)));
    setNewHttpConfig(stringifyPretty(server.httpConfigTemplate ?? {
      url: "https://your-mcp-endpoint.example.com/mcp",
      headers: { Authorization: "Bearer {{apiKey}}" },
    }, JSON.stringify({
      url: "https://your-mcp-endpoint.example.com/mcp",
      headers: { Authorization: "Bearer {{apiKey}}" },
    }, null, 2)));
    setNewHealthcheck(stringifyPretty(server.healthcheckSpec ?? { name: "ping", params: {} }, JSON.stringify({ name: "ping", params: {} }, null, 2)));
    setNewWritePolicy(stringifyPretty(server.writeToolPolicy ?? { mode: "allowlist", tools: [] }, JSON.stringify({ mode: "allowlist", tools: [] }, null, 2)));
    setBuilderEnabled(false);
    setCreatedServer(null);
    setCreateError(null);
  }, [open, editDefinitionServerId, servers, credentialFields]);

  const isEditMode = !!editServerId;
  const isDefinitionEditMode = !!editDefinitionServerId;
  const selectedServer = createdServer ?? servers.find((s) => s.id === selectedServerId);
  const fields = selectedServer ? (credentialFields[selectedServer.type] ?? []) : [];
  let newModeFields: CredentialField[] = [];
  let newModeFieldsError: string | null = null;
  if (mode === "new" && !isEditMode) {
    try {
      const parsed = JSON.parse(newCredentialFields) as unknown;
      if (Array.isArray(parsed)) {
        newModeFields = parsed
          .filter((f): f is CredentialField => !!f && typeof f === "object" && "name" in (f as Record<string, unknown>))
          .map((f) => ({
            name: String(f.name ?? ""),
            label: String(f.label ?? f.name ?? ""),
            type: f.type === "password" ? ("password" as const) : ("text" as const),
            placeholder: String(f.placeholder ?? ""),
            optional: Boolean(f.optional ?? false),
          }))
          .filter((f) => f.name.length > 0);
      }
    } catch {
      newModeFieldsError = "Credential Fields JSON is invalid.";
    }
  }

  const parseJson = <T,>(label: string, text: string): T => {
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Invalid JSON in ${label}`);
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCreateError(null);
    const form = new FormData(e.currentTarget);

    let activeServerId = selectedServerId;
    let activeServer = selectedServer;

    if (mode === "new") {
      if (!newServerName.trim() || !newServerType.trim() || !newServerUrl.trim()) {
        setCreateError("Name, type, and URL are required to create a connector.");
        return;
      }
      setCreating(true);
      try {
        const payload = {
          name: newServerName.trim(),
          type: newServerType.trim(),
          url: newServerUrl.trim(),
          description: newServerDescription.trim() || undefined,
          transport: newServerTransport,
          credentialForm: {
            fields: parseJson<CredentialField[]>("credential fields", newCredentialFields),
          },
          ...(newServerTransport === "stdio"
            ? { launchConfigTemplate: parseJson<{ cmd: string; args: string[]; env: Record<string, string> }>("launch config", newLaunchConfig) }
            : { httpConfigTemplate: parseJson<{ url: string; headers: Record<string, string> }>("http config", newHttpConfig) }),
          healthcheckSpec: parseJson<{ name: string; params: Record<string, unknown> }>("healthcheck spec", newHealthcheck),
          writeToolPolicy: parseJson<{ mode?: "allowlist" | "denylist" | "allAsk" | "allowAll"; tools?: string[] }>("write tool policy", newWritePolicy),
        } as const;

        const created = await onCreateServer(payload);
        setCreatedServer(created);
        activeServer = created;
        activeServerId = created.id;
      } catch (err) {
        setCreateError(err instanceof Error ? err.message : "Failed to create connector");
        setCreating(false);
        return;
      } finally {
        setCreating(false);
      }
    }

    if (!activeServerId || !activeServer) return;

    const activeFields = activeServer.type in credentialFields
      ? (credentialFields[activeServer.type] ?? [])
      : parseJson<CredentialField[]>("credential fields", newCredentialFields);

    const credentials: Record<string, string> = {};
    for (const field of activeFields) {
      const val = (form.get(field.name) as string | null)?.trim() ?? "";
      if (!val && !field.optional) {
        setCreateError(`${field.label || field.name} is required.`);
        return;
      }
      if (val) credentials[field.name] = val;
    }

    onSubmit(activeServerId, credentials);
    setSelectedServerId("");
    setCreatedServer(null);
  };

  const handleOpenChange = (val: boolean) => {
    if (!val) {
      setSelectedServerId("");
      setMode("existing");
      setCreatedServer(null);
      setCreateError(null);
      setBuilderEnabled(true);
    }
    onOpenChange(val);
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <Dialog.Title className="text-lg font-semibold text-zinc-100">
            {isDefinitionEditMode ? "Edit MCP Connector Definition" : isEditMode ? "Update MCP Connection" : "Connect to MCP Server"}
          </Dialog.Title>
          {servers.length === 0 ? (
            <div className="mt-4 rounded-lg border border-zinc-700 bg-zinc-800 p-4 text-center text-sm text-zinc-400">
              No MCP servers available.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              {!isEditMode && !isDefinitionEditMode && (
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setMode("existing")}
                    className={`rounded px-2 py-1 ${mode === "existing" ? "bg-zinc-100 text-zinc-900" : "bg-zinc-800 text-zinc-300"}`}
                  >
                    Connect Existing
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("new")}
                    className={`rounded px-2 py-1 ${mode === "new" ? "bg-zinc-100 text-zinc-900" : "bg-zinc-800 text-zinc-300"}`}
                  >
                    Add New MCP Connector
                  </button>
                </div>
              )}

              {mode === "new" && !isEditMode && (
                <div className="space-y-3 rounded-lg border border-zinc-700 bg-zinc-800/60 p-3">
                  <p className="text-xs text-zinc-400">
                    {isDefinitionEditMode
                      ? "Edit connector definition and overwrite the existing type, then reconnect with credentials below."
                      : "Create a connector definition, then connect with credentials below."}
                  </p>
                  <input value={newServerName} onChange={(e) => setNewServerName(e.target.value)} placeholder="Connector name (e.g. Notion)" className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100" />
                  <input value={newServerType} onChange={(e) => setNewServerType(e.target.value)} placeholder="Connector type key (e.g. notion)" disabled={isDefinitionEditMode} className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 disabled:opacity-60" />
                  <input value={newServerUrl} onChange={(e) => setNewServerUrl(e.target.value)} placeholder="Base URL" className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100" />
                  <input value={newServerDescription} onChange={(e) => setNewServerDescription(e.target.value)} placeholder="Description (optional)" className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100" />
                  <select value={newServerTransport} onChange={(e) => setNewServerTransport(e.target.value === "http" ? "http" : "stdio")} className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100">
                    <option value="stdio">stdio (npx/uvx/node/docker)</option>
                    <option value="http">http (remote MCP endpoint)</option>
                  </select>
                  <div className="flex items-center justify-between rounded border border-zinc-700 bg-zinc-900 px-3 py-2">
                    <p className="text-xs text-zinc-400">Simple Builder (recommended for unsupported apps)</p>
                    <button type="button" onClick={() => setBuilderEnabled((v) => !v)} className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200">
                      {builderEnabled ? "Switch to Advanced JSON" : "Switch to Builder"}
                    </button>
                  </div>
                  {builderEnabled && (
                    <div className="space-y-3 rounded border border-zinc-700 bg-zinc-900/70 p-3">
                      <p className="text-xs text-zinc-400">Credential fields</p>
                      {builderCredentialFields.map((f, idx) => (
                        <div key={`${f.name}-${idx}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                          <input value={f.name} onChange={(e) => setBuilderCredentialFields((prev) => prev.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))} placeholder="apiKey (field key)" className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100" />
                          <input value={f.label} onChange={(e) => setBuilderCredentialFields((prev) => prev.map((x, i) => i === idx ? { ...x, label: e.target.value } : x))} placeholder="API Key (field label)" className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100" />
                          <button
                            type="button"
                            onClick={() => setBuilderCredentialFields((prev) => prev.filter((_, i) => i !== idx))}
                            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                            aria-label="Delete credential field"
                            title="Delete"
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                      <button type="button" onClick={() => setBuilderCredentialFields((prev) => [...prev, { name: "", label: "", type: "text", placeholder: "", optional: true }])} className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200">+ Add credential field</button>

                      {newServerTransport === "stdio" ? (
                        <>
                          <p className="text-xs text-zinc-400">Launch setup</p>
                          <select value={builderCommandType} onChange={(e) => setBuilderCommandType((e.target.value as "npx" | "uvx" | "node" | "docker" | "binary"))} className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100">
                            <option value="npx">npx</option>
                            <option value="uvx">uvx</option>
                            <option value="node">node</option>
                            <option value="docker">docker</option>
                            <option value="binary">binary</option>
                          </select>
                          <input value={builderCommandTarget} onChange={(e) => setBuilderCommandTarget(e.target.value)} placeholder="your-mcp-package / ghcr.io/org/image / server.js / binary-path" className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100" />
                          <textarea value={builderCommandArgsText} onChange={(e) => setBuilderCommandArgsText(e.target.value)} rows={2} placeholder="extra args (one per line)" className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 font-mono text-xs text-zinc-100" />
                          <p className="text-xs text-zinc-400">Environment variables</p>
                          {builderEnvRows.map((row, idx) => (
                            <div key={`env-${idx}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                              <input value={row.key} onChange={(e) => setBuilderEnvRows((prev) => prev.map((r, i) => i === idx ? { ...r, key: e.target.value } : r))} placeholder="API_KEY" className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100" />
                              <input value={row.value} onChange={(e) => setBuilderEnvRows((prev) => prev.map((r, i) => i === idx ? { ...r, value: e.target.value } : r))} placeholder="{{apiKey}}" className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100" />
                              <button
                                type="button"
                                onClick={() => setBuilderEnvRows((prev) => prev.filter((_, i) => i !== idx))}
                                className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                                aria-label="Delete env mapping"
                                title="Delete"
                              >
                                Delete
                              </button>
                            </div>
                          ))}
                          <button type="button" onClick={() => setBuilderEnvRows((prev) => [...prev, { key: "", value: "" }])} className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200">+ Add env mapping</button>
                        </>
                      ) : (
                        <>
                          <p className="text-xs text-zinc-400">HTTP MCP endpoint</p>
                          <input value={builderHttpUrl} onChange={(e) => setBuilderHttpUrl(e.target.value)} placeholder="https://your-mcp-endpoint.example.com/mcp" className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100" />
                          <p className="text-xs text-zinc-400">Headers</p>
                          {builderHeaderRows.map((row, idx) => (
                            <div key={`hdr-${idx}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                              <input value={row.key} onChange={(e) => setBuilderHeaderRows((prev) => prev.map((r, i) => i === idx ? { ...r, key: e.target.value } : r))} placeholder="Authorization" className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100" />
                              <input value={row.value} onChange={(e) => setBuilderHeaderRows((prev) => prev.map((r, i) => i === idx ? { ...r, value: e.target.value } : r))} placeholder="Bearer {{apiKey}}" className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100" />
                              <button
                                type="button"
                                onClick={() => setBuilderHeaderRows((prev) => prev.filter((_, i) => i !== idx))}
                                className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                                aria-label="Delete header row"
                                title="Delete"
                              >
                                Delete
                              </button>
                            </div>
                          ))}
                          <button type="button" onClick={() => setBuilderHeaderRows((prev) => [...prev, { key: "", value: "" }])} className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200">+ Add header</button>
                        </>
                      )}

                      <p className="text-xs text-zinc-400">Health check strategy</p>
                      <select value={builderHealthMode} onChange={(e) => setBuilderHealthMode(e.target.value === "toolCall" ? "toolCall" : "listTools")} className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100">
                        <option value="listTools">List Tools (recommended)</option>
                        <option value="toolCall">Tool Call</option>
                      </select>
                      {builderHealthMode === "toolCall" && (
                        <>
                          <input value={builderHealthTool} onChange={(e) => setBuilderHealthTool(e.target.value)} placeholder="tool name (e.g. ping)" className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100" />
                          <textarea value={builderHealthParamsText} onChange={(e) => setBuilderHealthParamsText(e.target.value)} rows={2} placeholder='{"limit":1}' className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 font-mono text-xs text-zinc-100" />
                        </>
                      )}
                      <p className="text-xs text-zinc-400">Write tool policy</p>
                      <select value={builderWriteMode} onChange={(e) => setBuilderWriteMode((e.target.value as "allowlist" | "denylist" | "allAsk" | "allowAll"))} className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100">
                        <option value="allowlist">allowlist</option>
                        <option value="denylist">denylist</option>
                        <option value="allAsk">allAsk</option>
                        <option value="allowAll">allowAll</option>
                      </select>
                      <textarea value={builderWriteToolsText} onChange={(e) => setBuilderWriteToolsText(e.target.value)} rows={2} placeholder="tool-a, tool-b" className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 font-mono text-xs text-zinc-100" />
                    </div>
                  )}
                  {!builderEnabled && (
                    <>
                      <label className="block text-xs text-zinc-400">Credential Fields JSON</label>
                      <textarea value={newCredentialFields} onChange={(e) => setNewCredentialFields(e.target.value)} rows={5} className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-100" />
                      {newServerTransport === "stdio" ? (
                        <>
                          <label className="block text-xs text-zinc-400">Launch Config JSON</label>
                          <textarea value={newLaunchConfig} onChange={(e) => setNewLaunchConfig(e.target.value)} rows={6} className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-100" />
                        </>
                      ) : (
                        <>
                          <label className="block text-xs text-zinc-400">HTTP Config JSON</label>
                          <textarea value={newHttpConfig} onChange={(e) => setNewHttpConfig(e.target.value)} rows={6} className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-100" />
                        </>
                      )}
                      <label className="block text-xs text-zinc-400">Healthcheck JSON</label>
                      <textarea value={newHealthcheck} onChange={(e) => setNewHealthcheck(e.target.value)} rows={3} className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-100" />
                      <label className="block text-xs text-zinc-400">Write Tool Policy JSON</label>
                      <textarea value={newWritePolicy} onChange={(e) => setNewWritePolicy(e.target.value)} rows={3} className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-100" />
                    </>
                  )}
                </div>
              )}

              {mode === "existing" || isEditMode ? (
              <div>
                <label htmlFor="mcpServerId" className="mb-1 block text-sm font-medium text-zinc-300">
                  MCP Server
                </label>
                <select
                  id="mcpServerId"
                  name="mcpServerId"
                  required
                  value={selectedServerId}
                  onChange={(e) => setSelectedServerId(e.target.value)}
                  disabled={isEditMode}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
                >
                  <option value="">Select a server…</option>
                  {servers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              ) : null}

              {selectedServer && (
                <>
                  {selectedServer.description && (
                    <p className="text-xs text-zinc-500">{selectedServer.description}</p>
                  )}
                  {fields.map((field) => (
                    <div key={field.name}>
                      <label
                        htmlFor={field.name}
                        className="mb-1 block text-sm font-medium text-zinc-300"
                      >
                        {field.label}
                        {field.optional && <span className="ml-1 text-xs text-zinc-500">(optional)</span>}
                      </label>
                      <input
                        id={field.name}
                        name={field.name}
                        type={field.type}
                        required={!field.optional}
                        placeholder={field.placeholder}
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
                      />
                    </div>
                  ))}
                </>
              )}

              {mode === "new" && !isEditMode && newModeFields.length > 0 && (
                <>
                  <div className="rounded-lg border border-zinc-700 bg-zinc-800/40 p-3">
                    <p className="mb-2 text-xs text-zinc-400">Connection Credentials</p>
                    <div className="space-y-3">
                      {newModeFields.map((field) => (
                        <div key={field.name}>
                          <label htmlFor={field.name} className="mb-1 block text-sm font-medium text-zinc-300">
                            {field.label}
                            {field.optional && <span className="ml-1 text-xs text-zinc-500">(optional)</span>}
                          </label>
                          <input
                            id={field.name}
                            name={field.name}
                            type={field.type}
                            required={!field.optional}
                            placeholder={field.placeholder}
                            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  {newModeFieldsError && <p className="text-xs text-red-400">{newModeFieldsError}</p>}
                </>
              )}

              {createError && <p className="text-xs text-red-400">{createError}</p>}

              <div className="flex justify-end gap-3 pt-2">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-400 transition hover:text-zinc-200"
                  >
                    Cancel
                  </button>
                </Dialog.Close>
                <button
                  type="submit"
                  disabled={creating || (mode === "existing" && !selectedServerId)}
                  className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {creating ? "Saving…" : isEditMode ? "Update" : mode === "new" ? (isDefinitionEditMode ? "Save & Reconnect" : "Create & Connect") : "Connect"}
                </button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
