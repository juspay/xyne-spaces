import { randomUUID } from "node:crypto";
import type { LocalHarnessDevice, LocalHarnessRun } from "@prisma/client";
import type {
  LocalHarnessProvider,
  LocalHarnessRunEnvelope,
  LocalHarnessToolSpec,
} from "xyne-claw-shared";
import { LOCAL_HARNESS_PROVIDERS, LOCAL_HARNESS_PROTOCOL_VERSION, isLocalHarnessProvider } from "xyne-claw-shared";
import { CONFIG } from "../config.js";
import { prisma } from "../db.js";
import { redisService } from "../redis.js";
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
  /**
   * RAW UserAgentConfig.provider for this agent — `undefined` when the user
   * never picked one. An explicit hosted pick ("spaces"/"claude"/"codex"/
   * "copilot") is a per-agent opt-out, so the user's account-wide default
   * harness is skipped for it.
   */
  personalProvider?: string | undefined;
}): Promise<{ provider: LocalHarnessProvider; device: LocalHarnessDevice } | undefined> {
  if (!CONFIG.localHarnessEnabled) return undefined;

  // Account-wide default (onboarding / Claw Settings "use for all my agents").
  // Ranks below the per-agent pick and above the agent's own providerOrder: it
  // is the user's preference, and a personal preference already outranks agent
  // config everywhere else.
  const userDefault =
    args.personalProvider === undefined
      ? await localHarnessRepository.getUserDefaultProvider(args.userId).catch(() => null)
      : null;

  const ordered = [
    ...new Set(
      [args.personalProvider, userDefault, ...args.providerOrder].filter(
        (p): p is LocalHarnessProvider => isLocalHarnessProvider(p),
      ),
    ),
  ];
  if (ordered.length === 0) {
    // Workspace policy decides whether an agent with no explicit local-harness
    // provider order may still auto-route to an online device. 'all' opts every
    // agent in; 'selected' (default) requires an explicit opt-in. Falls back to
    // the LOCAL_HARNESS_DEFAULT_ALL env only when the org has no stored setting.
    const mode = (await localHarnessRepository.getOrgHarnessMode(args.orgId).catch(() => null))
      ?? (CONFIG.localHarnessDefaultAll ? "all" : "selected");
    // A per-agent pick of ANY provider — including "spaces", which means "use
    // the agent's own configuration, not my personal one" — opts this agent out
    // of the blanket auto-route.
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
  serverFallbackBody: Record<string, unknown>;
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

  await rememberServerFallback(run.id, args.serverFallbackBody);

  log.info(
    `[local-harness] run queued id=${run.id} session=${sessionId} agent=${args.agentSlug} provider=${args.target.provider} model=${model ?? "(cli default)"} device=${args.target.device.id}`,
  );
  return { sessionId, runId: run.id };
}

const FALLBACK_KEY_PREFIX = "local-harness-fallback:";

function fallbackKey(runId: string): string {
  return `${FALLBACK_KEY_PREFIX}${runId}`;
}

async function rememberServerFallback(runId: string, body: Record<string, unknown>): Promise<void> {
  const ttlSeconds = Math.ceil(CONFIG.localHarnessRunTimeoutMs / 1000) + 600;
  await redisService
    .getConnection()
    .set(fallbackKey(runId), JSON.stringify(body), "EX", ttlSeconds)
    .catch((err: unknown) => {
      log.warn(`[local-harness] could not stash server fallback for run=${runId}: ${err instanceof Error ? err.message : String(err)}`);
    });
}

export async function failOverToServerRun(run: LocalHarnessRun, reason: string): Promise<boolean> {
  const raw = await redisService.getConnection().get(fallbackKey(run.id)).catch(() => null);
  if (!raw) {
    log.warn(`[local-harness] no stashed server fallback for run=${run.id} — cannot recover (${reason})`);
    await localHarnessRepository.settleFallback(run.id, false, reason);
    return false;
  }

  try {
    const res = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: raw,
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json().catch(() => ({}))) as { success?: boolean; sessionId?: string; error?: string };
    if (!res.ok || !body.success || !body.sessionId) {
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }

    await redisService.getConnection().del(fallbackKey(run.id)).catch(() => {});
    await localHarnessRepository.settleFallback(run.id, true, reason);
    log.info(
      `[local-harness] failed over to server run=${run.id} provider=${run.provider} agent=${run.agentSlug} ` +
        `newSession=${body.sessionId} reason="${reason}"`,
    );
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`[local-harness] server fallback dispatch failed run=${run.id} reason="${reason}": ${message}`);
    await localHarnessRepository.settleFallback(run.id, false, `${reason}; server fallback also failed: ${message}`);
    return false;
  }
}

export async function recoverFailedLocalRun(run: LocalHarnessRun, reason: string): Promise<boolean> {
  const owned = await localHarnessRepository.beginFallback(run.id).catch(() => null);
  if (owned === false) return true;
  return failOverToServerRun(run, reason);
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

const PROVIDER_LABEL: Record<string, string> = {
  "claude-code": "Claude Code",
  "codex-cli": "Codex CLI",
};

export function localHarnessProviderLabel(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider;
}

function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

export interface LocalHarnessAttribution {
  provider: string;
  harnessName: string;
  label: string;
  ownerName: string;
}

export async function describeLocalHarnessRun(run: LocalHarnessRun): Promise<LocalHarnessAttribution> {
  const harnessName = localHarnessProviderLabel(run.provider);

  const user = await prisma.user
    .findUnique({ where: { id: run.userId }, select: { name: true, email: true } })
    .catch(() => null);

  const fullName = user?.name?.trim() || user?.email?.split("@")[0] || "";
  const ownerName = fullName.split(/\s+/)[0] ?? "";

  return {
    provider: run.provider,
    harnessName,
    label: ownerName ? `${possessive(ownerName)} ${harnessName}` : harnessName,
    ownerName,
  };
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
  opts: { localHarnessUnreachable?: boolean } = {},
): Promise<void> {
  const localHarness = result.status === "done"
    ? await describeLocalHarnessRun(run).catch(() => null)
    : null;

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
      ...(localHarness ? { localHarness } : {}),
      ...(opts.localHarnessUnreachable ? { localHarnessUnreachable: true, localHarnessProvider: run.provider } : {}),
      ...(result.toolsUsed?.length ? { toolsUsed: result.toolsUsed } : {}),
      ...(result.tokenUsage ? { tokenUsage: result.tokenUsage } : {}),
      ...(result.error ? { error: result.error } : {}),
    }),
  }).catch((err) => {
    log.warn(`[local-harness] result relay failed run=${run.id}: ${err instanceof Error ? err.message : String(err)}`);
  });
}
