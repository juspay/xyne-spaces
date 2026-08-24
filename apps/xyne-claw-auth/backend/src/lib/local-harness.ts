import { randomUUID } from "node:crypto";
import type { LocalHarnessDevice, LocalHarnessRun } from "@prisma/client";
import type {
  LocalHarnessProvider,
  LocalHarnessRunEnvelope,
  LocalHarnessToolSpec,
} from "xyne-claw-shared";
import { LOCAL_HARNESS_PROVIDERS, LOCAL_HARNESS_PROTOCOL_VERSION, isLocalHarnessProvider } from "xyne-claw-shared";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { mintSessionToken } from "./session-tokens.js";
import { authenticatedProviders, localHarnessRepository } from "../repositories/localHarnessRepository.js";

const log = createLogger("local-harness");

export { LOCAL_HARNESS_PROVIDERS, isLocalHarnessProvider };

const SESSION_TOKEN_TTL_SECONDS = 3600;

export function defaultModelForProvider(provider: LocalHarnessProvider): string | null {
  return provider === "claude-code" ? "sonnet" : null;
}

export function pinnedModelForProvider(config: unknown, provider: LocalHarnessProvider): string | null {
  const cfg = (config as Record<string, unknown> | null) ?? null;
  const models = cfg?.["localHarnessModels"];
  if (!models || typeof models !== "object" || Array.isArray(models)) return null;
  const value = (models as Record<string, unknown>)[provider];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function resolveLocalHarnessTarget(args: {
  userId: string;
  orgId: string;
  providerOrder: string[];
  personalProvider?: string | undefined;
}): Promise<{ provider: LocalHarnessProvider; device: LocalHarnessDevice } | undefined> {
  if (!CONFIG.localHarnessEnabled) return undefined;

  const ordered = [args.personalProvider, ...args.providerOrder].filter(
    (p): p is LocalHarnessProvider => isLocalHarnessProvider(p),
  );
  if (ordered.length === 0) {
    // Workspace policy decides whether an agent with no explicit local-harness
    // provider order may still auto-route to an online device. 'all' opts every
    // agent in; 'selected' (default) requires an explicit opt-in. Falls back to
    // the LOCAL_HARNESS_DEFAULT_ALL env only when the org has no stored setting.
    const mode = (await localHarnessRepository.getOrgHarnessMode(args.orgId).catch(() => null))
      ?? (CONFIG.localHarnessDefaultAll ? "all" : "selected");
    if (mode !== "all" || args.personalProvider) return undefined;
    const devices = await localHarnessRepository.listOnlineDevices(args.userId).catch(() => [] as LocalHarnessDevice[]);
    for (const device of devices) {
      const provider = authenticatedProviders(device).find(isLocalHarnessProvider);
      if (provider) {
        log.info(`[local-harness] auto-routing user=${args.userId} to ${provider} on device=${device.id}`);
        return { provider, device };
      }
    }
    return undefined;
  }

  for (const provider of ordered) {
    const devices = await localHarnessRepository
      .listOnlineDevicesForProvider(args.userId, provider)
      .catch(() => [] as LocalHarnessDevice[]);
    const device = devices[0];
    if (device) return { provider, device };
    log.info(`[local-harness] no online device for provider=${provider} user=${args.userId} — falling back to server run`);
  }
  return undefined;
}

export async function dispatchLocalHarnessRun(args: {
  target: { provider: LocalHarnessProvider; device: LocalHarnessDevice };
  userId: string;
  orgId: string;
  conversationId: string;
  agentSlug: string;
  agentName: string;
  systemPrompt: string;
  model: string | null;
  task: string;
  context: string | null;
  progressUrl: string;
  callbackUrl: string;
}): Promise<{ sessionId: string; runId: string }> {
  const sessionId = randomUUID();
  const model = args.model ?? defaultModelForProvider(args.target.provider);

  const envelope: LocalHarnessRunEnvelope = {
    protocolVersion: LOCAL_HARNESS_PROTOCOL_VERSION,
    runId: "",
    sessionId,
    conversationId: args.conversationId,
    provider: args.target.provider,
    model,
    agentSlug: args.agentSlug,
    agentName: args.agentName,
    systemPrompt: args.systemPrompt,
    task: args.task,
    context: args.context,
    timeoutMs: CONFIG.localHarnessRunTimeoutMs,
  };

  const run = await localHarnessRepository.enqueueRun({
    sessionId,
    userId: args.userId,
    orgId: args.orgId,
    agentSlug: args.agentSlug,
    provider: args.target.provider,
    model,
    envelope: envelope as unknown as never,
    progressUrl: args.progressUrl,
    callbackUrl: args.callbackUrl,
    expiresAt: new Date(Date.now() + CONFIG.localHarnessRunTimeoutMs),
  });

  log.info(
    `[local-harness] run queued id=${run.id} session=${sessionId} agent=${args.agentSlug} provider=${args.target.provider} model=${model ?? "(cli default)"} device=${args.target.device.id}`,
  );
  return { sessionId, runId: run.id };
}

export function flattenToolName(serverType: string, toolName: string): string {
  return `${serverType}.${toolName}`;
}

type McpServerTools = {
  serverType?: string;
  serverName?: string;
  tools?: Array<{ name?: string; description?: string; inputSchema?: Record<string, unknown> }>;
  writeTools?: string[];
};

function sessionAuthHeaders(run: Pick<LocalHarnessRun, "sessionId" | "userId" | "agentSlug">): Record<string, string> {
  const token = mintSessionToken({
    sessionId: run.sessionId,
    userId: run.userId,
    agentSlug: run.agentSlug,
    ttlSeconds: SESSION_TOKEN_TTL_SECONDS,
  });
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
  };
}

function mcpUrl(sessionId: string, suffix: string): string {
  return `${CONFIG.internalUrl}/claw/api/v1/sessions/${encodeURIComponent(sessionId)}/mcp/${suffix}`;
}

export async function listToolsForRun(run: LocalHarnessRun): Promise<LocalHarnessToolSpec[]> {
  const res = await fetch(mcpUrl(run.sessionId, "tools"), { headers: sessionAuthHeaders(run) });
  if (!res.ok) {
    log.warn(`[local-harness] tool listing failed run=${run.id} status=${res.status}`);
    return [];
  }
  const body = (await res.json()) as { success?: boolean; data?: McpServerTools[] };
  const servers = Array.isArray(body.data) ? body.data : [];

  const specs: LocalHarnessToolSpec[] = [];
  const seen = new Set<string>();
  for (const server of servers) {
    const serverType = server.serverType;
    if (!serverType) continue;
    const writeTools = new Set(server.writeTools ?? []);
    for (const tool of server.tools ?? []) {
      if (!tool.name) continue;
      const name = flattenToolName(serverType, tool.name);
      if (seen.has(name)) continue;
      seen.add(name);
      specs.push({
        name,
        serverType,
        toolName: tool.name,
        description: tool.description ?? "",
        inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
        write: writeTools.has(tool.name),
      });
    }
  }
  return specs;
}

export async function callToolForRun(
  run: LocalHarnessRun,
  call: { serverType: string; toolName: string; params: Record<string, unknown> },
): Promise<{ ok: boolean; content: string }> {
  const res = await fetch(mcpUrl(run.sessionId, "call"), {
    method: "POST",
    headers: sessionAuthHeaders(run),
    body: JSON.stringify({ serverType: call.serverType, tool: call.toolName, params: call.params }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    data?: { content?: string; pendingAction?: unknown } | string;
  };

  if (!res.ok || body.success === false) {
    const message = body.error ?? `Tool call failed (HTTP ${res.status})`;
    log.info(`[local-harness] tool call rejected run=${run.id} tool=${call.serverType}/${call.toolName}: ${message}`);
    return { ok: false, content: message };
  }

  const data = body.data;
  const content = typeof data === "string" ? data : (data?.content ?? "");

  if (typeof data !== "string" && data?.pendingAction) {
    log.info(`[local-harness] write tool needs approval run=${run.id} tool=${call.serverType}/${call.toolName} — not supported from a local harness`);
    return {
      ok: false,
      content: `${call.toolName} needs approval before it can run, which isn't supported from a local harness yet. Re-run this agent on Xyne's servers to approve the action.`,
    };
  }

  return { ok: true, content };
}

function callbackHeaders(run: Pick<LocalHarnessRun, "sessionId" | "userId" | "agentSlug">): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
    "x-session-token": mintSessionToken({
      sessionId: run.sessionId,
      userId: run.userId,
      agentSlug: run.agentSlug,
      ttlSeconds: SESSION_TOKEN_TTL_SECONDS,
    }),
  };
}

export async function relayProgress(run: LocalHarnessRun, body: Record<string, unknown>): Promise<void> {
  await fetch(run.progressUrl, {
    method: "POST",
    headers: callbackHeaders(run),
    body: JSON.stringify({ ...body, sessionId: run.sessionId }),
  }).catch((err) => {
    log.warn(`[local-harness] progress relay failed run=${run.id}: ${err instanceof Error ? err.message : String(err)}`);
  });
}

function toCallbackStatus(status: "done" | "failed" | "cancelled"): "completed" | "failed" | "cancelled" {
  return status === "done" ? "completed" : status;
}

export async function relayResult(
  run: LocalHarnessRun,
  result: {
    status: "done" | "failed" | "cancelled";
    text: string;
    toolsUsed?: string[];
    tokenUsage?: { input?: number; output?: number };
    effectiveModel?: string;
    error?: string;
  },
): Promise<void> {
  await fetch(run.callbackUrl, {
    method: "POST",
    headers: callbackHeaders(run),
    body: JSON.stringify({
      status: toCallbackStatus(result.status),
      result: result.text,
      sessionId: run.sessionId,
      userId: run.userId,
      provider: run.provider,
      model: result.effectiveModel ?? run.model ?? undefined,
      ...(result.toolsUsed?.length ? { toolsUsed: result.toolsUsed } : {}),
      ...(result.tokenUsage ? { tokenUsage: result.tokenUsage } : {}),
      ...(result.error ? { error: result.error } : {}),
    }),
  }).catch((err) => {
    log.warn(`[local-harness] result relay failed run=${run.id}: ${err instanceof Error ? err.message : String(err)}`);
  });
}
