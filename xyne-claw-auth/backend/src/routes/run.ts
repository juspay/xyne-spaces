import { Router, type NextFunction, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { decrypt } from "../crypto.js";
import { chatMessageRepository, agentRunRepository, chatAttachmentRepository, userProviderCredentialsRepository } from "../repositories/index.js";
import { buildAgentCatalog } from "../services/agentCatalogService.js";
import { gcsService } from "../services/gcsService.js";
import {
  normalizeAttachedContext,
  buildAttachedContextPayload,
  type AttachedContextRef,
} from "../services/agentChatContextService.js";
import { storeForSession as storeAttachedContextForSession } from "../mcp/attached-context-injector.js";
import { storeRunScalars } from "../mcp/run-scalars.js";
import type { SpacesAuthContext } from "../mcp/servers/xyne-spaces-client.js";
import { resolveCustomSubagentsForRun } from "../lib/subagent-resolver.js";
import {
  resolveCallableAgentsForRun,
  resolveCallableAgentSpecForOrchestratorCall,
  resolveOrchestratorCallableAgentsForRun,
} from "../lib/callable-agent-resolver.js";
import { ClawSseParser, parseToolsConfig, stripPlatformConfigKeys } from "xyne-claw-shared";
import { mintSessionToken } from "../lib/session-tokens.js";
import { consumeAlreadyOpenStream } from "../lib/consume-claw-stream.js";
import { resolveAgentProviderConfigs, resolveSubagentProviderMode, type ProviderConfig } from "../lib/agent-provider-config.js";
import { resolveFastMode } from "../lib/fast-mode.js";
import { redisService } from "../redis.js";
import { requireAuth, requireStrictS2S, requireUserAuth, requireResultToken, s2sKeyMatches } from "../middleware/require-auth.js";
import { handleRunCompletion, handleRunHandoff } from "../queue/run-recovery-worker.js";
import { getDmChannelForUserAndApp, getWorkspaceIdForUser } from "../lib/spaces-db.js";
import { isAllowedExternalCallbackUrl, isInternalCallbackOrigin, type ExternalResultCallbackConfig } from "../surfaces/external-api/delivery.js";
import type { VerifiedCliToken } from "../lib/cli-tokens.js";
import { agentScopeAllows, sanitizeExternalRunBody } from "../lib/service-tokens.js";
import { encryptSurfaceSecret } from "../lib/surface-resolver.js";

import { createLogger } from "../logger.js";
import { getRequesterId, getOrgId, isClawAdmin } from "../middleware/agent-acl.js";
import type { SessionContext } from "./webhook.js";
const log = createLogger("run");

const router = Router();

const RUN_RETRY_DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectErrorCodes(err: unknown): string[] {
  const codes: string[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown): void => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    if (typeof value === "object") {
      const maybe = value as { code?: unknown; cause?: unknown; errors?: unknown };
      if (typeof maybe.code === "string") codes.push(maybe.code);
      visit(maybe.cause);
      if (Array.isArray(maybe.errors)) {
        for (const child of maybe.errors) visit(child);
      }
    }
  };
  visit(err);
  return codes;
}

function isConnectionRefusedClassError(err: unknown): boolean {
  const codes = collectErrorCodes(err);
  return codes.includes("ECONNREFUSED") || codes.includes("EAI_AGAIN");
}

async function fetchClawRunWithRetry(init: RequestInit, label: string): Promise<globalThis.Response> {
  let retried = false;
  for (;;) {
    try {
      const response = await fetch(`${CONFIG.xyneClawUrl}/run`, init);
      if (response.status === 503 && !retried) {
        retried = true;
        log.warn(`[run] proxy: retrying claw /run once after 503 (${label})`);
        await sleep(RUN_RETRY_DELAY_MS);
        continue;
      }
      return response;
    } catch (err) {
      if (!retried && isConnectionRefusedClassError(err)) {
        retried = true;
        log.warn(`[run] proxy: retrying claw /run once after ${collectErrorCodes(err).join(",") || "connection refusal"} (${label})`);
        await sleep(RUN_RETRY_DELAY_MS);
        continue;
      }
      throw err;
    }
  }
}

function requireRunCaller(req: Request, res: Response, next: NextFunction): void | Promise<void> {
  if (req.originalUrl.includes("/internal/run")) {
    return requireAuth(req, res, next);
  }
  if ((req.body as { triggerSource?: unknown } | undefined)?.triggerSource === "api") {
    return requireAuth(req, res, next);
  }
  return requireUserAuth(req, res, next);
}

type AgentRunTriggerSource = "spaces" | "scheduled" | "chat" | "api" | "automation" | "slack";

function triggerSourceForEventType(eventType: unknown, requested: unknown): AgentRunTriggerSource {
  if (requested === "slack") return "slack";
  if (eventType === "automation") return "automation";
  if (eventType === "scheduled_job") return "scheduled";
  return "spaces";
}

const ASSISTANT_PROMPT = `You are a helpful AI assistant powered by Xyne Spaces. You help the user by searching their workspace data — messages, tickets, activity, and knowledge base — to give accurate, grounded answers.

## How to Build Context (do this FIRST)
You have access to the \`spaces-research\` tool — it spawns a dedicated research agent that thoroughly searches the workspace and returns structured findings. **Use it for any query that needs deep context** — it does a much better job than searching manually.

For simple queries (quick lookup, recent activity):
- Use spaces-search, spaces-activity, spaces-tickets directly

For complex queries (summarize discussions, find context across channels, understand what happened):
- Use \`spaces-research\` with a detailed topic description
- Spawn multiple \`spaces-research\` calls for different angles if needed

Available tools for direct use:
1. **Recent activity** — spaces-activity
2. **Messages & conversations** — spaces-messages
3. **Tickets & work items** — spaces-tickets
4. **Search** — spaces-search
5. **People lookup** — spaces-users
6. **Deep research** — spaces-research (delegated research agent)

## How to Respond
- Be helpful, thorough, and detailed.
- Ground every answer in data from tools. Do not guess.
- For engineering queries — use Bitbucket, Kibana, or Grafana tools.
- Acknowledge gaps honestly.
- Give detailed, thorough responses with context, reasoning, and relevant data.

## Write Actions & Approvals
Some tools (like creating tickets or scheduling calls) require user approval before executing. When you call these tools, they will return "Action queued for approval". This is NORMAL — it means:
- The action details have been sent to the user as an Approve/Decline button
- The user will see the action details and can approve or decline
- You should tell the user: "I've queued the action for your approval — check for the Approve button."
- Do NOT retry or treat this as an error. The action will execute when the user approves.

## Critical Rules
1. NEVER fabricate information. Only use data retrieved from tools.
2. ALWAYS gather context before responding.
3. When a tool returns "Action queued for approval", tell the user to approve it — do NOT retry.`;

/** Used for USER_MENTIONED — digital twin mode (respond AS the user) */
const TWIN_PROMPT = `You are the **Digital Twin** of the user. You act, think, and respond exactly as this person would.

## Identity
You ARE this user's digital representative. Someone has @mentioned this user in a channel and you are responding on their behalf. Respond the way this person would, using their knowledge, context, communication style, and expertise.

## How to Build Context (do this FIRST)
You have access to the \`spaces-research\` tool — it spawns a dedicated research agent that thoroughly searches the workspace and returns structured findings. **Use it for any query that needs deep context** — it does a much better job than searching manually.

For simple queries (quick lookup, recent activity):
- Use spaces-search, spaces-activity, spaces-tickets directly

For complex queries (summarize discussions, find context across channels, understand what happened):
- Use \`spaces-research\` with a detailed topic description
- Spawn multiple \`spaces-research\` calls for different angles if needed

Available tools for direct use:
1. **Recent activity** — spaces-activity
2. **Messages & conversations** — spaces-messages
3. **Tickets & work items** — spaces-tickets
4. **Search** — spaces-search
5. **People lookup** — spaces-users
6. **Deep research** — spaces-research (delegated research agent)

## Voice — write as the user, NOT as a bot
This is a chat reply that will be posted under the user's own name. It must read
like THEY typed it in the moment — not like an AI report.

**Before you draft, learn how this user writes.** Look at the thread and call
\`memory-search\` for how they reply (tone, length, greetings, sign-offs, emoji,
whether they use slang or stay formal). Then mirror it. When unsure, default to a
short, casual, first-person chat message.

**Hard rules on format — break these and the reply looks robotic:**
- NO markdown headings (\`#\`, \`##\`, \`###\`). This is chat, not a document.
- NO tables, NO "Analysis / Summary / Status / Reason:" report scaffolding.
- NO long bulleted dumps of tool output. Pull out what matters and say it in prose.
- Do not paste raw tool/log/build output. Read it, understand it, then say what it
  means in your own words.
- ONLY use heavier structure (a couple of bullets, etc.) if THIS user actually
  writes that way — otherwise keep it as flowing sentences.

**Substance:**
- The research/tools are for *what to say*; your voice is for *how to say it*.
- Ground every claim in data from tools. Do not guess. Acknowledge gaps honestly.
- Respond in first person ("I", "my", "we") as the user.
- Keep it **short — 2 to 6 lines**. People skim chat. Be direct and human.
- Do thorough research behind the scenes, but the final reply stays concise and conversational.

## Write Actions & Approvals
Some tools (like creating tickets or scheduling calls) require user approval before executing. When you call these tools, they will return "Action queued for approval". This is NORMAL — it means:
- The action details have been sent to the user as an Approve/Decline button
- The user will see the action details and can approve or decline
- You should tell the user: "I've queued the action for your approval — check for the Approve button."
- Do NOT retry or treat this as an error. The action will execute when the user approves.

## Critical Rules
1. NEVER fabricate information. Only use data retrieved from tools.
2. ALWAYS gather context before responding.
3. Respond as the user, not as an assistant describing the user.
4. Write a human chat message in the user's voice — never a structured report (no headings/tables/scaffolding).
5. When a tool returns "Action queued for approval", tell the user to approve it — do NOT retry.`;

// ── Resolve identity: gateway call → Xyne Spaces userId ──

async function resolveUserId(body: Record<string, unknown>): Promise<{ userId: string; userName: string; userEmail: string; orgId?: string } | { error: string }> {
  const { userId, userName, gatewayType, externalUserId } = body as {
    userId?: string;
    userName?: string;
    gatewayType?: string;
    externalUserId?: string;
  };

  // Direct call with userId (e.g., from Xyne Spaces)
  if (userId && typeof userId === "string" && userId.trim().length > 0) {
    const user = await prisma.user.findUnique({ where: { id: userId.trim() }, select: { name: true, email: true, orgId: true } });
    return {
      userId: userId.trim(),
      userName: userName?.trim() ?? user?.name ?? "",
      userEmail: user?.email ?? "",
      ...(user?.orgId ? { orgId: user.orgId } : {}),
    };
  }

  // Gateway call — resolve externalUserId → Xyne Spaces userId
  if (gatewayType && externalUserId) {
    const gateway = await prisma.gateway.findUnique({ where: { type: gatewayType } });
    if (!gateway) {
      return { error: `Unknown gateway type: ${gatewayType}` };
    }
    if (!gateway.enabled) {
      return { error: `Gateway '${gatewayType}' is disabled` };
    }

    const identity = await prisma.gatewayIdentity.findFirst({
      where: { gatewayId: gateway.id, externalUserId: externalUserId.trim() },
      include: { user: true },
    });

    if (!identity) {
      return { error: `No linked Xyne Spaces account for ${gatewayType} user '${externalUserId}'` };
    }

    return {
      userId: identity.userId,
      userName: identity.user.name,
      userEmail: identity.user.email,
      ...(identity.user.orgId ? { orgId: identity.user.orgId } : {}),
    };
  }

  return { error: "Either userId or (gatewayType + externalUserId) is required" };
}

// ── Resolve Spaces auth from request (for service-to-service calls) ──

async function resolveSpacesAuthFromRequest(req: Request, userId?: string): Promise<SpacesAuthContext | undefined> {
  try {
    // Parse cookies — may be absent, header/Authorization fallbacks still apply.
    const cookieMap = new Map<string, string>();
    const cookies = req.headers.cookie;
    if (cookies) {
      for (const cookie of cookies.split(";")) {
        const [name, ...rest] = cookie.trim().split("=");
        if (name && rest.length > 0) {
          cookieMap.set(name, rest.join("="));
        }
      }
    }

    // Workspace id: x-workspace-id header → xyne_last_workspace cookie
    const workspaceHeader = req.headers["x-workspace-id"];
    const workspaceId = (typeof workspaceHeader === "string" && workspaceHeader.trim())
      ? workspaceHeader.trim()
      : cookieMap.get("xyne_last_workspace");

    // Token: workspace-scoped JWT → legacy google_access_token JWT → Authorization Bearer
    let token: string | undefined;
    if (workspaceId) {
      const wsToken = cookieMap.get(`xyne_ws_${workspaceId}_token`);
      if (wsToken && wsToken.split(".").length === 3) {
        token = wsToken;
      }
    }
    if (!token) {
      const legacy = cookieMap.get("google_access_token");
      if (legacy && legacy.split(".").length === 3) {
        token = legacy;
      }
    }
    if (!token) {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        token = authHeader.slice(7);
      }
    }

    // Session id: x-session-id header → xyne_session cookie → user_session_id cookie.
    // Spaces' authV2 sets `user_session_id`, not `xyne_session` — checking both
    // keeps legacy callers working while fixing the dominant miss.
    const sessionHeader = req.headers["x-session-id"];
    const sessionId = (typeof sessionHeader === "string" && sessionHeader.trim())
      ? sessionHeader.trim()
      : cookieMap.get("xyne_session") ?? cookieMap.get("user_session_id");

    if (!token && !sessionId) return undefined;

    const effectiveWorkspaceId = workspaceId
      ?? (userId ? await getWorkspaceIdForUser(userId, "require-auth").catch(() => null) : null)
      ?? undefined;
    if (!workspaceId && effectiveWorkspaceId) {
      log.info(`[run] resolved Spaces workspaceId=${effectiveWorkspaceId} from user row for userId=${userId ?? "unknown"}`);
    }

    return {
      ...(token ? { token } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(effectiveWorkspaceId ? { workspaceId: effectiveWorkspaceId } : {}),
    };
  } catch (err) {
    log.warn("[run] Failed to resolve Spaces auth from request:", err);
    return undefined;
  }
}

// ── Resolve agent config ──

async function resolveAgent(agentSlug: string | undefined, orgId: string | undefined): Promise<{
  id: string;
  systemPrompt: string;
  modelId?: string | undefined;
  agentConfig: Record<string, unknown>;
  config?: unknown;
  orgId: string;
  delegationTier: "standard" | "orchestrator";
  spacesAppId?: string | null;
  spacesAppToken?: string | null;
  spacesAppUserId?: string | null;
  skills?: {
    slug: string;
    name: string;
    description: string;
    content: string;
    files?: Array<{ relativePath: string; content: string; contentType?: string | null }>;
  }[];
} | { error: string }> {
  // Find by slug, or fall back to default agent. Include the skill's
  // sibling files (SkillFile rows) so directory-style skills get
  // materialized in the child workspace alongside SKILL.md.
  const includeSkills = { skills: { include: { skill: { include: { files: true } } } } };
  if (agentSlug && !orgId) {
    log.error(`[run] orgId is required for agentSlug lookup agentSlug=${agentSlug}`);
    return { error: `Agent '${agentSlug}' not found` };
  }
  if (!agentSlug && !orgId) {
    log.error("[run] orgId is required; refusing global default-agent lookup agentSlug=default orgId=none");
    return { error: "orgId is required" };
  }
  const agent = agentSlug
    ? await prisma.agent.findUnique({
      where: { orgId_slug: { orgId: orgId!, slug: agentSlug } },
      include: includeSkills,
    })
    : await prisma.agent.findFirst({ where: { orgId: orgId!, isDefault: true }, include: includeSkills });

  if (!agent) {
    return { error: agentSlug ? `Agent '${agentSlug}' not found` : "No default agent configured" };
  }
  if (!agent.enabled) {
    return { error: `Agent '${agent.slug}' is disabled` };
  }

  // Skills via junction table — forward slug/name/description/content so the
  // worker can build clean YAML frontmatter regardless of what's in `content`
  // (UI-created skills are plain text; seeded skills have inline frontmatter).
  // Also forward `files[]` (relativePath/content) — extra files in the skill
  // directory beyond SKILL.md.
  const skills = agent.skills.map((as) => ({
    slug: as.skill.slug,
    name: as.skill.name,
    description: as.skill.description ?? "",
    content: as.skill.content,
    ...(as.skill.files.length > 0
      ? {
          files: as.skill.files.map((f) => ({
            relativePath: f.relativePath,
            content: f.content,
            contentType: f.contentType,
          })),
        }
      : {}),
  }));

  return {
    id: agent.id,
    systemPrompt: agent.systemPrompt,
    modelId: agent.modelId || undefined,
    orgId: agent.orgId,
    delegationTier: agent.delegationTier === "orchestrator" ? "orchestrator" : "standard",
    spacesAppId: agent.spacesAppId ?? null,
    spacesAppToken: agent.spacesAppToken ?? null,
    spacesAppUserId: agent.spacesAppUserId ?? null,
    agentConfig: stripPlatformConfigKeys(agent.config as Record<string, unknown>),
    config: agent.config,
    ...(skills.length > 0 ? { skills } : {}),
  };
}

// ── POST /clone-session — forward chat-branching session clone to xyne-claw ──
//
// claw-auth doesn't own PI session files (xyne-claw does), so chat branching
// asks xyne-claw to materialize a sibling JSONL via SessionManager.createBranchedSession.
// This route is the S2S bridge. Body: { sourceConversationId, targetConversationId, branchMode? }
router.post("/clone-session", requireStrictS2S, async (req: Request, res: Response) => {
  const { sourceConversationId, targetConversationId, branchMode } = req.body as {
    sourceConversationId?: string;
    targetConversationId?: string;
    branchMode?: "lastUser" | "beforeLastUser";
  };
  if (!sourceConversationId || typeof sourceConversationId !== "string") {
    res.status(400).json({ success: false, error: "sourceConversationId is required" });
    return;
  }
  if (!targetConversationId || typeof targetConversationId !== "string") {
    res.status(400).json({ success: false, error: "targetConversationId is required" });
    return;
  }
  try {
    const clawRes = await fetch(`${CONFIG.xyneClawUrl}/clone-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify({
        sourceConversationId,
        targetConversationId,
        branchMode: branchMode ?? "lastUser",
      }),
    });
    const body = (await clawRes.json().catch(() => ({}))) as { success?: boolean; error?: string };
    if (!clawRes.ok) {
      res.status(clawRes.status).json({ success: false, error: body.error ?? `HTTP ${clawRes.status}` });
      return;
    }
    res.json({ success: body.success === true, ...(body.error ? { error: body.error } : {}) });
  } catch (err) {
    log.error("[run] clone-session forward failed:", err instanceof Error ? err.message : err);
    res.status(502).json({ success: false, error: "Failed to reach agent service" });
  }
});

router.get("/callable-agent-spec", requireStrictS2S, async (req: Request, res: Response) => {
  try {
    const caller = (req.query["caller"] as string | undefined)?.trim();
    const callee = (req.query["callee"] as string | undefined)?.trim();
    const userId = (req.query["userId"] as string | undefined)?.trim();
    const sessionId = (req.query["sessionId"] as string | undefined)?.trim();
    if (!caller || !callee || !userId || !sessionId) {
      res.status(400).json({ success: false, error: "caller, callee, userId, and sessionId are required" });
      return;
    }

    const resolvedSpec = await resolveCallableAgentSpecForOrchestratorCall(prisma, {
      callerSlug: caller,
      calleeSlug: callee,
      userId,
    });
    if ("error" in resolvedSpec) {
      res.status(resolvedSpec.status).json({ success: false, error: resolvedSpec.error });
      return;
    }

    res.json({
      success: true,
      data: {
        ...resolvedSpec.spec,
        sessionToken: mintSessionToken({
          sessionId,
          userId,
          agentSlug: resolvedSpec.spec.slug,
          ...(resolvedSpec.spec.spacesAppId ? { spacesAppId: resolvedSpec.spec.spacesAppId } : {}),
          ttlSeconds: 6 * 60 * 60,
        }),
      },
    });
  } catch (err) {
    log.error("[run] callable-agent-spec error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── POST /run — accept task, resolve identity + agent, forward to xyne-claw ──

router.post("/run", requireRunCaller, async (req: Request, res: Response) => {
  try {
    // Service tokens get the EXTERNAL body contract: unknown fields (provider
    // overrides, eventType, session plumbing) are stripped before the shared
    // destructure below ever sees them — external traffic must not be able to
    // masquerade as internal traffic.
    const serviceToken = (res.locals ?? {})["accessToken"] as VerifiedCliToken | undefined;
    const isServiceTokenCaller = serviceToken?.client === "service";
    if (isServiceTokenCaller) {
      const { sanitized, dropped } = sanitizeExternalRunBody(req.body as Record<string, unknown>);
      if (dropped.length > 0) {
        log.warn(`[run] service token dropped non-contract fields: ${dropped.join(", ")}`);
      }
      req.body = sanitized;
    }
    const { task, context, conversationId, piSessionConversationId, agentSlug, callbackUrl, callbackSecret, channelId, deliverTo, projectId, projectName, cwd, eventType, triggerSource, slackDelivery, traceId, provider, providerOrder, providerOverride, subagentProviders, subagentProviderMode, providerConfigs, progressUrl, attachments, contextFiles, attachedContext, ticketIds, canvasIds, callIds, idempotencyKey: requestedIdempotencyKey, isRegenerate, detached, fastMode, resumedFromHandoff, generateFollowUpSuggestions } = req.body as {
      task?: string;
      context?: string;
      conversationId?: string;
      /** Optional: PI session JSONL file id. When set, OVERRIDES conversationId
       *  for the persistent-session lookup downstream. Used by chat branching
       *  so the conversation row (DB) stays the same but the PI session lives
       *  at a branched id like `${conversationId}__branch__${assistantMsgId}`. */
      piSessionConversationId?: string;
      agentSlug?: string;
      callbackUrl?: string;
      callbackSecret?: string;
      channelId?: string;
      deliverTo?: "dm";
      projectId?: string;
      projectName?: string;
      cwd?: string;
      eventType?: string;
      triggerSource?: string;
      slackDelivery?: SessionContext["slackDelivery"];
      traceId?: string;
      provider?: string;
      providerOrder?: string[];
      /** Per-run provider/model pin. Same contract as agent-chat's chat route:
       *  the Ask AI composer's model picker sends it so a user can switch model
       *  for one turn without touching the agent's stored config. */
      providerOverride?: { provider?: string; model?: string };
      subagentProviders?: Record<string, string>;
      subagentProviderMode?: "parent" | "spaces" | "fast-model";
      providerConfigs?: Record<string, ProviderConfig>;
      progressUrl?: string;
      attachments?: Array<{ fileName: string; mimeType: string; data: string }>;
      contextFiles?: Array<{ path: string; content: string }>;
      attachedContext?: Array<{ type: "channel" | "ticket" | "canvas" | "call"; id: string; title: string; threadId?: string }>;
      ticketIds?: string[];
      canvasIds?: string[];
      callIds?: string[];
      idempotencyKey?: string;
      detached?: boolean;
      fastMode?: boolean;
      resumedFromHandoff?: boolean;
      generateFollowUpSuggestions?: boolean;
      /** Branching: when true, claw branches the PI session at the last user
       *  entry so the new assistant turn is a sibling of the previous one. */
      isRegenerate?: boolean;
    };

    const defaultTriggerSource = triggerSourceForEventType(eventType, triggerSource);
    const explicitFastMode = typeof fastMode === "boolean" ? fastMode : undefined;

    log.info(`[run] Received: ticketIds=${JSON.stringify(ticketIds)}, canvasIds=${JSON.stringify(canvasIds)}, callIds=${JSON.stringify(callIds)}`);
    // [AUTODBG] confirm automation forwards reach this handler (past requireStrictS2S)
    // and which dispatch path they take. dispatchSessionId is the id the caller
    // (webhook.ts) sent; run.ts mints its own below, so this links the two.
    {
      const __dispatchSid = (req.body as { sessionId?: string }).sessionId;
      const __wantsSse = String(req.headers["accept"] || "").includes("text/event-stream");
      log.info(`[run] AUTODBG entry: eventType=${eventType} dispatchSessionId=${__dispatchSid} agent=${agentSlug} hasCallbackUrl=${!!callbackUrl} wantsSse=${__wantsSse} clawSseTransport=${CONFIG.clawSseTransport}`);
    }

    if (!task || typeof task !== "string" || task.trim().length === 0) {
      res.status(400).json({ success: false, error: "task is required and must be a non-empty string" });
      return;
    }
    if (callbackUrl !== undefined && typeof callbackUrl !== "string") {
      res.status(400).json({ success: false, error: "callbackUrl must be a string" });
      return;
    }
    if (isServiceTokenCaller && serviceToken) {
      if (!serviceToken.scopes.includes("runs:write")) {
        res.status(403).json({ success: false, error: "This token does not have the runs:write scope" });
        return;
      }
      const requestedAgent = typeof agentSlug === "string" && agentSlug.trim() ? agentSlug.trim() : "assistant";
      if (!agentScopeAllows(serviceToken.scopes, requestedAgent)) {
        // Deny-by-default: tokens minted before agent scopes existed have no
        // agent:* entries and can invoke nothing until an admin adds them
        // (per-slug, or the explicit "agent:*" org-wide wildcard).
        res.status(403).json({ success: false, error: "This token is not scoped for the requested agent" });
        return;
      }
    }
    const isInternalS2SCaller = s2sKeyMatches(req.headers["x-s2s-key"]);
    if ((triggerSource === "slack" || slackDelivery !== undefined) && !isInternalS2SCaller) {
      res.status(400).json({ success: false, error: "slackDelivery requires internal service authentication" });
      return;
    }
    if (callbackUrl
        && !isInternalCallbackOrigin(callbackUrl)
        && !isAllowedExternalCallbackUrl(callbackUrl)) {
      res.status(400).json({ success: false, error: "callbackUrl is not an allowed target" });
      return;
    }
    if (callbackSecret !== undefined && (typeof callbackSecret !== "string" || callbackSecret.length > 256)) {
      res.status(400).json({ success: false, error: "callbackSecret must be a string of at most 256 characters" });
      return;
    }

    // Resolve identity. Browser and access-token auth pin x-user-id server-side;
    // body userId is accepted only when it agrees with that authenticated id.
    const authenticatedUserId = getRequesterId(req);
    const bodyUserIdRaw = (req.body as { userId?: unknown }).userId;
    const bodyUserId = typeof bodyUserIdRaw === "string" && bodyUserIdRaw.trim()
      ? bodyUserIdRaw.trim()
      : undefined;
    if (bodyUserId && authenticatedUserId && bodyUserId !== authenticatedUserId) {
      log.warn(`[run] userId pin mismatch: session=${authenticatedUserId} body=${bodyUserId}`);
      res.status(403).json({ success: false, error: "Body userId does not match authenticated session" });
      return;
    }

    const identityBody = {
      ...(req.body as Record<string, unknown>),
      ...(!bodyUserId && authenticatedUserId ? { userId: authenticatedUserId } : {}),
    };
    const resolved = await resolveUserId(identityBody);
    if ("error" in resolved) {
      res.status(400).json({ success: false, error: resolved.error });
      return;
    }

    const headerOrgId = getOrgId(req);
    const runtimeOrgId = headerOrgId ?? resolved.orgId;
    if (agentSlug && !runtimeOrgId) {
      log.error(`[run] orgId is required for agentSlug lookup agentSlug=${agentSlug} userId=${resolved.userId}`);
      res.status(400).json({ success: false, error: "orgId is required" });
      return;
    }

    // Resolve agent (only if explicitly requested). Org comes from auth/user DB,
    // never from request body.
    const agent = await resolveAgent(agentSlug, runtimeOrgId);
    if ("error" in agent) {
      res.status(400).json({ success: false, error: agent.error });
      return;
    }

    // Per-run provider/model pin. Validate up-front (clean 400) — once the SSE
    // stream opens we can only fail mid-stream. Mirrors the agent-chat route.
    const OVERRIDABLE = new Set(["spaces", "copilot", "claude", "codex", "litellm"]);
    const runOverride = providerOverride?.provider && OVERRIDABLE.has(providerOverride.provider) ? providerOverride : undefined;
    if (providerOverride?.provider && !runOverride) {
      res.status(400).json({ success: false, error: `Unknown provider override "${providerOverride.provider}"` });
      return;
    }
    // Personal-cred providers (copilot/claude/codex) require the USER's own key.
    // "litellm" is exempt: it rides the AGENT's shared LiteLLM credential (admin-
    // set), so any caller may switch among that key's models for a single run
    // without connecting a personal key. "spaces" is the keyless platform
    // default. The litellm agent cred is validated below (its config must exist
    // in providerConfigs, else the override no-ops).
    if (runOverride?.provider && runOverride.provider !== "spaces" && runOverride.provider !== "litellm") {
      const cred = await userProviderCredentialsRepository.findByUserAndProvider(resolved.userId, runOverride.provider).catch(() => null);
      if (!cred?.encryptedKey) {
        res.status(400).json({ success: false, error: `No ${runOverride.provider} credentials for this user — connect it in Settings first` });
        return;
      }
    }

    let effectiveChannelId = channelId;
    if (!effectiveChannelId && deliverTo === "dm" && authenticatedUserId) {
      if (agent.spacesAppId) {
        effectiveChannelId = await getDmChannelForUserAndApp(authenticatedUserId, agent.spacesAppId) ?? undefined;
      }
      if (!effectiveChannelId) {
        log.warn(`[run] dm-delivery unresolved user=${authenticatedUserId} agent=${agentSlug || "assistant"}`);
      }
    }

    // For the default assistant agent: select prompt based on event type
    // USER_MENTIONED → digital twin prompt (respond AS the user)
    // DM / APP_MENTIONED → assistant prompt (help the user)
    let effectivePrompt = agent.systemPrompt;
    if (!agentSlug || agentSlug === "assistant") {
      effectivePrompt = eventType === "USER_MENTIONED" ? TWIN_PROMPT : ASSISTANT_PROMPT;
    }

    // Resolve attachedContext (+ the Spaces thread the assistant was opened
    // from) to actual content if Spaces auth is available. The thread arrives
    // as agentConfig.SPACES_CONVERSATION_ID — separate from the attachedContext
    // array — so we fold it into the same "# Attached context" block instead of
    // only surfacing its raw id in Session Metadata.
    const agentConfigBody = (req.body as { agentConfig?: Record<string, unknown> }).agentConfig;
    const readAgentConfigString = (key: string): string | undefined => {
      const raw = agentConfigBody?.[key];
      return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
    };
    const attachedThreadConversationId = readAgentConfigString("SPACES_CONVERSATION_ID");
    const attachedCanvasViewAccessId = readAgentConfigString("SPACES_CANVAS_VIEW_ACCESS_ID");
    let resolvedAttachedContext: { contextFiles: Array<{ path: string; content: string }>; promptPrefix?: string } | undefined;
    let normalizedAttached: AttachedContextRef[] = [];
    if (attachedContext?.length) {
      const normalized = normalizeAttachedContext(attachedContext);
      if (normalized.error) log.warn(`[run] attachedContext ignored: ${normalized.error}`);
      normalizedAttached = normalized.items;
    }
    if (normalizedAttached.length > 0 || attachedThreadConversationId || attachedCanvasViewAccessId) {
      // Try to get Spaces auth from request cookies
      const spacesAuth = await resolveSpacesAuthFromRequest(req, resolved.userId);
      if (spacesAuth) {
        try {
          resolvedAttachedContext = await buildAttachedContextPayload(normalizedAttached, spacesAuth, {
            ...(attachedThreadConversationId ? { threadConversationId: attachedThreadConversationId } : {}),
            ...(attachedCanvasViewAccessId ? { canvasViewAccessId: attachedCanvasViewAccessId } : {}),
          });
          log.info(`[run] Resolved ${normalizedAttached.length} attached item(s)${attachedThreadConversationId ? " + thread" : ""}${attachedCanvasViewAccessId ? " + canvas" : ""} to ${resolvedAttachedContext.contextFiles.length} context files`);
        } catch (err) {
          log.warn("[run] Failed to resolve attachedContext:", err instanceof Error ? err.message : String(err));
        }
      } else {
        log.warn("[run] No Spaces auth available to resolve attachedContext");
      }
    }

    // Forward to xyne-claw (returns sessionId immediately)
    // Include resolved attached context (contextFiles + promptPrefix) if available
    const mergedContextFiles = [
      ...(contextFiles ?? []),
      ...(resolvedAttachedContext?.contextFiles ?? []),
    ];
    
    let additionalInstructions = (req.body as { additionalInstructions?: string }).additionalInstructions ?? "";

    // Promote the attached-context prefix into `context` (NOT additionalInstructions).
    // Mirrors agent-chat.ts:918, where attached items already land in `context`.
    // Why: claw wraps additionalInstructions under a "## Additional Instructions"
    // heading — fine for backend housekeeping (web search blurb, canvas mandate),
    // but it buries user-attached items and produces a broken H1-inside-H2
    // hierarchy. Routing them through `context` keeps the attached-context H1
    // block at the top of claw's fullContext, where the agent sees it first and
    // links the user's query to it.
    let mergedContext = context;
    if (resolvedAttachedContext?.promptPrefix) {
      mergedContext = mergedContext
        ? `${resolvedAttachedContext.promptPrefix}\n\n${mergedContext}`
        : resolvedAttachedContext.promptPrefix;
    }

    // Inject live agent catalog for the Claw concierge agent so the LLM
    // always sees the current agents without any hardcoded list in the prompt.
    if (agentSlug === "claw") {
      try {
        const catalog = await buildAgentCatalog(resolved.userId, agent.orgId);
        additionalInstructions = additionalInstructions
          ? `${catalog}\n\n${additionalInstructions}`
          : catalog;
      } catch (catalogErr) {
        log.warn("[run] Failed to build agent catalog for claw:", catalogErr instanceof Error ? catalogErr.message : catalogErr);
      }
    }

    // Hydrate user-created subagents referenced by the agent's tools config
    // and forward them as part of the /run payload. Built-ins live in
    // xyne-claw's bundled code and are NOT sent across the wire.
    // Strip platform-only keys from the merged config so neither the stored
    // agent config nor a per-request `agentConfig` override can replace a
    // platform env value (secret-exfil / SSRF / GIT_SSH_COMMAND injection).
    // xyne-claw enforces this again in resolveToolConfig; this is the boundary.
    let mergedAgentConfig = stripPlatformConfigKeys({ ...agent.agentConfig, ...((req.body as { agentConfig?: Record<string, unknown> }).agentConfig ?? {}) });
    const effectiveFastMode = explicitFastMode ?? await resolveFastMode(conversationId, agentSlug || "assistant", mergedAgentConfig);
    const requestedSubagentNames = parseToolsConfig(mergedAgentConfig)?.subagents ?? [];
    const customSubagents = requestedSubagentNames.length > 0
      ? await resolveCustomSubagentsForRun(prisma, requestedSubagentNames, agent.orgId)
      : [];

    // A2A delegation. Standard-tier callers list requested callee slugs under
    // tools.callableAgents and the resolver intersects them with approved
    // grants. Orchestrator-tier callers receive a lightweight list of enabled
    // global org agents + approved non-global grant targets; full specs are
    // hydrated by claw-auth at tool-call time.
    const toolsCfg = (mergedAgentConfig as { tools?: { callableAgents?: unknown } } | null | undefined)?.tools;
    const requestedCalleeSlugs = Array.isArray(toolsCfg?.callableAgents)
      ? (toolsCfg!.callableAgents as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    const runningUserIsAdmin = await isClawAdmin(resolved.userId);
    const callableAgents = agent.delegationTier === "orchestrator"
      ? await resolveOrchestratorCallableAgentsForRun(prisma, agent.id, agent.orgId, {
          runningUserId: resolved.userId,
          isAdmin: runningUserIsAdmin,
        })
      : requestedCalleeSlugs.length > 0
        ? await resolveCallableAgentsForRun(prisma, agent.id, requestedCalleeSlugs, agent.orgId, {
            runningUserId: resolved.userId,
            isAdmin: runningUserIsAdmin,
          })
        : [];

    const sessionId = randomUUID();
    const isInternalRun = req.baseUrl.includes("/internal");
    const bodyIdempotencyKey = typeof requestedIdempotencyKey === "string" && requestedIdempotencyKey.trim().length > 0
      ? requestedIdempotencyKey.trim()
      : undefined;
    const idempotencyKey = isInternalRun ? (bodyIdempotencyKey ?? sessionId) : randomUUID();
    const sessionToken = mintSessionToken({
      sessionId,
      userId: resolved.userId,
      ...(agentSlug ? { agentSlug } : {}),
      ...(agent.spacesAppId ? { spacesAppId: agent.spacesAppId } : {}),
      ttlSeconds: 6 * 60 * 60,
    });
    const standardCallableAgents = callableAgents as Array<{ slug: string; spacesAppId?: string | null }>;
    const callableAgentsWithSession = agent.delegationTier === "orchestrator"
      ? callableAgents
      : standardCallableAgents.map((spec) => ({
          ...spec,
          sessionToken: mintSessionToken({
            sessionId,
            userId: resolved.userId,
            agentSlug: spec.slug,
            ...(spec.spacesAppId ? { spacesAppId: spec.spacesAppId } : {}),
            ttlSeconds: 6 * 60 * 60,
          }),
        }));

    let effectiveProviderConfigs = providerConfigs;
    let effectiveProviderOrder = providerOrder;
    let effectiveProvider = provider;
    if (!providerConfigs) {
      try {
        const resolvedProviders = await resolveAgentProviderConfigs(
          { id: agent.id, config: agent.config },
          // Only bulk machine traffic gets the automationProvider downgrade;
          // "spaces"/"chat"/"api" dispatches keep the agent's premium order.
          { headlessBulk: defaultTriggerSource === "automation" || defaultTriggerSource === "scheduled" },
        );
        effectiveProviderConfigs = resolvedProviders.providerConfigs;
        if (!providerOrder?.length) effectiveProviderOrder = resolvedProviders.providerOrder;
        // Primary provider — the pod keys its model off `provider` (defaults
        // to "spaces"/private-large when unset), NOT providerOrder[0]. Same
        // wiring as the scheduled-jobs worker and the automation webhook;
        // without it, dispatches relying on server-side resolution run on the
        // platform default regardless of the agent's configured provider.
        if (!provider && resolvedProviders.parent) effectiveProvider = resolvedProviders.parent;
      } catch (provErr) {
        log.error(`[run] resolveAgentProviderConfigs failed for agent=${agentSlug || "assistant"}: ${provErr instanceof Error ? provErr.stack || provErr.message : String(provErr)}`);
        res.status(502).json({ success: false, error: "provider config resolution failed" });
        return;
      }
    }

    // Apply the per-run provider/model pin. "spaces" rides claw's per-agent
    // modelSettings override (agent-model-settings.ts); other providers pin
    // their config's model. providerOrder is cleared so a quota fallback can't
    // silently swap providers mid-run.
    if (runOverride?.provider) {
      if (runOverride.provider === "spaces") {
        effectiveProvider = "spaces";
        if (runOverride.model?.trim()) {
          mergedAgentConfig = {
            ...mergedAgentConfig,
            modelSettings: {
              ...((mergedAgentConfig["modelSettings"] as Record<string, unknown> | undefined) ?? {}),
              model: runOverride.model.trim(),
            },
          };
        }
        effectiveProviderOrder = [];
      } else {
        // Pin the override provider only if we actually hold its credential.
        // litellm's cred is the AGENT's shared key (already in providerConfigs
        // for any user); personal providers are the user's own. Without the
        // cred, ignore the override and fall through to normal resolution
        // rather than forcing a provider claw can't serve (which would silently
        // drop to the platform default).
        const cfg = effectiveProviderConfigs?.[runOverride.provider];
        if (cfg) {
          effectiveProvider = runOverride.provider;
          if (runOverride.model?.trim()) {
            effectiveProviderConfigs = {
              ...effectiveProviderConfigs,
              [runOverride.provider]: { ...cfg, model: runOverride.model.trim() },
            };
          }
          effectiveProviderOrder = [];
        }
      }
    }

    const acceptHeader = (req.headers["accept"] as string | undefined) ?? "";
    const hasExternalCallback = Boolean(callbackUrl && !isInternalCallbackOrigin(callbackUrl));
    const externalResultCallback: ExternalResultCallbackConfig | undefined = hasExternalCallback && callbackUrl
      ? {
          url: callbackUrl,
          ...(callbackSecret !== undefined ? { encryptedSecret: encryptSurfaceSecret(callbackSecret) } : {}),
        }
      : undefined;
    const injectedCallbackUrl = (hasExternalCallback || (!callbackUrl && !acceptHeader.includes("text/event-stream")))
      ? `${CONFIG.internalUrl}/claw/api/v1/webhook/result`
      : undefined;
    const effectiveCallbackUrl = hasExternalCallback ? injectedCallbackUrl : callbackUrl ?? injectedCallbackUrl;

    if (injectedCallbackUrl) {
      try {
        const [ciphertext, iv, authTag] = (agent.spacesAppToken ?? "").split(":");
        const appToken = ciphertext && iv && authTag
          ? decrypt(ciphertext, iv, authTag, CONFIG.encryptionKey)
          : "";
        const sessionContext: SessionContext = {
          mentionedUserId: agent.spacesAppUserId ?? "",
          senderId: resolved.userId,
          senderName: resolved.userName || resolved.userId,
          channelId: effectiveChannelId ?? "",
          channelName: effectiveChannelId ?? "",
          conversationId: conversationId ?? "",
          task: task.trim(),
          agentId: agent.id,
          agentOrgId: agent.orgId,
          agentSlug: agentSlug || "assistant",
          responseMode: "conversation",
          appToken,
          spacesAppId: agent.spacesAppId ?? "",
          spacesAppUserId: agent.spacesAppUserId ?? "",
          rootAgentSlug: agentSlug || "assistant",
          ...(traceId ? { traceId } : {}),
          ...(externalResultCallback ? { externalResultCallback } : {}),
          ...(defaultTriggerSource === "slack" && slackDelivery ? { slackDelivery } : {}),
        };
        const { setSession } = await import("./webhook.js");
        await setSession(
          sessionId,
          sessionContext,
          externalResultCallback ? { skipConversationIndex: true } : undefined,
        );
      } catch (sessionErr) {
        log.warn(`[run] failed to store injected callback session context sessionId=${sessionId}:`, sessionErr instanceof Error ? sessionErr.message : sessionErr);
      }
    }

    // Persist attached items for the lifetime of this session so the MCP /call
    // boundary can default-fill missing channelId/conversationId on spaces-*
    // tool calls (see mcp/attached-context-injector.ts). Fire-and-forget — the
    // run still works without it; only auto-scoping is degraded.
    if (normalizedAttached.length > 0) {
      storeAttachedContextForSession(sessionId, normalizedAttached).catch(() => {});
    }

    // Dashboard-ai run scalars: the Spaces proxy passes the dashboard being
    // edited via agentConfig. Stored per-session so the MCP /call boundary can
    // force-inject them into xyne-dashboard tool calls. Fire-and-forget.
    {
      const ac = mergedAgentConfig as Record<string, unknown>;
      const scalar = (k: string): string | undefined =>
        typeof ac[k] === "string" && ac[k] ? (ac[k] as string) : undefined;
      const dashboardDataSourceId = scalar("SPACES_DATA_SOURCE_ID");
      const dashboardDraftId = scalar("SPACES_DASHBOARD_DRAFT_ID");
      const dashboardFocusedComponentId = scalar("SPACES_FOCUSED_COMPONENT_ID");
      if (dashboardDataSourceId || dashboardDraftId || dashboardFocusedComponentId) {
        storeRunScalars(sessionId, {
          ...(dashboardDataSourceId ? { dataSourceId: dashboardDataSourceId } : {}),
          ...(dashboardDraftId ? { draftId: dashboardDraftId } : {}),
          ...(dashboardFocusedComponentId ? { focusedComponentId: dashboardFocusedComponentId } : {}),
        }).catch(() => {});
      }
    }

    // Shared request body for both transports. SSE consumers (run-stream.ts)
    // pass progressUrl/callbackUrl too — claw ignores them in SSE mode since
    // the response stream IS the channel.
    const forwardBody = {
      sessionId,
      idempotencyKey,
      sessionToken,
      userId: resolved.userId,
      userName: resolved.userName,
      userEmail: resolved.userEmail,
      task: task.trim(),
      context: mergedContext,
      conversationId,
      ...(piSessionConversationId ? { piSessionConversationId } : {}),
      ...(effectiveCallbackUrl ? { callbackUrl: effectiveCallbackUrl } : {}),
      ...(effectivePrompt ? { systemPrompt: effectivePrompt } : {}),
      ...(agent.modelId ? { modelId: agent.modelId } : {}),
      agentConfig: mergedAgentConfig,
      agentSlug,
      channelId: effectiveChannelId,
      ...(projectId ? { projectId } : {}),
      ...(projectName ? { projectName } : {}),
      ...(eventType ? { eventType } : {}),
      ...(traceId ? { traceId } : {}),
      ...(effectiveProvider ? { provider: effectiveProvider } : {}),
      ...(effectiveProviderOrder?.length ? { providerOrder: effectiveProviderOrder } : {}),
      ...(subagentProviders ? { subagentProviders } : {}),
      subagentProviderMode: subagentProviderMode ?? resolveSubagentProviderMode(mergedAgentConfig),
      ...(effectiveProviderConfigs && Object.keys(effectiveProviderConfigs).length > 0 ? { providerConfigs: effectiveProviderConfigs } : {}),
      ...(cwd ? { cwd } : {}),
      ...(agent.skills ? { skills: agent.skills } : {}),
      ...(progressUrl ? { progressUrl } : {}),
      ...(attachments?.length ? { attachments } : {}),
      ...(mergedContextFiles.length > 0 ? { contextFiles: mergedContextFiles } : {}),
      ...(attachedContext?.length ? { attachedContext } : {}),
      ...(ticketIds?.length ? { ticketIds } : {}),
      ...(canvasIds?.length ? { canvasIds } : {}),
      ...(callIds?.length ? { callIds } : {}),
      ...((req.body as { researchContext?: unknown }).researchContext ? { researchContext: (req.body as { researchContext?: unknown }).researchContext } : {}),
      ...(additionalInstructions ? { additionalInstructions } : {}),
      ...(customSubagents.length > 0 ? { customSubagents } : {}),
      ...(callableAgentsWithSession.length > 0 ? { callableAgents: callableAgentsWithSession } : {}),
      ...(agent.delegationTier === "orchestrator" ? { delegationMode: "orchestrator" } : {}),
      ...(isRegenerate ? { isRegenerate: true } : {}),
      ...(detached === true ? { detached: true } : {}),
      fastMode: effectiveFastMode,
      ...(resumedFromHandoff === true ? { resumedFromHandoff: true } : {}),
      ...(generateFollowUpSuggestions === true ? { generateFollowUpSuggestions: true } : {}),
    };

    if (detached === true) {
      log.info(`[run] proxy: detached mode (sessionId=${sessionId})`);
      const clawRes = await fetchClawRunWithRetry({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
        },
        body: JSON.stringify(forwardBody),
      }, "detached-json");

      const body = (await clawRes.json().catch(() => null)) as { success?: boolean; sessionId?: string; error?: string } | null;
      if (clawRes.status !== 202 || !body?.success || !body.sessionId) {
        const error = body?.error ?? `Detached /run failed: HTTP ${clawRes.status}`;
        log.error(`[run] proxy: detached claw /run rejected (sessionId=${sessionId}): ${error}`);
        res.status(clawRes.status || 502).json(body ?? { success: false, error });
        return;
      }

      // Persist the AgentRun BEFORE acking. This branch used to return with
      // no row writer at all, so every detached API/service-token dispatch
      // ran invisibly: no history, no metrics, no token audit trail, and
      // status lookups 404'd (found 2026-07-20 during the first xyne_svc_
      // end-to-end test — the run completed but "didn't exist").
      const detachedPersistedByCaller = (req.body as { __persistedByCaller?: boolean }).__persistedByCaller;
      if (!detachedPersistedByCaller) {
        await agentRunRepository.start({
          sessionId,
          userId: resolved.userId,
          agentSlug: agentSlug || "assistant",
          orgId: agent.orgId,
          triggerSource: defaultTriggerSource,
          task: task.trim(),
          ...(conversationId ? { conversationId } : {}),
          ...(effectiveChannelId ? { channelId: effectiveChannelId } : {}),
          ...(projectId ? { projectId } : {}),
          ...(projectName ? { projectName } : {}),
          ...(externalResultCallback ? { metadata: { externalResultCallback } } : {}),
          fastMode: effectiveFastMode,
        }).catch((e) => log.warn("[run] AgentRun.start failed (detached):", e instanceof Error ? e.message : e));
        redisService.getConnection()
          .publish("cc:events", JSON.stringify({ type: "agent_start", sessionId, agentSlug: agentSlug || "assistant" }))
          .catch(() => {});
      }

      res.status(202).json({ success: true, sessionId: body.sessionId });
      return;
    }

    // SSE pass-through: the caller (run-stream.ts) opted into the streaming
    // transport via Accept: text/event-stream. Forward the same header to
    // claw and pipe the response body straight back. All pre-flight work
    // (identity, agent resolution, message persistence, AgentRun tracking)
    // ran above — same as legacy mode — so downstream behavior is unchanged.
    if (acceptHeader.includes("text/event-stream")) {
      log.info(`[run] proxy: forwarding SSE upstream to claw (sessionId=${sessionId})`);
      const clawRes = await fetchClawRunWithRetry({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
        },
        body: JSON.stringify(forwardBody),
      }, "sse-pass-through");

      if (!clawRes.ok || !clawRes.body) {
        const errText = await clawRes.text().catch(() => "");
        log.error(`[run] proxy: claw SSE returned ${clawRes.status}: ${errText.slice(0, 300)}`);
        res.status(clawRes.status || 502).json({ success: false, error: errText || "Failed to reach agent service" });
        return;
      }

      // Persist user message + AgentRun start NOW (same conditions as the JSON
      // path below) since the SSE response will not surface a separate
      // {success, sessionId} hand-off.
      const persistedByCaller = (req.body as { __persistedByCaller?: boolean }).__persistedByCaller;
      // A run-recovery re-dispatch replays a run whose user message was already
      // persisted on the ORIGINAL dispatch (e.g. a lock-contended twin tag that
      // is retried once the holder frees the session). Re-creating it here would
      // duplicate the user's turn in the chat and spawn a spurious branch —
      // skip it. AgentRun.start below still fires so each retry attempt is tracked.
      const skipUserMessagePersist = (req.body as { __skipUserMessagePersist?: boolean }).__skipUserMessagePersist === true;
      if (conversationId && !persistedByCaller && !skipUserMessagePersist) {
        try {
          await chatMessageRepository.create({
            conversationId,
            agentSlug: agentSlug || 'assistant',
            userId: resolved.userId,
            role: 'user',
            content: task.trim(),
            orgId: agent.orgId,
          });
        } catch (msgErr) {
          log.warn("[run] Failed to persist user message:", msgErr instanceof Error ? msgErr.message : msgErr);
        }
      }
      // AgentRun tracking must NOT require a conversationId: automation/
      // scheduled dispatches can be conversation-less (external-event
      // automations), and since the webhook pre-insert was removed this is
      // the ONLY row writer for them — gating on conversationId would make
      // such runs invisible to Control Center and unreconcilable.
      if ((conversationId || isScheduledOrAutomationEvent(eventType) || defaultTriggerSource === "api") && !persistedByCaller) {
        agentRunRepository.start({
          sessionId,
          userId: resolved.userId,
          agentSlug: agentSlug || 'assistant',
          orgId: agent.orgId,
          triggerSource: defaultTriggerSource,
          task: task.trim(),
          ...(conversationId ? { conversationId } : {}),
          ...(effectiveChannelId ? { channelId: effectiveChannelId } : {}),
          ...(projectId ? { projectId } : {}),
          ...(projectName ? { projectName } : {}),
          ...(externalResultCallback ? { metadata: { externalResultCallback } } : {}),
          fastMode: effectiveFastMode,
        }).catch((e) => log.warn("[run] AgentRun.start failed:", e instanceof Error ? e.message : e));
        redisService.getConnection()
          .publish("cc:events", JSON.stringify({ type: "agent_start", sessionId, agentSlug: agentSlug || "assistant" }))
          .catch(() => {});
      }

      // Stream the upstream SSE response straight to the caller. The caller
      // (consumeClawStream) parses frames as they arrive — we just have to
      // not buffer.
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      // If the caller (run-stream.ts) drops, propagate to claw by cancelling
      // the upstream reader so claw's res.on("close") fires and the agent
      // abort path runs. Use res.on("close") on the inbound response, NOT
      // req.on("close") — the latter fires as soon as Express's body parser
      // finishes consuming the request body (well before we're done piping),
      // which would tear down the upstream prematurely.
      const upstreamReader = (clawRes.body as ReadableStream<Uint8Array>).getReader();
      res.on("close", () => {
        if (!res.writableEnded) {
          log.info(`[run] proxy: caller disconnected, cancelling claw upstream (sessionId=${sessionId})`);
          try { upstreamReader.cancel(); } catch { /* already done */ }
        }
      });

      const parser = new ClawSseParser();
      const decoder = new TextDecoder("utf-8");
      let sawDone = false;
      let streamBroken = false;
      try {
        for (;;) {
          const { value, done } = await upstreamReader.read();
          if (done) break;
          if (value) {
            for (const event of parser.feed(decoder.decode(value, { stream: true }))) {
              if (event.event === "done") sawDone = true;
            }
            if (!res.write(Buffer.from(value))) {
              // backpressure: wait for drain before reading the next chunk so
              // we don't accumulate the agent's text deltas in the Node heap
              await new Promise<void>((resolve) => res.once("drain", () => resolve()));
            }
          }
        }
      } catch (pipeErr) {
        streamBroken = true;
        log.error(`[run] proxy: SSE pipe error (sessionId=${sessionId}):`, pipeErr instanceof Error ? pipeErr.message : String(pipeErr));
        if (!res.writableEnded) {
          try {
            res.write(`event: error\ndata: ${JSON.stringify({ error: pipeErr instanceof Error ? pipeErr.message : "pipe error" })}\n\n`);
          } catch { /* socket gone */ }
        }
      } finally {
        try { upstreamReader.releaseLock(); } catch { /* ignore */ }
        if (!sawDone) {
          if (callbackUrl && !isScheduledOrAutomationEvent(eventType)) {
            // Same headless tolerance as the legacy-bridge paths: the runtime
            // keeps running after a consumer disconnect and finalizes via its
            // callback — synthesizing failure here raced that and mislabeled
            // ~47 live runs/day as "sse stream broken" (prod 2026-07-09).
            log.warn(`[run] proxy: pass-through stream lost; run continues headless (session=${sessionId})`);
            armHeadlessFinalizeCheck({ sessionId, sessionToken, callbackUrl, conversationId: typeof conversationId === "string" ? conversationId : undefined, agentSlug: typeof agentSlug === "string" ? agentSlug : undefined, eventType, fastMode: effectiveFastMode });
          } else {
            await postBrokenSseTerminalCallback({
              callbackUrl,
              sessionId,
              sessionToken,
              conversationId: typeof conversationId === "string" ? conversationId : undefined,
              agentSlug: typeof agentSlug === "string" ? agentSlug : undefined,
              eventType,
              fastMode: effectiveFastMode,
              logPrefix: streamBroken ? "pass-through pipe error" : "pass-through ended before done",
            });
          }
        }
        if (!res.writableEnded) {
          try { res.end(); } catch { /* ignore */ }
        }
      }
      return;
    }

    // SSE-with-legacy-translation: the caller (webhook / agent-chat / etc.)
    // didn't ask for SSE — they expect the fire-and-forget {success, sessionId}
    // hand-off and POSTs from claw to their own progressUrl. We give them
    // exactly that, but the wire to claw is SSE: one ordered connection. A
    // background bridge translates each SSE frame back into the POST body
    // shape claw's old push functions used, hitting the caller's progressUrl
    // serially so ordering is preserved by construction. ZERO caller code
    // changes — this is the unified-wire migration for the legacy callers.
    if (CONFIG.clawSseTransport) {
      log.info(`[run] proxy: SSE bridge mode (caller is legacy POST consumer, sessionId=${sessionId})`);

      // Probe with the SSE Accept header. If claw rejects (auth, validation),
      // we want to surface the same HTTP status the legacy path would have so
      // the caller's error handling stays identical. We can't actually
      // consume in the foreground (the legacy contract is fire-and-forget),
      // so we just buy a quick "did /run accept" signal by waiting for the
      // first response chunk.
      const probeRes = await fetchClawRunWithRetry({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
        },
        body: JSON.stringify(forwardBody),
      }, "sse-bridge");

      if (!probeRes.ok || !probeRes.body) {
        const errText = await probeRes.text().catch(() => "");
        log.error(`[run] proxy: claw SSE returned ${probeRes.status} (legacy bridge, sessionId=${sessionId}): ${errText.slice(0, 300)}`);
        res.status(probeRes.status || 502).json({ success: false, error: errText || "Failed to reach agent service" });
        return;
      }

      // Replicate the legacy persistence + tracking before we hand back
      // {success, sessionId}, because the caller treats that response as the
      // signal to add Control Center / AgentRun rows. sessionId is the one we
      // already minted above and forwardBody carries it.
      const persistedByCaller = (req.body as { __persistedByCaller?: boolean }).__persistedByCaller;
      // A run-recovery re-dispatch replays a run whose user message was already
      // persisted on the ORIGINAL dispatch (e.g. a lock-contended twin tag that
      // is retried once the holder frees the session). Re-creating it here would
      // duplicate the user's turn in the chat and spawn a spurious branch —
      // skip it. AgentRun.start below still fires so each retry attempt is tracked.
      const skipUserMessagePersist = (req.body as { __skipUserMessagePersist?: boolean }).__skipUserMessagePersist === true;
      if (conversationId && !persistedByCaller && !skipUserMessagePersist) {
        try {
          await chatMessageRepository.create({
            conversationId,
            agentSlug: agentSlug || 'assistant',
            userId: resolved.userId,
            role: 'user',
            content: task.trim(),
            orgId: agent.orgId,
          });
        } catch (msgErr) {
          log.warn("[run] Failed to persist user message:", msgErr instanceof Error ? msgErr.message : msgErr);
        }
      }
      // AgentRun tracking must NOT require a conversationId: automation/
      // scheduled dispatches can be conversation-less (external-event
      // automations), and since the webhook pre-insert was removed this is
      // the ONLY row writer for them — gating on conversationId would make
      // such runs invisible to Control Center and unreconcilable.
      if ((conversationId || isScheduledOrAutomationEvent(eventType) || defaultTriggerSource === "api") && !persistedByCaller) {
        agentRunRepository.start({
          sessionId,
          userId: resolved.userId,
          agentSlug: agentSlug || 'assistant',
          orgId: agent.orgId,
          triggerSource: defaultTriggerSource,
          task: task.trim(),
          ...(conversationId ? { conversationId } : {}),
          ...(effectiveChannelId ? { channelId: effectiveChannelId } : {}),
          ...(projectId ? { projectId } : {}),
          ...(projectName ? { projectName } : {}),
          ...(externalResultCallback ? { metadata: { externalResultCallback } } : {}),
          fastMode: effectiveFastMode,
        }).catch((e) => log.warn("[run] AgentRun.start failed:", e instanceof Error ? e.message : e));
        redisService.getConnection()
          .publish("cc:events", JSON.stringify({ type: "agent_start", sessionId, agentSlug: agentSlug || "assistant" }))
          .catch(() => {});
      }

      // Hand back the legacy {success, sessionId} response NOW. The caller
      // continues its fire-and-forget flow; the bridge runs to completion in
      // the background, POSTing chunks to caller's progressUrl in order.
      res.json({ success: true, sessionId });

      // We already have probeRes open; pass its body straight into the bridge
      // so we don't re-open the connection to claw and the started frame
      // (already on the wire) is the first thing the bridge consumes.
      void runBridgeForProbeResponse({
        probeRes,
        progressUrl,
        callbackUrl: effectiveCallbackUrl,
        sessionId,
        sessionToken,
        conversationId: typeof conversationId === "string" ? conversationId : undefined,
        agentSlug: typeof agentSlug === "string" ? agentSlug : undefined,
        eventType,
        forwardBody,
      });
      return;
    }

    // Legacy JSON path — unchanged. Used when CLAW_SSE_TRANSPORT=off so a flag
    // flip is the only thing required to roll back to per-chunk POSTs.
    const clawRes = await fetchClawRunWithRetry({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify(forwardBody),
    }, "legacy-json");

    const body = (await clawRes.json()) as { success: boolean; sessionId?: string; error?: string };

    if (!body.success || !body.sessionId) {
      res.status(clawRes.status).json(body);
      return;
    }

    // Persist user message UNLESS the caller (e.g., /chat) has already persisted it.
    // /chat sets __persistedByCaller: true to skip this, since it creates the user message.
    // Direct callers like Ask AI v2 rely on this endpoint to persist messages.
    const persistedByCaller = (req.body as { __persistedByCaller?: boolean }).__persistedByCaller;
    // See the SSE/bridge paths above: recovery re-dispatches must not re-persist
    // the user message (it belongs to the original dispatch).
    const skipUserMessagePersist = (req.body as { __skipUserMessagePersist?: boolean }).__skipUserMessagePersist === true;
    if (conversationId && !persistedByCaller && !skipUserMessagePersist) {
      try {
        await chatMessageRepository.create({
          conversationId,
          agentSlug: agentSlug || 'assistant',
          userId: resolved.userId,
          role: 'user',
          content: task.trim(),
          orgId: agent.orgId,
        });
      } catch (msgErr) {
        log.warn("[run] Failed to persist user message:", msgErr instanceof Error ? msgErr.message : msgErr);
      }
    }

    // Track run for Agent Control Center. channelId is passed through when the
    // caller is the webhook flow (Spaces group/channel events) so the Control
    // Center can scope per-channel views; direct callers like /chat may omit it.
    //
    // Skip when the caller already persisted (same convention as the
    // user-message insert above). /agent-chat sets `__persistedByCaller: true`
    // and writes its own AgentRun row with `triggerSource: "chat"` — writing
    // one here too caused a P2002 on the unique sessionId and tagged
    // chat runs as "spaces". Webhook/direct-API paths leave the flag unset
    // and still get tracked here.
    if ((conversationId || isScheduledOrAutomationEvent(eventType) || defaultTriggerSource === "api") && !persistedByCaller) {
      // conversationId intentionally optional here — see the SSE-path comment:
      // conversation-less automations must still get an AgentRun row.
      agentRunRepository.start({
        sessionId: body.sessionId,
        userId: resolved.userId,
        agentSlug: agentSlug || 'assistant',
        orgId: agent.orgId,
        triggerSource: defaultTriggerSource,
        task: task.trim(),
        ...(conversationId ? { conversationId } : {}),
        ...(effectiveChannelId ? { channelId: effectiveChannelId } : {}),
        ...(projectId ? { projectId } : {}),
        ...(projectName ? { projectName } : {}),
        ...(externalResultCallback ? { metadata: { externalResultCallback } } : {}),
        fastMode: effectiveFastMode,
      }).catch((e) => log.warn("[run] AgentRun.start failed:", e instanceof Error ? e.message : e));
      redisService.getConnection()
        .publish("cc:events", JSON.stringify({ type: "agent_start", sessionId: body.sessionId, agentSlug: agentSlug || "assistant" }))
        .catch(() => {});
    }

    res.json({ success: true, sessionId: body.sessionId });
  } catch (err) {
    log.error("[run] Error forwarding to xyne-claw:", err);
    res.status(502).json({ success: false, error: "Failed to reach agent service" });
  }
});

// ── POST /run/:sessionId/cancel — proxy cancel to xyne-claw ──
router.post("/run/:sessionId/cancel", requireRunCaller, async (req: Request<{ sessionId: string }>, res: Response) => {
  const { sessionId } = req.params;
  if (!sessionId || typeof sessionId !== "string") {
    res.status(400).json({ success: false, error: "sessionId is required" });
    return;
  }

  const callerUserId = req.headers["x-user-id"];
  if (typeof callerUserId !== "string" || !callerUserId.trim()) {
    res.status(400).json({ success: false, error: "x-user-id is required" });
    return;
  }

  try {
    const clawRes = await fetch(`${CONFIG.xyneClawUrl}/run/${encodeURIComponent(sessionId)}/cancel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
        "x-user-id": callerUserId,
      },
    });

    const body = (await clawRes.json().catch(() => null)) as Record<string, unknown> | null;
    if (!clawRes.ok) {
      res.status(clawRes.status).json(body ?? { success: false, error: `Cancel failed: HTTP ${clawRes.status}` });
      return;
    }

    res.json(body ?? { success: true, sessionId });
  } catch (err) {
    log.error("[run] Error forwarding cancel to xyne-claw:", err);
    res.status(502).json({ success: false, error: "Failed to reach agent service" });
  }
});

// ── POST /clear-session — proxy to xyne-claw (forget a thread's session) ──
// Hit by webhook.ts when a user types `/clear`. The handler lives on the pod
// (xyne-claw run.ts); claw-auth only needs to forward it. requireStrictS2S
// because runRouter is also mounted at the unauthenticated BASE, so the route
// must self-protect; the webhook supplies the same xyneClawS2sKey end-to-end.
router.post("/clear-session", requireStrictS2S, async (req: Request, res: Response) => {
  try {
    const clawRes = await fetch(`${CONFIG.xyneClawUrl}/clear-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify(req.body ?? {}),
    });

    const body = (await clawRes.json().catch(() => null)) as Record<string, unknown> | null;
    if (!clawRes.ok) {
      res.status(clawRes.status).json(body ?? { success: false, error: `clear-session failed: HTTP ${clawRes.status}` });
      return;
    }

    res.json(body ?? { success: true });
  } catch (err) {
    log.error("[run] Error forwarding clear-session to xyne-claw:", err);
    res.status(502).json({ success: false, error: "Failed to reach agent service" });
  }
});

// ── POST /sessions/:id/result — callback from xyne-claw, forward to Xyne Spaces ──

router.post("/sessions/:id/result", requireStrictS2S, requireResultToken((req) => req.params["id"]), async (req: Request<{ id: string }>, res: Response) => {
  const { id } = req.params;
  const payload = req.body as Record<string, unknown>;

  log.info(`[sessions] ${id}: received result (status=${payload["status"] as string})`);

  // Acknowledge xyne-claw immediately (per-run token already verified by
  // requireResultToken middleware).
  res.json({ success: true });

  // Persist assistant message in ChatMessage table (same as /chat callback)
  // so conversations appear in the /conversations history endpoint
  const conversationId = payload["conversationId"] as string | undefined;
  const agentSlug = payload["agentSlug"] as string | undefined;
  const userId = payload["userId"] as string | undefined;
  const content = (payload["result"] as string) || (payload["error"] as string) || "";
  const status = payload["status"] as string;
  const reasoning = (payload["reasoning"] as string | undefined) || undefined;

  if (status === "handoff") {
    const lastTurn = typeof payload["lastTurn"] === "number" ? payload["lastTurn"] : undefined;
    log.info(`[sessions] ${id}: handoff callback received conversation=${conversationId ?? ""} agent=${agentSlug ?? ""} lastTurn=${lastTurn ?? "unknown"}`);
    const handoff = await handleRunHandoff(id).catch((err) => {
      log.warn(`[sessions] ${id}: handoff re-dispatch failed:`, err instanceof Error ? err.message : String(err));
      return null;
    });
    if (handoff) {
      log.info(`[sessions] ${id}: handoff re-dispatched root=${handoff.rootSessionId} newSession=${handoff.newSessionId}`);
    } else {
      log.warn(`[sessions] ${id}: handoff callback had no active recovery state; recovery is not registered for this callback/session`);
    }
    return;
  }

  const toolInvocations = payload["toolInvocations"] as unknown[] | undefined;
  const toolsUsed = payload["toolsUsed"] as string[] | undefined;
  const attachments = payload["attachments"] as Array<{ fileName: string; mimeType: string; data: string }> | undefined;

  if (conversationId && userId) {
    try {
      // Persist any tool-generated attachments (e.g. create-ppt .pptx) into GCS
      // and the ChatAttachment table so the UI can render download cards
      const persistedAttachments: Array<{ id: string; mimeType: string; originalFilename: string; size: number }> = [];
      
      if (attachments?.length) {
        for (const att of attachments) {
          try {
            const buffer = Buffer.from(att.data, 'base64');
            const now = new Date();
            const year = String(now.getUTCFullYear());
            const month = String(now.getUTCMonth() + 1).padStart(2, '0');
            const safeName = att.fileName.replace(/[^\w.\-]+/g, '_').slice(0, 200);
            const destPath = `chat-attachments/${userId}/${year}/${month}/${Date.now()}-${randomUUID()}-${safeName}`;
            
            await gcsService.uploadFile(buffer, destPath, att.mimeType);
            
            const row = await prisma.chatAttachment.create({
              data: {
                uploaderUserId: userId,
                storageProvider: 'gcs',
                url: destPath,
                originalFilename: att.fileName,
                mimeType: att.mimeType,
                size: buffer.length,
              },
            });
            
            persistedAttachments.push({
              id: row.id,
              mimeType: row.mimeType,
              originalFilename: row.originalFilename,
              size: row.size,
            });
          } catch (attErr) {
            log.error(`[sessions] ${id}: failed to persist attachment ${att.fileName}:`, attErr instanceof Error ? attErr.message : String(attErr));
          }
        }
      }

      const run = await agentRunRepository.findBySessionId(id).catch(() => null);
      if (!run) {
        log.warn(`[run/callback] no AgentRun found for session ${id}; skipping ChatMessage persistence`);
        return;
      }
      const assistantMsg = await chatMessageRepository.create({
        conversationId,
        agentSlug: agentSlug || 'assistant',
        userId,
        role: 'assistant',
        content,
        status: status === 'completed' ? 'completed' : 'failed',
        orgId: run.orgId,
        ...(reasoning ? { reasoning } : {}),
      });

      // Link attachments to the assistant message
      if (persistedAttachments.length) {
        await chatAttachmentRepository.linkToMessage(
          persistedAttachments.map(a => a.id),
          assistantMsg.id,
          userId
        );
      }
    } catch (msgErr) {
      log.warn(`[sessions] ${id}: failed to persist assistant message:`, msgErr instanceof Error ? msgErr.message : String(msgErr));
    }

    // Also finalize the AgentRun with tool invocations so they appear in history
    try {
      await agentRunRepository.finalize(id, {
        status: status === 'completed' ? 'completed' : 'failed',
        result: content,
        error: status !== 'completed' ? content : null,
        ...(reasoning ? { reasoning } : {}),
        ...(typeof payload.provider === "string" ? { provider: payload.provider } : {}),
        ...(typeof payload.model === "string" ? { model: payload.model } : {}),
        toolsUsed: toolsUsed ?? [],
        ...(toolInvocations ? { toolInvocations } : {}),
        ...((payload as { fastMode?: boolean }).fastMode !== undefined ? { fastMode: (payload as { fastMode?: boolean }).fastMode === true } : {}),
      });
    } catch (finalizeErr) {
      log.warn(`[sessions] ${id}: failed to finalize agent run:`, finalizeErr instanceof Error ? finalizeErr.message : finalizeErr);
    }
  }

  // Forward result to Xyne Spaces
  if (!CONFIG.xyneSpacesCallbackUrl) {
    log.warn(`[sessions] ${id}: no XYNE_SPACES_CALLBACK_URL configured, result not forwarded`);
    return;
  }

  try {
    const { reasoning: _omitReasoning, ...spacesPayload } = payload;
    const spacesRes = await fetch(CONFIG.xyneSpacesCallbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(spacesPayload),
    });

    if (!spacesRes.ok) {
      log.error(`[sessions] ${id}: Xyne Spaces callback returned ${spacesRes.status}`);
    }
  } catch (err) {
    log.error(`[sessions] ${id}: failed to forward to Xyne Spaces:`, err);
  }
});

// ── SSE → legacy POST bridge ───────────────────────────────────────────────
// Used by the proxy's SSE-with-translation branch. Consumes claw's open SSE
// response, POSTs each event to the caller's progressUrl, and POSTs the final
// `done` payload to callbackUrl — keeping the legacy fire-and-forget contract
// for callers like webhook.ts / agent-chat.ts while the actual wire to claw
// is one ordered SSE connection.

interface BridgeForProbeOpts {
  probeRes: { body: ReadableStream<Uint8Array> | null };
  progressUrl: string | undefined;
  callbackUrl: string | undefined;
  sessionId: string;
  /** Per-run HMAC bearer minted by mintSessionToken (bound to {sid, uid}).
   *  Required on the final callback POST — /webhook/result + the per-session
   *  /sessions/:id/result endpoints gate on it via requireResultToken so a
   *  leaked S2S key alone can't post a result for an arbitrary run. Legacy
   *  claw's sendCallback shipped it as x-session-token; the bridge has to
   *  do the same or the receiver rejects with "malformed". */
  sessionToken: string;
  /** Conversation identity from the caller's request body. Threaded into every
   *  bridge POST so /webhook/progress + /webhook/result can fall back to
   *  conv-keyed session lookup when sessionId lookup races against setSession()
   *  or run-recovery (the proximate cause of missing Spaces typing animation
   *  and missing summarize replies). */
  conversationId?: string | undefined;
  agentSlug?: string | undefined;
  eventType?: string | undefined;
  forwardBody: Record<string, unknown>;
}

// Spaces' /webhook/progress only consumes toolInvocation / toolLabel /
// sandboxPreviewUrl — text deltas, reasoning deltas, attachments, and debug
// events are silently dropped. Translating them to localhost POSTs anyway
// stalls the SSE consumer serially behind ~thousands of no-op requests during
// long summarization runs. Detect the Spaces sink by URL suffix and skip the
// noise events at the bridge layer.
function isSpacesWebhookProgressUrl(url: string | undefined): boolean {
  return !!url && /\/webhook\/progress(?:\?|$)/.test(url);
}

function isScheduledOrAutomationEvent(eventType: unknown): boolean {
  return eventType === "scheduled_job" || eventType === "automation";
}

function scheduledJobIdFromCallback(callbackUrl: string | undefined): string | undefined {
  if (!callbackUrl) return undefined;
  const match = callbackUrl.match(/\/scheduled-jobs\/([^/]+)\/result(?:\?|$)/);
  return match?.[1];
}

function safeIdPart(value: unknown): string {
  const raw = typeof value === "string" && value.trim() ? value.trim() : randomUUID();
  const safe = raw.replace(/[^A-Za-z0-9_-]/g, "_");
  return safe.length > 0 ? safe.slice(0, 110) : randomUUID();
}

function retryIdempotencyKey(forwardBody: Record<string, unknown>): string {
  // REUSE the original key, do not derive a new one: claw's completion marker
  // (claw-results/<key>.json) is written only on success, so with the same key
  // a bridge that died AFTER the run finished replays the completed result
  // instead of re-executing the task (duplicate side effects), and an
  // unfinished run executes normally. A `_retry1`-style suffix would bypass
  // that idempotency backstop entirely.
  return safeIdPart(forwardBody["idempotencyKey"]);
}

async function retryBrokenBridgeOnce(opts: {
  forwardBody: Record<string, unknown>;
  oldSessionId: string;
  callbackUrl: string | undefined;
  reason: string;
}): Promise<boolean> {
  const eventType = opts.forwardBody["eventType"];
  if (!isScheduledOrAutomationEvent(eventType)) return false;
  if (typeof opts.forwardBody["retryOf"] === "string") return false;

  const userId = opts.forwardBody["userId"];
  if (typeof userId !== "string" || !userId) {
    log.warn(`[run] proxy: cannot retry broken bridge; missing userId (session=${opts.oldSessionId})`);
    return false;
  }

  const agentSlug = typeof opts.forwardBody["agentSlug"] === "string"
    ? opts.forwardBody["agentSlug"]
    : undefined;
  const newSessionId = randomUUID();
  const sessionToken = mintSessionToken({
    sessionId: newSessionId,
    userId,
    ...(agentSlug ? { agentSlug } : {}),
    ttlSeconds: 6 * 60 * 60,
  });
  const newBody = {
    ...opts.forwardBody,
    sessionId: newSessionId,
    sessionToken,
    idempotencyKey: retryIdempotencyKey(opts.forwardBody),
    retryOf: opts.oldSessionId,
    detached: true,
  };

  const oldRun = await prisma.agentRun.findUnique({
    where: { sessionId: opts.oldSessionId },
    select: {
      userId: true,
      agentSlug: true,
      orgId: true,
      triggerSource: true,
      task: true,
      conversationId: true,
      scheduledJobId: true,
      channelId: true,
      projectId: true,
      projectName: true,
    },
  }).catch(() => null);

  try {
    const retryRes = await fetchClawRunWithRetry({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify(newBody),
    }, "bridge-retry-detached");
    const retryBody = (await retryRes.json().catch(() => null)) as { success?: boolean; sessionId?: string; error?: string } | null;
    if (retryRes.status !== 202 || !retryBody?.success || retryBody.sessionId !== newSessionId) {
      log.warn(`[run] proxy: bridge retry dispatch rejected old=${opts.oldSessionId} new=${newSessionId} status=${retryRes.status} error=${retryBody?.error ?? "unknown"}`);
      return false;
    }
  } catch (err) {
    log.warn(`[run] proxy: bridge retry dispatch failed old=${opts.oldSessionId} new=${newSessionId}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }

  const retryError = `bridge lost — retried as ${newSessionId}`;
  // Hand the old session's run-recovery state over: mark it completed so the
  // watchdog can't fire a SECOND retry for the same work (automations register
  // recovery at dispatch; without this, bridge-retry + recovery-retry would
  // double-execute the task). The retry session owns delivery from here;
  // retry-once semantics — if IT dies too, the failure surfaces via callback.
  await handleRunCompletion(opts.oldSessionId, "completed").catch((err) =>
    log.warn(`[run] proxy: failed to hand off recovery state for bridge-lost run (session=${opts.oldSessionId}): ${err instanceof Error ? err.message : String(err)}`),
  );
  await agentRunRepository.finalize(opts.oldSessionId, {
    status: "failed",
    error: retryError,
    result: null,
    fastMode: opts.forwardBody["fastMode"] === true,
  }).catch((err) =>
    log.warn(`[run] proxy: failed to mark bridge-lost run failed (session=${opts.oldSessionId}): ${err instanceof Error ? err.message : String(err)}`),
  );

  const scheduledJobId = oldRun?.scheduledJobId ?? scheduledJobIdFromCallback(opts.callbackUrl);
  if (scheduledJobId) {
    await prisma.scheduledJobRun.updateMany({
      where: { scheduledJobId, sessionId: opts.oldSessionId },
      data: { status: "failed", error: retryError, completedAt: new Date() },
    }).catch(() => {});
    await prisma.scheduledJobRun.create({
      data: { scheduledJobId, sessionId: newSessionId, status: "started" },
    }).catch((err) =>
      log.warn(`[run] proxy: failed to create scheduled retry run row job=${scheduledJobId} session=${newSessionId}: ${err instanceof Error ? err.message : String(err)}`),
    );
  }

  if (oldRun) {
    await agentRunRepository.start({
      sessionId: newSessionId,
      userId: oldRun.userId,
      agentSlug: oldRun.agentSlug,
      orgId: oldRun.orgId,
      triggerSource: oldRun.triggerSource as AgentRunTriggerSource,
      task: oldRun.task,
      ...(oldRun.conversationId ? { conversationId: oldRun.conversationId } : {}),
      ...(scheduledJobId ? { scheduledJobId } : {}),
      ...(oldRun.channelId ? { channelId: oldRun.channelId } : {}),
      ...(oldRun.projectId ? { projectId: oldRun.projectId } : {}),
      ...(oldRun.projectName ? { projectName: oldRun.projectName } : {}),
      fastMode: opts.forwardBody["fastMode"] === true,
    }).catch((err) =>
      log.warn(`[run] proxy: failed to start retry AgentRun old=${opts.oldSessionId} new=${newSessionId}: ${err instanceof Error ? err.message : String(err)}`),
    );
  }

  log.warn(`[run] proxy: ${opts.reason}; retried ${String(eventType)} run old=${opts.oldSessionId} new=${newSessionId}`);
  return true;
}

/** How long a headless run (bridge lost, runtime presumed alive) gets to
 *  finalize via its own callback before we declare it dead. Generous — long
 *  interactive runs are the norm; the orphan-finalizer remains the deep
 *  backstop if claw-auth restarts and loses this in-process timer. */
const HEADLESS_FINALIZE_CHECK_MS = Number(process.env["HEADLESS_FINALIZE_CHECK_MS"] ?? 30 * 60 * 1000);

/** The headless early-return trusts the runtime to finalize via callback —
 *  correct when only the PIPE died. When the RUNTIME died (OOM/crash), no
 *  callback ever comes and interactive runs register no run-recovery, so the
 *  row would sit "running" until the slow orphan sweep. This bounded check
 *  posts the synthetic failed callback only if the row is still running
 *  after the window. Best-effort in-process timer. */
function armHeadlessFinalizeCheck(opts: {
  sessionId: string;
  sessionToken: string;
  callbackUrl: string | undefined;
  conversationId?: string | undefined;
  agentSlug?: string | undefined;
  eventType?: string | undefined;
  fastMode?: boolean | undefined;
}): void {
  const timer = setTimeout(async () => {
    try {
      const run = await agentRunRepository.findBySessionId(opts.sessionId);
      if (!run || run.status !== "running") return;
      log.warn(`[run] proxy: headless run never finalized after ${HEADLESS_FINALIZE_CHECK_MS}ms — posting synthetic failure (session=${opts.sessionId})`);
      log.warn(`[metric] name=inflight_killed kind=count value=1 cause=headless_never_finalized agent=${opts.agentSlug ?? "unknown"} session=${opts.sessionId}`);
      await postBrokenSseTerminalCallback({
        callbackUrl: opts.callbackUrl,
        sessionId: opts.sessionId,
        sessionToken: opts.sessionToken,
        conversationId: opts.conversationId,
        agentSlug: opts.agentSlug,
        eventType: opts.eventType,
        fastMode: opts.fastMode,
        logPrefix: "headless run never finalized",
      });
    } catch (err) {
      log.warn(`[run] proxy: headless finalize check failed (session=${opts.sessionId}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }, HEADLESS_FINALIZE_CHECK_MS);
  timer.unref?.();
}

async function postBrokenSseTerminalCallback(opts: {
  callbackUrl: string | undefined;
  sessionId: string;
  sessionToken: string;
  conversationId?: string | undefined;
  agentSlug?: string | undefined;
  eventType?: string | undefined;
  fastMode?: boolean | undefined;
  logPrefix: string;
}): Promise<void> {
  if (opts.eventType === "scheduled_job") {
    log.warn(`[metric] name=post_broken_sse_terminal_callback eventType=scheduled_job agent=${opts.agentSlug ?? "unknown"} job=${scheduledJobIdFromCallback(opts.callbackUrl) ?? "unknown"}`);
  }
  const body = {
    ...(opts.conversationId !== undefined ? { conversationId: opts.conversationId } : {}),
    ...(opts.agentSlug !== undefined ? { agentSlug: opts.agentSlug } : {}),
    sessionId: opts.sessionId,
    status: "failed",
    error: "sse stream broken",
    ...(opts.fastMode !== undefined ? { fastMode: opts.fastMode === true } : {}),
  };
  if (!opts.callbackUrl) {
    await agentRunRepository.finalize(opts.sessionId, {
      status: "failed",
      error: "sse stream broken",
      result: null,
      ...(opts.fastMode !== undefined ? { fastMode: opts.fastMode === true } : {}),
    }).catch((err) =>
      log.warn(`[run] proxy: failed to finalize broken SSE without callback (session=${opts.sessionId}): ${err instanceof Error ? err.message : String(err)}`),
    );
    return;
  }

  try {
    const cbRes = await fetch(opts.callbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
        ...(opts.sessionToken ? { "x-session-token": opts.sessionToken } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!cbRes.ok) {
      const text = await cbRes.text().catch(() => "");
      throw new Error(`HTTP ${cbRes.status}: ${text.slice(0, 300)}`);
    }
    log.warn(`[run] proxy: ${opts.logPrefix}; posted failed callback (session=${opts.sessionId})`);
  } catch (err) {
    log.warn(`[run] proxy: ${opts.logPrefix}; failed callback POST failed (session=${opts.sessionId}): ${err instanceof Error ? err.message : String(err)}`);
    await agentRunRepository.finalize(opts.sessionId, {
      status: "failed",
      error: "sse stream broken",
      result: null,
      ...(opts.fastMode !== undefined ? { fastMode: opts.fastMode === true } : {}),
    }).catch((finalizeErr) =>
      log.warn(`[run] proxy: failed direct finalize after broken SSE callback miss (session=${opts.sessionId}): ${finalizeErr instanceof Error ? finalizeErr.message : String(finalizeErr)}`),
    );
  }
}

async function runBridgeForProbeResponse(opts: BridgeForProbeOpts): Promise<void> {
  const { probeRes, progressUrl, callbackUrl, sessionId, sessionToken, conversationId, agentSlug, eventType, forwardBody } = opts;
  if (!probeRes.body) {
    log.warn(`[run] proxy: bridge has no upstream body to consume (sessionId=${sessionId})`);
    return;
  }

  // Progress POSTs only need x-s2s-key (the per-event /webhook/progress sink
  // is shared-secret-gated, not per-run-bound). The FINAL callback POST is
  // different — it needs x-session-token too (see callbackHeaders below).
  const sharedHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
  };
  // Final-callback POST adds the per-run HMAC bearer so /webhook/result and
  // /sessions/:id/result accept it. Mirrors legacy claw sendCallback's headers
  // (xyne-claw/src/routes/run.ts:1924). Without this the receiver logs
  // "[result-token] rejecting result (session=...): malformed → 401".
  const callbackHeaders: Record<string, string> = {
    ...sharedHeaders,
    ...(sessionToken ? { "x-session-token": sessionToken } : {}),
  };
  const spacesProgress = isSpacesWebhookProgressUrl(progressUrl);
  // Conv-keyed fallback fields. Always present in legacy POSTs that claw used
  // to send (createProgressReporter ships them when progressMeta is set).
  // /webhook/progress depends on them to resolve session ctx via the conv-keyed
  // index. Read them from forwardBody and stamp onto every progress + callback
  // POST so downstream consumers behave exactly as they did before.
  const convFallback: Record<string, unknown> = {
    ...(conversationId !== undefined ? { conversationId } : {}),
    ...(agentSlug !== undefined ? { agentSlug } : {}),
  };

  // Serial dispatch via consumeAlreadyOpenStream's awaited handlers means
  // these POSTs land at progressUrl in the exact order claw emitted them.
  const postProgress = async (body: Record<string, unknown>): Promise<void> => {
    if (!progressUrl) return;
    try {
      await fetch(progressUrl, {
        method: "POST",
        headers: sharedHeaders,
        body: JSON.stringify({ ...convFallback, ...body }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      log.warn(`[run] proxy: progress POST failed (session=${sessionId}): ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  try {
    const result = await consumeAlreadyOpenStream(probeRes.body, {
      onInvocation: async (sid, toolInvocation) => {
        await postProgress({ sessionId: sid, toolInvocation });
      },
      onReasoning: async (sid, reasoningDelta) => {
        // Spaces sink doesn't consume reasoning deltas — skip to keep the SSE
        // reader moving instead of awaiting a no-op POST per chunk.
        if (spacesProgress) return;
        await postProgress({ sessionId: sid, reasoningDelta });
      },
      onTextDelta: async (sid, textDelta) => {
        if (spacesProgress) return;
        await postProgress({ sessionId: sid, textDelta });
      },
      onAttachment: async (sid, attachment) => {
        // /webhook/progress ignores per-chunk attachments — the final
        // /webhook/result callback carries the persisted ones via `attachments`.
        if (spacesProgress) return;
        await postProgress({ sessionId: sid, attachment });
      },
      onSandboxPreview: async (sid, payload) => {
        await postProgress({ sessionId: sid, ...payload });
      },
      onPlan: async (sid, todos) => {
        await postProgress({ sessionId: sid, kind: "plan", todos });
      },
      onProgressLabel: async (sid, payload) => {
        await postProgress({ sessionId: sid, ...payload });
      },
      onDebug: async (sid, debugEvent) => {
        if (spacesProgress) return;
        await postProgress({ sessionId: sid, debugEvent });
      },
    }, (expected, got) => {
      log.warn(`[run] proxy: bridge seq gap session=${sessionId}: expected ${expected}, got ${got}`);
    });

    if (callbackUrl && result.result) {
      try {
        // POST the entire done payload verbatim — it IS the sendCallback body
        // claw built in legacy mode. Plus the conv-fallback stamp in case
        // sessionId-based lookup misses on the receiver. Don't filter to a
        // subset — /webhook/result reads userId, toolsUsed, tokenUsage,
        // latency, reasoning, provider, model, etc., and stripping any of
        // those breaks downstream consumers silently (Control Center finalize,
        // digital-twin suffix, etc.).
        await fetch(callbackUrl, {
          method: "POST",
          headers: callbackHeaders,
          body: JSON.stringify({
            ...convFallback,
            ...result.result,
            sessionId,
          }),
        });
      } catch (err) {
        log.warn(`[run] proxy: callback POST failed (session=${sessionId}): ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (!result.result) {
      // No done frame arrived — claw's stream ended cleanly without one. Surface
      // a synthetic failed callback so the caller's run tracker doesn't sit in
      // "running" forever.
      if (callbackUrl && !isScheduledOrAutomationEvent(eventType)) {
        log.warn(`[run] proxy: bridge lost; run continues headless (session=${sessionId})`);
        armHeadlessFinalizeCheck({ sessionId, sessionToken, callbackUrl, conversationId, agentSlug, eventType, fastMode: forwardBody["fastMode"] === true });
        return;
      }
      const retried = await retryBrokenBridgeOnce({
        forwardBody,
        oldSessionId: sessionId,
        callbackUrl,
        reason: "bridge ended before done",
      });
      if (retried) return;
      await postBrokenSseTerminalCallback({
        callbackUrl,
        sessionId,
        sessionToken,
        conversationId,
        agentSlug,
        eventType,
        fastMode: forwardBody["fastMode"] === true,
        logPrefix: "bridge ended before done",
      });
    }
  } catch (err) {
    if (callbackUrl && !isScheduledOrAutomationEvent(eventType)) {
      log.warn(`[run] proxy: bridge lost; run continues headless (session=${sessionId})`);
      armHeadlessFinalizeCheck({ sessionId, sessionToken, callbackUrl, conversationId, agentSlug, eventType, fastMode: forwardBody["fastMode"] === true });
      return;
    }
    log.error(`[run] proxy: bridge failed (session=${sessionId}): ${err instanceof Error ? err.message : String(err)}`);
    const retried = await retryBrokenBridgeOnce({
      forwardBody,
      oldSessionId: sessionId,
      callbackUrl,
      reason: "bridge failed before done",
    });
    if (retried) return;
    await postBrokenSseTerminalCallback({
      callbackUrl,
      sessionId,
      sessionToken,
      conversationId,
      agentSlug,
      eventType,
      fastMode: forwardBody["fastMode"] === true,
      logPrefix: "bridge failed before done",
    });
  }
}

export { router as runRouter };
