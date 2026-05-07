/**
 * Webhook handler for Xyne Spaces app events.
 *
 * POST /webhook       — receives USER_MENTIONED events, starts xyne-claw for the mentioned user
 * POST /webhook/result — callback from xyne-claw, sends result to mentioned user's DM with approve/decline
 */

import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { CONFIG } from "../config.js";
import {
  agentRepository,
  userRepository,
  userAgentConfigRepository,
  userProviderCredentialsRepository,
  userSubagentConfigRepository,
  agentShareRepository,
  agentRunRepository,
  chatMessageRepository,
} from "../repositories/index.js";
import { extractCodexBearer } from "../lib/codex-creds.js";
import { createTraceId, createLogger } from "../logger.js";
import { decrypt } from "../crypto.js";
import { prisma } from "../db.js";
import { redisService } from "../redis.js";
import { UNREGISTERED_USER_TEMPLATE } from "../constants.js";
import {
  registerRunRecovery,
  touchRunRecovery,
  handleRunCompletion,
  getRecoveryContextForSession,
} from "../queue/run-recovery-worker.js";
import { appendCitations } from "../lib/citations.js";

// Feature flag: when Spaces has the XYNE-12145 fix deployed
// (POST /api/apps/chat/agentProgress with the authenticateApp middleware), flip
// this to "true" to use the ephemeral <AgentSpinner /> signal path. Default
// false: claw posts a real placeholder message and edits it in-place — works
// on every Spaces version. Once the Spaces fix is live in prod, set
// SPACES_SUPPORTS_AGENT_PROGRESS=true in the deployment env, no code change.
const USE_EPHEMERAL_PROGRESS = true;

// Per-process dedup for the one-shot sandbox preview announce. Claw also
// guards against re-emit on its side; this Set is the second layer in case
// run-recovery re-delivers the same payload.
const announcedSandboxPreviews = new Set<string>();

const router = Router();

// ── Agent Chain Config Types ────────────────────────────────────────

interface ChainConditions {
  /** Tools that MUST have been called for the chain to trigger */
  toolsMustInclude?: string[];
  /** Tools that must NOT have been called (e.g. skip chain if error-related tool ran) */
  toolsMustExclude?: string[];
}

interface ChainOnComplete {
  /** Slug of the agent to trigger next */
  triggerAgent: string;
  /** Task template for the next agent. Supports {{result}} and {{agentSlug}} */
  task: string;
  /** Instructions for the LLM judge on when to CONTINUE vs STOP */
  judgeContext?: string;
  /** Deterministic conditions that must pass before triggering */
  conditions?: ChainConditions;
}

interface ChainOnFailure {
  /** Agent to trigger on failure, or null to do nothing */
  triggerAgent?: string | null;
  /** If true, post a message in thread notifying that chain was escalated */
  escalate?: boolean;
}

interface ChainConfig {
  onComplete?: ChainOnComplete;
  onFailure?: ChainOnFailure;
  maxRetries?: number;
  /** Max times the chain can loop back (for bidirectional chains like doctor↔RCA). Default 1 (no loops). */
  maxDepth?: number;
}

/**
 * LLM-as-judge: determines whether a chain should continue or stop
 * based on the agent's natural response. Uses a fast/cheap model.
 */
/** Call xyne-claw's /chain-judge endpoint to decide if a chain should continue */
async function judgeChainContinuation(
  agentResult: string,
  sourceAgent: string,
  targetAgent: string,
  taskTemplate?: string,
  userQuery?: string,
  judgeContext?: string,
): Promise<"continue" | "stop"> {
  try {
    const res = await fetch(`${CONFIG.xyneClawUrl}/chain-judge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify({ agentResult, sourceAgent, targetAgent, taskTemplate, userQuery, judgeContext }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      console.warn(`[chain-judge] xyne-claw returned ${res.status}, defaulting to continue`);
      return "continue";
    }

    const data = (await res.json()) as { success: boolean; data?: { action: string; reason: string } };
    if (data.success && data.data) {
      console.log(`[chain-judge] ${sourceAgent} → ${targetAgent}: ${data.data.action} (${data.data.reason})`);
      return data.data.action === "stop" ? "stop" : "continue";
    }

    return "continue";
  } catch (err) {
    console.warn(`[chain-judge] Failed, defaulting to continue:`, err instanceof Error ? err.message : err);
    return "continue";
  }
}

function parseChainConfig(agentConfig: Record<string, unknown> | null): ChainConfig | undefined {
  const chain = (agentConfig as Record<string, unknown> | null)?.["chain"];
  if (!chain || typeof chain !== "object") return undefined;
  return chain as ChainConfig;
}

function evaluateChainConditions(conditions: ChainConditions | undefined, toolsUsed: string[]): boolean {
  if (!conditions) return true;

  if (conditions.toolsMustInclude?.length) {
    const allPresent = conditions.toolsMustInclude.every((t) => toolsUsed.includes(t));
    if (!allPresent) return false;
  }

  if (conditions.toolsMustExclude?.length) {
    const anyExcluded = conditions.toolsMustExclude.some((t) => toolsUsed.includes(t));
    if (anyExcluded) return false;
  }

  return true;
}

/** Traverse chain config up to maxHops to detect A→B→C→A cycles. */

function interpolateChainTask(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return result;
}

// ── Redis-backed session context store ──────────────────────────────

export interface SessionContext {
  mentionedUserId: string;
  senderId: string;
  senderName: string;
  channelId: string;
  channelName: string;
  conversationId: string;
  task: string;
  agentSlug?: string | undefined;
  responseMode: "conversation" | "approval";
  appToken: string;
  spacesAppId: string;
  spacesAppUserId: string;
  traceId?: string;
  provider?: string;
  /** Current chain depth — incremented each time a chain fires. Used with maxDepth. */
  chainDepth?: number;
  /**
   * MessageId of the "⏳ Working on it…" placeholder we posted at webhook-arrival
   * time. Used ONLY when USE_EPHEMERAL_PROGRESS=false — we edit this message
   * in-place as tools run, and replace its content with the final agent
   * response in the result handler. Undefined under the ephemeral path.
   */
  progressMessageId?: string;
}

const SESSION_TTL = 86400;
const SESSION_PREFIX = "session:";

export async function setSession(sessionId: string, ctx: SessionContext): Promise<void> {
  const redis = redisService.getConnection();
  await redis.set(`${SESSION_PREFIX}${sessionId}`, JSON.stringify(ctx), "EX", SESSION_TTL);
}

async function getSession(sessionId: string): Promise<SessionContext | null> {
  const redis = redisService.getConnection();
  const raw = await redis.get(`${SESSION_PREFIX}${sessionId}`);
  if (!raw) return null;
  return JSON.parse(raw) as SessionContext;
}

async function deleteSession(sessionId: string): Promise<void> {
  const redis = redisService.getConnection();
  await redis.del(`${SESSION_PREFIX}${sessionId}`);
}

// ── Types ────────────────────────────────────────────────────────────

// Matches Spaces' AppEventAttachment shape from
// xyne-spaces/backend/src/apps/types/index.ts:39 — every field name MUST line up
// or we end up reading `undefined` ids and posting download URLs like
// `/api/attachments/undefined/download` (we hit this in prod, see logs around
// 06:04:19 on 2026-04-27 for callbackId d99e84b2).
interface WebhookAttachment {
  attachmentId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileUrl: string;
  width?: number;
  height?: number;
}

interface WebhookEvent {
  eventType: string;
  payload: {
    conversationId: string;
    messageId: string;
    content: string;
    cleanContent: string;
    createdAt: string | number;
    userId: string;
    senderName?: string;
    channelId: string;
    channelName?: string;
    mentionedUserIds?: string[];
    attachments?: WebhookAttachment[];
  };
  timestamp: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

async function spacesAppFetchMultipart(path: string, form: FormData, appToken?: string): Promise<unknown> {
  const url = `${CONFIG.spacesBackendUrl}/api/apps${path}`;
  const token = appToken ?? "";
  if (!token) throw new Error("No app token provided");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      // Do NOT set Content-Type — let fetch set it with the multipart boundary
      Authorization: `Bearer ${token}`,
    },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Spaces app API ${res.status}: ${text.slice(0, 500)}`);
  }

  return res.json();
}

async function spacesAppFetchGet(path: string, appToken?: string): Promise<unknown> {
  const url = `${CONFIG.spacesBackendUrl}/api/apps${path}`;
  const token = appToken ?? "";
  if (!token) throw new Error("No app token provided");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Spaces app API ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

async function spacesAppFetch(path: string, body: Record<string, unknown>, appToken?: string): Promise<unknown> {
  const url = `${CONFIG.spacesBackendUrl}/api/apps${path}`;
  const token = appToken ?? "";
  if (!token) throw new Error("No app token provided");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Spaces app API ${res.status}: ${text.slice(0, 500)}`);
  }

  return res.json();
}

function decryptStoredField(stored: string): string {
  const [ciphertext, iv, authTag] = stored.split(":");
  if (!ciphertext || !iv || !authTag) throw new Error("Invalid encrypted field format");
  return decrypt(ciphertext, iv, authTag, CONFIG.encryptionKey);
}

interface ResolvedAgent {
  slug: string;
  appToken: string;
  spacesAppId: string;
  spacesAppUserId: string;
  isDefault: boolean;
}

async function resolveAgentByAppUserId(appUserId: string): Promise<ResolvedAgent | null> {
  const agent = await agentRepository.findByAppUserId(appUserId);

  if (agent?.spacesAppToken && agent.spacesAppId) {
    return {
      slug: agent.slug,
      appToken: decryptStoredField(agent.spacesAppToken),
      spacesAppId: agent.spacesAppId,
      spacesAppUserId: agent.spacesAppUserId ?? "",
      isDefault: agent.isDefault,
    };
  }

  return null;
}

async function getDefaultAgent(): Promise<ResolvedAgent | null> {
  const agent = await agentRepository.findDefault();

  if (!agent?.spacesAppToken || !agent.spacesAppId) return null;

  return {
    slug: agent.slug,
    appToken: decryptStoredField(agent.spacesAppToken),
    spacesAppId: agent.spacesAppId,
    spacesAppUserId: agent.spacesAppUserId ?? "",
    isDefault: true,
  };
}

export async function fetchConversationHistory(
  conversationId: string,
  appToken?: string,
  excludeUserId?: string,
): Promise<string | undefined> {
  try {
    const data = await spacesAppFetchGet(
      `/chat/conversationReplies?conversationId=${encodeURIComponent(conversationId)}`,
      appToken,
    ) as { items?: Array<{ userId: string; cleanContent: string; createdAt: string }> };

    let items = data.items ?? [];
    if (excludeUserId) {
      items = items.filter((m) => m.userId !== excludeUserId);
    }
    if (items.length === 0) return undefined;

    const lines = items.map(
      (m) => `[${new Date(m.createdAt).toISOString()}] ${m.userId}: ${m.cleanContent}`,
    );
    return `Thread history (oldest → newest):\n${lines.join("\n")}`;
  } catch (err) {
    console.warn("[webhook] Failed to fetch conversation history:", err);
    return undefined;
  }
}

function buildAppActionFrontmatter(
  result: string,
  channelId: string,
  conversationId: string,
  mentionedUserId: string,
  senderName: string,
  channelName: string,
  task: string,
): string {
  const approveId = crypto.randomUUID();
  const declineId = crypto.randomUUID();
  const callbackBase = `${CONFIG.selfUrl}/claw/api/v1/app/callback`;

  const contextHeader = `**${senderName}** mentioned you in **#${channelName}**:\n> ${task}\n\n---\n\nHere's the response I'd send on your behalf:\n\n`;

  const frontmatter = [
    "---",
    "appActions:",
    `  - actionId: "${approveId}"`,
    `    label: "Approve"`,
    `    type: "button"`,
    `    color: "#22c55e"`,
    `    actionableUrl: "${callbackBase}"`,
    `    context:`,
    `      targetChannelId: "${channelId}"`,
    `      targetConversationId: "${conversationId}"`,
    `      mentionedUserId: "${mentionedUserId}"`,
    `      messageContent: ${JSON.stringify(result)}`,
    `  - actionId: "${declineId}"`,
    `    label: "Decline"`,
    `    type: "button"`,
    `    color: "#ef4444"`,
    `    actionableUrl: "${callbackBase}"`,
    `    context:`,
    `      mentionedUserId: "${mentionedUserId}"`,
    "---",
    "",
    contextHeader + result,
  ];

  return frontmatter.join("\n");
}

// ── Action formatting ───────────────────────────────────────────────

function formatActionDescription(tool: string, params: Record<string, unknown>): string {
  if (tool === "spaces-create-ticket") {
    const title = params["title"] as string ?? "";
    const desc = (params["description"] as string ?? "").slice(0, 300);
    const lines = [`**Create Ticket**`, ``, `**Title:** ${title}`];
    if (desc) lines.push(`**Description:** ${desc}${(params["description"] as string ?? "").length > 300 ? "..." : ""}`);
    return lines.join("\n");
  }

  if (tool === "spaces-schedule-call") {
    const title = params["title"] as string ?? "Call";
    const startsAt = params["startsAt"] as string ?? "";
    const endsAt = params["endsAt"] as string ?? "";
    const lines = [`**Schedule Call**`, ``, `**Title:** ${title}`];
    if (startsAt) lines.push(`**Starts:** ${new Date(startsAt).toLocaleString()}`);
    if (endsAt) lines.push(`**Ends:** ${new Date(endsAt).toLocaleString()}`);
    return lines.join("\n");
  }

  if (tool === "spaces-memory-create") {
    const docType = (params["docType"] as string ?? "fact").toUpperCase();
    const query = params["query"] as string ?? "";
    const tags = params["tags"] as string[] ?? [];
    const lines = [`**Save to Knowledge Base (${docType})**`];
    if (query) lines.push(``, `**Summary:** ${query}`);
    if (tags.length > 0) lines.push(`**Tags:** ${tags.join(", ")}`);
    lines.push(``, `_See attached file for full content._`);
    return lines.join("\n");
  }

  // Fallback for unknown tools
  const entries = Object.entries(params).filter(([, v]) => v != null).slice(0, 8);
  const lines = [`**${tool}**`, ``];
  for (const [key, value] of entries) {
    const val = typeof value === "string" ? value.slice(0, 200) : JSON.stringify(value).slice(0, 200);
    lines.push(`**${key}:** ${val}`);
  }
  return lines.join("\n");
}


// ── POST /webhook and /webhook/:agentSlug — receive events from Xyne Spaces ──

async function handleWebhook(req: Request, res: Response): Promise<void> {
  const traceId = createTraceId();
  const log = createLogger("webhook", traceId);
  const event = req.body as WebhookEvent;
  const { eventType, payload } = event;

  // Only handle mention events
  if (eventType !== "USER_MENTIONED" && eventType !== "APP_MENTIONED" && eventType !== "DIRECT_MESSAGE") {
    res.json({ success: true });
    return;
  }

  // For APP_MENTIONED: the agent slug comes from the URL param (each agent has its own webhook URL)
  // For USER_MENTIONED: resolve from mentionedUserIds
  let agent: ResolvedAgent | null = null;

  const agentSlugFromUrl = (req.params as { agentSlug?: string }).agentSlug;
  if (agentSlugFromUrl) {
    const agentRow = await agentRepository.findBySlug(agentSlugFromUrl);

    // For USER_MENTIONED on non-default agents (doctor, pgm, etc.) — ignore.
    // These agents should only respond to APP_MENTIONED / DIRECT_MESSAGE.
    // The default agent (assistant/Digital Twin) SHOULD handle USER_MENTIONED
    // because that's the Digital Twin flow — someone @mentions a real user.
    if (eventType === "USER_MENTIONED" && !agentRow?.isDefault) {
      log.info(`Ignoring USER_MENTIONED on non-default agent webhook /${agentSlugFromUrl}`);
      res.json({ success: true });
      return;
    }

    // For USER_MENTIONED on default agent (Digital Twin): verify mentioned user is registered
    if (eventType === "USER_MENTIONED" && agentRow?.isDefault) {
      const mentionedUserIds = (payload as { mentionedUserIds?: string[] }).mentionedUserIds ?? [];
      if (mentionedUserIds.length == 1) {
        const mentionedUser = await userRepository.findById(mentionedUserIds[0]!);
        if (!mentionedUser) {
          log.info(`Ignoring USER_MENTIONED — mentioned user ${mentionedUserIds[0]} not registered in claw-auth`);
          res.json({ success: true });
          return;
        }
      }
      else {
        log.info(`Ignoring USER_MENTIONED — expected exactly 1 mentioned user, got ${mentionedUserIds.length}`);
        res.json({ success: true });
        return;
      }
    }

    if (agentRow?.spacesAppToken && agentRow.spacesAppId) {
      agent = {
        slug: agentRow.slug,
        appToken: decryptStoredField(agentRow.spacesAppToken),
        spacesAppId: agentRow.spacesAppId,
        spacesAppUserId: agentRow.spacesAppUserId ?? "",
        isDefault: agentRow.isDefault,
      };
    }
  } else if (eventType === "USER_MENTIONED") {
    const mentionedUserIds = (payload as { mentionedUserIds?: string[] }).mentionedUserIds ?? [];
    if (mentionedUserIds.length > 0) {
      // First check if the mentioned user is an agent bot
      agent = await resolveAgentByAppUserId(mentionedUserIds[0]!);


      // If not an agent bot, check if the mentioned user is registered in claw-auth
      // (i.e. they have a Digital Twin set up with MCP connections)
      if (!agent) {
        const mentionedUser = await userRepository.findById(mentionedUserIds[0]!);
        if (!mentionedUser) {
          log.info(`Ignoring USER_MENTIONED — user ${mentionedUserIds[0]} not registered in claw-auth`);
          res.json({ success: true });
          return;
        } 
        // User exists in claw-auth — fall through to default agent (Digital Twin)
      }
    }
  }

  // Fall back to default agent
  if (!agent) {
    agent = await getDefaultAgent();
  }

  if (!agent) {
    log.error("No agent found and no default agent registered");
    res.json({ success: true });
    return;
  }

  // Verify the sender has an account in claw-auth
  const senderUser = await userRepository.findById(payload.userId);
  if (!senderUser) {
    if (eventType === "DIRECT_MESSAGE") {
      log.info(`Sender ${payload.userId} not registered — sending setup template`);
      res.json({ success: true });
      spacesAppFetch("/chat/postMessage", {
        channelId: payload.channelId,
        conversationId: payload.conversationId,
        markdownText: UNREGISTERED_USER_TEMPLATE,
        userId: agent.spacesAppUserId,
        metadata: { contentFormat: "markdown" },
      }, agent.appToken).catch((err) => {
        log.error("Failed to send unregistered-user template", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    } else {
      log.info(`Ignoring ${eventType} — sender ${payload.userId} not registered in claw-auth`);
      res.json({ success: true });
    }
    return;
  }

  log.info(`${eventType} from user ${payload.userId} → agent ${agent.slug}`);

  // Acknowledge immediately
  res.json({ success: true });

  const task = payload.cleanContent?.trim();
  if (!task) return;

  try {
    // Fetch thread history to give the agent context (exclude own messages to avoid duplication on resume)
    const history = await fetchConversationHistory(payload.conversationId, agent.appToken, agent.spacesAppUserId);

    // For USER_MENTIONED: run as the mentioned user (their tools, their twin)
    const allMentionedIds = (payload as { mentionedUserIds?: string[] }).mentionedUserIds ?? [];
    const targetUserId = eventType === "USER_MENTIONED" && allMentionedIds.length > 0
      ? allMentionedIds[0]! : payload.userId;

    // Resolve agent config (repoUrl, skills)
    const agentRow = await agentRepository.findBySlugWithRelations(agent.slug);
    const repoUrl = (agentRow?.config as Record<string, unknown> | null)?.["repoUrl"] as string | undefined;
    const agentSkills = agentRow?.skills?.map((s) => ({ name: s.skill.name, content: s.skill.content }));

    // Per-agent: which provider to use as the parent agent LLM
    const userAgentConfig = await userAgentConfigRepository.findByUserAndAgent(targetUserId, agent.slug).catch(() => null);
    const userProvider = userAgentConfig?.provider;

    // User-level: all provider credentials (copilot/claude) owned by this user
    const allCreds = await userProviderCredentialsRepository.listByUser(targetUserId).catch(() => []);
    const credsByProvider = new Map(allCreds.map((c) => [c.provider, c] as const));

    // User-level: per-subagent provider routing overrides
    const subagentConfigs = await userSubagentConfigRepository.listByUser(targetUserId).catch(() => []);
    const subagentProviders: Record<string, string> = {};
    for (const s of subagentConfigs) subagentProviders[s.subagentName] = s.provider;

    // Build providerConfigs: every provider this user has credentials for, decrypted + ready to send
    const providerConfigs: Record<string, { apiKey: string; model: string; baseUrl?: string; authType?: string }> = {};
    for (const [provider, row] of credsByProvider) {
      if (!row.encryptedKey || !row.iv || !row.authTag) continue;
      try {
        const decrypted = decrypt(row.encryptedKey, row.iv, row.authTag, CONFIG.encryptionKey);
        // Codex OAuth-mode stores a JSON bundle ({access_token,refresh_token,expires_at}).
        // Pull out the bare access_token so downstream sees a usable Bearer string.
        const apiKey = provider === "codex" ? extractCodexBearer(decrypted) : decrypted;
        const defaultModel =
          provider === "copilot" ? "gpt-4o" :
          provider === "codex" ? "gpt-4.1" :
          "claude-sonnet-4-5";
        providerConfigs[provider] = {
          apiKey,
          model: row.model ?? defaultModel,
          ...(row.baseUrl ? { baseUrl: row.baseUrl } : {}),
          ...(row.authType ? { authType: row.authType } : {}),
        };
      } catch (err) {
        log.error(`Failed to decrypt ${provider} key`, { error: err instanceof Error ? err.message : String(err) });
      }
    }

    log.info(`Provider resolution: parent=${userProvider ?? "spaces"} creds=[${Object.keys(providerConfigs).join(",")}] subagentOverrides=${JSON.stringify(subagentProviders)}`);

    // Download image attachments from Spaces (if any) to pass to the agent.
    // Spaces' attachment routes use user-session auth and reject app tokens
    // (HTTP 401), so we use the *sender's* xyne-spaces MCP token (stored
    // encrypted in userMcpConnection by users.ts:autoConfigureSpaces). That
    // token authenticates as the actual user who sent the message.
    //
    // Source order:
    //   1. Direct fetch of `att.fileUrl` (signed/public URL — no auth)
    //   2. Spaces user-session route with the sender's MCP token
    //   3. Spaces apps-route with agent appToken (last resort)
    let userSpacesToken: string | undefined;
    let userSpacesSessionId: string | undefined;
    try {
      const conn = await prisma.userMcpConnection.findFirst({
        where: { userId: payload.userId, mcpServer: { type: "xyne-spaces" } },
      });
      if (conn) {
        const decrypted = decrypt(conn.encryptedCreds, conn.iv, conn.authTag, CONFIG.encryptionKey);
        const parsed = JSON.parse(decrypted) as { token?: string; sessionId?: string };
        if (parsed.token) userSpacesToken = parsed.token;
        if (parsed.sessionId) userSpacesSessionId = parsed.sessionId;
      }
    } catch (err) {
      log.warn(`Failed to load user Spaces token for ${payload.userId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Spaces auth middleware (backend/src/middleware/auth.ts) needs the JWT
    // AND a session cookie to silently refresh expired JWTs. Pure Bearer-only
    // 401s the moment the JWT TTL elapses. We cover all three cookie name
    // aliases (legacy + workspace + V2) so any of Spaces' middleware variants
    // can find what it needs.
    const userCookieParts: string[] = [];
    if (userSpacesToken) {
      userCookieParts.push(`google_access_token=${userSpacesToken}`);
    }
    if (userSpacesSessionId) {
      userCookieParts.push(`user_session_id=${userSpacesSessionId}`);
      userCookieParts.push(`xyne_session=${userSpacesSessionId}`);
    }
    const userCookieHeader = userCookieParts.length > 0 ? userCookieParts.join("; ") : undefined;

    const inboundAttachments: Array<{ fileName: string; mimeType: string; data: string }> = [];
    if (payload.attachments?.length) {
      for (const att of payload.attachments) {
        if (!att.mimeType.startsWith("image/")) continue;
        log.info(
          `Attachment ${att.attachmentId}: fileUrl=${att.fileUrl ? `"${att.fileUrl.slice(0, 120)}"` : "(empty)"} hasUserToken=${!!userSpacesToken} hasSessionId=${!!userSpacesSessionId}`,
        );

        const sources: Array<{ label: string; url: string; headers?: Record<string, string> }> = [];
        if (att.fileUrl && /^https?:\/\//i.test(att.fileUrl)) {
          sources.push({ label: "fileUrl", url: att.fileUrl });
        }
        if (userSpacesToken) {
          sources.push({
            label: "user-token",
            url: `${CONFIG.spacesBackendUrl}/api/attachments/${att.attachmentId}/download`,
            headers: {
              Authorization: `Bearer ${userSpacesToken}`,
              ...(userCookieHeader ? { Cookie: userCookieHeader } : {}),
            },
          });
        }
        sources.push({
          label: "apps-route",
          url: `${CONFIG.spacesBackendUrl}/api/apps/attachments/${att.attachmentId}/download`,
          headers: { Authorization: `Bearer ${agent.appToken}` },
        });
        sources.push({
          label: "user-route",
          url: `${CONFIG.spacesBackendUrl}/api/attachments/${att.attachmentId}/download`,
          headers: { Authorization: `Bearer ${agent.appToken}` },
        });

        const failures: string[] = [];
        let downloaded = false;
        for (const src of sources) {
          try {
            const dlRes = await fetch(src.url, {
              signal: AbortSignal.timeout(15_000),
              ...(src.headers ? { headers: src.headers } : {}),
            });
            if (dlRes.ok) {
              const buffer = Buffer.from(await dlRes.arrayBuffer());
              inboundAttachments.push({
                fileName: att.fileName,
                mimeType: att.mimeType,
                data: buffer.toString("base64"),
              });
              log.info(
                `Downloaded attachment ${att.attachmentId} (${att.fileName}, ${att.mimeType}, ${buffer.length} bytes) via ${src.label}`,
              );
              downloaded = true;
              break;
            }
            const body = await dlRes.text().catch(() => "");
            failures.push(`${src.label}: HTTP ${dlRes.status} ${body.slice(0, 120)}`);
          } catch (err) {
            failures.push(`${src.label}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        if (!downloaded) {
          log.warn(
            `Failed to download attachment ${att.attachmentId} (${att.fileName}); tried ${sources.length} source(s): ${failures.join(" | ")}`,
          );
        }
      }
    }

    const runUrl = `${CONFIG.selfUrl}/claw/api/v1/run`;
    const runRes = await fetch(runUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: targetUserId,
        task,
        conversationId: payload.conversationId,
        agentSlug: agent.slug,
        eventType,
        traceId,
        callbackUrl: `${CONFIG.selfUrl}/claw/api/v1/webhook/result`,
        progressUrl: `${CONFIG.selfUrl}/claw/api/v1/webhook/progress`,
        channelId: payload.channelId,
        ...(history
          ? {
              context: `## Thread Awareness\nYou are in a group thread in Xyne Spaces where multiple users and agents can participate. The thread history below shows messages from other participants — use it to understand context. Your own previous messages are NOT included here (they are already in your session). If you need more context, use spaces-messages or spaces-message-detail to read the full thread.\n\n${history}`
            }
          : {}),
        ...(repoUrl ? { repoUrl } : {}),
        ...(agentSkills && agentSkills.length > 0 ? { skills: agentSkills } : {}),
        ...(userProvider ? { provider: userProvider } : {}),
        ...(Object.keys(subagentProviders).length > 0 ? { subagentProviders } : {}),
        ...(Object.keys(providerConfigs).length > 0 ? { providerConfigs } : {}),
        ...(inboundAttachments.length > 0 ? { attachments: inboundAttachments } : {}),
      }),
    });

    const body = (await runRes.json()) as { success: boolean; sessionId?: string };

    if (body.success && body.sessionId) {
      const mentionedUserIds = (payload as { mentionedUserIds?: string[] }).mentionedUserIds ?? [];

      // Progress signal to the dashboard. Two paths, switched by flag:
      //   USE_EPHEMERAL_PROGRESS=true  → POST /chat/agentProgress (requires Spaces XYNE-12145)
      //   USE_EPHEMERAL_PROGRESS=false → POST /chat/postMessage for a "⏳ Working on it..."
      //                                  placeholder; we capture messageId and edit it later.
      let progressMessageId: string | undefined;
      if (eventType !== "USER_MENTIONED") {
        try {
          if (USE_EPHEMERAL_PROGRESS) {
            await spacesAppFetch("/chat/agentProgress", {
              conversationId: payload.conversationId,
              channelId: payload.channelId,
              agentSlug: agent.slug,
              userId: agent.spacesAppUserId,
              toolLabel: "Working on it...",
              status: "working",
            }, agent.appToken);
          } else {
            const placeholderRes = (await spacesAppFetch("/chat/postMessage", {
              channelId: payload.channelId,
              conversationId: payload.conversationId,
              markdownText: "⏳ Working on it...",
              userId: agent.spacesAppUserId,
              metadata: { contentFormat: "markdown" },
            }, agent.appToken)) as { messageId?: string };
            progressMessageId = placeholderRes?.messageId;
            log.info(`Posted progress placeholder, messageId=${progressMessageId}`);
          }
        } catch (err) {
          log.warn("Failed to publish initial agent progress signal", { error: err instanceof Error ? err.message : String(err) });
        }
      }

      const sessionContext: SessionContext = {
        mentionedUserId: eventType === "USER_MENTIONED" ? (mentionedUserIds[0] ?? agent.spacesAppUserId) : agent.spacesAppUserId,
        senderId: payload.userId,
        senderName: payload.senderName ?? payload.userId,
        channelId: payload.channelId,
        channelName: payload.channelName ?? payload.channelId,
        conversationId: payload.conversationId,
        task,
        agentSlug: agent.slug,
        responseMode: eventType === "USER_MENTIONED" ? "approval" as const : "conversation" as const,
        appToken: agent.appToken,
        spacesAppId: agent.spacesAppId,
        spacesAppUserId: agent.spacesAppUserId,
        traceId,
        ...(userProvider ? { provider: userProvider } : {}),
        ...(progressMessageId ? { progressMessageId } : {}),
      };

      await setSession(body.sessionId, sessionContext);

      await registerRunRecovery({
        rootSessionId: body.sessionId,
        maxRetries: CONFIG.runRecoveryMaxRetries,
        timeoutMs: CONFIG.runRecoveryTimeoutMs,
        retryBackoffMs: CONFIG.runRecoveryBackoffMs,
        dispatchPayload: {
          userId: targetUserId,
          task,
          conversationId: payload.conversationId,
          agentSlug: agent.slug,
          eventType,
          traceId,
          callbackUrl: `${CONFIG.selfUrl}/claw/api/v1/webhook/result`,
          progressUrl: `${CONFIG.selfUrl}/claw/api/v1/webhook/progress`,
          channelId: payload.channelId,
          ...(history ? { context: `## Thread Awareness\nYou are in a group thread in Xyne Spaces where multiple users and agents can participate. The thread history below shows messages from other participants — use it to understand context. Your own previous messages are NOT included here (they are already in your session). If you need more context, use spaces-messages or spaces-message-detail to read the full thread.\n\n${history}` } : {}),
          ...(repoUrl ? { repoUrl } : {}),
          ...(agentSkills && agentSkills.length > 0 ? { skills: agentSkills } : {}),
          ...(userProvider ? { provider: userProvider } : {}),
          ...(Object.keys(subagentProviders).length > 0 ? { subagentProviders } : {}),
          ...(Object.keys(providerConfigs).length > 0 ? { providerConfigs } : {}),
          ...(inboundAttachments.length > 0 ? { attachments: inboundAttachments } : {}),
        },
        sessionContext,
      });

      // Track the run for the Agent Control Center
      try {
        await agentRunRepository.start({
          sessionId: body.sessionId,
          userId: targetUserId,
          agentSlug: agent.slug,
          triggerSource: "spaces",
          task,
          conversationId: payload.conversationId,
          channelId: payload.channelId,
        });
        await chatMessageRepository.create({
          conversationId: payload.conversationId,
          agentSlug: agent.slug,
          userId: targetUserId,
          role: "user",
          content: task,
          status: "completed",
        });
      } catch (err) {
        log.warn("Failed to record AgentRun/ChatMessage", { error: err instanceof Error ? err.message : String(err) });
      }

      log.info(`Forwarded to xyne-claw, sessionId=${body.sessionId}`);
    }
  } catch (err) {
    log.error("Error forwarding:", { error: err instanceof Error ? err.message : String(err) });
  }
}

// ── POST /webhook/result — callback from xyne-claw (MUST be before /:agentSlug) ──

router.post("/result", async (req: Request, res: Response) => {
  const payload = req.body as {
    sessionId?: string;
    userId?: string;
    status?: string;
    result?: string;
    error?: string;
    toolsUsed?: string[];
    toolInvocations?: unknown;
    tokenUsage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
    attachments?: Array<{ fileName: string; mimeType: string; data: string }>;
    pendingResponses?: Array<{ responseId: string; message: string }>;
    provider?: string;
  };

  const sessionId = payload.sessionId ?? "";

  // Acknowledge immediately
  res.json({ success: true });

  let ctx = sessionId ? await getSession(sessionId) : null;
  if (!ctx && sessionId) {
    ctx = await getRecoveryContextForSession(sessionId);
  }
  const resultWithCitations = payload.status === "completed" && payload.result
    ? appendCitations(payload.result, payload.toolInvocations, {
      baseUrl: CONFIG.spacesAppUrl,
      ...(ctx?.channelId ? { defaultChannelId: ctx.channelId } : {}),
    })
    : payload.result ?? "";

  // Finalize the AgentRun record (fire-and-forget)
  if (sessionId) {
    const status = payload.status === "completed" ? "completed" : "failed";
    agentRunRepository.finalize(sessionId, {
      status,
      result: payload.result !== undefined ? resultWithCitations : null,
      error: payload.error ?? null,
      toolsUsed: payload.toolsUsed ?? [],
      ...(payload.toolInvocations !== undefined ? { toolInvocations: payload.toolInvocations } : {}),
      ...(payload.tokenUsage ? { tokenUsage: payload.tokenUsage } : {}),
    }).catch(() => {});
  }

  if (payload.status === "completed") {
    await handleRunCompletion(sessionId, "completed").catch((err) => {
      console.warn(`[webhook/result] Failed to mark ${sessionId} completed in run recovery:`, err instanceof Error ? err.message : err);
    });
  }

  if (payload.status === "failed") {
    const recoveryFailure = await handleRunCompletion(sessionId, "failed", payload.error).catch((err) => {
      console.warn(`[webhook/result] Failed to process ${sessionId} failure in run recovery:`, err instanceof Error ? err.message : err);
      return null;
    });

    if (recoveryFailure?.retried) {
      console.log(`[webhook/result] Session ${sessionId}: retry queued (${recoveryFailure.retriesUsed}/${recoveryFailure.maxRetries})`);
      return;
    }
  }

  if (payload.status !== "completed") {
    // ── Handle failure chain if configured ──
    if (payload.status === "failed" && ctx?.agentSlug) {
      try {
        const agentRow = await agentRepository.findBySlug(ctx.agentSlug);

        // Check user-level chain config first, fall back to global agent config
        const userChainRow = await userAgentConfigRepository.findByUserAndAgent(ctx.senderId, ctx.agentSlug);
        const chain = userChainRow?.chainConfig
          ? parseChainConfig({ chain: userChainRow.chainConfig } as Record<string, unknown>)
          : parseChainConfig(agentRow?.config as Record<string, unknown> | null);

        if (chain?.onFailure?.escalate) {
          const token = ctx.appToken;
          await spacesAppFetch("/chat/postMessage", {
            channelId: ctx.channelId,
            conversationId: ctx.conversationId,
            markdownText: `⚠️ **Agent chain escalation**: \`${ctx.agentSlug}\` failed. Error: ${payload.error ?? "unknown"}. Manual intervention needed.`,
            userId: ctx.spacesAppUserId,
            metadata: { contentFormat: "markdown" },
          }, token).catch(() => {});
        }

        if (chain?.onFailure?.triggerAgent) {
          const runUrl = `${CONFIG.selfUrl}/claw/api/v1/run`;
          const failureTask = `The agent "${ctx.agentSlug}" failed with error: ${payload.error ?? "unknown"}. Original task was: ${ctx.task}. Please investigate and resolve.`;
          const failureAgentRow = await agentRepository.findBySlug(chain.onFailure.triggerAgent);
          const runRes = await fetch(runUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId: ctx.senderId,
              task: failureTask,
              agentSlug: chain.onFailure.triggerAgent,
              channelId: ctx.channelId,
              callbackUrl: `${CONFIG.selfUrl}/claw/api/v1/webhook/result`,
              progressUrl: `${CONFIG.selfUrl}/claw/api/v1/webhook/progress`,
            }),
          });
          if (!runRes.ok) { console.error(`[webhook/result] Failure chain trigger HTTP ${runRes.status}`); return; }
          const runBody = (await runRes.json()) as { success: boolean; sessionId?: string };
          if (runBody.success && runBody.sessionId && failureAgentRow?.spacesAppToken && failureAgentRow.spacesAppId) {
            const failureAppToken = decryptStoredField(failureAgentRow.spacesAppToken);
            const failureContext: SessionContext = {
              mentionedUserId: failureAgentRow.spacesAppUserId ?? "",
              senderId: ctx.senderId,
              senderName: ctx.senderName,
              channelId: ctx.channelId,
              channelName: ctx.channelName,
              conversationId: ctx.conversationId,
              task: ctx.task,
              agentSlug: chain.onFailure.triggerAgent,
              responseMode: "conversation",
              appToken: failureAppToken,
              spacesAppId: failureAgentRow.spacesAppId,
              spacesAppUserId: failureAgentRow.spacesAppUserId ?? "",
              chainDepth: (ctx.chainDepth ?? 0) + 1,
            };
            await setSession(runBody.sessionId, failureContext);
            await registerRunRecovery({
              rootSessionId: runBody.sessionId,
              maxRetries: CONFIG.runRecoveryMaxRetries,
              timeoutMs: CONFIG.runRecoveryTimeoutMs,
              retryBackoffMs: CONFIG.runRecoveryBackoffMs,
              dispatchPayload: {
                userId: ctx.senderId,
                task: failureTask,
                conversationId: ctx.conversationId,
                agentSlug: chain.onFailure.triggerAgent,
                eventType: "APP_MENTIONED",
                traceId: ctx.traceId ?? runBody.sessionId,
                callbackUrl: `${CONFIG.selfUrl}/claw/api/v1/webhook/result`,
                progressUrl: `${CONFIG.selfUrl}/claw/api/v1/webhook/progress`,
                channelId: ctx.channelId,
              },
              sessionContext: failureContext,
            });
          }
          console.log(`[webhook/result] Failure chain: ${ctx.agentSlug} → ${chain.onFailure.triggerAgent}`);
        }
      } catch (chainErr) {
        console.error("[webhook/result] Failure chain error (non-fatal):", chainErr);
      }
    }
    return;
  }

  if (!ctx) {
    console.warn(`[webhook/result] No session context for ${sessionId}`);
    return;
  }

  const log = createLogger("webhook/result", ctx.traceId ?? sessionId.slice(0, 8));
  log.info(`status=${payload.status}, resultLength=${resultWithCitations.length}`);

  // Clear the ephemeral agent progress signal — dashboard drops the spinner.
  // Only fires in the ephemeral path; the placeholder path clears naturally
  // when we edit the "⏳" message with the final result below.
  if (USE_EPHEMERAL_PROGRESS) {
    spacesAppFetch("/chat/agentProgress", {
      conversationId: ctx.conversationId,
      channelId: ctx.channelId,
      agentSlug: ctx.agentSlug,
      userId: ctx.spacesAppUserId,
      status: "done",
    }, ctx.appToken).catch((err) =>
      log.warn("Failed to clear agent progress signal", { error: err instanceof Error ? err.message : String(err) }),
    );
  }

  // Persist the assistant response as a ChatMessage (transcript) — fire-and-forget
  if (resultWithCitations.trim() && ctx.conversationId && ctx.agentSlug) {
    chatMessageRepository.create({
      conversationId: ctx.conversationId,
      agentSlug: ctx.agentSlug,
      userId: ctx.senderId,
      role: "assistant",
      content: resultWithCitations,
      status: "completed",
    }).catch((e) => log.warn("Failed to save assistant ChatMessage", { error: e instanceof Error ? e.message : String(e) }));
  }

  // Notify user if result is empty (but not if copilot has pendingResponses)
  if (!resultWithCitations.trim() && !payload.pendingResponses?.length) {
    if (ctx.responseMode === "approval") {
      log.warn("Empty result in approval mode — skipping (no thread message)");
      await deleteSession(sessionId);
      return;
    }

    log.warn("Empty result — notifying user");
    try {
      const token = ctx.appToken;
      const sorryText = "Sorry, I wasn't able to produce a response. Please try sending your message again.";
      await spacesAppFetch("/chat/postMessage", {
        channelId: ctx.channelId,
        conversationId: ctx.conversationId,
        markdownText: sorryText,
        userId: ctx.spacesAppUserId,
        metadata: { contentFormat: "markdown" },
      }, token);
    } catch (err) {
      log.error("Failed to send empty-result notice", { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  // Don't delete session yet — agent conversations may continue
  // sessionStore.delete(sessionId);

  try {
    const token = ctx.appToken;

    // ── Copilot mode: post pendingResponses instead of result.text ──
    if (payload.pendingResponses?.length) {
      if (ctx.responseMode === "approval") {
        // Merge copilot responses into a single result for the approval DM
        const combinedResult = payload.pendingResponses.map((pr) => pr.message).join("\n\n");
        const dmResult = (await spacesAppFetch("/channel/openDm", {
          targetUserId: ctx.mentionedUserId,
        }, token)) as { channelId: string };

        const messageContent = buildAppActionFrontmatter(
          combinedResult,
          ctx.channelId,
          ctx.conversationId,
          ctx.mentionedUserId,
          ctx.senderName,
          ctx.channelName,
          ctx.task,
        );

        const metadata = { hasAppActions: true, appId: ctx.spacesAppId, contentFormat: "markdown" };
        await spacesAppFetch("/chat/postMessage", {
          channelId: dmResult.channelId,
          markdownText: messageContent,
          userId: ctx.spacesAppUserId,
          metadata,
        }, token);

        log.info(`Digital Twin (copilot): sent approve/decline DM to ${ctx.mentionedUserId}`);
        await deleteSession(sessionId);
        return;
      }

      if (payload.attachments?.length) {
        const form = new FormData();
        for (const att of payload.attachments) {
          const buffer = Buffer.from(att.data, "base64");
          const blob = new Blob([buffer], { type: att.mimeType });
          form.append("files", blob, att.fileName);
        }
        form.append("channelId", ctx.channelId);
        form.append("conversationId", ctx.conversationId);
        form.append("userId", ctx.spacesAppUserId);
        form.append("markdownText", payload.pendingResponses.map((pr) => pr.message).join("\n\n"));
        form.append("metadata", JSON.stringify({ contentFormat: "markdown" }));
        await spacesAppFetchMultipart("/files/filesUpload", form, token);
        log.info(`Copilot: uploaded ${payload.attachments.length} attachment(s) with response(s) in thread ${ctx.conversationId}`);
      } else {
        for (const pr of payload.pendingResponses) {
          await spacesAppFetch("/chat/postMessage", {
            channelId: ctx.channelId,
            conversationId: ctx.conversationId,
            markdownText: pr.message,
            userId: ctx.spacesAppUserId,
            metadata: { contentFormat: "markdown" },
          }, token);
        }
        log.info(`Copilot: posted ${payload.pendingResponses.length} response(s) in thread ${ctx.conversationId}`);
      }

      // Post pending write action approvals (e.g. spaces-memory-create) before returning
      const copilotPendingActions = (payload as { pendingActions?: Array<Record<string, unknown>> }).pendingActions;
      if (copilotPendingActions?.length) {
        for (const action of copilotPendingActions) {
          const actionDesc = formatActionDescription(action["tool"] as string, action["params"] as Record<string, unknown>);
          const approveId = crypto.randomUUID();
          const declineId = crypto.randomUUID();

          const actionMsg = [
            "---",
            "appActions:",
            `  - actionId: "${approveId}"`,
            `    label: "Approve"`,
            `    type: "button"`,
            `    color: "#22c55e"`,
            `    actionableUrl: "${CONFIG.selfUrl}/claw/api/v1/app/callback"`,
            `    context:`,
            `      actionType: "write"`,
            `      serverType: "${action["serverType"] as string}"`,
            `      tool: "${action["tool"] as string}"`,
            `      params: ${JSON.stringify(JSON.stringify(action["params"]))}`,
            `      userId: "${action["userId"] as string}"`,
            `      signature: "${action["signature"] as string}"`,
            `  - actionId: "${declineId}"`,
            `    label: "Decline"`,
            `    type: "button"`,
            `    color: "#ef4444"`,
            `    actionableUrl: "${CONFIG.selfUrl}/claw/api/v1/app/callback"`,
            `    context:`,
            `      userId: "${action["userId"] as string}"`,
            "---",
            "",
            `The agent wants to execute:\n\n${actionDesc}`,
          ].join("\n");

          if (action["tool"] === "spaces-memory-create" && (action["params"] as Record<string, unknown>)?.["content"]) {
            const memParams = action["params"] as Record<string, unknown>;
            const memContent = memParams["content"] as string;
            const memDocType = (memParams["docType"] as string) ?? "fact";
            const form = new FormData();
            const blob = new Blob([memContent], { type: "text/markdown" });
            form.append("files", blob, `memory-${memDocType}-${Date.now()}.md`);
            form.append("channelId", ctx.channelId);
            form.append("conversationId", ctx.conversationId);
            form.append("userId", ctx.spacesAppUserId);
            form.append("markdownText", actionMsg);
            form.append("metadata", JSON.stringify({ hasAppActions: true, appId: ctx.spacesAppId, contentFormat: "markdown" }));
            await spacesAppFetchMultipart("/files/filesUpload", form, token);
          } else {
            await spacesAppFetch("/chat/postMessage", {
              channelId: ctx.channelId,
              conversationId: ctx.conversationId,
              markdownText: actionMsg,
              userId: ctx.spacesAppUserId,
              metadata: { hasAppActions: true, appId: ctx.spacesAppId, contentFormat: "markdown" },
            }, token);
          }
        }
        log.info(`Copilot: posted ${copilotPendingActions.length} write action approval(s)`);
      }

      // Don't delete session — copilot sessions persist for multi-turn
      return;
    }

    if (ctx.responseMode === "approval") {
      // ── Digital Twin mode: DM the mentioned user with approve/decline ──
      const dmResult = (await spacesAppFetch("/channel/openDm", {
        targetUserId: ctx.mentionedUserId,
      }, token)) as { channelId: string };

      const messageContent = buildAppActionFrontmatter(
        resultWithCitations,
        ctx.channelId,
        ctx.conversationId,
        ctx.mentionedUserId,
        ctx.senderName,
        ctx.channelName,
        ctx.task,
      );

      const metadata = { hasAppActions: true, appId: ctx.spacesAppId, contentFormat: "markdown" };

      if (payload.attachments?.length) {
        const form = new FormData();
        for (const att of payload.attachments) {
          const buffer = Buffer.from(att.data, "base64");
          const blob = new Blob([buffer], { type: att.mimeType });
          form.append("files", blob, att.fileName);
        }
        form.append("channelId", dmResult.channelId);
        form.append("userId", ctx.spacesAppUserId);
        form.append("markdownText", messageContent);
        form.append("metadata", JSON.stringify(metadata));

        await spacesAppFetchMultipart("/files/filesUpload", form, token);
      } else {
        await spacesAppFetch("/chat/postMessage", {
          channelId: dmResult.channelId,
          markdownText: messageContent,
          userId: ctx.spacesAppUserId,
          metadata,
        }, token);
      }

      log.info(`Digital Twin: sent approve/decline DM to ${ctx.mentionedUserId} (asked by ${ctx.senderId})`);
      await deleteSession(sessionId);
      // Return immediately — don't post pendingQuestions, pendingActions,
      // or chain notifications to the thread. Everything goes through the DM.
      return;
    } else {
      // ── Agent conversation mode: edit the progress placeholder in-place,
      // or post a new message if no placeholder exists ──
      const convMetadata = { contentFormat: "markdown" };
      const agentResult = resultWithCitations;

      if (payload.attachments?.length) {
        const form = new FormData();
        for (const att of payload.attachments) {
          const buffer = Buffer.from(att.data, "base64");
          const blob = new Blob([buffer], { type: att.mimeType });
          form.append("files", blob, att.fileName);
        }
        form.append("channelId", ctx.channelId);
        form.append("conversationId", ctx.conversationId);
        form.append("userId", ctx.spacesAppUserId);
        form.append("markdownText", agentResult);
        form.append("metadata", JSON.stringify(convMetadata));
        await spacesAppFetchMultipart("/files/filesUpload", form, token);
        log.info(`Agent ${ctx.agentSlug}: replied with ${payload.attachments.length} attachment(s)`);
      } else {
        // Placeholder path: if we have the "⏳" messageId, edit it with the final
        // result so the same message transitions from "working..." to the answer.
        // On any update failure, fall through to a fresh postMessage so the user
        // never goes without the final answer.
        let posted = false;
        if (!USE_EPHEMERAL_PROGRESS && ctx.progressMessageId) {
          try {
            await spacesAppFetch("/chat/updateMessage", {
              messageId: ctx.progressMessageId,
              markdownText: agentResult,
              userId: ctx.spacesAppUserId,
              metadata: convMetadata,
            }, token);
            log.info(`Updated placeholder ${ctx.progressMessageId} with final result for ${ctx.agentSlug}`);
            posted = true;
          } catch (err) {
            log.warn("Failed to update placeholder with final result — falling back to fresh post", { error: err instanceof Error ? err.message : String(err) });
          }
        }
        if (!posted) {
          log.info(`Posting result: channelId=${ctx.channelId} conversationId=${ctx.conversationId} resultLen=${agentResult.length} userId=${ctx.spacesAppUserId}`);
          await spacesAppFetch("/chat/postMessage", {
            channelId: ctx.channelId,
            conversationId: ctx.conversationId,
            markdownText: agentResult,
            userId: ctx.spacesAppUserId,
            metadata: convMetadata,
          }, token);
          log.info(`Agent ${ctx.agentSlug}: replied in thread ${ctx.conversationId}`);
        }
      }
    }

    // ── Post question buttons in thread ──
    const pendingQuestions = (payload as { pendingQuestions?: Array<{ questionId: string; question: string; options: string[] }> }).pendingQuestions;
    if (pendingQuestions?.length) {
      const OPTION_COLORS = ["#3b82f6", "#8b5cf6", "#f59e0b", "#10b981"];
      for (const q of pendingQuestions) {
        const actions = q.options.map((opt, i) => [
          `  - actionId: "${crypto.randomUUID()}"`,
          `    label: "${opt.replace(/"/g, '\\"')}"`,
          `    type: "button"`,
          `    color: "${OPTION_COLORS[i % OPTION_COLORS.length]}"`,
          `    actionableUrl: "${CONFIG.selfUrl}/claw/api/v1/app/callback"`,
          `    context:`,
          `      actionType: "user-answer"`,
          `      questionId: "${q.questionId}"`,
          `      answer: "${opt.replace(/"/g, '\\"')}"`,
          `      agentSlug: "${ctx.agentSlug ?? ""}"`,
          `      channelId: "${ctx.channelId}"`,
          `      conversationId: "${ctx.conversationId}"`,
          `      userId: "${ctx.senderId}"`,
        ].join("\n"));
        const questionMsg = ["---", "appActions:", ...actions, "---", "", q.question].join("\n");
        await spacesAppFetch("/chat/postMessage", {
          channelId: ctx.channelId,
          conversationId: ctx.conversationId,
          markdownText: questionMsg,
          userId: ctx.spacesAppUserId,
          metadata: { hasAppActions: true, appId: ctx.spacesAppId, contentFormat: "markdown" },
        }, token);
      }
      log.info(`Posted ${pendingQuestions.length} question(s) in thread ${ctx.conversationId}`);
    }

    // ── Send approval DMs for pending write actions (HITL) ──
    const pendingActionsPayload = (payload as { pendingActions?: Array<Record<string, unknown>> }).pendingActions;
    if (pendingActionsPayload?.length) {
      for (const action of pendingActionsPayload) {
        const actionDesc = formatActionDescription(action["tool"] as string, action["params"] as Record<string, unknown>);
        const approveId = crypto.randomUUID();
        const declineId = crypto.randomUUID();

        const actionMsg = [
          "---",
          "appActions:",
          `  - actionId: "${approveId}"`,
          `    label: "Approve"`,
          `    type: "button"`,
          `    color: "#22c55e"`,
          `    actionableUrl: "${CONFIG.selfUrl}/claw/api/v1/app/callback"`,
          `    context:`,
          `      actionType: "write"`,
          `      serverType: "${action["serverType"] as string}"`,
          `      tool: "${action["tool"] as string}"`,
          `      params: ${JSON.stringify(JSON.stringify(action["params"]))}`,
          `      userId: "${action["userId"] as string}"`,
          `      signature: "${action["signature"] as string}"`,
          `  - actionId: "${declineId}"`,
          `    label: "Decline"`,
          `    type: "button"`,
          `    color: "#ef4444"`,
          `    actionableUrl: "${CONFIG.selfUrl}/claw/api/v1/app/callback"`,
          `    context:`,
          `      userId: "${action["userId"] as string}"`,
          "---",
          "",
          `The agent wants to execute:\n\n${actionDesc}`,
        ].join("\n");

        // Post in the same thread where the conversation happened
        if (action["tool"] === "spaces-memory-create" && (action["params"] as Record<string, unknown>)?.["content"]) {
          const memParams = action["params"] as Record<string, unknown>;
          const memContent = memParams["content"] as string;
          const memDocType = (memParams["docType"] as string) ?? "fact";
          const form = new FormData();
          const blob = new Blob([memContent], { type: "text/markdown" });
          form.append("files", blob, `memory-${memDocType}-${Date.now()}.md`);
          form.append("channelId", ctx.channelId);
          form.append("conversationId", ctx.conversationId);
          form.append("userId", ctx.spacesAppUserId);
          form.append("markdownText", actionMsg);
          form.append("metadata", JSON.stringify({ hasAppActions: true, appId: ctx.spacesAppId, contentFormat: "markdown" }));
          await spacesAppFetchMultipart("/files/filesUpload", form, token);
        } else {
          await spacesAppFetch("/chat/postMessage", {
            channelId: ctx.channelId,
            conversationId: ctx.conversationId,
            markdownText: actionMsg,
            userId: ctx.spacesAppUserId,
            metadata: { hasAppActions: true, appId: ctx.spacesAppId, contentFormat: "markdown" },
          }, token);
        }
      }

      log.info(`Sent ${pendingActionsPayload.length} write action approval(s) to ${ctx.senderId}`);
    }

    // ── Agent chaining: auto-trigger next agent if chain config exists ──
    // Priority: user-level chainConfig > agent-level config.chain
    if (ctx.agentSlug) {
      try {
        const agentRow = await agentRepository.findBySlug(ctx.agentSlug);

        // Check user-level chain config first, fall back to global agent config
        const userChainRow = await userAgentConfigRepository.findByUserAndAgent(ctx.senderId, ctx.agentSlug);
        const chain = userChainRow?.chainConfig
          ? parseChainConfig({ chain: userChainRow.chainConfig } as Record<string, unknown>)
          : parseChainConfig(agentRow?.config as Record<string, unknown> | null);

        if (chain?.onComplete?.triggerAgent) {
          // maxDepth = number of full loops (A→B = 1 loop). Each loop = 2 steps.
          const MAX_LOOPS = 3;
          const configLoops = Math.min(chain.maxDepth ?? MAX_LOOPS, MAX_LOOPS);
          const maxDepth = configLoops * 2; // convert loops to steps
          const currentDepth = ctx.chainDepth ?? 0;
          const resultText = resultWithCitations;
          const hasConditions = (chain.onComplete.conditions?.toolsMustInclude?.length ?? 0) > 0 ||
            (chain.onComplete.conditions?.toolsMustExclude?.length ?? 0) > 0;

          // 1. Depth check
          let shouldContinue = currentDepth < maxDepth;
          if (!shouldContinue) {
            log.info(`Chain: max depth ${configLoops} loops reached — stopping`);
            // Notify the user who initiated the chain
            await spacesAppFetch("/chat/postMessage", {
              channelId: ctx.channelId,
              conversationId: ctx.conversationId,
              text: `<span data-mention="" data-mention-type="user" data-user-id="${ctx.senderId}" data-username="${ctx.senderName}" class="chat-input-mention">@${ctx.senderName}</span> Agent chain completed ${configLoops} loops. Review the results above.`,
              userId: ctx.spacesAppUserId,
            }, token).catch(() => {});
          }

          // 2. Deterministic or LLM judge
          if (shouldContinue) {
            if (hasConditions) {
              const toolsUsed = (payload as { toolsUsed?: string[] }).toolsUsed ?? [];
              shouldContinue = evaluateChainConditions(chain.onComplete.conditions, toolsUsed);
              if (!shouldContinue) log.info(`Chain: conditions not met — skipping`);
            } else {
              const judgment = await judgeChainContinuation(resultText, ctx.agentSlug, chain.onComplete.triggerAgent, chain.onComplete.task, ctx.task, chain.onComplete.judgeContext);
              shouldContinue = judgment === "continue";
              if (!shouldContinue) log.info(`Chain: judge says STOP — ending chain`);
            }
          }

          // 3. Trigger next agent
          if (shouldContinue) {
            const interpolatedTask = interpolateChainTask(chain.onComplete.task, {
              result: resultText.slice(0, 4000),
              agentSlug: ctx.agentSlug,
              channelId: ctx.channelId,
              conversationId: ctx.conversationId,
            });

            const targetAgentRow = await agentRepository.findBySlug(chain.onComplete.triggerAgent);
            if (!targetAgentRow?.spacesAppToken || !targetAgentRow.spacesAppId) {
              log.error(`Chain: target agent "${chain.onComplete.triggerAgent}" not found or not configured`);
              return;
            }
            const runRes = await fetch(`${CONFIG.selfUrl}/claw/api/v1/run`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                userId: ctx.senderId,
                task: interpolatedTask,
                agentSlug: chain.onComplete.triggerAgent,
                channelId: ctx.channelId,
                callbackUrl: `${CONFIG.selfUrl}/claw/api/v1/webhook/result`,
                progressUrl: `${CONFIG.selfUrl}/claw/api/v1/webhook/progress`,
              }),
            });

            if (!runRes.ok) { log.error(`Chain trigger HTTP ${runRes.status}`); return; }
            const runBody = (await runRes.json()) as { success: boolean; sessionId?: string; error?: string };

            if (runBody.success && runBody.sessionId && targetAgentRow?.spacesAppToken && targetAgentRow.spacesAppId) {
              const targetAppToken = decryptStoredField(targetAgentRow.spacesAppToken);
              const targetContext: SessionContext = {
                mentionedUserId: targetAgentRow.spacesAppUserId ?? "",
                senderId: ctx.senderId,
                senderName: ctx.senderName,
                channelId: ctx.channelId,
                channelName: ctx.channelName,
                conversationId: ctx.conversationId,
                task: interpolatedTask,
                agentSlug: chain.onComplete.triggerAgent,
                responseMode: "conversation",
                appToken: targetAppToken,
                spacesAppId: targetAgentRow.spacesAppId,
                spacesAppUserId: targetAgentRow.spacesAppUserId ?? "",
                chainDepth: currentDepth + 1,
                ...(ctx.traceId ? { traceId: ctx.traceId } : {}),
              };
              await setSession(runBody.sessionId, targetContext);
              await registerRunRecovery({
                rootSessionId: runBody.sessionId,
                maxRetries: CONFIG.runRecoveryMaxRetries,
                timeoutMs: CONFIG.runRecoveryTimeoutMs,
                retryBackoffMs: CONFIG.runRecoveryBackoffMs,
                dispatchPayload: {
                  userId: ctx.senderId,
                  task: interpolatedTask,
                  conversationId: ctx.conversationId,
                  agentSlug: chain.onComplete.triggerAgent,
                  eventType: "APP_MENTIONED",
                  traceId: ctx.traceId ?? runBody.sessionId,
                  callbackUrl: `${CONFIG.selfUrl}/claw/api/v1/webhook/result`,
                  progressUrl: `${CONFIG.selfUrl}/claw/api/v1/webhook/progress`,
                  channelId: ctx.channelId,
                },
                sessionContext: targetContext,
              });
              const loopNum = Math.ceil((currentDepth + 1) / 2);
              log.info(`Chain: ${ctx.agentSlug} → ${chain.onComplete.triggerAgent} (step ${currentDepth + 1}/${maxDepth}, loop ${loopNum}/${configLoops})`);
              await spacesAppFetch("/chat/postMessage", {
                channelId: ctx.channelId,
                conversationId: ctx.conversationId,
                markdownText: `⛓️ **Agent chain**: \`${ctx.agentSlug}\` → \`${chain.onComplete.triggerAgent}\` (loop ${loopNum}/${configLoops})`,
                userId: ctx.spacesAppUserId,
                metadata: { contentFormat: "markdown" },
              }, token).catch(() => {});
            } else if (!runBody.success) {
              log.error(`Chain: failed to trigger ${chain.onComplete.triggerAgent}: ${runBody.error ?? "unknown"}`);
            }
          }
        }
      } catch (chainErr) {
        log.error("Chain trigger failed (non-fatal):", { error: chainErr instanceof Error ? chainErr.message : String(chainErr) });
      }
    }
  } catch (err) {
    log.error("Failed to send result", { error: err instanceof Error ? err.message : String(err) });
  }
});

// ── POST /webhook/progress — live tool-call update from xyne-claw ───────────
//
// xyne-claw POSTs here on every tool_execution_start (throttled to 10s).
// We look up the session, then call updateMessage on the progress placeholder.

router.post("/progress", async (req: Request, res: Response) => {
  const { sessionId, toolLabel, toolInvocation, sandboxPreviewUrl, sandboxId } = req.body as {
    sessionId?: string;
    toolLabel?: string;
    toolInvocation?: unknown;
    sandboxPreviewUrl?: string;
    sandboxId?: string;
  };

  // Acknowledge immediately — we never block xyne-claw
  res.json({ success: true });

  if (!sessionId) return;

  await touchRunRecovery(sessionId).catch((err) => {
    console.warn(`[webhook/progress] touchRunRecovery failed for ${sessionId}:`, err instanceof Error ? err.message : err);
  });

  // Incremental tool streaming — fires on every tool_execution_end
  if (toolInvocation) {
    agentRunRepository.appendToolInvocation(sessionId, toolInvocation).catch((e) => {
      console.warn(`[webhook/progress] appendToolInvocation failed for ${sessionId}:`, e instanceof Error ? e.message : e);
    });
    return;
  }

  // One-shot sandbox preview announce — claw fires this the first time a kata
  // session is acquired, so the user gets a clickable noVNC link in the channel
  // while the agent is still working. claw-side guards against re-emit, but we
  // also check the in-memory Set here in case run-recovery re-delivers.
  if (sandboxPreviewUrl && sandboxId) {
    if (announcedSandboxPreviews.has(sessionId)) return;
    announcedSandboxPreviews.add(sessionId);
    const ctx = await getSession(sessionId).catch(() => null) ?? await getRecoveryContextForSession(sessionId).catch(() => null);
    if (!ctx || ctx.responseMode !== "conversation") return;
    const log = createLogger("webhook/progress", ctx.traceId ?? sessionId.slice(0, 8));
    try {
      await spacesAppFetch("/chat/postMessage", {
        channelId: ctx.channelId,
        conversationId: ctx.conversationId,
        markdownText: `🖥️ **Live preview**: [Open sandbox](${sandboxPreviewUrl}) — agent is working in this room. Anyone in this channel can watch (and drive) chromium over noVNC.`,
        userId: ctx.spacesAppUserId,
        metadata: { contentFormat: "markdown" },
      }, ctx.appToken);
      log.info(`Sandbox preview announced: ${sandboxPreviewUrl} (sandboxId=${sandboxId})`);
    } catch (err) {
      log.warn("Failed to announce sandbox preview", { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (!toolLabel) return;

  // Record progress for the Agent Control Center (fire-and-forget)
  agentRunRepository.updateProgress(sessionId, toolLabel).catch(() => {});

  let ctx = await getSession(sessionId).catch(() => null);
  if (!ctx) {
    ctx = await getRecoveryContextForSession(sessionId).catch(() => null);
  }
  if (!ctx) return;
  // Only publish progress for conversation mode (DM / app-mention) — approval mode has no live surface.
  if (ctx.responseMode !== "conversation") return;

  const log = createLogger("webhook/progress", ctx.traceId ?? sessionId.slice(0, 8));

  try {
    if (USE_EPHEMERAL_PROGRESS) {
      await spacesAppFetch("/chat/agentProgress", {
        conversationId: ctx.conversationId,
        channelId: ctx.channelId,
        agentSlug: ctx.agentSlug,
        userId: ctx.spacesAppUserId,
        toolLabel,
        status: "working",
      }, ctx.appToken);
      log.info(`Progress (ephemeral): ${toolLabel} → conv=${ctx.conversationId}`);
    } else if (ctx.progressMessageId) {
      await spacesAppFetch("/chat/updateMessage", {
        messageId: ctx.progressMessageId,
        markdownText: `⏳ ${toolLabel}`,
        userId: ctx.spacesAppUserId,
      }, ctx.appToken);
      log.info(`Progress (placeholder): ${toolLabel} → messageId=${ctx.progressMessageId}`);
    }
    // else: placeholder mode with no placeholderId (initial post failed) — silently skip
  } catch (err) {
    log.warn("Failed to publish agent progress signal", { error: err instanceof Error ? err.message : String(err) });
  }
});

// Register webhook routes — generic and agent-specific (AFTER /result to avoid param catch)
router.post("/", handleWebhook);
router.post("/:agentSlug", handleWebhook);

export { router as webhookRouter };
