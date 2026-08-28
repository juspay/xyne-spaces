import { Dialog } from "../ui/Dialog";
import { TextField } from "../ui/TextField";
import { SelectField } from "../ui/SelectField";
import { Button } from "../ui/Button";
import { ServerIcon } from "../ui/ServerIcon";
import { ArrowLeftIcon, PlusIcon } from "@phosphor-icons/react";
import { useState, useEffect, type FormEvent, type ChangeEvent } from "react";
import type { McpServer, CredentialField } from "../../../lib/types";
import type { CreateServerResult } from "../../../lib/api";

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
  }) => Promise<CreateServerResult>;
  servers: McpServer[];
  credentialFields: Record<string, CredentialField[]>;
  connectedServerIds?: Set<string>;
  editServerId?: string | undefined;
  editDefinitionServerId?: string | undefined;
  connectServerId?: string | undefined;
}

type Step = "pick" | "configure";
type Mode = "existing" | "new";
type BuilderCredentialField = CredentialField & { id: string; optional?: boolean };
type BuilderKvRow = { key: string; value: string };

let builderCredentialRowId = 0;

function createBuilderCredentialField(
  field: Partial<CredentialField> = {},
): BuilderCredentialField {
  builderCredentialRowId += 1;
  return {
    id: `credential-field-${builderCredentialRowId}`,
    name: field.name ?? "",
    label: field.label ?? "",
    type: field.type === "text" ? "text" : "password",
    placeholder: field.placeholder ?? "",
    optional: field.optional ?? false,
  };
}

function credentialFieldsFromSchema(
  schema: Record<string, unknown> | null | undefined,
): CredentialField[] {
  if (!schema || typeof schema !== "object") return [];
  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return [];
  const required = new Set(
    Array.isArray(schema.required) ? schema.required.map((name) => String(name)) : [],
  );
  return Object.entries(properties).map(([name, raw]) => {
    const property = raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {};
    return {
      name,
      label: String(property.title ?? property.label ?? name),
      type: property.format === "password" || property.secret === true ? "password" : "text",
      placeholder: String(property.placeholder ?? ""),
      optional: !required.has(name),
    };
  });
}

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
  const [newServerTransport, setNewServerTransport] = useState<"stdio" | "http">("http");
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
    [createBuilderCredentialField()],
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

  const parseCredentialFieldsForBuilder = (text: string): BuilderCredentialField[] => {
    const parsed = parseJson<unknown>("credential fields", text);
    if (!Array.isArray(parsed)) throw new Error("Credential Fields JSON must be an array.");
    return parsed
      .filter((field): field is Record<string, unknown> =>
        !!field && typeof field === "object" && !Array.isArray(field),
      )
      .map((field) => createBuilderCredentialField({
        name: String(field.name ?? ""),
        label: String(field.label ?? field.name ?? ""),
        type: field.type === "password" ? "password" : "text",
        placeholder: String(field.placeholder ?? ""),
        optional: Boolean(field.optional ?? false),
      }))
      .filter((field) => field.name.trim().length > 0);
  };

  const recordToRows = (value: unknown): BuilderKvRow[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [{ key: "", value: "" }];
    }
    const rows = Object.entries(value as Record<string, unknown>).map(([key, rowValue]) => ({
      key,
      value: String(rowValue ?? ""),
    }));
    return rows.length > 0 ? rows : [{ key: "", value: "" }];
  };

  const switchToBuilder = () => {
    try {
      const parsedFields = parseCredentialFieldsForBuilder(newCredentialFields);
      const health = parseJson<Record<string, unknown>>("healthcheck spec", newHealthcheck);
      const writePolicy = parseJson<Record<string, unknown>>("write tool policy", newWritePolicy);

      setBuilderCredentialFields(
        parsedFields.length > 0 ? parsedFields : [createBuilderCredentialField()],
      );
      setBuilderHealthMode(health.name === "__list_tools__" ? "listTools" : "toolCall");
      setBuilderHealthTool(health.name === "__list_tools__" ? "" : String(health.name ?? "ping"));
      setBuilderHealthParamsText(JSON.stringify(health.params ?? {}, null, 2));

      const writeMode = String(writePolicy.mode ?? "allowlist");
      setBuilderWriteMode(
        writeMode === "denylist" || writeMode === "allAsk" || writeMode === "allowAll"
          ? writeMode
          : "allowlist",
      );
      setBuilderWriteToolsText(
        Array.isArray(writePolicy.tools) ? writePolicy.tools.map(String).join("\n") : "",
      );

      if (newServerTransport === "http") {
        const http = parseJson<Record<string, unknown>>("HTTP config", newHttpConfig);
        const httpUrl = String(http.url ?? "");
        setBuilderHttpUrl(httpUrl);
        setNewServerUrl(httpUrl);
        setBuilderHeaderRows(recordToRows(http.headers));
      } else {
        const launch = parseJson<Record<string, unknown>>("launch config", newLaunchConfig);
        const cmd = String(launch.cmd ?? "");
        const args = Array.isArray(launch.args) ? launch.args.map(String) : [];
        if (!["npx", "uvx", "node", "docker"].includes(cmd)) {
          throw new Error(
            `The Builder cannot represent the command “${cmd || "(empty)"}”. Keep using Advanced JSON for this connector.`,
          );
        }

        setBuilderCommandType(cmd as "npx" | "uvx" | "node" | "docker");
        if (cmd === "npx") {
          const withoutFlag = args[0] === "-y" ? args.slice(1) : args;
          setBuilderCommandTarget(withoutFlag[0] ?? "");
          setBuilderCommandArgsText(withoutFlag.slice(1).join("\n"));
        } else if (cmd === "docker") {
          const withoutRun = args[0] === "run" ? args.slice(1) : args;
          const withoutRm = withoutRun[0] === "--rm" ? withoutRun.slice(1) : withoutRun;
          setBuilderCommandTarget(withoutRm[0] ?? "");
          setBuilderCommandArgsText(withoutRm.slice(1).join("\n"));
        } else {
          setBuilderCommandTarget(args[0] ?? "");
          setBuilderCommandArgsText(args.slice(1).join("\n"));
        }
        setBuilderEnvRows(recordToRows(launch.env));
      }

      setCreateError(null);
      setBuilderEnabled(true);
    } catch (err) {
      setCreateError(
        err instanceof Error
          ? `${err.message} Fix it before switching to Builder.`
          : "Could not convert JSON to Builder fields.",
      );
    }
  };

  const toggleBuilderMode = () => {
    if (builderEnabled) {
      setCreateError(null);
      setBuilderEnabled(false);
      return;
    }
    switchToBuilder();
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
  // A shared (scope=global) connector cannot be edited in place — saving queues
  // the change for admin approval. Drives the button label and the notice.
  const definitionServer = isDefinitionEditMode
    ? servers.find((s) => s.id === editDefinitionServerId)
    : undefined;
  const isGlobalDefinitionEdit =
    (definitionServer?.connectorMeta as { scope?: string } | null | undefined)?.scope ===
    "global";
  const selectedServer = createdServer ?? servers.find((s) => s.id === selectedServerId);
  const fields = (() => {
    if (!selectedServer) return [];
    const resolvedFields = credentialFields[selectedServer.type] ?? [];
    const savedFields = selectedServer.credentialForm?.fields ?? [];
    if (resolvedFields.length > 0) return resolvedFields;
    if (savedFields.length > 0) return savedFields;
    return credentialFieldsFromSchema(selectedServer.credentialSchema);
  })();

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
    if (isEditMode) return selectedServer ? `Reconnect ${selectedServer.name}` : "Reconnect MCP";
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
    setNewServerName("");
    setNewServerType("");
    setNewServerUrl("");
    setNewServerDescription("");
    setNewServerTransport("http");
    setBuilderCredentialFields([createBuilderCredentialField()]);
    setBuilderHttpUrl("");
    setBuilderHeaderRows([{ key: "", value: "" }]);
    setBuilderHealthMode("listTools");
    setBuilderHealthTool("");
    setBuilderHealthParamsText("{}");
    setBuilderWriteMode("allowlist");
    setBuilderWriteToolsText("");
    setBuilderEnabled(true);
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
    let definitionEditQueued = false;

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
          transport: "http" as const,
          credentialForm: {
            fields: parseJson<CredentialField[]>("credential fields", newCredentialFields),
          },
          httpConfigTemplate: parseJson<{
            url: string;
            headers: Record<string, string>;
          }>("http config", newHttpConfig),
          healthcheckSpec: parseJson<{ name: string; params: Record<string, unknown> }>(
            "healthcheck spec",
            newHealthcheck,
          ),
          writeToolPolicy: parseJson<{
            mode?: "allowlist" | "denylist" | "allAsk" | "allowAll";
            tools?: string[];
          }>("write tool policy", newWritePolicy),
        } as const;
        const result = await onCreateServer(payload);
        if (result.kind === "editRequest") {
          // Shared connector edit queued for admin approval — there is no live
          // server to reconnect and the page already showed the approval toast.
          definitionEditQueued = true;
        } else {
          setCreatedServer(result.server);
          activeServer = result.server;
          activeServerId = result.server.id;
        }
      } catch (err) {
        setCreateError(err instanceof Error ? err.message : "Failed to create connector");
        setCreating(false);
        return;
      } finally {
        setCreating(false);
      }
    }

    if (definitionEditQueued) {
      // Nothing to reconnect for a shared connector awaiting approval — close.
      handleOpenChange(false);
      return;
    }

    if (!activeServerId || !activeServer) return;
    const resolvedActiveFields = credentialFields[activeServer.type] ?? [];
    const savedActiveFields = activeServer.credentialForm?.fields ?? [];
    const activeFields = resolvedActiveFields.length > 0
      ? resolvedActiveFields
      : savedActiveFields.length > 0
        ? savedActiveFields
        : mode === "new"
          ? parseJson<CredentialField[]>("credential fields", newCredentialFields)
          : credentialFieldsFromSchema(activeServer.credentialSchema);
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
                  ? isGlobalDefinitionEdit
                    ? "Sending…"
                    : "Saving…"
                  : isEditMode
                    ? "Save & Reconnect"
                    : mode === "new"
                      ? isDefinitionEditMode
                        ? isGlobalDefinitionEdit
                          ? "Send for approval"
                          : "Save & Reconnect"
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
                    <div className="rounded-xl border border-xyne-border-subtle bg-xyne-surface-subtle px-3 py-2.5">
                      <p className="text-[12px] font-medium text-xyne-fg-secondary">
                        Replace connection credentials
                      </p>
                      <p className="mt-0.5 text-[11px] leading-4 text-xyne-fg-muted">
                        For security, saved values are never shown. Enter all required fields again;
                        saving replaces the stored credentials and reconnects this MCP.
                      </p>
                    </div>
                  )}
                  {fields.map((field) => (
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
              )}

              {mode === "existing" && selectedServer && fields.length === 0 && (
                <p className="text-[13px] text-xyne-fg-secondary">
                  This connector does not define credential fields. Continue to reconnect it without
                  credentials, or edit its connector definition first.
                </p>
              )}

              {/* ── New connector definition form ──────────────────── */}
              {mode === "new" && !isEditMode && (
                <div className="space-y-3">
                  <p className="text-[12px] leading-5 text-xyne-fg-muted">
                    {isDefinitionEditMode
                      ? isGlobalDefinitionEdit
                        ? "This is a shared connector. Edit the definition below — your changes are sent to an admin for approval, not applied immediately."
                        : "Edit connector definition and overwrite the existing type, then reconnect with credentials below."
                      : "Define the MCP endpoint and the fields each user must enter. You will test it with your own credentials before publishing it for others."}
                  </p>
                  <TextField
                    label="Connector name"
                    placeholder="e.g. Notion"
                    hint="The friendly name users will see in the connector catalog."
                    value={newServerName}
                    onChange={(e) => setNewServerName(e.target.value)}
                  />
                  <TextField
                    label="Connector type key"
                    placeholder="e.g. notion"
                    hint="A unique, stable key such as expense-mcp. It cannot be changed after creation."
                    value={newServerType}
                    onChange={(e) => setNewServerType(e.target.value)}
                    disabled={isDefinitionEditMode}
                  />
                  <TextField
                    label="MCP endpoint"
                    placeholder="https://..."
                    hint="The Streamable HTTP endpoint Claw connects to, for example https://mcp.example.com/mcp."
                    value={newServerUrl}
                    onChange={(e) => {
                      setNewServerUrl(e.target.value);
                      if (newServerTransport === "http" && builderEnabled) {
                        setBuilderHttpUrl(e.target.value);
                      }
                    }}
                  />
                  <TextField
                    label="Description"
                    placeholder="Description (optional)"
                    value={newServerDescription}
                    onChange={(e) => setNewServerDescription(e.target.value)}
                  />
                  <SelectField
                    label="Transport"
                    hint="Self-serve MCP connectors can only use hosted HTTP endpoints. Local stdio connectors require a code-reviewed static adapter."
                    value="http"
                    onValueChange={() => {
                      setNewServerTransport("http");
                      if (!builderHttpUrl.trim()) {
                        setBuilderHttpUrl(newServerUrl.trim());
                      }
                    }}
                    options={[
                      { value: "http", label: "http (remote MCP endpoint)" },
                    ]}
                  />

                  <div className="flex items-center justify-between py-1">
                    <p className="text-[12px] text-xyne-fg-muted">
                      Simple Builder (recommended for unsupported apps)
                    </p>
                    <button
                      type="button"
                      onClick={toggleBuilderMode}
                      className="rounded-full border border-xyne-border bg-xyne-surface-subtle px-2.5 py-1 text-[12px] text-xyne-fg-primary transition hover:bg-xyne-surface"
                    >
                      {builderEnabled ? "Switch to Advanced JSON" : "Switch to Builder"}
                    </button>
                  </div>

                  {builderEnabled && (
                    <div className="space-y-3">
                      <div className="rounded-xl border border-xyne-border-subtle bg-xyne-surface-subtle px-3 py-2.5">
                        <p className="text-[12px] font-medium text-xyne-fg-secondary">1. User credential form</p>
                        <p className="mt-0.5 text-[11px] leading-4 text-xyne-fg-muted">
                          Add what every user must enter. The field key becomes a reusable template,
                          for example <code>{"{{email}}"}</code> or <code>{"{{password}}"}</code>.
                        </p>
                      </div>
                      {builderCredentialFields.map((f, idx) => (
                        <div key={f.id} className="space-y-2 rounded-xl border border-xyne-border-subtle p-3">
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              value={f.name}
                              onChange={(e) =>
                                setBuilderCredentialFields((prev) =>
                                  prev.map((x, i) => i === idx ? { ...x, name: e.target.value } : x),
                                )
                              }
                              placeholder="Field key, e.g. email"
                              aria-label={`Credential ${idx + 1} field key`}
                              className={compactInput}
                            />
                            <input
                              value={f.label}
                              onChange={(e) =>
                                setBuilderCredentialFields((prev) =>
                                  prev.map((x, i) => i === idx ? { ...x, label: e.target.value } : x),
                                )
                              }
                              placeholder="User label, e.g. Email"
                              aria-label={`Credential ${idx + 1} label`}
                              className={compactInput}
                            />
                          </div>
                          <div className="grid grid-cols-[1fr_1.5fr_auto_auto] items-center gap-2">
                            <select
                              value={f.type}
                              onChange={(e) =>
                                setBuilderCredentialFields((prev) =>
                                  prev.map((x, i) => i === idx
                                    ? { ...x, type: e.target.value === "password" ? "password" : "text" }
                                    : x),
                                )
                              }
                              aria-label={`Credential ${idx + 1} input type`}
                              className={compactInput}
                            >
                              <option value="text">Text</option>
                              <option value="password">Password / secret</option>
                            </select>
                            <input
                              value={f.placeholder}
                              onChange={(e) =>
                                setBuilderCredentialFields((prev) =>
                                  prev.map((x, i) => i === idx ? { ...x, placeholder: e.target.value } : x),
                                )
                              }
                              placeholder="Placeholder (optional)"
                              aria-label={`Credential ${idx + 1} placeholder`}
                              className={compactInput}
                            />
                            <label className="flex items-center gap-1.5 whitespace-nowrap text-[12px] text-xyne-fg-secondary">
                              <input
                                type="checkbox"
                                checked={!f.optional}
                                onChange={(e) =>
                                  setBuilderCredentialFields((prev) =>
                                    prev.map((x, i) => i === idx ? { ...x, optional: !e.target.checked } : x),
                                  )
                                }
                              />
                              Required
                            </label>
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
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          setBuilderCredentialFields((prev) => [
                            ...prev,
                            createBuilderCredentialField({ type: "text", optional: false }),
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
                          <div className="rounded-xl border border-xyne-border-subtle bg-xyne-surface-subtle px-3 py-2.5">
                            <p className="text-[12px] font-medium text-xyne-fg-secondary">2. MCP endpoint and authentication</p>
                            <p className="mt-0.5 text-[11px] leading-4 text-xyne-fg-muted">
                              Enter the Streamable HTTP MCP endpoint. Map user fields into headers
                              with templates such as <code>{"{{email}}"}</code> and <code>{"{{password}}"}</code>.
                            </p>
                          </div>
                          <input
                            value={builderHttpUrl}
                            onChange={(e) => {
                              setBuilderHttpUrl(e.target.value);
                              setNewServerUrl(e.target.value);
                            }}
                            placeholder="https://your-mcp-endpoint.example.com/mcp"
                            className={compactInput}
                          />
                          <p className="text-[12px] text-xyne-fg-muted">Request headers</p>
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
                                placeholder="Header name, e.g. X-User-Email"
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
                                placeholder="Value template, e.g. {{email}}"
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
                  <div className="mb-2 rounded-xl border border-xyne-border-subtle bg-xyne-surface-subtle px-3 py-2.5">
                    <p className="text-[12px] font-medium text-xyne-fg-secondary">3. Test your connection</p>
                    <p className="mt-0.5 text-[11px] leading-4 text-xyne-fg-muted">
                      Enter your own values below. They are encrypted and saved only to your
                      connection; publishing shares the connector definition, never your credentials.
                    </p>
                  </div>
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
