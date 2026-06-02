import { Dialog } from "../ui/Dialog";
import { TextField } from "../ui/TextField";
import { SelectField } from "../ui/SelectField";
import { Button } from "../ui/Button";
import { ServerIcon } from "../ui/ServerIcon";
import { ArrowLeftIcon, PlusIcon } from "@phosphor-icons/react";
import { useState, useEffect, type FormEvent, type ChangeEvent } from "react";
import type { McpServer, CredentialField } from "../../../lib/types";

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
  connectedServerIds?: Set<string>;
  editServerId?: string | undefined;
  editDefinitionServerId?: string | undefined;
  connectServerId?: string | undefined;
}

type Step = "pick" | "configure";
type Mode = "existing" | "new";
type BuilderCredentialField = CredentialField & { optional?: boolean };
type BuilderKvRow = { key: string; value: string };

const compactInput =
  "w-full rounded-full border border-xyne-border bg-xyne-surface px-3 py-1.5 text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:border-xyne-border-focus focus:shadow-[var(--comp-focus-ring)] focus:outline-none disabled:opacity-60";
const compactTextarea =
  "w-full rounded-2xl border border-xyne-border bg-xyne-surface px-3 py-2 font-mono text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:border-xyne-border-focus focus:shadow-[var(--comp-focus-ring)] focus:outline-none";

// ── ServerPickerCard ──────────────────────────────────────────────────
function ServerPickerCard({
  server,
  connected,
  onClick,
}: {
  server: McpServer;
  connected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      data-id={`mcp-picker-card-${server.id}`}
      type="button"
      onClick={onClick}
      className={[
        "flex flex-col items-center gap-2.5 rounded-xl border p-4 text-center",
        "transition-[background-color,border-color,box-shadow] duration-[var(--comp-duration-normal)]",
        "cursor-pointer hover:border-xyne-border-strong hover:bg-xyne-surface-subtle hover:shadow-sm",
        connected
          ? "border-xyne-success-border bg-xyne-success-bg"
          : "border-xyne-border bg-xyne-surface",
      ].join(" ")}
    >
      <ServerIcon type={server.type} size="lg" />
      <div className="min-w-0 w-full">
        <p className="truncate text-[13px] font-semibold text-xyne-fg-primary">{server.name}</p>
        {connected && (
          <span className="text-[11px] font-medium text-xyne-success-fg">Connected</span>
        )}
      </div>
    </button>
  );
}

// ── AddConnectionDialog ───────────────────────────────────────────────
export function AddConnectionDialog({
  open,
  onOpenChange,
  onSubmit,
  onCreateServer,
  servers,
  credentialFields,
  connectedServerIds = new Set(),
  editServerId,
  editDefinitionServerId,
  connectServerId,
}: Props) {
  // ── wizard state ────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>("pick");
  const [cameFromPick, setCameFromPick] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");

  // ── form state ──────────────────────────────────────────────────────
  const [selectedServerId, setSelectedServerId] = useState("");
  const [mode, setMode] = useState<Mode>("existing");
  const [newServerName, setNewServerName] = useState("");
  const [newServerType, setNewServerType] = useState("");
  const [newServerUrl, setNewServerUrl] = useState("");
  const [newServerDescription, setNewServerDescription] = useState("");
  const [newServerTransport, setNewServerTransport] = useState<"stdio" | "http">("stdio");
  const [newCredentialFields, setNewCredentialFields] = useState<string>(
    JSON.stringify(
      [{ name: "apiKey", label: "API Key", type: "password", placeholder: "Enter API key" }],
      null,
      2,
    ),
  );
  const [newLaunchConfig, setNewLaunchConfig] = useState<string>(
    JSON.stringify(
      { cmd: "npx", args: ["-y", "your-mcp-package"], env: { API_KEY: "{{apiKey}}" } },
      null,
      2,
    ),
  );
  const [newHttpConfig, setNewHttpConfig] = useState<string>(
    JSON.stringify(
      {
        url: "https://your-mcp-endpoint.example.com/mcp",
        headers: { Authorization: "Bearer {{apiKey}}" },
      },
      null,
      2,
    ),
  );
  const [newHealthcheck, setNewHealthcheck] = useState<string>(
    JSON.stringify({ name: "ping", params: {} }, null, 2),
  );
  const [newWritePolicy, setNewWritePolicy] = useState<string>(
    JSON.stringify({ mode: "allowlist", tools: [] }, null, 2),
  );
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdServer, setCreatedServer] = useState<McpServer | null>(null);
  const [builderEnabled, setBuilderEnabled] = useState(true);
  const [builderCredentialFields, setBuilderCredentialFields] = useState<BuilderCredentialField[]>(
    [{ name: "", label: "", type: "password", placeholder: "", optional: false }],
  );
  const [builderCommandType, setBuilderCommandType] = useState<
    "npx" | "uvx" | "node" | "docker" | "binary"
  >("npx");
  const [builderCommandTarget, setBuilderCommandTarget] = useState("");
  const [builderCommandArgsText, setBuilderCommandArgsText] = useState("");
  const [builderEnvRows, setBuilderEnvRows] = useState<BuilderKvRow[]>([{ key: "", value: "" }]);
  const [builderHttpUrl, setBuilderHttpUrl] = useState("");
  const [builderHeaderRows, setBuilderHeaderRows] = useState<BuilderKvRow[]>([
    { key: "", value: "" },
  ]);
  const [builderHealthMode, setBuilderHealthMode] = useState<"listTools" | "toolCall">("listTools");
  const [builderHealthTool, setBuilderHealthTool] = useState("");
  const [builderHealthParamsText, setBuilderHealthParamsText] = useState("{}");
  const [builderWriteMode, setBuilderWriteMode] = useState<
    "allowlist" | "denylist" | "allAsk" | "allowAll"
  >("allowlist");
  const [builderWriteToolsText, setBuilderWriteToolsText] = useState("");

  // ── helpers ─────────────────────────────────────────────────────────
  const stringifyPretty = (value: unknown, fallback: string): string => {
    if (value === null || value === undefined) return fallback;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return fallback;
    }
  };

  const parseJson = <T,>(label: string, text: string): T => {
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Invalid JSON in ${label}`);
    }
  };

  // ── effects: sync step when dialog opens in a specific mode ─────────
  useEffect(() => {
    if (open && editServerId) {
      setSelectedServerId(editServerId);
      setMode("existing");
      setStep("configure");
      setCameFromPick(false);
    }
  }, [open, editServerId]);

  useEffect(() => {
    if (!open || !editDefinitionServerId) return;
    const server = servers.find((s) => s.id === editDefinitionServerId);
    if (!server) return;
    const fallbackFields: CredentialField[] = [
      {
        name: "apiKey",
        label: "API Key",
        type: "password" as const,
        placeholder: "Enter API key",
        optional: false,
      },
    ];
    const existingFields: CredentialField[] = credentialFields[server.type] ?? fallbackFields;
    setMode("new");
    setNewServerName(server.name ?? "");
    setNewServerType(server.type ?? "");
    setNewServerUrl(server.url ?? "");
    setNewServerDescription(server.description ?? "");
    setNewServerTransport(server.transport === "http" ? "http" : "stdio");
    setNewCredentialFields(
      stringifyPretty(
        server.credentialForm?.fields ?? existingFields,
        JSON.stringify(existingFields, null, 2),
      ),
    );
    setNewLaunchConfig(
      stringifyPretty(
        server.launchConfigTemplate ?? {
          cmd: "npx",
          args: ["-y", "your-mcp-package"],
          env: { API_KEY: "{{apiKey}}" },
        },
        JSON.stringify(
          { cmd: "npx", args: ["-y", "your-mcp-package"], env: { API_KEY: "{{apiKey}}" } },
          null,
          2,
        ),
      ),
    );
    setNewHttpConfig(
      stringifyPretty(
        server.httpConfigTemplate ?? {
          url: "https://your-mcp-endpoint.example.com/mcp",
          headers: { Authorization: "Bearer {{apiKey}}" },
        },
        JSON.stringify(
          {
            url: "https://your-mcp-endpoint.example.com/mcp",
            headers: { Authorization: "Bearer {{apiKey}}" },
          },
          null,
          2,
        ),
      ),
    );
    setNewHealthcheck(
      stringifyPretty(
        server.healthcheckSpec ?? { name: "ping", params: {} },
        JSON.stringify({ name: "ping", params: {} }, null, 2),
      ),
    );
    setNewWritePolicy(
      stringifyPretty(
        server.writeToolPolicy ?? { mode: "allowlist", tools: [] },
        JSON.stringify({ mode: "allowlist", tools: [] }, null, 2),
      ),
    );
    setBuilderEnabled(false);
    setCreatedServer(null);
    setCreateError(null);
    setStep("configure");
    setCameFromPick(false);
  }, [open, editDefinitionServerId, servers, credentialFields]);

  useEffect(() => {
    if (!open || !connectServerId) return;
    setMode("existing");
    setSelectedServerId(connectServerId);
    setStep("configure");
    setCameFromPick(false);
  }, [open, connectServerId]);

  // Default: no preset → show picker
  useEffect(() => {
    if (!open || editServerId || editDefinitionServerId || connectServerId) return;
    setStep("pick");
    setCameFromPick(false);
    setSelectedServerId("");
    setMode("existing");
  }, [open, editServerId, editDefinitionServerId, connectServerId]);

  // ── builder → JSON sync ─────────────────────────────────────────────
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
    try {
      params = JSON.parse(builderHealthParamsText) as Record<string, unknown>;
    } catch {
      params = {};
    }
    const healthSpec =
      builderHealthMode === "listTools"
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

  // ── derived ─────────────────────────────────────────────────────────
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
          .filter(
            (f): f is CredentialField =>
              !!f && typeof f === "object" && "name" in (f as Record<string, unknown>),
          )
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

  const pickerFiltered = servers.filter((s) => {
    const q = pickerSearch.toLowerCase();
    return !q || s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q);
  });

  const dialogTitle = (() => {
    if (step === "pick") return "Add MCP Connector";
    if (isDefinitionEditMode) return "Edit MCP Connector Definition";
    if (isEditMode) return "Update Connection";
    if (mode === "new") return "New MCP Connector";
    return selectedServer ? `Connect ${selectedServer.name}` : "Connect Connector";
  })();

  // ── handlers ────────────────────────────────────────────────────────
  const handlePickServer = (server: McpServer) => {
    setSelectedServerId(server.id);
    setMode("existing");
    setStep("configure");
    setCameFromPick(true);
  };

  const handlePickCustom = () => {
    setMode("new");
    setStep("configure");
    setCameFromPick(true);
    setSelectedServerId("");
  };

  const handleBack = () => {
    setStep("pick");
    setCameFromPick(false);
    setCreateError(null);
    if (!isEditMode && !isDefinitionEditMode) {
      setMode("existing");
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
        setCreateError("Name, type, and URL are required.");
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
            ? {
                launchConfigTemplate: parseJson<{
                  cmd: string;
                  args: string[];
                  env: Record<string, string>;
                }>("launch config", newLaunchConfig),
              }
            : {
                httpConfigTemplate: parseJson<{
                  url: string;
                  headers: Record<string, string>;
                }>("http config", newHttpConfig),
              }),
          healthcheckSpec: parseJson<{ name: string; params: Record<string, unknown> }>(
            "healthcheck spec",
            newHealthcheck,
          ),
          writeToolPolicy: parseJson<{
            mode?: "allowlist" | "denylist" | "allAsk" | "allowAll";
            tools?: string[];
          }>("write tool policy", newWritePolicy),
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
    const activeFields =
      activeServer.type in credentialFields
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
      setStep("pick");
      setCameFromPick(false);
      setPickerSearch("");
      setSelectedServerId("");
      setMode("existing");
      setCreatedServer(null);
      setCreateError(null);
      setBuilderEnabled(true);
    }
    onOpenChange(val);
  };

  // ── render ───────────────────────────────────────────────────────────
  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title={dialogTitle}
      maxWidth={step === "pick" ? 660 : 560}
      footer={
        step === "pick" ? (
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
        ) : (
          <div data-id="add-connection-footer" className="flex w-full items-center justify-between">
            <div>
              {cameFromPick && (
                <Button
                  data-id="add-connection-back-btn"
                  variant="ghost"
                  size="sm"
                  onClick={handleBack}
                >
                  <ArrowLeftIcon size={14} />
                  Back
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                form="add-connection-form"
                variant="primary"
                disabled={creating || (mode === "existing" && !selectedServerId)}
              >
                {creating
                  ? "Saving…"
                  : isEditMode
                    ? "Update"
                    : mode === "new"
                      ? isDefinitionEditMode
                        ? "Save & Reconnect"
                        : "Create & Connect"
                      : "Connect"}
              </Button>
            </div>
          </div>
        )
      }
    >
      {/* ── Step 1: Catalog picker ────────────────────────────────── */}
      {step === "pick" && (
        <div data-id="mcp-picker">
          {/* Search */}
          <div className="relative mb-4">
            <input
              data-id="mcp-picker-search"
              type="text"
              value={pickerSearch}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setPickerSearch(e.target.value)}
              placeholder="Search connectors…"
              className="w-full rounded-full border border-xyne-border bg-xyne-surface px-4 py-2 text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:border-xyne-border-focus focus:shadow-[var(--comp-focus-ring)] focus:outline-none"
            />
          </div>

          {pickerFiltered.length === 0 ? (
            <div className="py-10 text-center text-[13px] text-xyne-fg-tertiary">
              No connectors match your search.
            </div>
          ) : (
            <div
              data-id="mcp-picker-grid"
              className="grid grid-cols-3 gap-2.5"
            >
              {pickerFiltered.map((server) => (
                <ServerPickerCard
                  key={server.id}
                  server={server}
                  connected={connectedServerIds.has(server.id)}
                  onClick={() => handlePickServer(server)}
                />
              ))}

              {/* Custom connector option */}
              <button
                data-id="mcp-picker-custom-card"
                type="button"
                onClick={handlePickCustom}
                className={[
                  "flex flex-col items-center gap-2.5 rounded-xl border border-dashed p-4 text-center",
                  "cursor-pointer transition-[background-color,border-color]",
                  "border-xyne-border hover:border-xyne-brand hover:bg-xyne-surface-subtle",
                ].join(" ")}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-xyne-surface-subtle">
                  <PlusIcon size={18} weight="bold" className="text-xyne-fg-tertiary" />
                </div>
                <div>
                  <p className="text-[13px] font-medium text-xyne-fg-secondary">Custom</p>
                  <p className="text-[11px] text-xyne-fg-tertiary">Add your own</p>
                </div>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Step 2: Configure (connect or define) ─────────────────── */}
      {step === "configure" && (
        <div data-id="mcp-configure">
          {servers.length === 0 && mode === "existing" ? (
            <div className="rounded-2xl border border-xyne-border bg-xyne-surface-subtle p-4 text-center text-[14px] text-xyne-fg-muted">
              No MCP servers available.
            </div>
          ) : (
            <form id="add-connection-form" onSubmit={handleSubmit} className="space-y-4">

              {/* ── Selected server info card (existing mode) ──────── */}
              {mode === "existing" && selectedServer && (
                <div
                  data-id="add-connection-server-card"
                  className="flex items-center gap-3 rounded-xl border border-xyne-border-subtle bg-xyne-surface-subtle p-3"
                >
                  <ServerIcon type={selectedServer.type} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-xyne-fg-primary">
                      {selectedServer.name}
                    </p>
                    {selectedServer.description && (
                      <p className="truncate text-[12px] text-xyne-fg-tertiary">
                        {selectedServer.description}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Fallback dropdown when no server selected but in edit mode */}
              {mode === "existing" && isEditMode && !selectedServer && (
                <SelectField
                  label="MCP Server"
                  id="mcpServerId"
                  value={selectedServerId}
                  onValueChange={(v) => setSelectedServerId(v ?? "")}
                  disabled={isEditMode}
                  placeholder="Select a server…"
                  options={servers.map((s) => ({ value: s.id, label: s.name }))}
                />
              )}

              {/* ── Credential fields (existing mode) ─────────────── */}
              {mode === "existing" && selectedServer && fields.length > 0 && (
                <div data-id="add-connection-creds" className="space-y-3">
                  {isEditMode && (
                    <p className="text-[12px] text-xyne-fg-muted">
                      Leave fields blank to keep existing values.
                    </p>
                  )}
                  {fields.map((field) => (
                    <TextField
                      key={field.name}
                      id={field.name}
                      name={field.name}
                      label={field.optional ? `${field.label} (optional)` : field.label}
                      type={field.type}
                      required={!field.optional && !isEditMode}
                      placeholder={field.placeholder}
                    />
                  ))}
                </div>
              )}

              {mode === "existing" && selectedServer && fields.length === 0 && (
                <p className="text-[13px] text-xyne-fg-secondary">
                  Click <strong>Connect</strong> to authorize.
                </p>
              )}

              {/* ── New connector definition form ──────────────────── */}
              {mode === "new" && !isEditMode && (
                <div className="space-y-3">
                  <p className="text-[12px] text-xyne-fg-muted">
                    {isDefinitionEditMode
                      ? "Edit connector definition and overwrite the existing type, then reconnect with credentials below."
                      : "Create a connector definition, then connect with credentials below."}
                  </p>
                  <TextField
                    label="Connector name"
                    placeholder="e.g. Notion"
                    value={newServerName}
                    onChange={(e) => setNewServerName(e.target.value)}
                  />
                  <TextField
                    label="Connector type key"
                    placeholder="e.g. notion"
                    value={newServerType}
                    onChange={(e) => setNewServerType(e.target.value)}
                    disabled={isDefinitionEditMode}
                  />
                  <TextField
                    label="Base URL"
                    placeholder="https://..."
                    value={newServerUrl}
                    onChange={(e) => setNewServerUrl(e.target.value)}
                  />
                  <TextField
                    label="Description"
                    placeholder="Description (optional)"
                    value={newServerDescription}
                    onChange={(e) => setNewServerDescription(e.target.value)}
                  />
                  <SelectField
                    label="Transport"
                    value={newServerTransport}
                    onValueChange={(v) => setNewServerTransport(v === "http" ? "http" : "stdio")}
                    options={[
                      { value: "stdio", label: "stdio (npx/uvx/node/docker)" },
                      { value: "http", label: "http (remote MCP endpoint)" },
                    ]}
                  />

                  <div className="flex items-center justify-between py-1">
                    <p className="text-[12px] text-xyne-fg-muted">
                      Simple Builder (recommended for unsupported apps)
                    </p>
                    <button
                      type="button"
                      onClick={() => setBuilderEnabled((v) => !v)}
                      className="rounded-full border border-xyne-border bg-xyne-surface-subtle px-2.5 py-1 text-[12px] text-xyne-fg-primary transition hover:bg-xyne-surface"
                    >
                      {builderEnabled ? "Switch to Advanced JSON" : "Switch to Builder"}
                    </button>
                  </div>

                  {builderEnabled && (
                    <div className="space-y-3">
                      <p className="text-[12px] text-xyne-fg-muted">Credential fields</p>
                      {builderCredentialFields.map((f, idx) => (
                        <div key={`${f.name}-${idx}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                          <input
                            value={f.name}
                            onChange={(e) =>
                              setBuilderCredentialFields((prev) =>
                                prev.map((x, i) =>
                                  i === idx ? { ...x, name: e.target.value } : x,
                                ),
                              )
                            }
                            placeholder="apiKey (field key)"
                            className={compactInput}
                          />
                          <input
                            value={f.label}
                            onChange={(e) =>
                              setBuilderCredentialFields((prev) =>
                                prev.map((x, i) =>
                                  i === idx ? { ...x, label: e.target.value } : x,
                                ),
                              )
                            }
                            placeholder="API Key (field label)"
                            className={compactInput}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setBuilderCredentialFields((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="rounded-full border border-xyne-border px-2.5 py-1 text-[12px] text-xyne-fg-muted transition hover:bg-xyne-surface-subtle"
                            aria-label="Delete credential field"
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          setBuilderCredentialFields((prev) => [
                            ...prev,
                            { name: "", label: "", type: "text", placeholder: "", optional: true },
                          ])
                        }
                        className="rounded-full border border-xyne-border bg-xyne-surface-subtle px-2.5 py-1 text-[12px] text-xyne-fg-primary transition hover:bg-xyne-surface"
                      >
                        + Add credential field
                      </button>

                      {newServerTransport === "stdio" ? (
                        <>
                          <p className="text-[12px] text-xyne-fg-muted">Launch setup</p>
                          <SelectField
                            value={builderCommandType}
                            onValueChange={(v) =>
                              setBuilderCommandType(
                                v as "npx" | "uvx" | "node" | "docker" | "binary",
                              )
                            }
                            options={[
                              { value: "npx", label: "npx" },
                              { value: "uvx", label: "uvx" },
                              { value: "node", label: "node" },
                              { value: "docker", label: "docker" },
                              { value: "binary", label: "binary" },
                            ]}
                          />
                          <input
                            value={builderCommandTarget}
                            onChange={(e) => setBuilderCommandTarget(e.target.value)}
                            placeholder="your-mcp-package / ghcr.io/org/image / server.js / binary-path"
                            className={compactInput}
                          />
                          <textarea
                            value={builderCommandArgsText}
                            onChange={(e) => setBuilderCommandArgsText(e.target.value)}
                            rows={2}
                            placeholder="extra args (one per line)"
                            className={compactTextarea}
                          />
                          <p className="text-[12px] text-xyne-fg-muted">Environment variables</p>
                          {builderEnvRows.map((row, idx) => (
                            <div key={`env-${idx}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                              <input
                                value={row.key}
                                onChange={(e) =>
                                  setBuilderEnvRows((prev) =>
                                    prev.map((r, i) =>
                                      i === idx ? { ...r, key: e.target.value } : r,
                                    ),
                                  )
                                }
                                placeholder="API_KEY"
                                className={compactInput}
                              />
                              <input
                                value={row.value}
                                onChange={(e) =>
                                  setBuilderEnvRows((prev) =>
                                    prev.map((r, i) =>
                                      i === idx ? { ...r, value: e.target.value } : r,
                                    ),
                                  )
                                }
                                placeholder="{{apiKey}}"
                                className={compactInput}
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setBuilderEnvRows((prev) => prev.filter((_, i) => i !== idx))
                                }
                                className="rounded-full border border-xyne-border px-2.5 py-1 text-[12px] text-xyne-fg-muted transition hover:bg-xyne-surface-subtle"
                                aria-label="Delete env mapping"
                              >
                                Delete
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() =>
                              setBuilderEnvRows((prev) => [...prev, { key: "", value: "" }])
                            }
                            className="rounded-full border border-xyne-border bg-xyne-surface-subtle px-2.5 py-1 text-[12px] text-xyne-fg-primary transition hover:bg-xyne-surface"
                          >
                            + Add env mapping
                          </button>
                        </>
                      ) : (
                        <>
                          <p className="text-[12px] text-xyne-fg-muted">HTTP MCP endpoint</p>
                          <input
                            value={builderHttpUrl}
                            onChange={(e) => setBuilderHttpUrl(e.target.value)}
                            placeholder="https://your-mcp-endpoint.example.com/mcp"
                            className={compactInput}
                          />
                          <p className="text-[12px] text-xyne-fg-muted">Headers</p>
                          {builderHeaderRows.map((row, idx) => (
                            <div
                              key={`hdr-${idx}`}
                              className="grid grid-cols-[1fr_1fr_auto] gap-2"
                            >
                              <input
                                value={row.key}
                                onChange={(e) =>
                                  setBuilderHeaderRows((prev) =>
                                    prev.map((r, i) =>
                                      i === idx ? { ...r, key: e.target.value } : r,
                                    ),
                                  )
                                }
                                placeholder="Authorization"
                                className={compactInput}
                              />
                              <input
                                value={row.value}
                                onChange={(e) =>
                                  setBuilderHeaderRows((prev) =>
                                    prev.map((r, i) =>
                                      i === idx ? { ...r, value: e.target.value } : r,
                                    ),
                                  )
                                }
                                placeholder="Bearer {{apiKey}}"
                                className={compactInput}
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setBuilderHeaderRows((prev) =>
                                    prev.filter((_, i) => i !== idx)
                                  )
                                }
                                className="rounded-full border border-xyne-border px-2.5 py-1 text-[12px] text-xyne-fg-muted transition hover:bg-xyne-surface-subtle"
                                aria-label="Delete header row"
                              >
                                Delete
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() =>
                              setBuilderHeaderRows((prev) => [...prev, { key: "", value: "" }])
                            }
                            className="rounded-full border border-xyne-border bg-xyne-surface-subtle px-2.5 py-1 text-[12px] text-xyne-fg-primary transition hover:bg-xyne-surface"
                          >
                            + Add header
                          </button>
                        </>
                      )}

                      <p className="text-[12px] text-xyne-fg-muted">Health check strategy</p>
                      <SelectField
                        value={builderHealthMode}
                        onValueChange={(v) =>
                          setBuilderHealthMode(v === "toolCall" ? "toolCall" : "listTools")
                        }
                        options={[
                          { value: "listTools", label: "List Tools (recommended)" },
                          { value: "toolCall", label: "Tool Call" },
                        ]}
                      />
                      {builderHealthMode === "toolCall" && (
                        <>
                          <input
                            value={builderHealthTool}
                            onChange={(e) => setBuilderHealthTool(e.target.value)}
                            placeholder="tool name (e.g. ping)"
                            className={compactInput}
                          />
                          <textarea
                            value={builderHealthParamsText}
                            onChange={(e) => setBuilderHealthParamsText(e.target.value)}
                            rows={2}
                            placeholder='{"limit":1}'
                            className={compactTextarea}
                          />
                        </>
                      )}

                      <p className="text-[12px] text-xyne-fg-muted">Write tool policy</p>
                      <SelectField
                        value={builderWriteMode}
                        onValueChange={(v) =>
                          setBuilderWriteMode(
                            v as "allowlist" | "denylist" | "allAsk" | "allowAll",
                          )
                        }
                        options={[
                          { value: "allowlist", label: "allowlist" },
                          { value: "denylist", label: "denylist" },
                          { value: "allAsk", label: "allAsk" },
                          { value: "allowAll", label: "allowAll" },
                        ]}
                      />
                      <textarea
                        value={builderWriteToolsText}
                        onChange={(e) => setBuilderWriteToolsText(e.target.value)}
                        rows={2}
                        placeholder="tool-a, tool-b"
                        className={compactTextarea}
                      />
                    </div>
                  )}

                  {!builderEnabled && (
                    <>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[12px] font-medium text-xyne-fg-secondary">
                          Credential Fields JSON
                        </label>
                        <textarea
                          value={newCredentialFields}
                          onChange={(e) => setNewCredentialFields(e.target.value)}
                          rows={5}
                          className={compactTextarea}
                        />
                      </div>
                      {newServerTransport === "stdio" ? (
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[12px] font-medium text-xyne-fg-secondary">
                            Launch Config JSON
                          </label>
                          <textarea
                            value={newLaunchConfig}
                            onChange={(e) => setNewLaunchConfig(e.target.value)}
                            rows={6}
                            className={compactTextarea}
                          />
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[12px] font-medium text-xyne-fg-secondary">
                            HTTP Config JSON
                          </label>
                          <textarea
                            value={newHttpConfig}
                            onChange={(e) => setNewHttpConfig(e.target.value)}
                            rows={6}
                            className={compactTextarea}
                          />
                        </div>
                      )}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[12px] font-medium text-xyne-fg-secondary">
                          Healthcheck JSON
                        </label>
                        <textarea
                          value={newHealthcheck}
                          onChange={(e) => setNewHealthcheck(e.target.value)}
                          rows={3}
                          className={compactTextarea}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[12px] font-medium text-xyne-fg-secondary">
                          Write Tool Policy JSON
                        </label>
                        <textarea
                          value={newWritePolicy}
                          onChange={(e) => setNewWritePolicy(e.target.value)}
                          rows={3}
                          className={compactTextarea}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Credential fields for a freshly-created server */}
              {mode === "new" && !isEditMode && newModeFields.length > 0 && (
                <div>
                  <p className="mb-2 text-[12px] text-xyne-fg-muted">Connection Credentials</p>
                  <div className="space-y-3">
                    {newModeFields.map((field) => (
                      <TextField
                        key={field.name}
                        id={field.name}
                        name={field.name}
                        label={field.optional ? `${field.label} (optional)` : field.label}
                        type={field.type}
                        required={!field.optional}
                        placeholder={field.placeholder}
                      />
                    ))}
                  </div>
                  {newModeFieldsError && (
                    <p className="mt-1 text-[12px] text-xyne-error-fg">{newModeFieldsError}</p>
                  )}
                </div>
              )}

              {createError && (
                <p data-id="add-connection-error" className="text-[12px] text-xyne-error-fg">
                  {createError}
                </p>
              )}
            </form>
          )}
        </div>
      )}
    </Dialog>
  );
}
