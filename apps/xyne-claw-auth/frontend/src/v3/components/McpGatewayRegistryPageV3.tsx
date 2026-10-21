import { useEffect, useState, useCallback, useMemo } from "react";
import { PlusIcon, TrashIcon, PlugsConnectedIcon, WarningCircleIcon, PencilSimpleIcon } from "@phosphor-icons/react";
import { PageLayout } from "./ui/PageLayout";
import { PageListHeader } from "./ui/PageListHeader";
import { Button } from "./ui/Button";
import { TextField } from "./ui/TextField";
import { SelectField } from "./ui/SelectField";
import { Badge } from "./ui/Badge";
import { Dialog } from "./ui/Dialog";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { useSnackbar } from "./ui/Snackbar";
import {
  registerGatewayService,
  listGatewayServices,
  getGatewayService,
  deregisterGatewayService,
  listMyGatewayRequests,
  type RegisterGatewayServiceInput,
  type GatewayToolInput,
} from "../../lib/api";
import type { GatewayServiceRow, GatewayServiceRequest } from "../../lib/types";

const METHOD_OPTIONS = [
  { value: "POST", label: "POST" },
  { value: "GET", label: "GET" },
  { value: "PUT", label: "PUT" },
  { value: "PATCH", label: "PATCH" },
  { value: "DELETE", label: "DELETE" },
];

/** Tool row as edited in the form — JSON schemas are held as text and parsed on submit. */
interface ToolRow {
  name: string;
  description: string;
  method: string;
  path: string;
  requiresApproval: boolean;
  isWriteTool: boolean;
  inputSchemaText: string;
  outputSchemaText: string;
}

function emptyTool(): ToolRow {
  return {
    name: "",
    description: "",
    method: "POST",
    path: "",
    requiresApproval: false,
    isWriteTool: false,
    inputSchemaText: '{\n  "type": "object",\n  "properties": {},\n  "required": []\n}',
    outputSchemaText: '{\n  "type": "object"\n}',
  };
}

/** Convert a stored/pasted tool object into an editable ToolRow (schemas as text). */
function toolToRow(t: unknown): ToolRow {
  const o = (t ?? {}) as Record<string, unknown>;
  const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  return {
    name: typeof o["name"] === "string" ? o["name"] : "",
    description: typeof o["description"] === "string" ? o["description"] : "",
    method: typeof o["method"] === "string" ? o["method"] : "POST",
    path: typeof o["path"] === "string" ? o["path"] : "",
    requiresApproval: o["requiresApproval"] === true,
    isWriteTool: o["isWriteTool"] === true,
    inputSchemaText: isObj(o["inputSchema"]) ? JSON.stringify(o["inputSchema"], null, 2) : "",
    outputSchemaText: isObj(o["outputSchema"]) ? JSON.stringify(o["outputSchema"], null, 2) : "",
  };
}

function parseObjectOrThrow(text: string, label: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-xyne-border-error bg-xyne-surface px-4 py-3">
      <WarningCircleIcon size={16} weight="fill" className="mt-0.5 shrink-0 text-xyne-border-error" />
      <p className="text-[13px] text-xyne-fg-primary break-words">{message}</p>
    </div>
  );
}

export function McpGatewayRegistryPageV3({ isAdmin = false }: { isAdmin?: boolean }) {
  const { show: showSnackbar } = useSnackbar();

  // Form state
  const [serviceName, setServiceName] = useState("");
  const [backendId, setBackendId] = useState("");
  const [backendUrl, setBackendUrl] = useState("");
  const [tokenEndpointUrl, setTokenEndpointUrl] = useState("/mcp-gateway/token");
  const [xAuthHeaderName, setXAuthHeaderName] = useState("X-Backend-Auth");
  const [tools, setTools] = useState<ToolRow[]>([emptyTool()]);
  const [showJson, setShowJson] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Page state
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState("");
  const [services, setServices] = useState<GatewayServiceRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GatewayServiceRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reloadServices = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      setServices(await listGatewayServices());
    } catch (err) {
      setServices([]);
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingList(false);
    }
  }, []);

  // Requester-facing: the caller's own submissions (status shown in "Your requests").
  const [myRequests, setMyRequests] = useState<GatewayServiceRequest[]>([]);

  const reloadRequests = useCallback(async () => {
    try {
      setMyRequests(await listMyGatewayRequests());
    } catch {
      setMyRequests([]);
    }
  }, []);

  useEffect(() => {
    void reloadServices();
    void reloadRequests();
  }, [reloadServices, reloadRequests]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return services;
    return services.filter(
      (s) =>
        s.serviceName.toLowerCase().includes(q) ||
        s.backendId.toLowerCase().includes(q) ||
        s.backendUrl.toLowerCase().includes(q),
    );
  }, [services, search]);

  const updateTool = (idx: number, patch: Partial<ToolRow>) =>
    setTools((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  const addTool = () => setTools((prev) => [...prev, emptyTool()]);
  const removeTool = (idx: number) =>
    setTools((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));

  const resetForm = () => {
    setServiceName("");
    setBackendId("");
    setBackendUrl("");
    setTokenEndpointUrl("/mcp-gateway/token");
    setXAuthHeaderName("X-Backend-Auth");
    setTools([emptyTool()]);
    setJsonText("");
    setShowJson(false);
    setFormError(null);
  };

  const openForm = () => {
    resetForm();
    setEditing(false);
    setShowForm(true);
  };

  /** Load a registered service's full tools into the form and open it for editing. */
  const openEdit = async (row: GatewayServiceRow) => {
    try {
      const detail = await getGatewayService(row.serviceName, row.backendId);
      setServiceName(detail.serviceName);
      setBackendId(detail.backendId);
      setBackendUrl(detail.backendUrl);
      setTokenEndpointUrl(detail.tokenEndpointUrl ?? "/mcp-gateway/token");
      setXAuthHeaderName(detail.xAuthHeaderName ?? "X-Backend-Auth");
      setTools(detail.tools.length > 0 ? detail.tools.map(toolToRow) : [emptyTool()]);
      setJsonText("");
      setShowJson(false);
      setFormError(null);
      setEditing(true);
      setShowForm(true);
    } catch (err) {
      showSnackbar({ variant: "error", title: "Could not load service", description: err instanceof Error ? err.message : String(err) });
    }
  };

  /** One-way helper: parse pasted JSON (full registration body or a bare tools array) into the form. */
  const fillFromJson = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      showSnackbar({ variant: "error", title: "Invalid JSON", description: "Could not parse the pasted JSON." });
      return;
    }
    const body = Array.isArray(parsed) ? { tools: parsed } : (parsed as Record<string, unknown>);
    if (!body || typeof body !== "object") {
      showSnackbar({ variant: "error", title: "Unexpected JSON shape" });
      return;
    }
    if (typeof body["serviceName"] === "string") setServiceName(body["serviceName"] as string);
    if (typeof body["backendId"] === "string") setBackendId(body["backendId"] as string);
    if (typeof body["backendUrl"] === "string") setBackendUrl(body["backendUrl"] as string);
    if (typeof body["tokenEndpointUrl"] === "string") setTokenEndpointUrl(body["tokenEndpointUrl"] as string);
    if (typeof body["xAuthHeaderName"] === "string") setXAuthHeaderName(body["xAuthHeaderName"] as string);
    const rawTools = body["tools"];
    if (Array.isArray(rawTools) && rawTools.length > 0) {
      setTools(rawTools.map(toolToRow));
    }
    setShowJson(false);
    showSnackbar({ variant: "success", title: "Form filled from JSON" });
  };

  const buildPayload = (): RegisterGatewayServiceInput => {
    if (!serviceName.trim()) throw new Error("Service name is required");
    if (!backendId.trim()) throw new Error("Backend ID is required");
    if (!backendUrl.trim()) throw new Error("Backend URL is required");
    if (!tokenEndpointUrl.trim()) throw new Error("Token endpoint URL is required");

    const builtTools: GatewayToolInput[] = tools.map((t, idx) => {
      if (!t.name.trim()) throw new Error(`Tool #${idx + 1}: name is required`);
      const inputSchema = parseObjectOrThrow(t.inputSchemaText, `Tool "${t.name}" inputSchema`);
      const outputSchema = parseObjectOrThrow(t.outputSchemaText, `Tool "${t.name}" outputSchema`);
      return {
        name: t.name.trim(),
        description: t.description.trim(),
        method: t.method as GatewayToolInput["method"],
        ...(t.path.trim() ? { path: t.path.trim() } : {}),
        requiresApproval: t.requiresApproval,
        isWriteTool: t.isWriteTool,
        ...(inputSchema ? { inputSchema } : {}),
        ...(outputSchema ? { outputSchema } : {}),
      };
    });

    return {
      serviceName: serviceName.trim(),
      backendId: backendId.trim(),
      backendUrl: backendUrl.trim(),
      tokenEndpointUrl: tokenEndpointUrl.trim(),
      xAuthHeaderName: xAuthHeaderName.trim() || undefined,
      tools: builtTools,
    };
  };

  /** Build a payload straight from pasted JSON (full registration body), so the
   *  user can paste-and-register without first filling the guided form. */
  const parseJsonToPayload = (text: string): RegisterGatewayServiceInput => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Invalid JSON — could not parse.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("JSON must be a registration object with serviceName, backendId, backendUrl, tokenEndpointUrl and tools.");
    }
    const body = parsed as Record<string, unknown>;
    const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : "");
    const serviceNameJson = str("serviceName");
    const backendIdJson = str("backendId");
    const backendUrlJson = str("backendUrl");
    const tokenEndpointUrlJson = str("tokenEndpointUrl");
    if (!serviceNameJson) throw new Error("serviceName is required in the JSON");
    if (!backendIdJson) throw new Error("backendId is required in the JSON");
    if (!backendUrlJson) throw new Error("backendUrl is required in the JSON");
    if (!tokenEndpointUrlJson) throw new Error("tokenEndpointUrl is required in the JSON");
    const rawTools = body["tools"];
    if (!Array.isArray(rawTools) || rawTools.length === 0) {
      throw new Error("tools must be a non-empty array");
    }
    const builtTools: GatewayToolInput[] = rawTools.map((t, idx) => {
      const o = (t ?? {}) as Record<string, unknown>;
      if (typeof o["name"] !== "string" || !o["name"].trim()) {
        throw new Error(`tools[${idx}].name is required`);
      }
      const isObj = (v: unknown): v is Record<string, unknown> =>
        typeof v === "object" && v !== null && !Array.isArray(v);
      return {
        name: (o["name"] as string).trim(),
        description: typeof o["description"] === "string" ? o["description"] : "",
        method: (typeof o["method"] === "string" ? o["method"] : "POST") as GatewayToolInput["method"],
        ...(typeof o["path"] === "string" ? { path: o["path"] } : {}),
        requiresApproval: o["requiresApproval"] === true,
        isWriteTool: o["isWriteTool"] === true,
        ...(isObj(o["inputSchema"]) ? { inputSchema: o["inputSchema"] } : {}),
        ...(isObj(o["outputSchema"]) ? { outputSchema: o["outputSchema"] } : {}),
      };
    });
    return {
      serviceName: serviceNameJson,
      backendId: backendIdJson,
      backendUrl: backendUrlJson,
      tokenEndpointUrl: tokenEndpointUrlJson,
      xAuthHeaderName: str("xAuthHeaderName") || undefined,
      tools: builtTools,
    };
  };

  const submitPayload = async (payload: RegisterGatewayServiceInput) => {
    setSubmitting(true);
    try {
      const result = await registerGatewayService(payload);
      showSnackbar({ variant: "success", title: result.message || "Submitted for approval" });
      setShowForm(false);
      setEditing(false);
      resetForm();
      await reloadServices();
      await reloadRequests();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFormError(msg);
      showSnackbar({ variant: "error", title: "Registration failed", description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    setFormError(null);
    let payload: RegisterGatewayServiceInput;
    try {
      payload = buildPayload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFormError(msg);
      showSnackbar({ variant: "error", title: "Check the form", description: msg });
      return;
    }
    await submitPayload(payload);
  };

  const handleSubmitFromJson = async () => {
    setFormError(null);
    let payload: RegisterGatewayServiceInput;
    try {
      payload = parseJsonToPayload(jsonText);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFormError(msg);
      showSnackbar({ variant: "error", title: "Check the JSON", description: msg });
      return;
    }
    await submitPayload(payload);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deregisterGatewayService(deleteTarget.serviceName);
      showSnackbar({ variant: "success", title: `${deleteTarget.serviceName} deregistered` });
      setDeleteTarget(null);
      await reloadServices();
    } catch (err) {
      showSnackbar({ variant: "error", title: "Failed to deregister", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setDeleting(false);
    }
  };

  const header = (
    <PageListHeader
      title="MCP Gateway Registry"
      subtitle="Backend services registered as MCP tools via the gateway."
      icon={<PlugsConnectedIcon size={18} weight="duotone" />}
      stats={[{ value: services.length, label: "Registered" }]}
      createLabel="Register service"
      onCreateClick={openForm}
      searchValue={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search services…"
      loading={loadingList}
    />
  );

  const body = (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-6">
      {listError ? (
        <ErrorBanner message={`Could not load services: ${listError}`} />
      ) : loadingList ? (
        <p className="text-[13px] text-xyne-fg-secondary">Loading…</p>
      ) : services.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-xyne-border py-16 text-center">
          <PlugsConnectedIcon size={28} weight="duotone" className="text-xyne-fg-secondary" />
          <p className="text-[14px] text-xyne-fg-secondary">No services registered yet.</p>
          <p className="max-w-sm text-[12px] text-xyne-fg-placeholder">
            Register a backend service to expose its endpoints to agents as MCP tools.
          </p>
          <Button variant="primary" size="sm" leadingIcon={<PlusIcon size={14} />} onClick={openForm}>
            Register service
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-[13px] text-xyne-fg-secondary">No services match your search.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((s) => (
            <div key={`${s.serviceName}:${s.backendId}`} className="flex items-center justify-between rounded-lg border border-xyne-border bg-xyne-surface px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-medium text-xyne-fg-primary">{s.serviceName}</span>
                  <Badge label={`${s.toolCount} tool${s.toolCount === 1 ? "" : "s"}`} />
                </div>
                <p className="truncate text-[12px] text-xyne-fg-secondary">
                  {s.backendId} · {s.backendUrl}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="secondary" size="sm" leadingIcon={<PencilSimpleIcon size={14} />} onClick={() => void openEdit(s)}>
                  Edit
                </Button>
                {isAdmin && (
                  <Button variant="ghost" size="sm" leadingIcon={<TrashIcon size={14} />} onClick={() => setDeleteTarget(s)}>
                    Deregister
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Your requests (approval status) */}
      {myRequests.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-[14px] font-semibold text-xyne-fg-primary">Your requests</h2>
          <div className="flex flex-col gap-2">
            {myRequests.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-lg border border-xyne-border bg-xyne-surface px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-medium text-xyne-fg-primary">{r.serviceName}</span>
                    <Badge label={r.status} />
                    <Badge label={`${r.toolCount} tool${r.toolCount === 1 ? "" : "s"}`} />
                  </div>
                  <p className="truncate text-[12px] text-xyne-fg-secondary">{r.backendId} · {r.backendUrl}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Register form dialog */}
      <Dialog
        open={showForm}
        onOpenChange={(open) => { if (!open) { setShowForm(false); setEditing(false); } }}
        title={editing ? `Edit ${serviceName || "service"}` : "Register a service"}
        description={
          editing
            ? "Add, edit, or remove tools, then save. Saving re-registers the service (upsert)."
            : "The tenant and registration key are added on the server — they never leave your browser."
        }
        maxWidth={760}
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => { setShowForm(false); setEditing(false); }} disabled={submitting}>Cancel</Button>
            <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Saving…" : editing ? "Save changes" : "Register service"}
            </Button>
          </div>
        }
      >
        {/* Paste-JSON helper */}
        <div className="rounded-lg border border-xyne-border bg-xyne-surface">
          <button
            type="button"
            onClick={() => setShowJson((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-[13px] font-medium text-xyne-fg-primary"
          >
            <span>Paste JSON — register directly, or fill the guided form</span>
            <span className="text-xyne-fg-secondary">{showJson ? "Hide" : "Show"}</span>
          </button>
          {showJson && (
            <div className="flex flex-col gap-2 border-t border-xyne-border px-4 py-3">
              <TextField
                multiline
                rows={8}
                placeholder='{ "serviceName": "...", "backendId": "...", "backendUrl": "...", "tokenEndpointUrl": "...", "tools": [ ... ] }'
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
              />
              <div className="flex items-center justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={fillFromJson}>Fill form</Button>
                <Button variant="primary" size="sm" onClick={handleSubmitFromJson} disabled={submitting}>
                  {submitting ? "Registering…" : "Register from JSON"}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Service fields */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="Service name" placeholder="pragati" value={serviceName} onChange={(e) => setServiceName(e.target.value)} disabled={editing} hint={editing ? "Locked while editing" : undefined} />
          <TextField label="Backend ID" placeholder="pragati-primary-backend" value={backendId} onChange={(e) => setBackendId(e.target.value)} disabled={editing} hint={editing ? "Locked while editing" : undefined} />
          <TextField label="Backend URL" placeholder="https://pragati.internal.staging.mum.juspay.net" value={backendUrl} onChange={(e) => setBackendUrl(e.target.value)} />
          <TextField label="Token endpoint URL" hint="Relative path, must start with /" placeholder="/api/mcp/v2/token" value={tokenEndpointUrl} onChange={(e) => setTokenEndpointUrl(e.target.value)} />
          <TextField label="Auth header name" hint="Header the gateway forwards the service token in" placeholder="Authorization" value={xAuthHeaderName} onChange={(e) => setXAuthHeaderName(e.target.value)} />
        </div>

        {/* Tools */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-xyne-fg-primary">Tools</h2>
            <Button variant="secondary" size="sm" leadingIcon={<PlusIcon size={14} />} onClick={addTool}>Add tool</Button>
          </div>

          {tools.map((tool, idx) => (
            <div key={idx} className="flex flex-col gap-3 rounded-lg border border-xyne-border bg-xyne-surface p-4">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium text-xyne-fg-secondary">Tool #{idx + 1}</span>
                <Button variant="ghost" size="sm" leadingIcon={<TrashIcon size={14} />} onClick={() => removeTool(idx)} disabled={tools.length === 1}>Remove</Button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <TextField label="Name" placeholder="fetch_server_info" value={tool.name} onChange={(e) => updateTool(idx, { name: e.target.value })} />
                <div>
                  <label className="mb-1 block text-[13px] font-medium text-xyne-fg-primary">Method</label>
                  <SelectField options={METHOD_OPTIONS} value={tool.method} onValueChange={(v) => updateTool(idx, { method: v ?? "POST" })} />
                </div>
                <TextField label="Path" placeholder="/api/mcp/v2/tools/fetch_server_info" value={tool.path} onChange={(e) => updateTool(idx, { path: e.target.value })} />
                <TextField label="Description" placeholder="What this tool does" value={tool.description} onChange={(e) => updateTool(idx, { description: e.target.value })} />
              </div>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-[13px] text-xyne-fg-primary">
                  <input type="checkbox" checked={tool.isWriteTool} onChange={(e) => updateTool(idx, { isWriteTool: e.target.checked })} />
                  Write tool (needs approval)
                </label>
                <label className="flex items-center gap-2 text-[13px] text-xyne-fg-primary">
                  <input type="checkbox" checked={tool.requiresApproval} onChange={(e) => updateTool(idx, { requiresApproval: e.target.checked })} />
                  Requires approval
                </label>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <TextField label="Input schema (JSON)" multiline rows={5} value={tool.inputSchemaText} onChange={(e) => updateTool(idx, { inputSchemaText: e.target.value })} />
                <TextField label="Output schema (JSON)" multiline rows={5} value={tool.outputSchemaText} onChange={(e) => updateTool(idx, { outputSchemaText: e.target.value })} />
              </div>
            </div>
          ))}
        </div>

        {formError && <ErrorBanner message={formError} />}
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={`Deregister ${deleteTarget?.serviceName ?? ""}?`}
        description="This removes all backends for this service under your tenant. Agents will lose access to its tools."
        confirmLabel={deleting ? "Removing…" : "Deregister"}
        danger
        onConfirm={handleDelete}
      />
    </div>
  );

  return <PageLayout header={header} body={body} />;
}
