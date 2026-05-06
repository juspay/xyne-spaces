import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { chatMessageRepository, agentRunRepository, chatAttachmentRepository } from "../repositories/index.js";
import { gcsService } from "../services/gcsService.js";
import {
  normalizeAttachedContext,
  buildAttachedContextPayload,
  type AttachedContextRef,
} from "../services/agentChatContextService.js";
import type { SpacesAuthContext } from "../mcp/servers/xyne-spaces-client.js";

const router = Router();

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
2. **Knowledge base** — spaces-memory-search
3. **Messages & conversations** — spaces-messages
4. **Tickets & work items** — spaces-tickets
5. **Search** — spaces-search
6. **People lookup** — spaces-users
7. **Deep research** — spaces-research (delegated research agent)

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
2. **Knowledge base** — spaces-memory-search
3. **Messages & conversations** — spaces-messages
4. **Tickets & work items** — spaces-tickets
5. **Search** — spaces-search
6. **People lookup** — spaces-users
7. **Deep research** — spaces-research (delegated research agent)

## How to Respond
- Mirror the user's communication style.
- Ground every answer in data from tools. Do not guess.
- For engineering queries — use Bitbucket, Kibana, or Grafana tools.
- Respond in first person ("I", "my", "we") as the user.
- Acknowledge gaps honestly.
- Keep the reply **short — 4 to 10 lines max**. People don't read long messages in chat. Be direct and actionable.
- Do thorough research (search messages, tickets, activity — gather all the context you need), but keep the **final reply concise**.

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
4. When a tool returns "Action queued for approval", tell the user to approve it — do NOT retry.`;

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
    const cookies = req.headers.cookie;
    if (!cookies) return undefined;

    // Parse cookies
    const cookieMap = new Map<string, string>();
    for (const cookie of cookies.split(";")) {
      const [name, ...rest] = cookie.trim().split("=");
      if (name && rest.length > 0) {
        cookieMap.set(name, rest.join("="));
      }
    }    
    // Look for Spaces session cookies
    const sessionCookie = cookieMap.get("xyne_session") || cookieMap.get("session") || cookieMap.get("connect.sid");
    if (!sessionCookie) return undefined;

    // Return auth context with sessionId - the actual validation happens in the interact() calls
    return {
      sessionId: sessionCookie,
    };
  } catch (err) {
    console.warn("[run] Failed to resolve Spaces auth from request:", err);
    return undefined;
  }
}

// ── Resolve agent config ──

async function resolveAgent(agentSlug: string | undefined): Promise<{
  systemPrompt: string;
  modelId?: string | undefined;
  agentConfig: Record<string, unknown>;
  skills?: { slug: string; name: string; description: string; content: string }[];
} | { error: string }> {
  // Find by slug, or fall back to default agent
  const includeSkills = { skills: { include: { skill: true } } };
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
  const skills = agent.skills.map((as) => ({
    slug: as.skill.slug,
    name: as.skill.name,
    description: as.skill.description ?? "",
    content: as.skill.content,
  }));

  return {
    systemPrompt: agent.systemPrompt,
    modelId: agent.modelId || undefined,
    agentConfig: agent.config as Record<string, unknown>,
    ...(skills.length > 0 ? { skills } : {}),
  };
}

// ── POST /run — accept task, resolve identity + agent, forward to xyne-claw ──

router.post("/run", async (req: Request, res: Response) => {
  try {
    const { task, context, conversationId, agentSlug, callbackUrl, channelId, cwd, repoUrl, eventType, traceId, provider, subagentProviders, providerConfigs, progressUrl, attachments, contextFiles, attachedContext } = req.body as {
      task?: string;
      context?: string;
      conversationId?: string;
      agentSlug?: string;
      callbackUrl?: string;
      channelId?: string;
      cwd?: string;
      repoUrl?: string;
      eventType?: string;
      traceId?: string;
      provider?: string;
      subagentProviders?: Record<string, string>;
      providerConfigs?: Record<string, { apiKey: string; model: string; baseUrl?: string }>;
      progressUrl?: string;
      attachments?: Array<{ fileName: string; mimeType: string; data: string }>;
      contextFiles?: Array<{ path: string; content: string }>;
      attachedContext?: Array<{ type: "channel" | "ticket" | "canvas" | "call"; id: string; title: string; threadId?: string }>;
    };

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

    // Resolve attachedContext to actual content if Spaces auth is available
    let resolvedAttachedContext: { contextFiles: Array<{ path: string; content: string }>; promptPrefix?: string } | undefined;
    if (attachedContext?.length) {
      const normalized = normalizeAttachedContext(attachedContext);
      if (!normalized.error && normalized.items.length > 0) {
        // Try to get Spaces auth from request cookies
        const spacesAuth = await resolveSpacesAuthFromRequest(req);
        if (spacesAuth) {
          try {
            resolvedAttachedContext = await buildAttachedContextPayload(normalized.items, spacesAuth);
            console.log(`[run] Resolved ${normalized.items.length} attached context items to ${resolvedAttachedContext.contextFiles.length} context files`);
          } catch (err) {
            console.warn("[run] Failed to resolve attachedContext:", err instanceof Error ? err.message : String(err));
          }
        } else {
          console.warn("[run] No Spaces auth available to resolve attachedContext");
        }
      }
    }

    // Forward to xyne-claw (returns sessionId immediately)
    // Include resolved attached context (contextFiles + promptPrefix) if available
    const mergedContextFiles = [
      ...(contextFiles ?? []),
      ...(resolvedAttachedContext?.contextFiles ?? []),
    ];
    
    // Build additional instructions that include the promptPrefix from resolved context
    let additionalInstructions = (req.body as { additionalInstructions?: string }).additionalInstructions ?? "";
    if (resolvedAttachedContext?.promptPrefix) {
      additionalInstructions = additionalInstructions 
        ? `${resolvedAttachedContext.promptPrefix}\n\n${additionalInstructions}`
        : resolvedAttachedContext.promptPrefix;
    }

    const clawRes = await fetch(`${CONFIG.xyneClawUrl}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify({
        userId: resolved.userId,
        userName: resolved.userName,
        userEmail: resolved.userEmail,
        task: task.trim(),
        context,
        conversationId,
        ...(callbackUrl ? { callbackUrl } : {}),
        ...(effectivePrompt ? { systemPrompt: effectivePrompt } : {}),
        ...(agent.modelId ? { modelId: agent.modelId } : {}),
        agentConfig: { ...agent.agentConfig, ...((req.body as { agentConfig?: Record<string, unknown> }).agentConfig ?? {}) },
        agentSlug,
        channelId,
        ...(eventType ? { eventType } : {}),
        ...(traceId ? { traceId } : {}),
        ...(provider ? { provider } : {}),
        ...(subagentProviders ? { subagentProviders } : {}),
        ...(providerConfigs ? { providerConfigs } : {}),
        ...(cwd ? { cwd } : {}),
        ...(repoUrl ? { repoUrl } : {}),
        ...(agent.skills ? { skills: agent.skills } : {}),
        ...(progressUrl ? { progressUrl } : {}),
        ...(attachments?.length ? { attachments } : {}),
        ...(mergedContextFiles.length > 0 ? { contextFiles: mergedContextFiles } : {}),
        ...(attachedContext?.length ? { attachedContext } : {}),
        ...((req.body as { researchContext?: unknown }).researchContext ? { researchContext: (req.body as { researchContext?: unknown }).researchContext } : {}),
        ...(additionalInstructions ? { additionalInstructions } : {}),
      }),
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
        console.warn("[run] Failed to persist user message:", msgErr instanceof Error ? msgErr.message : msgErr);
      }
    }

    // Track run for Agent Control Center
    if (conversationId) {
      agentRunRepository.start({
        sessionId: body.sessionId,
        userId: resolved.userId,
        agentSlug: agentSlug || 'assistant',
        triggerSource: "spaces",
        task: task.trim(),
        conversationId,
      }).catch((e) => console.warn("[run] AgentRun.start failed:", e instanceof Error ? e.message : e));
    }

    res.json({ success: true, sessionId: body.sessionId });
  } catch (err) {
    console.error("[run] Error forwarding to xyne-claw:", err);
    res.status(502).json({ success: false, error: "Failed to reach agent service" });
  }
});

// ── POST /sessions/:id/result — callback from xyne-claw, forward to Xyne Spaces ──

router.post("/sessions/:id/result", async (req: Request<{ id: string }>, res: Response) => {
  const { id } = req.params;
  const payload = req.body as Record<string, unknown>;

  console.log(`[sessions] ${id}: received result (status=${payload["status"] as string})`);

  // Acknowledge xyne-claw immediately
  res.json({ success: true });

  // Persist assistant message in ChatMessage table (same as /chat callback)
  // so conversations appear in the /conversations history endpoint
  const conversationId = payload["conversationId"] as string | undefined;
  const agentSlug = payload["agentSlug"] as string | undefined;
  const userId = payload["userId"] as string | undefined;
  const content = (payload["result"] as string) || (payload["error"] as string) || "";
  const status = payload["status"] as string;

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
            console.error(`[sessions] ${id}: failed to persist attachment ${att.fileName}:`, attErr instanceof Error ? attErr.message : String(attErr));
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
      console.warn(`[sessions] ${id}: failed to persist assistant message:`, msgErr instanceof Error ? msgErr.message : String(msgErr));
    }

    // Also finalize the AgentRun with tool invocations so they appear in history
    try {
      await agentRunRepository.finalize(id, {
        status: status === 'completed' ? 'completed' : 'failed',
        result: content,
        error: status !== 'completed' ? content : null,
        toolsUsed: toolsUsed ?? [],
        ...(toolInvocations ? { toolInvocations } : {}),
      });
    } catch (finalizeErr) {
      console.warn(`[sessions] ${id}: failed to finalize agent run:`, finalizeErr instanceof Error ? finalizeErr.message : finalizeErr);
    }
  }

  // Forward result to Xyne Spaces
  if (!CONFIG.xyneSpacesCallbackUrl) {
    console.warn(`[sessions] ${id}: no XYNE_SPACES_CALLBACK_URL configured, result not forwarded`);
    return;
  }

  try {
    const spacesRes = await fetch(CONFIG.xyneSpacesCallbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!spacesRes.ok) {
      console.error(`[sessions] ${id}: Xyne Spaces callback returned ${spacesRes.status}`);
    }
  } catch (err) {
    console.error(`[sessions] ${id}: failed to forward to Xyne Spaces:`, err);
  }
});

export { router as runRouter };
