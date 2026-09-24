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
import { ingestArtifactSignals } from "./conversation-artifact-signals.js";
import { authenticatedProviders, localHarnessRepository } from "../repositories/localHarnessRepository.js";

const log = createLogger("local-harness");

export { LOCAL_HARNESS_PROVIDERS, isLocalHarnessProvider };

const SESSION_TOKEN_TTL_SECONDS = 3600;

export interface StreamAttachment {
  fileName: string;
  mimeType: string;
  data: string;
  metadata?: Record<string, unknown>;
}

const DELIVER_KEY_PREFIX = "local-harness-deliver:";
const DELIVER_TTL_SECONDS = 2 * 60 * 60;

function deliverKey(runId: string): string {
  return `${DELIVER_KEY_PREFIX}${runId}`;
}

export async function stashDeliveredFiles(runId: string, files: StreamAttachment[]): Promise<number> {
  const existing = await readDeliveredFiles(runId);
  const merged = [...existing, ...files];
  await redisService.getConnection().set(deliverKey(runId), JSON.stringify(merged), "EX", DELIVER_TTL_SECONDS);
  return merged.length;
}

export async function readDeliveredFiles(runId: string): Promise<StreamAttachment[]> {
  const raw = await redisService.getConnection().get(deliverKey(runId)).catch(() => null);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as StreamAttachment[]) : [];
  } catch {
    return [];
  }
}

export async function clearDeliveredFiles(runId: string): Promise<void> {
  await redisService.getConnection().del(deliverKey(runId)).catch(() => {});
}

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

export async function resolveLocalHarnessTargetForProvider(
  userId: string,
  provider: LocalHarnessProvider,
): Promise<{ provider: LocalHarnessProvider; device: LocalHarnessDevice } | undefined> {
  if (!CONFIG.localHarnessEnabled) return undefined;
  const devices = await localHarnessRepository
    .listOnlineDevicesForProvider(userId, provider)
    .catch(() => [] as LocalHarnessDevice[]);
  const device = devices[0];
  return device ? { provider, device } : undefined;
}

export type LocalSandboxSpec = NonNullable<LocalHarnessRunEnvelope["localSandbox"]>;

const LOCAL_SANDBOX_CACHE_TTL_MS = 5 * 60 * 1000;
const localSandboxCache = new Map<string, { at: number; spec: LocalSandboxSpec }>();

export async function resolveLocalSandbox(command: string): Promise<LocalSandboxSpec | undefined> {
  const name = command.replace(/^\//, "").toLowerCase();
  if (!/^[a-z0-9-]{1,40}$/.test(name)) return undefined;

  const cached = localSandboxCache.get(name);
  if (cached && Date.now() - cached.at < LOCAL_SANDBOX_CACHE_TTL_MS) return cached.spec;

  try {
    const res = await fetch(`${CONFIG.xyneClawUrl}/internal/task-commands/${encodeURIComponent(name)}`, {
      headers: { ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}) },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      log.warn(`[local-harness] task command /${name} lookup failed status=${res.status}`);
      return undefined;
    }
    const body = (await res.json()) as { instruction?: unknown; skills?: unknown };
    if (typeof body.instruction !== "string") return undefined;
    const skills = Array.isArray(body.skills)
      ? body.skills.filter(
          (s): s is { name: string; content: string } =>
            !!s && typeof s === "object" &&
            typeof (s as Record<string, unknown>)["name"] === "string" &&
            typeof (s as Record<string, unknown>)["content"] === "string",
        )
      : [];
    const spec: LocalSandboxSpec = { command: `/${name}`, instruction: body.instruction, skills };
    localSandboxCache.set(name, { at: Date.now(), spec });
    return spec;
  } catch (err) {
    log.warn(`[local-harness] task command /${name} lookup errored: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
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
  attachments?: Array<{ id: string; fileName: string; mimeType: string }>;
  workspace?: LocalHarnessRunEnvelope["workspace"];
  noServerFallback?: boolean;
  resumeSessionId?: string | null;
  continuation?: { agentSlug: string; excludeMessageIds?: string[] } | false;
  localSandbox?: LocalHarnessRunEnvelope["localSandbox"];
}): Promise<{ sessionId: string; runId: string }> {
  const sessionId = randomUUID();
  const model = args.model ?? defaultModelForProvider(args.target.provider);

  let resumeSessionId = args.resumeSessionId;
  let context = args.context;
  if (args.continuation && args.resumeSessionId === undefined) {
    const { planHarnessContinuation } = await import("./local-harness-continuation.js");
    const plan = await planHarnessContinuation({
      conversationId: args.conversationId,
      agentSlug: args.continuation.agentSlug,
      provider: args.target.provider,
      ...(args.continuation.excludeMessageIds ? { excludeMessageIds: args.continuation.excludeMessageIds } : {}),
    }).catch(() => ({ resumeSessionId: null, context: null }));
    resumeSessionId = plan.resumeSessionId;
    if (plan.context) context = context ? `${context}\n\n${plan.context}` : plan.context;
  }

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
    context,
    timeoutMs: CONFIG.localHarnessRunTimeoutMs,
    ...(resumeSessionId ? { resumeSessionId } : {}),
    ...(args.attachments?.length ? { attachments: args.attachments } : {}),
    ...(args.workspace ? { workspace: args.workspace } : {}),
    ...(args.localSandbox ? { localSandbox: args.localSandbox } : {}),
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
  if (args.noServerFallback) await markNoServerFallback(run.id);

  log.info(
    `[local-harness] run queued id=${run.id} session=${sessionId} agent=${args.agentSlug} provider=${args.target.provider} model=${model ?? "(cli default)"} device=${args.target.device.id}`,
  );
  return { sessionId, runId: run.id };
}

const FALLBACK_KEY_PREFIX = "local-harness-fallback:";

function fallbackKey(runId: string): string {
  return `${FALLBACK_KEY_PREFIX}${runId}`;
}

export const TURN_HANDOFF_SUMMARY_FALLBACK = "I paused this task to handle your new message.";

const INTERRUPT_KEY_PREFIX = "local-harness-interrupt:";
const INTERRUPT_TTL_SECONDS = 10 * 60;

function interruptKey(runId: string): string {
  return `${INTERRUPT_KEY_PREFIX}${runId}`;
}

export async function requestLocalHarnessInterrupt(runId: string): Promise<void> {
  await redisService.getConnection().set(interruptKey(runId), "1", "EX", INTERRUPT_TTL_SECONDS).catch(() => {});
}

export async function isLocalHarnessInterruptRequested(runId: string): Promise<boolean> {
  const raw = await redisService.getConnection().get(interruptKey(runId)).catch(() => null);
  return raw === "1";
}

export async function clearLocalHarnessInterrupt(runId: string): Promise<void> {
  await redisService.getConnection().del(interruptKey(runId)).catch(() => {});
}

const NO_FALLBACK_KEY_PREFIX = "local-harness-no-fallback:";

function noFallbackKey(runId: string): string {
  return `${NO_FALLBACK_KEY_PREFIX}${runId}`;
}

async function markNoServerFallback(runId: string): Promise<void> {
  const ttlSeconds = Math.ceil(CONFIG.localHarnessRunTimeoutMs / 1000) + 600;
  await redisService.getConnection().set(noFallbackKey(runId), "1", "EX", ttlSeconds).catch(() => {});
}

export async function isServerFallbackBlocked(runId: string): Promise<boolean> {
  const raw = await redisService.getConnection().get(noFallbackKey(runId)).catch(() => null);
  return raw === "1";
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

export async function readServerFallback(runId: string): Promise<Record<string, unknown> | null> {
  const raw = await redisService.getConnection().get(fallbackKey(runId)).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function failOverToServerRun(run: LocalHarnessRun, reason: string): Promise<boolean> {
  if (await isServerFallbackBlocked(run.id)) {
    log.info(`[local-harness] run=${run.id} is a workspace run — surfacing the failure instead of a server fallback (${reason})`);
    await localHarnessRepository.settleFallback(run.id, false, reason);
    return false;
  }
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

export const LOCAL_TOOL_SERVER_TYPE = "local";

async function localToolsForRun(run: LocalHarnessRun): Promise<LocalHarnessToolSpec[]> {
  try {
    const { agentRepository } = await import("../repositories/index.js");
    const { getAllCustomTools } = await import("xyne-claw-shared");
    const agent = await agentRepository.findBySlug(run.agentSlug, run.orgId);
    const tools = (agent?.config as { tools?: { custom?: unknown } } | null)?.tools?.custom;
    const enabled = new Set(Array.isArray(tools) ? tools.filter((t): t is string => typeof t === "string") : []);
    const browserImplied = enabled.has("open-url");
    const envelope = run.envelope as unknown as { localSandbox?: { container?: unknown } } | null;
    const sandboxRun = Boolean(envelope?.localSandbox);
    const containerRun = envelope?.localSandbox?.container === true;
    return getAllCustomTools()
      .filter(
        (tool) =>
          tool.harness === "local" &&
          (tool.source === "custom:local-sandbox"
            ? sandboxRun
            : tool.source === "custom:local-container"
            ? containerRun
            : tool.source === "custom:workspace-plan" ||
              tool.source === "custom:local-sessions" ||
              tool.source === "custom:app-control" ||
              enabled.has(tool.slug) ||
              (browserImplied && tool.source === "custom:workspace-browser")),
      )
      .map((tool) => ({
        name: flattenToolName(LOCAL_TOOL_SERVER_TYPE, tool.slug),
        serverType: LOCAL_TOOL_SERVER_TYPE,
        toolName: tool.slug,
        description: tool.description,
        inputSchema: tool.inputSchema as unknown as Record<string, unknown>,
        write: false,
        local: true,
      }));
  } catch (err) {
    log.warn(`[local-harness] local tool listing failed run=${run.id}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

export async function listToolsForRun(run: LocalHarnessRun): Promise<LocalHarnessToolSpec[]> {
  const res = await fetch(mcpUrl(run.sessionId, "tools"), { headers: sessionAuthHeaders(run) });
  if (!res.ok) {
    log.warn(`[local-harness] tool listing failed run=${run.id} status=${res.status}`);
    return [];
  }
  const body = (await res.json()) as { success?: boolean; data?: McpServerTools[] };
  const servers = Array.isArray(body.data) ? body.data : [];

  const specs: LocalHarnessToolSpec[] = await localToolsForRun(run);
  const seen = new Set<string>(specs.map((spec) => spec.name));
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

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isAgentOutputUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const own = [CONFIG.spacesAppUrl, CONFIG.spacesBackendUrl, CONFIG.selfUrl, CONFIG.frontendUrl];
  const matchesOwn = own.some((base) => {
    if (!base) return false;
    try {
      return new URL(base).host.toLowerCase() === parsed.host.toLowerCase();
    } catch {
      return false;
    }
  });
  if (matchesOwn) return true;
  return LOOPBACK_HOSTS.has(host) && /^\/runs\/[^/]+\//.test(parsed.pathname);
}

async function callLocalTool(
  run: LocalHarnessRun,
  call: { toolName: string; params: Record<string, unknown> },
): Promise<{ ok: boolean; content: string }> {
  const envelope = run.envelope as unknown as { conversationId?: string };
  const conversationId = envelope?.conversationId;
  if (!conversationId) return { ok: false, content: "Error: this run has no conversation to open the page in." };

  if (call.toolName === "open-url") {
    const raw = typeof call.params["url"] === "string" ? call.params["url"].trim() : "";
    if (!/^https?:\/\//i.test(raw)) return { ok: false, content: "Error: url must be an absolute http(s) URL." };
    const { recordConversationArtifact, normalizeExternalUrl, detectLinkProvider } = await import("./conversation-artifacts.js");
    const normalized = normalizeExternalUrl(raw);
    if (!normalized) return { ok: false, content: "Error: url could not be parsed." };
    const label = typeof call.params["title"] === "string" && call.params["title"].trim() ? call.params["title"].trim() : new URL(raw).host;
    if (isAgentOutputUrl(raw) || isAgentOutputUrl(normalized)) {
      return { ok: true, content: `Opened ${raw} in the user's workspace panel. Tell the user it is open on the right.` };
    }
    await recordConversationArtifact({
      conversationId,
      runId: run.sessionId,
      kind: "PAGE",
      refService: "EXTERNAL",
      refId: normalized,
      url: raw,
      provider: detectLinkProvider(normalized),
      title: label,
      createdByUserId: run.userId,
      orgId: run.orgId,
    });
    return { ok: true, content: `Opened ${raw} in the user's workspace panel. Tell the user it is open on the right.` };
  }

  if (call.toolName === "update-plan") {
    const raw = Array.isArray(call.params["todos"]) ? (call.params["todos"] as unknown[]) : [];
    const statuses = new Set(["pending", "in_progress", "completed", "failed"]);
    const todos = raw
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item, index) => ({
        id: typeof item["id"] === "string" && item["id"].trim() ? item["id"].trim().slice(0, 40) : `t${index + 1}`,
        title: typeof item["title"] === "string" ? item["title"].trim().slice(0, 160) : "",
        status: typeof item["status"] === "string" && statuses.has(item["status"]) ? item["status"] : "pending",
      }))
      .filter((todo) => todo.title)
      .slice(0, 30);
    if (todos.length === 0) return { ok: false, content: "update-plan needs at least one todo with a title." };
    const title = typeof call.params["title"] === "string" ? call.params["title"].trim().slice(0, 120) : undefined;
    await relayProgress(run, { todos, ...(title ? { planTitle: title } : {}) });
    const done = todos.filter((todo) => todo.status === "completed").length;
    return { ok: true, content: `Plan updated: ${done}/${todos.length} steps completed.` };
  }

  return { ok: false, content: `Unknown local tool: ${call.toolName}` };
}

export async function callToolForRun(
  run: LocalHarnessRun,
  call: { serverType: string; toolName: string; params: Record<string, unknown> },
): Promise<{ ok: boolean; content: string }> {
  if (call.serverType === LOCAL_TOOL_SERVER_TYPE) {
    try {
      return await callLocalTool(run, call);
    } catch (err) {
      return { ok: false, content: `${call.toolName} failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
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
    const action = data.pendingAction as Record<string, unknown>;
    const actionId = typeof action["signature"] === "string" ? action["signature"] : "";
    if (!actionId) {
      return { ok: false, content: `${call.toolName} could not be queued for approval — the action was not signed.` };
    }
    if (run.pendingActionId) {
      return {
        ok: false,
        content: `Another action is awaiting approval. Stop now and wait for the user to answer the approval card before calling ${call.toolName}.`,
      };
    }
    const stored = await localHarnessRepository
      .setPendingAction(run.id, actionId, action as never)
      .catch(() => false);
    if (!stored) {
      return {
        ok: false,
        content: `Another action is awaiting approval. Stop now and wait for the user to answer the approval card before calling ${call.toolName}.`,
      };
    }
    log.info(`[local-harness] run ${run.id} stopped on approval for ${call.serverType}/${call.toolName}`);
    return {
      ok: true,
      content:
        `${call.toolName} is queued for the user's approval. Stop now: reply with one short sentence saying the action ` +
        `awaits approval, and do not retry or work around it.`,
    };
  }

  const envelope = run.envelope as unknown as { conversationId?: string };
  if (envelope?.conversationId) {
    void ingestArtifactSignals({
      conversationId: envelope.conversationId,
      runId: run.sessionId,
      userId: run.userId,
      orgId: run.orgId,
      toolName: call.toolName,
      toolResult: content,
    });
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
    pendingActions?: Array<Record<string, unknown>>;
    attachments?: StreamAttachment[];
    interrupted?: true;
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
      ...(result.pendingActions?.length ? { pendingActions: result.pendingActions } : {}),
      ...(result.attachments?.length ? { attachments: result.attachments } : {}),
      ...(result.toolsUsed?.length ? { toolsUsed: result.toolsUsed } : {}),
      ...(result.tokenUsage ? { tokenUsage: result.tokenUsage } : {}),
      ...(result.error ? { error: result.error } : {}),
    }),
  }).catch((err) => {
    log.warn(`[local-harness] result relay failed run=${run.id}: ${err instanceof Error ? err.message : String(err)}`);
  });
}
