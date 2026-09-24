
export type LocalHarnessProvider = "claude-code" | "codex-cli";

export const LOCAL_HARNESS_PROVIDERS: readonly LocalHarnessProvider[] = ["claude-code", "codex-cli"];

export function isLocalHarnessProvider(v: unknown): v is LocalHarnessProvider {
  return typeof v === "string" && (LOCAL_HARNESS_PROVIDERS as readonly string[]).includes(v);
}

export const LOCAL_HARNESS_SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export function isSafeLocalHarnessName(v: unknown): v is string {
  return typeof v === "string" && LOCAL_HARNESS_SAFE_NAME.test(v);
}

export const LOCAL_HARNESS_PROTOCOL_VERSION = 1;

export interface LocalHarnessInstallation {
  provider: LocalHarnessProvider;
  binaryPath: string;
  version: string;
  authenticated: boolean;
  /**
   * Whether the user has connected THIS harness on THIS device. Each harness is
   * paired independently, so a device can have Claude Code connected while Codex
   * CLI stays off. Absent on devices registered before per-harness pairing —
   * treat `undefined` as connected so those keep working (see
   * `authenticatedProviders`).
   */
  enabled?: boolean;
}

/** Device-token authed installation refresh (per-harness connect/disconnect). */
export interface LocalHarnessInstallationSync {
  protocolVersion: number;
  installations: LocalHarnessInstallation[];
}

export interface LocalHarnessDeviceRegistration {
  protocolVersion: number;
  deviceName: string;
  platform: string;
  installations: LocalHarnessInstallation[];
}

export interface LocalHarnessDeviceCredential {
  deviceId: string;
  deviceToken: string;
}

export interface LocalHarnessDeviceStatus {
  deviceId: string;
  deviceName: string;
  platform: string;
  installations: LocalHarnessInstallation[];
  lastSeenAt: string | null;
  online: boolean;
  createdAt: string;
}

export interface LocalHarnessRunEnvelope {
  protocolVersion: number;
  runId: string;
  sessionId: string;
  conversationId: string;
  provider: LocalHarnessProvider;
  model: string | null;
  agentSlug: string;
  agentName: string;
  systemPrompt: string;
  task: string;
  context: string | null;
  timeoutMs: number;
  resumeSessionId?: string | null;
  attachments?: Array<{
    id: string;
    fileName: string;
    mimeType: string;
  }>;
  workspace?: {
    path: string;
    name: string;
    branch?: string;
  };
  localSandbox?: {
    command: string;
    instruction: string;
    skills: Array<{ name: string; content: string }>;
    container?: boolean;
  };
}

export type LocalHarnessPollResult =
  | { status: "idle" }
  | { status: "run"; run: LocalHarnessRunEnvelope };

export interface LocalHarnessToolSpec {
  name: string;
  serverType: string;
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  write: boolean;
  local?: boolean;
}

export interface LocalHarnessToolList {
  runId: string;
  tools: LocalHarnessToolSpec[];
}

export interface LocalHarnessToolCallRequest {
  serverType: string;
  toolName: string;
  params: Record<string, unknown>;
}

export interface LocalHarnessToolCallResponse {
  ok: boolean;
  content: string;
}

export type LocalHarnessProgressEvent =
  | { kind: "text"; delta: string }
  | { kind: "reasoning"; delta: string }
  | {
      kind: "tool";
      toolName: string;
      toolCallId?: string;
      args?: Record<string, unknown>;
      result?: string;
      status?: "running" | "completed" | "error";
      durationMs?: number;
    }
  | { kind: "status"; label: string };

export type LocalHarnessRunStatus = "done" | "failed" | "cancelled";

export interface LocalHarnessRunResult {
  status: LocalHarnessRunStatus;
  text: string;
  toolsUsed?: string[];
  tokenUsage?: { input?: number; output?: number };
  effectiveModel?: string;
  error?: string;
  harnessSessionId?: string;
  workspaceDiff?: LocalHarnessWorkspaceDiff;
  interrupted?: true;
}

export interface LocalHarnessWorkspaceDiff {
  branch: string;
  changedFiles: number;
  stat: string;
  patch: string;
}

export const LOCAL_HARNESS_DIFF_PATCH_MAX = 2 * 1024 * 1024;
export const LOCAL_HARNESS_DIFF_STAT_MAX = 20 * 1024;

export function isLocalHarnessWorkspaceDiff(v: unknown): v is LocalHarnessWorkspaceDiff {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d["branch"] === "string" &&
    typeof d["changedFiles"] === "number" &&
    Number.isFinite(d["changedFiles"]) &&
    typeof d["stat"] === "string" &&
    typeof d["patch"] === "string"
  );
}

export function clampLocalHarnessWorkspaceDiff(diff: LocalHarnessWorkspaceDiff): LocalHarnessWorkspaceDiff {
  return {
    branch: diff.branch.slice(0, 300),
    changedFiles: Math.max(0, Math.floor(diff.changedFiles)),
    stat: diff.stat.slice(0, LOCAL_HARNESS_DIFF_STAT_MAX),
    patch: diff.patch.slice(0, LOCAL_HARNESS_DIFF_PATCH_MAX),
  };
}

export function isLocalHarnessToolCallRequest(v: unknown): v is LocalHarnessToolCallRequest {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  if (!isSafeLocalHarnessName(r["serverType"])) return false;
  if (!isSafeLocalHarnessName(r["toolName"])) return false;
  const params = r["params"];
  return params === undefined || (typeof params === "object" && params !== null && !Array.isArray(params));
}

export function isLocalHarnessRunResult(v: unknown): v is LocalHarnessRunResult {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  const status = r["status"];
  if (status !== "done" && status !== "failed" && status !== "cancelled") return false;
  const harnessSessionId = r["harnessSessionId"];
  if (harnessSessionId !== undefined && typeof harnessSessionId !== "string") return false;
  const workspaceDiff = r["workspaceDiff"];
  if (workspaceDiff !== undefined && !isLocalHarnessWorkspaceDiff(workspaceDiff)) return false;
  const interrupted = r["interrupted"];
  if (interrupted !== undefined && interrupted !== true) return false;
  return typeof r["text"] === "string";
}

export function isLocalHarnessProgressEvent(v: unknown): v is LocalHarnessProgressEvent {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  switch (e["kind"]) {
    case "text":
      return typeof e["delta"] === "string";
    case "reasoning":
      return typeof e["delta"] === "string";
    case "tool":
      return isSafeLocalHarnessName(e["toolName"]);
    case "status":
      return typeof e["label"] === "string";
    default:
      return false;
  }
}

function isInstallationArray(v: unknown): v is LocalHarnessInstallation[] {
  if (!Array.isArray(v)) return false;
  return v.every((i) => {
    if (!i || typeof i !== "object") return false;
    const inst = i as Record<string, unknown>;
    return (
      isLocalHarnessProvider(inst["provider"]) &&
      typeof inst["binaryPath"] === "string" &&
      typeof inst["version"] === "string" &&
      typeof inst["authenticated"] === "boolean" &&
      (inst["enabled"] === undefined || typeof inst["enabled"] === "boolean")
    );
  });
}

export function isLocalHarnessDeviceRegistration(v: unknown): v is LocalHarnessDeviceRegistration {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  if (r["protocolVersion"] !== LOCAL_HARNESS_PROTOCOL_VERSION) return false;
  if (typeof r["deviceName"] !== "string" || !r["deviceName"].trim()) return false;
  if (typeof r["platform"] !== "string" || !r["platform"].trim()) return false;
  return isInstallationArray(r["installations"]);
}

export function isLocalHarnessInstallationSync(v: unknown): v is LocalHarnessInstallationSync {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  if (r["protocolVersion"] !== LOCAL_HARNESS_PROTOCOL_VERSION) return false;
  return isInstallationArray(r["installations"]);
}
