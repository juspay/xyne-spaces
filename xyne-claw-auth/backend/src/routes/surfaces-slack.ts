import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { Router, type Request, type Response } from "express";
import { CONFIG } from "../config.js";
import { prisma } from "../db.js";
import { createLogger } from "../logger.js";
import { resolveAgentProviderConfigs, resolveSubagentProviderMode } from "../lib/agent-provider-config.js";
import { connectedSurfaceBotToken, postSlackMessage, slackBotTokenFromConfig } from "../lib/slack-delivery.js";
import { getSurfaceAdapter } from "../lib/surface-adapter.js";
import {
  encryptSurfaceSecret,
  decryptSurfaceSecret,
  getConnectedSurfaceSigningSecret,
  resolveInboundForTenant,
  resolveSurfaceTenant,
  SurfaceResolverError,
} from "../lib/surface-resolver.js";
import { getOrgId, getRequesterId, isClawAdmin, isOrgAdmin } from "../middleware/agent-acl.js";
import { requireUserAuth } from "../middleware/require-auth.js";
import { setSession } from "./webhook.js";
import {
  configWithRotatedTokens,
  hasUsableSlackConfigToken,
  rotateSlackRefreshToken,
  rotateStoredSlackConfigToken,
  SlackConfigTokenError,
} from "../services/slackConfigTokenService.js";

const log = createLogger("surfaces-slack");
const router = Router();

const MAX_DEDUP_ENTRIES = 10_000;
const DEDUP_TTL_MS = 10 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const SLACK_SCOPES = [
  "app_mentions:read",
  "chat:write",
  "chat:write.customize",
  "im:history",
  "im:read",
  "im:write",
  // Result attachments (test reports, HTML evidence) upload via the external
  // upload flow. Existing installs need a reinstall to gain this scope.
  "files:write",
  // Future apps can replace the working-message acknowledgement with an eyes
  // reaction. Existing installs do not gain this scope until reinstalled.
  "reactions:write",
  "users:read",
  "users:read.email",
] as const;

interface SlackOAuthState {
  orgId: string;
  userId: string;
  surfaceAgentId?: string;
  expiresAt: number;
}

interface SlackOAuthResponse {
  ok?: boolean;
  error?: string;
  access_token?: string;
  bot_user_id?: string;
  app_id?: string;
  team?: { id?: string; name?: string };
}

interface SlackManifestResponse {
  ok?: boolean;
  error?: string;
  app_id?: string;
  credentials?: {
    client_id?: string;
    client_secret?: string;
    signing_secret?: string;
    verification_token?: string;
  };
}

const oauthStates = new Map<string, SlackOAuthState>();

function createOAuthState(input: Omit<SlackOAuthState, "expiresAt">): string {
  pruneOAuthStates();
  const state = randomBytes(32).toString("base64url");
  oauthStates.set(state, { ...input, expiresAt: Date.now() + OAUTH_STATE_TTL_MS });
  return state;
}

function slackCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env["SLACK_CLIENT_ID"]?.trim();
  const clientSecret = process.env["SLACK_CLIENT_SECRET"]?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function slackCallbackUri(): string {
  return `${CONFIG.selfUrl.replace(/\/+$/, "")}/claw/api/v1/surfaces/slack/oauth/callback`;
}

function createAgentInstallUrl(input: {
  orgId: string;
  userId: string;
  surfaceAgentId: string;
  clientId: string;
}): string {
  const state = createOAuthState({
    orgId: input.orgId,
    userId: input.userId,
    surfaceAgentId: input.surfaceAgentId,
  });
  const installUrl = new URL("https://slack.com/oauth/v2/authorize");
  installUrl.searchParams.set("client_id", input.clientId);
  installUrl.searchParams.set("scope", SLACK_SCOPES.join(","));
  installUrl.searchParams.set("redirect_uri", slackCallbackUri());
  installUrl.searchParams.set("state", state);
  return installUrl.toString();
}

function frontendOrganizationUrl(param: "slack_connected" | "slack_error", value: string): string {
  const configured = process.env["FRONTEND_URL"]
    ?? (process.env["AUTH_SERVICE_URL"]
      ? `${CONFIG.selfUrl.replace(/\/+$/, "")}/claw/`
      : "http://localhost:5174/claw/");
  const url = new URL("v3/organizations", configured.endsWith("/") ? configured : `${configured}/`);
  url.searchParams.set(param, value);
  return url.toString();
}

function takeOAuthState(value: unknown): SlackOAuthState | null {
  if (typeof value !== "string" || !value) return null;
  const stored = oauthStates.get(value);
  oauthStates.delete(value);
  if (!stored || stored.expiresAt < Date.now()) return null;
  return stored;
}

function pruneOAuthStates(now = Date.now()): void {
  for (const [state, value] of oauthStates) {
    if (value.expiresAt < now) oauthStates.delete(state);
  }
}

// Process-local LRU is sufficient for this stub. Move this idempotency key to
// Redis before the service runs with multiple replicas.
const seenEvents = new Map<string, number>();

function isDuplicate(key: string, now = Date.now()): boolean {
  const seenAt = seenEvents.get(key);
  if (seenAt !== undefined && now - seenAt <= DEDUP_TTL_MS) {
    seenEvents.delete(key);
    seenEvents.set(key, seenAt);
    return true;
  }

  if (seenAt !== undefined) seenEvents.delete(key);
  seenEvents.set(key, now);
  while (seenEvents.size > MAX_DEDUP_ENTRIES) {
    const oldest = seenEvents.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    seenEvents.delete(oldest);
  }
  return false;
}

function objectPayload(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

interface BoundSlackSurfaceAgent {
  id: string;
  config: unknown;
  agent: {
    id: string;
    slug: string;
    name: string;
    orgId: string;
    config: unknown;
  };
}

interface SlackUsersInfoResponse {
  ok?: boolean;
  error?: string;
  user?: { profile?: { email?: string } };
}

function slackEventRecord(raw: unknown): Record<string, unknown> | null {
  return objectPayload(objectPayload(raw)?.["event"]);
}

function stripSlackBotMention(text: string, botUserId: string): string {
  if (!botUserId) return text.trim();
  const escaped = botUserId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`<@${escaped}>`, "g"), " ").replace(/\s+/g, " ").trim();
}

async function resolveSlackUserByEmail(input: {
  currentUserId: string | null;
  surfaceId: string;
  orgId: string;
  teamId: string;
  slackUserId: string;
  botToken: string;
}): Promise<string | null> {
  if (input.currentUserId) return input.currentUserId;

  const url = new URL("https://slack.com/api/users.info");
  url.searchParams.set("user", input.slackUserId);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${input.botToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null) as SlackUsersInfoResponse | null;
  const email = body?.user?.profile?.email?.trim();
  if (!response.ok || !body?.ok || !email) return null;

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, orgId: input.orgId },
    select: { id: true },
  });
  if (!user) return null;

  try {
    await prisma.userSurfaceIdentity.create({
      data: {
        surfaceId: input.surfaceId,
        surfaceWorkspaceId: input.teamId,
        surfaceUserId: input.slackUserId,
        userId: user.id,
        orgId: input.orgId,
        status: "ACTIVE",
        linkedAt: new Date(),
        lastSeenAt: new Date(),
      },
    });
  } catch (error) {
    // A retry/race may have inserted the same unique identity. Only accept the
    // winning row when it resolves to this exact tenant user.
    const existing = await prisma.userSurfaceIdentity.findUnique({
      where: {
        surfaceId_surfaceWorkspaceId_surfaceUserId: {
          surfaceId: input.surfaceId,
          surfaceWorkspaceId: input.teamId,
          surfaceUserId: input.slackUserId,
        },
      },
      select: { userId: true, orgId: true, status: true },
    }).catch(() => null);
    if (!existing || existing.userId !== user.id || existing.orgId !== input.orgId || existing.status !== "ACTIVE") {
      throw error;
    }
  }
  return user.id;
}

async function processBoundSlackEvent(input: {
  event: {
    eventType: "APP_MENTIONED" | "DIRECT_MESSAGE";
    surfaceTenantId: string;
    surfaceUserId: string;
    channelId: string;
    threadId?: string;
    text: string;
    eventId: string;
    raw: unknown;
  };
  surfaceId: string;
  orgId: string;
  resolvedUserId: string | null;
  surfaceAgent: BoundSlackSurfaceAgent;
}): Promise<void> {
  const { event, surfaceAgent } = input;
  const botToken = slackBotTokenFromConfig(surfaceAgent.config, event.surfaceTenantId);
  if (!botToken) throw new Error(`Slack bot install missing for team ${event.surfaceTenantId}`);

  const rawEvent = slackEventRecord(event.raw);
  const eventTs = typeof rawEvent?.["ts"] === "string" ? rawEvent["ts"] : "";
  const threadRootTs = event.threadId ?? eventTs;
  if (!threadRootTs) throw new Error(`Slack event ${event.eventId} is missing ts`);

  const userId = await resolveSlackUserByEmail({
    currentUserId: input.resolvedUserId,
    surfaceId: input.surfaceId,
    orgId: input.orgId,
    teamId: event.surfaceTenantId,
    slackUserId: event.surfaceUserId,
    botToken,
  });
  if (!userId) {
    await postSlackMessage(botToken, {
      channel: event.channelId,
      threadTs: threadRootTs,
      text: "Your Slack account isn't linked to a Xyne Claw user yet — sign in to claw with your work email first",
    });
    return;
  }

  const install = objectPayload(objectPayload(surfaceAgent.config)?.["installs"])?.[event.surfaceTenantId];
  const botUserId = typeof objectPayload(install)?.["botUserId"] === "string"
    ? objectPayload(install)!["botUserId"] as string
    : "";
  const task = event.eventType === "APP_MENTIONED"
    ? stripSlackBotMention(event.text, botUserId)
    : event.text.trim();
  if (!task) return;

  const conversationId = slackConversationId(event.surfaceTenantId, event.channelId, threadRootTs);
  await dispatchSlackRun({
    agent: surfaceAgent.agent,
    surfaceAgentId: surfaceAgent.id,
    userId,
    task,
    conversationId,
    eventType: event.eventType,
    idempotencyKey: event.eventId,
    teamId: event.surfaceTenantId,
    channelId: event.channelId,
    threadRootTs,
    slackUserId: event.surfaceUserId,
    ...(eventTs ? { sourceMessageId: eventTs } : {}),
  });

  // Slack thread IDs are opaque conversation keys throughout the run/chat
  // repositories. Queueing is intentionally deferred for v1; each inbound gets
  // its own run session while deterministic conversationId preserves history.
  void postSlackMessage(botToken, {
    channel: event.channelId,
    threadTs: threadRootTs,
    text: `⏳ ${surfaceAgent.agent.name} is working on it…`,
  }).catch((error) => log.warn("[surfaces-slack] failed to post working acknowledgement", {
    error: error instanceof Error ? error.message : String(error),
  }));
}

/**
 * Deterministic per-thread conversation id. claw's /internal/run restricts
 * ids to [A-Za-z0-9_-] (they flow into filesystem paths and cleanup), so
 * Slack's ":"-separated ids and "."-form timestamps must be flattened.
 */
function slackConversationId(teamId: string, channelId: string, threadRootTs: string): string {
  return `slack-${teamId}-${channelId}-${threadRootTs.replace(/\./g, "_")}`;
}

/**
 * The one Slack run-dispatch path — mentions, DMs, and slash commands all go
 * through here so provider resolution, the session ctx, and the result
 * callback can never drift apart per entry point (the phase-4 parity lesson).
 */
async function dispatchSlackRun(input: {
  agent: { id: string; slug: string; orgId: string; config: unknown };
  surfaceAgentId: string;
  /** Slash-command runs reply via the umbrella app's bot token. */
  connectedSurfaceId?: string;
  userId: string;
  task: string;
  conversationId: string;
  eventType: "APP_MENTIONED" | "DIRECT_MESSAGE";
  idempotencyKey: string;
  teamId: string;
  channelId: string;
  threadRootTs: string;
  slackUserId: string;
  sourceMessageId?: string;
}): Promise<string> {
  const slackDelivery = {
    surfaceAgentId: input.surfaceAgentId,
    ...(input.connectedSurfaceId ? { connectedSurfaceId: input.connectedSurfaceId } : {}),
    teamId: input.teamId,
    channelId: input.channelId,
    threadTs: input.threadRootTs,
    slackUserId: input.slackUserId,
  };
  const providers = await resolveAgentProviderConfigs({
    id: input.agent.id,
    config: input.agent.config,
  });
  const response = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
    },
    // This mirrors the established mention dispatch contract. In particular,
    // provider resolution and the result callback must never be omitted.
    body: JSON.stringify({
      userId: input.userId,
      task: input.task,
      conversationId: input.conversationId,
      agentSlug: input.agent.slug,
      orgId: input.agent.orgId,
      eventType: input.eventType,
      triggerSource: "slack",
      idempotencyKey: input.idempotencyKey,
      progressUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`,
      channelId: input.channelId,
      slackDelivery,
      ...(providers.parent ? { provider: providers.parent } : {}),
      ...(providers.providerOrder.length > 1 ? { providerOrder: providers.providerOrder } : {}),
      ...(Object.keys(providers.providerConfigs).length > 0 ? { providerConfigs: providers.providerConfigs } : {}),
      subagentProviderMode: resolveSubagentProviderMode(input.agent.config),
      ...(input.agent.config ? { agentConfig: input.agent.config } : {}),
    }),
  });
  const body = await response.json().catch(() => null) as { success?: boolean; sessionId?: string; error?: string } | null;
  if (!response.ok || !body?.success || !body.sessionId) {
    throw new Error(`Slack run dispatch failed: ${body?.error ?? `HTTP ${response.status}`}`);
  }

  await setSession(body.sessionId, {
    mentionedUserId: input.userId,
    targetUserId: input.userId,
    senderId: input.userId,
    senderName: input.slackUserId,
    channelId: input.channelId,
    channelName: input.channelId,
    conversationId: input.conversationId,
    ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}),
    task: input.task,
    agentId: input.agent.id,
    agentOrgId: input.agent.orgId,
    agentSlug: input.agent.slug,
    responseMode: "conversation",
    appToken: "",
    spacesAppId: "",
    spacesAppUserId: "",
    rootAgentSlug: input.agent.slug,
    slackDelivery,
  });
  return body.sessionId;
}

// Slack command rules: 1-32 chars after the slash, lowercase letters, numbers,
// hyphens and underscores (Slack rejects anything fancier at manifest update).
const SLACK_COMMAND_RE = /^\/[a-z0-9][a-z0-9_-]{0,31}$/;

function slackCommandsUri(): string {
  return `${CONFIG.selfUrl.replace(/\/+$/, "")}/claw/api/v1/surfaces/slack/commands`;
}

/** The org's umbrella app: the workspace-installed org-level Slack app row
 *  (legacy Connect-Slack OAuth path) whose manifest carries the slash
 *  commands. Returns the ACTIVE team row with an appId in config. */
async function findUmbrellaApp(orgId: string, surfaceId: string): Promise<{
  connectionId: string;
  appId: string;
  teamId: string;
} | null> {
  const rows = await prisma.connectedSurface.findMany({
    where: { orgId, surfaceId, status: "ACTIVE", NOT: { surfaceTenantId: "" } },
    orderBy: { createdAt: "asc" },
  });
  for (const row of rows) {
    const config = objectPayload(row.config);
    const appId = typeof config?.["appId"] === "string" ? config["appId"].trim() : "";
    if (appId) return { connectionId: row.id, appId, teamId: row.surfaceTenantId };
  }
  return null;
}

interface SlackManifestExportResponse {
  ok?: boolean;
  error?: string;
  manifest?: Record<string, unknown>;
}

/**
 * Deleting a Slack app in the console emits no webhook, so stored per-agent
 * apps can silently die. Probe via apps.manifest.export with the org's config
 * token. Fail-open: without a usable token, or on transient errors, assume the
 * app exists (never mint duplicates because of a network blip).
 */
async function slackAppStillExists(orgId: string, surfaceId: string, appId: string): Promise<boolean> {
  try {
    const tokenRow = await prisma.connectedSurface.findUnique({
      where: { orgId_surfaceId_surfaceTenantId: { orgId, surfaceId, surfaceTenantId: "" } },
    });
    if (!tokenRow || !hasUsableSlackConfigToken(tokenRow)) return true;
    const accessToken = await rotateStoredSlackConfigToken(tokenRow.id);
    const response = await fetch("https://slack.com/api/apps.manifest.export", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: accessToken, app_id: appId }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => null) as SlackManifestExportResponse | null;
    if (body?.ok) return true;
    const error = body?.error ?? "";
    // Only these codes prove the app is gone/inaccessible; anything else is
    // treated as transient.
    return !["app_not_found", "invalid_app_id", "app_not_installed", "not_authorized"].includes(error);
  } catch {
    return true;
  }
}

/** Append (or replace) a slash command on the umbrella app's manifest via
 *  apps.manifest.export -> update, using the org's rotated config token. */
async function registerUmbrellaCommand(input: {
  configAccessToken: string;
  umbrellaAppId: string;
  commandName: string;
  description: string;
}): Promise<void> {
  const exportResponse = await fetch("https://slack.com/api/apps.manifest.export", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: input.configAccessToken, app_id: input.umbrellaAppId }),
    signal: AbortSignal.timeout(15_000),
  });
  const exported = await exportResponse.json().catch(() => null) as SlackManifestExportResponse | null;
  if (!exportResponse.ok || !exported?.ok || !exported.manifest) {
    throw new Error(`Slack manifest export failed: ${exported?.error ?? `HTTP ${exportResponse.status}`}`);
  }
  const manifest = exported.manifest;
  const features = objectPayload(manifest["features"]) ?? {};
  const existing = Array.isArray(features["slash_commands"]) ? features["slash_commands"] : [];
  const kept = existing.filter((entry) => objectPayload(entry)?.["command"] !== input.commandName);
  features["slash_commands"] = [
    ...kept,
    {
      command: input.commandName,
      url: slackCommandsUri(),
      description: input.description.slice(0, 2000),
      usage_hint: "<task for the agent>",
      should_escape: false,
    },
  ];
  manifest["features"] = features;
  const updateResponse = await fetch("https://slack.com/api/apps.manifest.update", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token: input.configAccessToken,
      app_id: input.umbrellaAppId,
      manifest: JSON.stringify(manifest),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const updated = await updateResponse.json().catch(() => null) as SlackManifestExportResponse | null;
  if (!updateResponse.ok || !updated?.ok) {
    throw new Error(`Slack manifest update failed: ${updated?.error ?? `HTTP ${updateResponse.status}`}`);
  }
}

function slackManifest(agent: { name: string; slug: string }): Record<string, unknown> {
  return {
    display_information: { name: agent.name },
    features: {
      bot_user: { display_name: agent.slug, always_online: true },
      app_home: { messages_tab_enabled: true, messages_tab_read_only_enabled: false },
    },
    oauth_config: {
      redirect_urls: [slackCallbackUri()],
      scopes: { bot: [...SLACK_SCOPES] },
    },
    settings: {
      event_subscriptions: {
        request_url: `${CONFIG.selfUrl.replace(/\/+$/, "")}/claw/api/v1/surfaces/slack/events`,
        bot_events: ["app_mention", "message.im"],
      },
      interactivity: { is_enabled: false },
      socket_mode_enabled: false,
    },
  };
}

router.post("/config-token", requireUserAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequesterId(req);
    const sessionOrgId = getOrgId(req);
    const body = objectPayload(req.body);
    const orgId = typeof body?.["orgId"] === "string" ? body["orgId"].trim() : sessionOrgId;
    const accessToken = typeof body?.["accessToken"] === "string" ? body["accessToken"].trim() : "";
    const refreshToken = typeof body?.["refreshToken"] === "string" ? body["refreshToken"].trim() : "";
    if (!userId || !sessionOrgId || !orgId) {
      res.status(401).json({ success: false, error: "Authenticated organization session required" });
      return;
    }
    if (sessionOrgId !== orgId || !(await isOrgAdmin(userId, orgId))) {
      res.status(403).json({ success: false, error: "Requires OWNER or ADMIN" });
      return;
    }
    if (!accessToken.startsWith("xoxe.xoxp-") || !refreshToken.startsWith("xoxe-1-")) {
      res.status(400).json({ success: false, error: "Enter a valid Slack app configuration access and refresh token pair" });
      return;
    }
    const surface = await prisma.surface.findUnique({ where: { key: "slack" } });
    if (!surface) {
      res.status(503).json({ success: false, error: "Slack surface is not initialized" });
      return;
    }
    const rotated = await rotateSlackRefreshToken(refreshToken);
    const existing = await prisma.connectedSurface.findUnique({
      where: { orgId_surfaceId_surfaceTenantId: { orgId, surfaceId: surface.id, surfaceTenantId: "" } },
    });
    const config = configWithRotatedTokens(existing?.config, rotated);
    await prisma.connectedSurface.upsert({
      where: { orgId_surfaceId_surfaceTenantId: { orgId, surfaceId: surface.id, surfaceTenantId: "" } },
      create: { orgId, surfaceId: surface.id, surfaceTenantId: "", config, status: "ACTIVE" },
      update: { config, status: "ACTIVE" },
    });
    res.json({ success: true, data: { configTokenStatus: "valid" } });
  } catch (error) {
    if (error instanceof SlackConfigTokenError) {
      res.status(400).json({ success: false, error: error.message });
      return;
    }
    log.error("[surfaces-slack] Configuration token connection failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    res.status(500).json({ success: false, error: "Failed to store Slack configuration token" });
  }
});

router.get("/agents/status", requireUserAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequesterId(req);
    const sessionOrgId = getOrgId(req);
    const requestedOrgId = typeof req.query["orgId"] === "string" ? req.query["orgId"].trim() : sessionOrgId;
    if (!userId || !sessionOrgId || !requestedOrgId) {
      res.status(401).json({ success: false, error: "Authenticated organization session required" });
      return;
    }
    const platformAdmin = await isClawAdmin(userId);
    if (!platformAdmin && (sessionOrgId !== requestedOrgId || !(await isOrgAdmin(userId, requestedOrgId)))) {
      res.status(403).json({ success: false, error: "Requires platform admin or organization OWNER/ADMIN" });
      return;
    }
    const surface = await prisma.surface.findUnique({ where: { key: "slack" } });
    if (!surface) {
      res.status(503).json({ success: false, error: "Slack surface is not initialized" });
      return;
    }
    const rows = await prisma.surfaceAgent.findMany({
      where: {
        surfaceId: surface.id,
        surfaceTenantId: "",
        agent: { orgId: requestedOrgId },
      },
      select: {
        id: true,
        config: true,
        agent: { select: { id: true, slug: true } },
      },
    });
    interface SlackAgentStatusEntry {
      agentId: string;
      agentSlug: string;
      appId: string;
      status: "command" | "created" | "installed";
      commandName?: string;
      installs: Array<{ teamId: string; teamName: string; installedAt: string }>;
      installUrl: string | null;
    }
    const data = rows.flatMap((row): SlackAgentStatusEntry[] => {
      const config = objectPayload(row.config);
      const appId = typeof config?.["appId"] === "string" ? config["appId"].trim() : "";
      const clientId = typeof config?.["clientId"] === "string" ? config["clientId"].trim() : "";
      const commandName = typeof config?.["commandName"] === "string" ? config["commandName"] : "";
      if (!appId || !clientId) {
        if (commandName) {
          // Command-only registration on the umbrella app — no dedicated app.
          return [{
            agentId: row.agent.id,
            agentSlug: row.agent.slug,
            appId: "",
            status: "command" as const,
            commandName,
            installs: [],
            installUrl: null,
          }];
        }
        log.warn(`[surfaces-slack] Skipping invalid per-agent Slack app state for agent ${row.agent.id}`);
        return [];
      }
      const storedInstalls = objectPayload(config?.["installs"]) ?? {};
      const installs = Object.entries(storedInstalls).flatMap(([teamId, value]) => {
        const install = objectPayload(value);
        const teamName = typeof install?.["teamName"] === "string" ? install["teamName"] : "";
        const installedAt = typeof install?.["installedAt"] === "string" ? install["installedAt"] : "";
        return teamId && teamName && installedAt ? [{ teamId, teamName, installedAt }] : [];
      });
      return [{
        agentId: row.agent.id,
        agentSlug: row.agent.slug,
        appId,
        status: installs.length > 0 || config?.["status"] === "installed" ? "installed" as const : "created" as const,
        ...(commandName ? { commandName } : {}),
        installs,
        installUrl: createAgentInstallUrl({
          orgId: requestedOrgId,
          userId,
          surfaceAgentId: row.id,
          clientId,
        }) as string | null,
      }];
    });
    res.json({ success: true, data });
  } catch (error) {
    log.error("[surfaces-slack] Per-agent Slack app status failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    res.status(500).json({ success: false, error: "Failed to load Slack app status" });
  }
});

router.post("/agents/:slug/create-app", requireUserAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequesterId(req);
    const sessionOrgId = getOrgId(req);
    if (!userId || !sessionOrgId) {
      res.status(401).json({ success: false, error: "Authenticated organization session required" });
      return;
    }
    const body = objectPayload(req.body);
    const requestedOrgId = typeof body?.["orgId"] === "string" ? body["orgId"].trim() : sessionOrgId;
    const slug = typeof req.params["slug"] === "string" ? req.params["slug"] : "";
    const agent = await prisma.agent.findFirst({
      where: { slug, orgId: requestedOrgId },
      select: { id: true, slug: true, name: true, orgId: true },
    });
    if (!agent) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    const platformAdmin = await isClawAdmin(userId);
    if (!platformAdmin && (sessionOrgId !== agent.orgId || !(await isOrgAdmin(userId, agent.orgId)))) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    const surface = await prisma.surface.findUnique({ where: { key: "slack" } });
    if (!surface) {
      res.status(503).json({ success: false, error: "Slack surface is not initialized" });
      return;
    }
    const recreate = body?.["recreate"] === true;
    const existingSurfaceAgent = await prisma.surfaceAgent.findUnique({
      where: {
        agentId_surfaceId_surfaceTenantId: {
          agentId: agent.id,
          surfaceId: surface.id,
          surfaceTenantId: "",
        },
      },
      select: { id: true, config: true },
    });
    const existingConfig = objectPayload(existingSurfaceAgent?.config);
    const existingAppId = typeof existingConfig?.["appId"] === "string" ? existingConfig["appId"].trim() : "";
    const existingClientId = typeof existingConfig?.["clientId"] === "string" ? existingConfig["clientId"].trim() : "";
    if (existingSurfaceAgent && existingAppId && !recreate) {
      if (!existingClientId) {
        log.error(`[surfaces-slack] Existing per-agent Slack app ${existingAppId} is missing its client ID`);
        res.status(500).json({ success: false, error: "Existing Slack app state is incomplete" });
        return;
      }
      // Deleting an app in the Slack console emits no webhook — verify the app
      // still exists before reusing it, else fall through and mint a fresh one.
      const stillExists = await slackAppStillExists(agent.orgId, surface.id, existingAppId);
      if (stillExists) {
        res.json({
          success: true,
          data: {
            appId: existingAppId,
            installUrl: createAgentInstallUrl({
              orgId: agent.orgId,
              userId,
              surfaceAgentId: existingSurfaceAgent.id,
              clientId: existingClientId,
            }),
            reused: true,
          },
        });
        return;
      }
      log.warn(`[surfaces-slack] Stored Slack app ${existingAppId} no longer exists — recreating`);
    }
    if (recreate && existingAppId) {
      log.warn(`[surfaces-slack] Replacing per-agent Slack app ${existingAppId}`);
    }
    const connection = await prisma.connectedSurface.findUnique({
      where: {
        orgId_surfaceId_surfaceTenantId: {
          orgId: agent.orgId,
          surfaceId: surface.id,
          surfaceTenantId: "",
        },
      },
    });
    if (!connection || !hasUsableSlackConfigToken(connection)) {
      res.status(503).json({ success: false, error: "Connect Slack with an app configuration token first" });
      return;
    }
    let configAccessToken: string;
    try {
      configAccessToken = await rotateStoredSlackConfigToken(connection.id);
    } catch (error) {
      if (error instanceof SlackConfigTokenError) {
        res.status(503).json({ success: false, error: "Connect Slack with an app configuration token first" });
        return;
      }
      throw error;
    }
    const manifestResponse = await fetch("https://slack.com/api/apps.manifest.create", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: configAccessToken,
        manifest: JSON.stringify(slackManifest(agent)),
      }),
    });
    const manifest = await manifestResponse.json().catch(() => null) as SlackManifestResponse | null;
    const appId = manifest?.app_id?.trim() ?? "";
    const clientId = manifest?.credentials?.client_id?.trim() ?? "";
    const clientSecret = manifest?.credentials?.client_secret?.trim() ?? "";
    const signingSecret = manifest?.credentials?.signing_secret?.trim() ?? "";
    if (!manifestResponse.ok || !manifest?.ok || !appId || !clientId || !clientSecret || !signingSecret) {
      log.warn(`[surfaces-slack] Slack manifest creation failed: ${manifest?.error ?? manifestResponse.status}`);
      res.status(502).json({ success: false, error: `Slack app creation failed${manifest?.error ? `: ${manifest.error}` : ""}` });
      return;
    }
    const surfaceAgent = await prisma.surfaceAgent.upsert({
      where: {
        agentId_surfaceId_surfaceTenantId: {
          agentId: agent.id,
          surfaceId: surface.id,
          surfaceTenantId: "",
        },
      },
      create: {
        agentId: agent.id,
        surfaceId: surface.id,
        surfaceTenantId: "",
        signingSecret: encryptSurfaceSecret(signingSecret),
        config: {
          appId,
          clientId,
          clientSecret: encryptSurfaceSecret(clientSecret),
          status: "created",
          createdByUserId: userId,
        },
      },
      update: {
        signingSecret: encryptSurfaceSecret(signingSecret),
        // Merge, don't replace: a command-only registration (commandName /
        // commandAppId fields) must survive the agent later getting its own app.
        config: {
          ...(existingConfig ?? {}),
          appId,
          clientId,
          clientSecret: encryptSurfaceSecret(clientSecret),
          status: "created",
          createdByUserId: userId,
        },
      },
    });
    const installUrl = createAgentInstallUrl({
      orgId: agent.orgId,
      userId,
      surfaceAgentId: surfaceAgent.id,
      clientId,
    });
    res.json({ success: true, data: { appId, installUrl, reused: false } });
  } catch (error) {
    log.error("[surfaces-slack] Per-agent Slack app creation failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    res.status(500).json({ success: false, error: "Failed to create Slack app" });
  }
});

router.delete("/agents/:slug/slack-app", requireUserAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequesterId(req);
    const sessionOrgId = getOrgId(req);
    if (!userId || !sessionOrgId) {
      res.status(401).json({ success: false, error: "Authenticated organization session required" });
      return;
    }
    const requestedOrgId = typeof req.query["orgId"] === "string" && req.query["orgId"].trim()
      ? req.query["orgId"].trim()
      : sessionOrgId;
    const slug = typeof req.params["slug"] === "string" ? req.params["slug"] : "";
    const agent = await prisma.agent.findFirst({
      where: { slug, orgId: requestedOrgId },
      select: { id: true, orgId: true },
    });
    if (!agent) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    const platformAdmin = await isClawAdmin(userId);
    if (!platformAdmin && (sessionOrgId !== agent.orgId || !(await isOrgAdmin(userId, agent.orgId)))) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    const surface = await prisma.surface.findUnique({ where: { key: "slack" } });
    if (!surface) {
      res.status(503).json({ success: false, error: "Slack surface is not initialized" });
      return;
    }
    // Forget the stored registration (app credentials, installs, command
    // binding). This does NOT delete the app on Slack's side — the console is
    // the source of truth there; this clears claw's mirror of it.
    await prisma.surfaceAgent.deleteMany({
      where: { agentId: agent.id, surfaceId: surface.id, surfaceTenantId: "" },
    });
    log.info(`[surfaces-slack] cleared Slack registration for agent ${slug}`);
    res.json({ success: true, data: { removed: true } });
  } catch (error) {
    log.error("[surfaces-slack] Slack registration removal failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    res.status(500).json({ success: false, error: "Failed to remove Slack registration" });
  }
});

router.post("/agents/:slug/register-command", requireUserAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequesterId(req);
    const sessionOrgId = getOrgId(req);
    if (!userId || !sessionOrgId) {
      res.status(401).json({ success: false, error: "Authenticated organization session required" });
      return;
    }
    const body = objectPayload(req.body);
    const requestedOrgId = typeof body?.["orgId"] === "string" ? body["orgId"].trim() : sessionOrgId;
    const slug = typeof req.params["slug"] === "string" ? req.params["slug"] : "";
    const agent = await prisma.agent.findFirst({
      where: { slug, orgId: requestedOrgId },
      select: { id: true, slug: true, name: true, orgId: true },
    });
    if (!agent) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    const platformAdmin = await isClawAdmin(userId);
    if (!platformAdmin && (sessionOrgId !== agent.orgId || !(await isOrgAdmin(userId, agent.orgId)))) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    const requestedCommand = typeof body?.["commandName"] === "string" && body["commandName"].trim()
      ? body["commandName"].trim()
      : `/${agent.slug}`;
    const commandName = requestedCommand.startsWith("/") ? requestedCommand : `/${requestedCommand}`;
    if (!SLACK_COMMAND_RE.test(commandName)) {
      res.status(400).json({
        success: false,
        error: "commandName must be /name with 1-32 lowercase letters, numbers, hyphens or underscores",
      });
      return;
    }
    const surface = await prisma.surface.findUnique({ where: { key: "slack" } });
    if (!surface) {
      res.status(503).json({ success: false, error: "Slack surface is not initialized" });
      return;
    }
    // One command name maps to exactly one agent per org.
    const conflicting = await prisma.surfaceAgent.findFirst({
      where: {
        surfaceId: surface.id,
        agentId: { not: agent.id },
        agent: { orgId: agent.orgId },
        config: { path: ["commandName"], equals: commandName },
      },
      select: { agent: { select: { slug: true } } },
    });
    if (conflicting) {
      res.status(409).json({
        success: false,
        error: `${commandName} is already registered for ${conflicting.agent.slug}`,
      });
      return;
    }
    const umbrella = await findUmbrellaApp(agent.orgId, surface.id);
    if (!umbrella) {
      res.status(503).json({
        success: false,
        error: "No workspace-installed Slack app found for this organization — connect Slack first",
      });
      return;
    }
    const tokenRow = await prisma.connectedSurface.findUnique({
      where: {
        orgId_surfaceId_surfaceTenantId: {
          orgId: agent.orgId,
          surfaceId: surface.id,
          surfaceTenantId: "",
        },
      },
    });
    if (!tokenRow || !hasUsableSlackConfigToken(tokenRow)) {
      res.status(503).json({ success: false, error: "Connect Slack with an app configuration token first" });
      return;
    }
    let configAccessToken: string;
    try {
      configAccessToken = await rotateStoredSlackConfigToken(tokenRow.id);
    } catch (error) {
      if (error instanceof SlackConfigTokenError) {
        res.status(503).json({ success: false, error: "Connect Slack with an app configuration token first" });
        return;
      }
      throw error;
    }
    await registerUmbrellaCommand({
      configAccessToken,
      umbrellaAppId: umbrella.appId,
      commandName,
      description: `Ask ${agent.name}`,
    });
    const existing = await prisma.surfaceAgent.findUnique({
      where: {
        agentId_surfaceId_surfaceTenantId: {
          agentId: agent.id,
          surfaceId: surface.id,
          surfaceTenantId: "",
        },
      },
      select: { config: true },
    });
    const mergedConfig = {
      ...(objectPayload(existing?.config) ?? {}),
      commandName,
      commandAppId: umbrella.appId,
      commandConnectedSurfaceId: umbrella.connectionId,
      commandRegisteredByUserId: userId,
    } as Prisma.InputJsonObject;
    await prisma.surfaceAgent.upsert({
      where: {
        agentId_surfaceId_surfaceTenantId: {
          agentId: agent.id,
          surfaceId: surface.id,
          surfaceTenantId: "",
        },
      },
      create: {
        agentId: agent.id,
        surfaceId: surface.id,
        surfaceTenantId: "",
        config: mergedConfig,
      },
      update: { config: mergedConfig },
    });
    log.info(`[surfaces-slack] registered command ${commandName} -> ${agent.slug} on app ${umbrella.appId}`);
    res.json({ success: true, data: { commandName, appId: umbrella.appId } });
  } catch (error) {
    log.error("[surfaces-slack] Slash-command registration failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ success: false, error: "Failed to register Slack command" });
  }
});

router.post("/commands", async (req: Request, res: Response) => {
  try {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const adapter = getSurfaceAdapter("slack");
    const payload = objectPayload(req.body);
    if (!payload || !rawBody || !adapter) {
      res.status(adapter ? 401 : 500).json({ success: false, error: "Unauthorized" });
      return;
    }
    const field = (name: string): string => typeof payload[name] === "string" ? (payload[name] as string).trim() : "";
    const teamId = field("team_id");
    const command = field("command");
    if (!teamId || !command) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    const tenant = await resolveSurfaceTenant("slack", teamId);
    // Commands are signed with the UMBRELLA app's signing secret: env secret
    // (manually-created org apps) or the secret snapshot stored at
    // Connect-Slack time on the team row.
    let verified = false;
    const envSecret = process.env["SLACK_SIGNING_SECRET"]?.trim();
    if (envSecret) verified = adapter.verifySignature(rawBody, req.headers, envSecret);
    if (!verified) {
      const connectedSecret = getConnectedSurfaceSigningSecret(tenant.connectedSurface);
      if (connectedSecret) verified = adapter.verifySignature(rawBody, req.headers, connectedSecret);
    }
    if (!verified) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    const surfaceAgent = await prisma.surfaceAgent.findFirst({
      where: {
        surfaceId: tenant.surface.id,
        agent: { orgId: tenant.connectedSurface.orgId },
        config: { path: ["commandName"], equals: command },
      },
      include: { agent: { select: { id: true, slug: true, name: true, orgId: true, config: true } } },
    });
    if (!surfaceAgent) {
      res.json({ response_type: "ephemeral", text: `No agent is registered for ${command} yet.` });
      return;
    }
    // Slack's 3-second deadline: acknowledge ephemerally, then work async.
    res.json({ response_type: "ephemeral", text: `⏳ Dispatching to ${surfaceAgent.agent.name}…` });
    void processSlackCommand({
      tenant,
      surfaceAgent: surfaceAgent as unknown as BoundSlackSurfaceAgent & { agent: { name: string } },
      teamId,
      channelId: field("channel_id"),
      slackUserId: field("user_id"),
      text: field("text"),
      responseUrl: field("response_url"),
      triggerId: field("trigger_id"),
    }).catch((error) => {
      log.error("[surfaces-slack] asynchronous command dispatch failed", {
        command,
        error: error instanceof Error ? error.message : String(error),
      });
      const responseUrl = field("response_url");
      if (responseUrl) {
        void fetch(responseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            response_type: "ephemeral",
            text: "Something went wrong dispatching this to the agent — please retry",
          }),
          signal: AbortSignal.timeout(10_000),
        }).catch(() => undefined);
      }
    });
  } catch (err) {
    if (err instanceof SurfaceResolverError && (err.code === "UNKNOWN_TENANT" || err.code === "UNKNOWN_SURFACE")) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    log.error("[surfaces-slack] Slash-command handling failed", {
      errorType: err instanceof Error ? err.name : "UnknownError",
    });
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

async function processSlackCommand(input: {
  tenant: Awaited<ReturnType<typeof resolveSurfaceTenant>>;
  surfaceAgent: BoundSlackSurfaceAgent;
  teamId: string;
  channelId: string;
  slackUserId: string;
  text: string;
  responseUrl: string;
  triggerId: string;
}): Promise<void> {
  const { tenant, surfaceAgent } = input;
  const task = input.text.trim();
  const config = objectPayload(surfaceAgent.config);
  const connectedSurfaceId = typeof config?.["commandConnectedSurfaceId"] === "string"
    ? config["commandConnectedSurfaceId"]
    : tenant.connectedSurface.id;
  const botToken = await connectedSurfaceBotToken(connectedSurfaceId);
  if (!botToken) throw new Error(`Umbrella Slack bot token missing for team ${input.teamId}`);
  if (!task) {
    await postSlackMessage(botToken, {
      channel: input.channelId,
      text: `Usage: give the command a task, e.g. \`${config?.["commandName"] ?? "/agent"} summarise today's errors\``,
    });
    return;
  }

  // Echo the ask in-channel (command invocations are invisible otherwise) —
  // the echo message becomes the thread root for the reply + follow-ups.
  const echo = await postSlackMessage(botToken, {
    channel: input.channelId,
    text: `💬 <@${input.slackUserId}> → *${surfaceAgent.agent.name}*: ${task}`,
  });
  const threadRootTs = echo.ts;
  if (!threadRootTs) throw new Error("Slack echo post returned no ts");

  const resolved = await resolveInboundForTenant(tenant, input.slackUserId, {
    surfaceAgentId: surfaceAgent.id,
    agentId: surfaceAgent.agent.id,
    agentSlug: surfaceAgent.agent.slug,
  });
  const userId = await resolveSlackUserByEmail({
    currentUserId: resolved.userId,
    surfaceId: tenant.surface.id,
    orgId: tenant.connectedSurface.orgId,
    teamId: input.teamId,
    slackUserId: input.slackUserId,
    botToken,
  });
  if (!userId) {
    await postSlackMessage(botToken, {
      channel: input.channelId,
      threadTs: threadRootTs,
      text: "Your Slack account isn't linked to a Xyne Claw user yet — sign in to claw with your work email first",
    });
    return;
  }

  const conversationId = slackConversationId(input.teamId, input.channelId, threadRootTs);
  await dispatchSlackRun({
    agent: surfaceAgent.agent,
    surfaceAgentId: surfaceAgent.id,
    connectedSurfaceId,
    userId,
    task,
    conversationId,
    eventType: "APP_MENTIONED",
    idempotencyKey: `slash:${input.teamId}:${input.channelId}:${threadRootTs}`,
    teamId: input.teamId,
    channelId: input.channelId,
    threadRootTs,
    slackUserId: input.slackUserId,
    sourceMessageId: threadRootTs,
  });
}

router.get("/oauth/start", requireUserAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequesterId(req);
    const sessionOrgId = getOrgId(req);
    const requestedOrgId = typeof req.query["orgId"] === "string" ? req.query["orgId"].trim() : "";
    const orgId = requestedOrgId || sessionOrgId;
    if (!userId || !orgId) {
      res.status(401).json({ success: false, error: "Authenticated organization session required" });
      return;
    }
    if (sessionOrgId !== orgId || !(await isOrgAdmin(userId, orgId))) {
      res.status(403).json({ success: false, error: "Requires OWNER or ADMIN" });
      return;
    }

    const credentials = slackCredentials();
    if (!credentials) {
      res.status(503).json({
        success: false,
        error: "Slack OAuth is not configured: SLACK_CLIENT_ID and SLACK_CLIENT_SECRET are required",
      });
      return;
    }

    const state = createOAuthState({ orgId, userId });

    const authorizeUrl = new URL("https://slack.com/oauth/v2/authorize");
    authorizeUrl.searchParams.set("client_id", credentials.clientId);
    authorizeUrl.searchParams.set("scope", SLACK_SCOPES.join(","));
    authorizeUrl.searchParams.set("redirect_uri", slackCallbackUri());
    authorizeUrl.searchParams.set("state", state);
    res.redirect(authorizeUrl.toString());
  } catch (err) {
    log.error("[surfaces-slack] OAuth start failed:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.get("/oauth/callback", async (req: Request, res: Response) => {
  const state = takeOAuthState(req.query["state"]);
  if (!state) {
    res.status(400).json({ success: false, error: "Invalid or expired Slack OAuth state" });
    return;
  }

  const oauthError = typeof req.query["error"] === "string" ? req.query["error"] : "";
  if (oauthError) {
    res.redirect(frontendOrganizationUrl("slack_error", oauthError));
    return;
  }
  const code = typeof req.query["code"] === "string" ? req.query["code"].trim() : "";
  if (!code) {
    res.redirect(frontendOrganizationUrl("slack_error", "missing_authorization_code"));
    return;
  }

  try {
    let credentials = slackCredentials();
    let perAgent: Prisma.SurfaceAgentGetPayload<{
      include: { agent: { select: { orgId: true; slug: true } } };
    }> | null = null;
    if (state.surfaceAgentId) {
      perAgent = await prisma.surfaceAgent.findUnique({
        where: { id: state.surfaceAgentId },
        include: { agent: { select: { orgId: true, slug: true } } },
      });
      const config = objectPayload(perAgent?.config);
      const clientId = typeof config?.["clientId"] === "string" ? config["clientId"] : "";
      const encryptedClientSecret = typeof config?.["clientSecret"] === "string" ? config["clientSecret"] : "";
      if (!perAgent || perAgent.agent?.orgId !== state.orgId || !clientId || !encryptedClientSecret) {
        res.redirect(frontendOrganizationUrl("slack_error", "invalid_surface_agent"));
        return;
      }
      credentials = {
        clientId,
        clientSecret: decryptSurfaceSecret(encryptedClientSecret, "Slack client secret"),
      };
    }
    if (!credentials) {
      res.redirect(frontendOrganizationUrl("slack_error", "slack_oauth_not_configured"));
      return;
    }
    const tokenResponse = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        code,
        redirect_uri: slackCallbackUri(),
      }),
    });
    const tokens = await tokenResponse.json().catch(() => null) as SlackOAuthResponse | null;
    if (!tokenResponse.ok || !tokens?.ok) {
      log.warn(`[surfaces-slack] Slack token exchange failed: ${tokens?.error ?? tokenResponse.status}`);
      res.redirect(frontendOrganizationUrl("slack_error", tokens?.error ?? "token_exchange_failed"));
      return;
    }

    const teamId = tokens.team?.id?.trim() ?? "";
    const teamName = tokens.team?.name?.trim() ?? "";
    const accessToken = tokens.access_token?.trim() ?? "";
    const botUserId = tokens.bot_user_id?.trim() ?? "";
    const appId = tokens.app_id?.trim() ?? "";
    if (!teamId || !teamName || !accessToken.startsWith("xoxb-") || !botUserId || !appId) {
      res.redirect(frontendOrganizationUrl("slack_error", "invalid_oauth_response"));
      return;
    }

    const surface = await prisma.surface.findUnique({ where: { key: "slack" } });
    if (!surface) {
      log.error("[surfaces-slack] Slack Surface catalog row is missing");
      res.redirect(frontendOrganizationUrl("slack_error", "slack_surface_not_initialized"));
      return;
    }

    const workspaceConnections = await prisma.connectedSurface.findMany({
      where: { surfaceId: surface.id, surfaceTenantId: teamId, status: "ACTIVE" },
      select: { orgId: true, config: true },
    });
    if (workspaceConnections.some((connection) => connection.orgId !== state.orgId)) {
      log.warn(`[surfaces-slack] rejected workspace ${teamId}: owned by another organization`);
      res.redirect(frontendOrganizationUrl("slack_error", "workspace_connected_to_another_organization"));
      return;
    }

    if (perAgent) {
      const currentConfig = objectPayload(perAgent.config) ?? {};
      const currentInstalls = objectPayload(currentConfig["installs"]) ?? {};
      const install = {
        encryptedBotToken: encryptSurfaceSecret(accessToken),
        teamName,
        botUserId,
        installedByUserId: state.userId,
        installedAt: new Date().toISOString(),
      };
      const existingWorkspace = workspaceConnections.find((connection) => connection.orgId === state.orgId);
      const existingWorkspaceConfig = objectPayload(existingWorkspace?.config) ?? {};
      await prisma.$transaction([
        prisma.connectedSurface.upsert({
          where: {
            orgId_surfaceId_surfaceTenantId: {
              orgId: state.orgId,
              surfaceId: surface.id,
              surfaceTenantId: teamId,
            },
          },
          create: {
            orgId: state.orgId,
            surfaceId: surface.id,
            surfaceTenantId: teamId,
            config: { ...existingWorkspaceConfig, teamName },
            status: "ACTIVE",
          },
          update: {
            config: { ...existingWorkspaceConfig, teamName },
            status: "ACTIVE",
          },
        }),
        prisma.surfaceAgent.update({
          where: { id: perAgent.id },
          data: {
            config: {
              ...currentConfig,
              appId,
              status: "installed",
              installs: { ...currentInstalls, [teamId]: install },
            } as Prisma.InputJsonObject,
          },
        }),
      ]);
      log.info(`[surfaces-slack] installed per-agent app ${appId} for org ${state.orgId}`);
      res.redirect(frontendOrganizationUrl("slack_connected", "true"));
      return;
    }

    const signingSecret = process.env["SLACK_SIGNING_SECRET"]?.trim();
    const existingWorkspace = workspaceConnections.find((connection) => connection.orgId === state.orgId);
    const existingConfig = objectPayload(existingWorkspace?.config);
    const existingSigningSecret = existingConfig?.["signingSecret"];
    const encryptedAccessToken = encryptSurfaceSecret(accessToken);
    const encryptedSigningSecret = signingSecret
      ? encryptSurfaceSecret(signingSecret)
      : typeof existingSigningSecret === "string" ? existingSigningSecret : undefined;
    const config = {
      teamName,
      botUserId,
      appId,
      installedByUserId: state.userId,
      ...(encryptedSigningSecret ? { signingSecret: encryptedSigningSecret } : {}),
    };
    await prisma.connectedSurface.upsert({
      where: {
        orgId_surfaceId_surfaceTenantId: {
          orgId: state.orgId,
          surfaceId: surface.id,
          surfaceTenantId: teamId,
        },
      },
      create: {
        orgId: state.orgId,
        surfaceId: surface.id,
        surfaceTenantId: teamId,
        accessToken: encryptedAccessToken,
        config,
        status: "ACTIVE",
      },
      update: {
        accessToken: encryptedAccessToken,
        config,
        status: "ACTIVE",
      },
    });

    log.info(`[surfaces-slack] connected workspace ${teamId} to org ${state.orgId}`);
    res.redirect(frontendOrganizationUrl("slack_connected", "true"));
  } catch (err) {
    log.error("[surfaces-slack] OAuth callback failed", {
      errorType: err instanceof Error ? err.name : "UnknownError",
    });
    res.redirect(frontendOrganizationUrl("slack_error", "connection_failed"));
  }
});

router.post("/events", async (req: Request, res: Response) => {
  let claimedEventKey: string | null = null;
  try {
    const payload = objectPayload(req.body);
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const adapter = getSurfaceAdapter("slack");
    if (!payload || !rawBody || !adapter) {
      res.status(adapter ? 401 : 500).json({ success: false, error: "Unauthorized" });
      return;
    }

    if (payload["type"] === "url_verification" && typeof payload["challenge"] === "string") {
      let verified = false;
      const appSecret = process.env["SLACK_SIGNING_SECRET"]?.trim();
      if (appSecret) verified = adapter.verifySignature(rawBody, req.headers, appSecret);
      if (!verified) {
        const apiAppId = typeof payload["api_app_id"] === "string" ? payload["api_app_id"].trim() : "";
        const verifyCandidates = async (where: Prisma.SurfaceAgentWhereInput): Promise<boolean> => {
          const candidates = await prisma.surfaceAgent.findMany({
            where,
            select: { signingSecret: true },
          });
          for (const candidate of candidates) {
            if (!candidate.signingSecret) continue;
            try {
              const secret = decryptSurfaceSecret(candidate.signingSecret, "Slack signing secret");
              if (adapter.verifySignature(rawBody, req.headers, secret)) return true;
            } catch {
              // A malformed row must not prevent another per-agent secret from matching.
            }
          }
          return false;
        };
        verified = await verifyCandidates({
          signingSecret: { not: null },
          ...(apiAppId ? { config: { path: ["appId"], equals: apiAppId } } : {}),
        });
        if (!verified && apiAppId) {
          verified = await verifyCandidates({ signingSecret: { not: null } });
        }
      }
      if (!verified) {
        res.status(401).json({ success: false, error: "Unauthorized" });
        return;
      }
      res.json({ challenge: payload["challenge"] });
      return;
    }

    const surfaceTenantId = typeof payload["team_id"] === "string" ? payload["team_id"] : null;
    if (!surfaceTenantId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    const tenant = await resolveSurfaceTenant("slack", surfaceTenantId);
    const apiAppId = typeof payload["api_app_id"] === "string" ? payload["api_app_id"].trim() : "";
    const surfaceAgent = apiAppId
      ? await prisma.surfaceAgent.findFirst({
        where: { surfaceId: tenant.surface.id, config: { path: ["appId"], equals: apiAppId } },
        include: { agent: { select: { id: true, slug: true, name: true, orgId: true, config: true } } },
      })
      : null;
    if (surfaceAgent && surfaceAgent.agent.orgId !== tenant.connectedSurface.orgId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    let verified = false;
    if (surfaceAgent?.signingSecret) {
      try {
        verified = adapter.verifySignature(
          rawBody,
          req.headers,
          decryptSurfaceSecret(surfaceAgent.signingSecret, "Slack signing secret"),
        );
      } catch {
        verified = false;
      }
    }
    const envSecret = process.env["SLACK_SIGNING_SECRET"]?.trim();
    if (!verified && envSecret) verified = adapter.verifySignature(rawBody, req.headers, envSecret);
    if (!verified) {
      const connectedSecret = getConnectedSurfaceSigningSecret(tenant.connectedSurface);
      if (connectedSecret) verified = adapter.verifySignature(rawBody, req.headers, connectedSecret);
    }
    if (!verified) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }


    const event = adapter.parseInbound(payload);
    if (!event) {
      res.sendStatus(200);
      return;
    }
    claimedEventKey = `${event.surfaceTenantId}:${event.eventId}`;
    if (isDuplicate(claimedEventKey)) {
      claimedEventKey = null;
      res.sendStatus(200);
      return;
    }
    const resolved = await resolveInboundForTenant(
      tenant,
      event.surfaceUserId,
      surfaceAgent ? {
        surfaceAgentId: surfaceAgent.id,
        agentId: surfaceAgent.agent.id,
        agentSlug: surfaceAgent.agent.slug,
      } : undefined,
    );
    log.info(
      `[surfaces-slack] resolved event=${event.eventId} tenant=${event.surfaceTenantId} org=${resolved.orgId} user=${resolved.userId ?? "(public-only)"} publicOnly=${resolved.publicOnly}`,
    );
    res.sendStatus(200);
    if (surfaceAgent && (event.eventType === "APP_MENTIONED" || event.eventType === "DIRECT_MESSAGE")) {
      // Slack's three-second deadline ends here. Identity auto-link, provider
      // resolution and run dispatch all happen after the response is committed.
      void processBoundSlackEvent({
        event,
        surfaceId: tenant.surface.id,
        orgId: tenant.connectedSurface.orgId,
        resolvedUserId: resolved.userId,
        surfaceAgent: surfaceAgent as BoundSlackSurfaceAgent,
      }).catch(async (error) => {
        log.error("[surfaces-slack] asynchronous event dispatch failed", {
          eventId: event.eventId,
          error: error instanceof Error ? error.message : String(error),
        });
        try {
          const botToken = slackBotTokenFromConfig(surfaceAgent.config, event.surfaceTenantId);
          const rawEvent = slackEventRecord(event.raw);
          const eventTs = typeof rawEvent?.["ts"] === "string" ? rawEvent["ts"] : "";
          const threadTs = event.threadId ?? eventTs;
          if (botToken && threadTs) {
            await postSlackMessage(botToken, {
              channel: event.channelId,
              threadTs,
              text: "Something went wrong dispatching this to the agent — please retry",
            });
          }
        } catch (replyError) {
          log.warn("[surfaces-slack] failed to post dispatch failure reply", {
            eventId: event.eventId,
            error: replyError instanceof Error ? replyError.message : String(replyError),
          });
        }
      });
    }
  } catch (err) {
    // Do not poison retries when processing the authenticated event failed.
    if (claimedEventKey) seenEvents.delete(claimedEventKey);
    if (err instanceof SurfaceResolverError && (err.code === "UNKNOWN_TENANT" || err.code === "UNKNOWN_SURFACE")) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    if (err instanceof SurfaceResolverError && err.code === "INVALID_SIGNING_SECRET") {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    log.error("[surfaces-slack] inbound event failed:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export const surfacesSlackRouter = router;
