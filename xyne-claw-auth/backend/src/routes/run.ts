import { Router, type NextFunction, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { chatMessageRepository, agentRunRepository, chatAttachmentRepository } from "../repositories/index.js";
import { buildAgentCatalog } from "../services/agentCatalogService.js";
import { gcsService } from "../services/gcsService.js";
import {
  normalizeAttachedContext,
  buildAttachedContextPayload,
  type AttachedContextRef,
} from "../services/agentChatContextService.js";
import { storeForSession as storeAttachedContextForSession } from "../mcp/attached-context-injector.js";
import type { SpacesAuthContext } from "../mcp/servers/xyne-spaces-client.js";
import { resolveCustomSubagentsForRun } from "../lib/subagent-resolver.js";
import { parseToolsConfig, stripPlatformConfigKeys } from "xyne-claw-shared";
import { mintSessionToken } from "../lib/session-tokens.js";
import { consumeAlreadyOpenStream } from "../lib/consume-claw-stream.js";
import { redisService } from "../redis.js";
import { requireAuth, requireStrictS2S, requireUserAuth, requireResultToken } from "../middleware/require-auth.js";

import { createLogger } from "../logger.js";
const log = createLogger("run");

const router = Router();

function requireRunCaller(req: Request, res: Response, next: NextFunction): void | Promise<void> {
  if (req.originalUrl.includes("/internal/run")) {
    return requireAuth(req, res, next);
  }
  return requireUserAuth(req, res, next);
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

async function resolveUserId(body: Record<string, unknown>): Promise<{ userId: string; userName: string; userEmail: string } | { error: string }> {
  const { userId, userName, gatewayType, externalUserId } = body as {
    userId?: string;
    userName?: string;
    gatewayType?: string;
    externalUserId?: string;
  };

  // Direct call with userId (e.g., from Xyne Spaces)
  if (userId && typeof userId === "string" && userId.trim().length > 0) {
    const user = await prisma.user.findUnique({ where: { id: userId.trim() } });
    return {
      userId: userId.trim(),
      userName: userName?.trim() ?? user?.name ?? "",
      userEmail: user?.email ?? "",
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

    return { userId: identity.userId, userName: identity.user.name, userEmail: identity.user.email };
  }

  return { error: "Either userId or (gatewayType + externalUserId) is required" };
}

// ── Resolve Spaces auth from request (for service-to-service calls) ──

async function resolveSpacesAuthFromRequest(req: Request): Promise<SpacesAuthContext | undefined> {
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

    return {
      ...(token ? { token } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(workspaceId ? { workspaceId } : {}),
    };
  } catch (err) {
    log.warn("[run] Failed to resolve Spaces auth from request:", err);
    return undefined;
  }
}

// ── Resolve agent config ──

async function resolveAgent(agentSlug: string | undefined): Promise<{
  systemPrompt: string;
  modelId?: string | undefined;
  agentConfig: Record<string, unknown>;
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
  const agent = agentSlug
    ? await prisma.agent.findUnique({ where: { slug: agentSlug }, include: includeSkills })
    : await prisma.agent.findFirst({ where: { isDefault: true }, include: includeSkills });

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
    systemPrompt: agent.systemPrompt,
    modelId: agent.modelId || undefined,
    agentConfig: stripPlatformConfigKeys(agent.config as Record<string, unknown>),
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

// ── POST /run — accept task, resolve identity + agent, forward to xyne-claw ──

router.post("/run", requireRunCaller, async (req: Request, res: Response) => {
  try {
    const { task, context, conversationId, piSessionConversationId, agentSlug, callbackUrl, channelId, projectId, projectName, cwd, eventType, traceId, provider, providerOrder, subagentProviders, providerConfigs, progressUrl, attachments, contextFiles, attachedContext, ticketIds, canvasIds, callIds, isRegenerate } = req.body as {
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
      channelId?: string;
      projectId?: string;
      projectName?: string;
      cwd?: string;
      eventType?: string;
      traceId?: string;
      provider?: string;
      providerOrder?: string[];
      subagentProviders?: Record<string, string>;
      providerConfigs?: Record<string, { apiKey: string; model: string; baseUrl?: string }>;
      progressUrl?: string;
      attachments?: Array<{ fileName: string; mimeType: string; data: string }>;
      contextFiles?: Array<{ path: string; content: string }>;
      attachedContext?: Array<{ type: "channel" | "ticket" | "canvas" | "call"; id: string; title: string; threadId?: string }>;
      ticketIds?: string[];
      canvasIds?: string[];
      callIds?: string[];
      /** Branching: when true, claw branches the PI session at the last user
       *  entry so the new assistant turn is a sibling of the previous one. */
      isRegenerate?: boolean;
    };

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

    // Resolve identity
    const resolved = await resolveUserId(req.body as Record<string, unknown>);
    if ("error" in resolved) {
      res.status(400).json({ success: false, error: resolved.error });
      return;
    }

    const sessionUserId = req.headers["x-user-id"];
    if (typeof sessionUserId === "string" && sessionUserId && sessionUserId !== resolved.userId) {
      log.warn(`[run] userId pin mismatch: session=${sessionUserId} body=${resolved.userId}`);
      res.status(403).json({ success: false, error: "Body userId does not match authenticated session" });
      return;
    }

    // Resolve agent (only if explicitly requested) - pass userId to get user-specific skills
    const agent = await resolveAgent(agentSlug);
    if ("error" in agent) {
      res.status(400).json({ success: false, error: agent.error });
      return;
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
      const spacesAuth = await resolveSpacesAuthFromRequest(req);
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
        const catalog = await buildAgentCatalog(resolved.userId);
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
    const mergedAgentConfig = stripPlatformConfigKeys({ ...agent.agentConfig, ...((req.body as { agentConfig?: Record<string, unknown> }).agentConfig ?? {}) });
    const requestedSubagentNames = parseToolsConfig(mergedAgentConfig)?.subagents ?? [];
    const customSubagents = requestedSubagentNames.length > 0
      ? await resolveCustomSubagentsForRun(prisma, requestedSubagentNames)
      : [];

    const sessionId = randomUUID();
    const sessionToken = mintSessionToken({
      sessionId,
      userId: resolved.userId,
      ...(agentSlug ? { agentSlug } : {}),
      ttlSeconds: 6 * 60 * 60,
    });

    // Persist attached items for the lifetime of this session so the MCP /call
    // boundary can default-fill missing channelId/conversationId on spaces-*
    // tool calls (see mcp/attached-context-injector.ts). Fire-and-forget — the
    // run still works without it; only auto-scoping is degraded.
    if (normalizedAttached.length > 0) {
      storeAttachedContextForSession(sessionId, normalizedAttached).catch(() => {});
    }

    // Shared request body for both transports. SSE consumers (run-stream.ts)
    // pass progressUrl/callbackUrl too — claw ignores them in SSE mode since
    // the response stream IS the channel.
    const forwardBody = {
      sessionId,
      sessionToken,
      userId: resolved.userId,
      userName: resolved.userName,
      userEmail: resolved.userEmail,
      task: task.trim(),
      context: mergedContext,
      conversationId,
      ...(piSessionConversationId ? { piSessionConversationId } : {}),
      ...(callbackUrl ? { callbackUrl } : {}),
      ...(effectivePrompt ? { systemPrompt: effectivePrompt } : {}),
      ...(agent.modelId ? { modelId: agent.modelId } : {}),
      agentConfig: mergedAgentConfig,
      agentSlug,
      channelId,
      ...(projectId ? { projectId } : {}),
      ...(projectName ? { projectName } : {}),
      ...(eventType ? { eventType } : {}),
      ...(traceId ? { traceId } : {}),
      ...(provider ? { provider } : {}),
      ...(providerOrder?.length ? { providerOrder } : {}),
      ...(subagentProviders ? { subagentProviders } : {}),
      ...(providerConfigs ? { providerConfigs } : {}),
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
      ...(isRegenerate ? { isRegenerate: true } : {}),
    };

    // SSE pass-through: the caller (run-stream.ts) opted into the streaming
    // transport via Accept: text/event-stream. Forward the same header to
    // claw and pipe the response body straight back. All pre-flight work
    // (identity, agent resolution, message persistence, AgentRun tracking)
    // ran above — same as legacy mode — so downstream behavior is unchanged.
    const acceptHeader = (req.headers["accept"] as string | undefined) ?? "";
    if (acceptHeader.includes("text/event-stream")) {
      log.info(`[run] proxy: forwarding SSE upstream to claw (sessionId=${sessionId})`);
      const clawRes = await fetch(`${CONFIG.xyneClawUrl}/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
        },
        body: JSON.stringify(forwardBody),
      });

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
      if (conversationId && !persistedByCaller) {
        try {
          await chatMessageRepository.create({
            conversationId,
            agentSlug: agentSlug || 'assistant',
            userId: resolved.userId,
            role: 'user',
            content: task.trim(),
          });
        } catch (msgErr) {
          log.warn("[run] Failed to persist user message:", msgErr instanceof Error ? msgErr.message : msgErr);
        }
        agentRunRepository.start({
          sessionId,
          userId: resolved.userId,
          agentSlug: agentSlug || 'assistant',
          triggerSource: "spaces",
          task: task.trim(),
          conversationId,
          ...(channelId ? { channelId } : {}),
          ...(projectId ? { projectId } : {}),
          ...(projectName ? { projectName } : {}),
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

      try {
        for (;;) {
          const { value, done } = await upstreamReader.read();
          if (done) break;
          if (value) {
            if (!res.write(Buffer.from(value))) {
              // backpressure: wait for drain before reading the next chunk so
              // we don't accumulate the agent's text deltas in the Node heap
              await new Promise<void>((resolve) => res.once("drain", () => resolve()));
            }
          }
        }
      } catch (pipeErr) {
        log.error(`[run] proxy: SSE pipe error (sessionId=${sessionId}):`, pipeErr instanceof Error ? pipeErr.message : String(pipeErr));
        if (!res.writableEnded) {
          try {
            res.write(`event: error\ndata: ${JSON.stringify({ error: pipeErr instanceof Error ? pipeErr.message : "pipe error" })}\n\n`);
          } catch { /* socket gone */ }
        }
      } finally {
        try { upstreamReader.releaseLock(); } catch { /* ignore */ }
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
      const probeRes = await fetch(`${CONFIG.xyneClawUrl}/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
        },
        body: JSON.stringify(forwardBody),
      });

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
      if (conversationId && !persistedByCaller) {
        try {
          await chatMessageRepository.create({
            conversationId,
            agentSlug: agentSlug || 'assistant',
            userId: resolved.userId,
            role: 'user',
            content: task.trim(),
          });
        } catch (msgErr) {
          log.warn("[run] Failed to persist user message:", msgErr instanceof Error ? msgErr.message : msgErr);
        }
        agentRunRepository.start({
          sessionId,
          userId: resolved.userId,
          agentSlug: agentSlug || 'assistant',
          triggerSource: "spaces",
          task: task.trim(),
          conversationId,
          ...(channelId ? { channelId } : {}),
          ...(projectId ? { projectId } : {}),
          ...(projectName ? { projectName } : {}),
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
        callbackUrl,
        sessionId,
        sessionToken,
        conversationId: typeof conversationId === "string" ? conversationId : undefined,
        agentSlug: typeof agentSlug === "string" ? agentSlug : undefined,
      });
      return;
    }

    // Legacy JSON path — unchanged. Used when CLAW_SSE_TRANSPORT=off so a flag
    // flip is the only thing required to roll back to per-chunk POSTs.
    const clawRes = await fetch(`${CONFIG.xyneClawUrl}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify(forwardBody),
    });

    const body = (await clawRes.json()) as { success: boolean; sessionId?: string; error?: string };

    if (!body.success || !body.sessionId) {
      res.status(clawRes.status).json(body);
      return;
    }

    // Persist user message UNLESS the caller (e.g., /chat) has already persisted it.
    // /chat sets __persistedByCaller: true to skip this, since it creates the user message.
    // Direct callers like Ask AI v2 rely on this endpoint to persist messages.
    const persistedByCaller = (req.body as { __persistedByCaller?: boolean }).__persistedByCaller;
    if (conversationId && !persistedByCaller) {
      try {
        await chatMessageRepository.create({
          conversationId,
          agentSlug: agentSlug || 'assistant',
          userId: resolved.userId,
          role: 'user',
          content: task.trim(),
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
    if (conversationId && !persistedByCaller) {
      agentRunRepository.start({
        sessionId: body.sessionId,
        userId: resolved.userId,
        agentSlug: agentSlug || 'assistant',
        triggerSource: "spaces",
        task: task.trim(),
        conversationId,
        ...(channelId ? { channelId } : {}),
        ...(projectId ? { projectId } : {}),
        ...(projectName ? { projectName } : {}),
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

      const assistantMsg = await chatMessageRepository.create({
        conversationId,
        agentSlug: agentSlug || 'assistant',
        userId,
        role: 'assistant',
        content,
        status: status === 'completed' ? 'completed' : 'failed',
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

async function runBridgeForProbeResponse(opts: BridgeForProbeOpts): Promise<void> {
  const { probeRes, progressUrl, callbackUrl, sessionId, sessionToken, conversationId, agentSlug } = opts;
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
    } else if (callbackUrl && !result.result) {
      // No done frame arrived — claw's stream ended cleanly without one. Surface
      // a synthetic failed callback so the caller's run tracker doesn't sit in
      // "running" forever.
      try {
        await fetch(callbackUrl, {
          method: "POST",
          headers: callbackHeaders,
          body: JSON.stringify({
            ...convFallback,
            sessionId,
            status: "failed",
            error: "Claw SSE stream ended without a done frame",
          }),
        });
      } catch { /* exhausted */ }
    }
  } catch (err) {
    log.error(`[run] proxy: bridge failed (session=${sessionId}): ${err instanceof Error ? err.message : String(err)}`);
    if (callbackUrl) {
      try {
        await fetch(callbackUrl, {
          method: "POST",
          headers: callbackHeaders,
          body: JSON.stringify({
            ...convFallback,
            sessionId,
            status: "failed",
            error: err instanceof Error ? err.message : "SSE bridge failed",
          }),
        });
      } catch { /* exhausted */ }
    }
  }
}

export { router as runRouter };
