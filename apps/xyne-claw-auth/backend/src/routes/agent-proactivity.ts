/**
 * Routes for agent proactivity: a draft for a channel question nobody tagged the agent in.
 *
 * The Spaces backend decides whether and which agent answers; it asks here for a draft.
 * The run is dispatched like awakening's: the agent's own bot, read-only, kept to the
 * room (agent-proactivity/tool-policy.ts). Its result goes through the standard
 * /webhook/result with a resultForwardUrl, as Spaces auto-draft's does: saved, cited and
 * finalized there, then forwarded to the backend instead of posted, because the backend
 * checks the conversation again before anything posts.
 */

import { randomUUID } from "crypto";
import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { requireInternalS2S } from "../middleware/require-auth.js";
import { agentRunRepository, chatMessageRepository } from "../repositories/index.js";
import { setSession } from "../lib/session-context.js";
import { fetchConversationHistory, threadAwarenessContext } from "./webhook.js";
import { ensureUserExists } from "../lib/users-jit.js";
import { resolveAgentProviderConfigs } from "../lib/agent-provider-config.js";
import { resolveAgentIdentity, AwakeningIdentityError } from "../awakening/dispatch.js";
import { buildWritePermissions } from "../awakening/write-policy.js";
import { resolveAwakeningConfig } from "../awakening/config.js";
import { isInternalCallbackOrigin } from "../surfaces/external-api/delivery.js";
import { PROACTIVE_SKILL } from "../agent-proactivity/skill.js";
import { PROACTIVITY_TRIGGER } from "../agent-proactivity/tool-policy.js";
import { isAgentInvocableBy } from "xyne-claw-shared";
import { createLogger } from "../logger.js";

const log = createLogger("agent-proactivity");

export const agentProactivityRouter: Router = Router();

interface DraftBody {
  agentSlug?: string;
  agentUserId?: string;
  workspaceId?: string;
  channelId?: string;
  conversationId?: string;
  episodeId?: string;
  /** The question as the asker wrote it: what a tagged run gets as its task. */
  task?: string;
  senderName?: string;
  channelName?: string;
  /** Already answered in the thread: draft only what that answer leaves out. */
  onlyAdd?: boolean;
  why?: string;
  /** Where the standard result handler forwards the draft: the backend, internal only. */
  callbackUrl?: string;
}

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

/**
 * POST /proactivity/draft — the Spaces backend asks an agent for a draft.
 */
agentProactivityRouter.post("/proactivity/draft", requireInternalS2S, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as DraftBody;
  const agentSlug = str(body.agentSlug);
  const workspaceId = str(body.workspaceId);
  const channelId = str(body.channelId);
  const conversationId = str(body.conversationId);
  const episodeId = str(body.episodeId);
  const task = str(body.task);
  const callbackUrl = str(body.callbackUrl);
  if (!agentSlug || !workspaceId || !channelId || !conversationId || !episodeId || !task || !callbackUrl) {
    res.status(400).json({ success: false, error: "agentSlug, workspaceId, channelId, conversationId, episodeId, task and callbackUrl are required" });
    return;
  }
  // The draft goes back to the Spaces backend and nowhere else.
  if (!isInternalCallbackOrigin(callbackUrl)) {
    res.status(400).json({ success: false, error: "callbackUrl must be an internal origin" });
    return;
  }

  const agent = await prisma.agent.findFirst({
    where: { slug: agentSlug, enabled: true, ...(str(body.agentUserId) ? { spacesAppUserId: str(body.agentUserId)! } : {}) },
    select: { id: true, slug: true, name: true, orgId: true, config: true, spacesAppId: true, spacesAppUserId: true, spacesAppToken: true },
  });
  if (!agent) {
    res.status(404).json({ success: false, error: "agent not found" });
    return;
  }
  // Everyone in the channel reads the answer: only an agent anyone may call.
  if (!isAgentInvocableBy(agent.config as Record<string, unknown> | null, null)) {
    res.status(403).json({ success: false, error: "only an agent everyone may call answers without a mention" });
    return;
  }

  let identity;
  try {
    // Fail-closed, as for awakening: an unprompted run acts as the agent's own bot or not at all.
    identity = resolveAgentIdentity(agent, workspaceId);
  } catch (err) {
    res.status(409).json({ success: false, error: err instanceof AwakeningIdentityError ? err.message : "agent identity unavailable" });
    return;
  }
  if (!(await ensureUserExists(identity.spacesAppUserId, "proactivity", agent.orgId))) {
    res.status(409).json({ success: false, error: "could not mirror the agent's Spaces user" });
    return;
  }

  // As a tagged run gets it: the message is the task, the thread is the context. Plus
  // where it is, so the agent can search this channel first, and for a question already
  // answered, that it only adds.
  const senderName = str(body.senderName);
  const channelName = str(body.channelName);
  const history = await fetchConversationHistory(conversationId, identity.appToken, identity.spacesAppUserId);
  const context = [
    `Channel: #${channelName ?? channelId} (id ${channelId})`,
    body.onlyAdd === true
      ? "## Already answered\nSomeone has already answered this in the thread. Reply only with what that answer leaves out, without repeating any of it. If it leaves nothing out, reply with nothing."
      : "",
    history ? threadAwarenessContext(history) : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const key = `${episodeId}:${agent.slug}:${randomUUID()}`;
  // Its own claw conversation, so the agent's session store never mixes with the
  // tagged runs in the same thread; the real thread rides in the SessionContext.
  const runConversationId = `proactivity_${episodeId}_${agent.slug}`;
  const baseConfig = (agent.config ?? {}) as Record<string, unknown>;
  const existingPermissions = (baseConfig["toolPermissions"] as Record<string, string> | undefined) ?? {};
  const agentConfig: Record<string, unknown> = {
    ...baseConfig,
    // Code is read in the one shared read-only sandbox, never a writable one of its own,
    // whatever the agent allows its automations.
    allowWriteInReadOnlyJob: false,
    // Belt and braces with the call-boundary guard: the same denials an observe-only
    // awakening gets, so claw never even offers the write tools.
    toolPermissions: buildWritePermissions(
      { ...resolveAwakeningConfig(baseConfig), writePolicy: "observe", shadow: true },
      existingPermissions,
    ),
  };
  const { providerConfigs, providerOrder, parent: providerParent } = await resolveAgentProviderConfigs(
    agent as Parameters<typeof resolveAgentProviderConfigs>[0],
    { headlessBulk: true },
  ).catch(() => ({ providerConfigs: {}, providerOrder: [] as string[], parent: undefined as string | undefined }));

  const response = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
    },
    body: JSON.stringify({
      userId: identity.spacesAppUserId,
      task,
      context,
      ...(senderName ? { senderName } : {}),
      ...(channelName ? { channelName } : {}),
      agentSlug: agent.slug,
      orgId: agent.orgId,
      channelId,
      conversationId: runConversationId,
      traceId: runConversationId,
      // No callbackUrl: the standard /webhook/result handles it and forwards it (below).
      // No progressUrl: an unprompted draft shows nothing in the thread until it posts.
      idempotencyKey: key,
      detached: true,
      // xyne-claw strips every write tool for this kind of run.
      eventType: PROACTIVITY_TRIGGER,
      skills: [PROACTIVE_SKILL],
      __persistedByCaller: true,
      agentConfig,
      ...(providerParent ? { provider: providerParent } : {}),
      ...(Object.keys(providerConfigs).length > 0 ? { providerConfigs } : {}),
      ...(providerOrder.length > 1 ? { providerOrder } : {}),
    }),
  }).catch((err: unknown) => {
    log.warn(`[proactivity] dispatch failed agent=${agent.slug}: ${err instanceof Error ? err.message : err}`);
    return null;
  });
  const dispatched = (await response?.json().catch(() => null)) as { success?: boolean; sessionId?: string; error?: string } | null;
  if (!response?.ok || !dispatched?.success || !dispatched.sessionId) {
    res.status(502).json({ success: false, error: dispatched?.error ?? `dispatch failed (${response?.status ?? "network"})` });
    return;
  }
  const sessionId = dispatched.sessionId;

  // Before answering: claw lists tools within milliseconds, and the listing reads this.
  await setSession(
    sessionId,
    {
      mentionedUserId: identity.spacesAppUserId,
      senderId: identity.spacesAppUserId,
      senderName: senderName ?? agent.slug,
      // The room: the call-boundary guard keeps Spaces reads to it and public channels.
      channelId,
      channelName: channelName ?? "",
      conversationId,
      task,
      agentId: agent.id,
      agentOrgId: agent.orgId,
      agentSlug: agent.slug,
      agentName: agent.name,
      responseMode: "conversation",
      triggerSource: PROACTIVITY_TRIGGER,
      // A draft, never a thread reply: forwarded to the backend, which posts it, if anything.
      resultForwardUrl: callbackUrl,
      suppressThreadReply: true,
      // App mode: Spaces is served with the bot's token, never a person's.
      isAutomation: true,
      appToken: identity.appToken,
      spacesAppId: identity.spacesAppId,
      spacesAppUserId: identity.spacesAppUserId,
      workspaceId,
      traceId: runConversationId,
    },
    // The real thread may have tagged runs of this agent; never shadow their index.
    { skipConversationIndex: true },
  ).catch((err: unknown) => log.warn(`[proactivity] setSession failed ${sessionId}: ${err instanceof Error ? err.message : err}`));

  res.json({ success: true, sessionId });

  await chatMessageRepository
    .create({
      conversationId: runConversationId,
      agentSlug: agent.slug,
      userId: identity.spacesAppUserId,
      role: "user",
      content: task,
      status: "completed",
      orgId: agent.orgId,
    })
    .catch((err: unknown) => log.warn(`[proactivity] user ChatMessage failed: ${err instanceof Error ? err.message : err}`));
  await agentRunRepository
    .start({
      sessionId,
      userId: identity.spacesAppUserId,
      agentSlug: agent.slug,
      orgId: agent.orgId,
      triggerSource: PROACTIVITY_TRIGGER,
      task: `answer without a mention (${str(body.why) ?? "open question"})`,
      conversationId: runConversationId,
      channelId,
    })
    .catch((err: unknown) => log.warn(`[proactivity] AgentRun.start failed: ${err instanceof Error ? err.message : err}`));
  log.info(`[proactivity] dispatched agent=${agent.slug} episode=${episodeId} session=${sessionId}`);
});

/** A run's tool calls as the trace shows them: name, arguments, how it went, the result trimmed. */
function toolCallsOf(invocations: unknown) {
  if (!Array.isArray(invocations)) return [];
  const clip = (value: unknown) => {
    const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
    return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
  };
  return (invocations as Array<Record<string, unknown>>).map((call) => ({
    toolName: typeof call["toolName"] === "string" ? call["toolName"] : "unknown",
    args: clip(call["args"] ?? call["input"]),
    result: clip(call["result"]),
    isError: call["isError"] === true,
    durationMs: typeof call["durationMs"] === "number" ? call["durationMs"] : null,
  }));
}

/**
 * GET /proactivity/episodes/:episodeId/drafts?channelId= — each agent's run for one
 * question, from the runs themselves: the prompt it was given (the run's user message),
 * its tool calls, and what it wrote. The only place a draft is kept. The Spaces backend checks that the reader may
 * see the channel before asking.
 */
agentProactivityRouter.get(
  "/proactivity/episodes/:episodeId/drafts",
  requireInternalS2S,
  async (req: Request<{ episodeId: string }>, res: Response) => {
    const episodeId = str(req.params.episodeId);
    const channelId = str(req.query["channelId"]);
    if (!episodeId || !channelId) {
      res.status(400).json({ success: false, error: "episodeId and channelId are required" });
      return;
    }
    const runs = await prisma.agentRun.findMany({
      where: {
        triggerSource: PROACTIVITY_TRIGGER,
        channelId,
        conversationId: { startsWith: `proactivity_${episodeId}_` },
      },
      orderBy: { startedAt: "asc" },
      select: {
        agentSlug: true,
        conversationId: true,
        status: true,
        result: true,
        error: true,
        model: true,
        totalMs: true,
        toolInvocations: true,
        startedAt: true,
        completedAt: true,
      },
    });
    const prompts = await prisma.chatMessage.findMany({
      where: { conversationId: { in: runs.map((run) => run.conversationId ?? "") }, role: "user" },
      select: { conversationId: true, content: true },
      orderBy: { createdAt: "asc" },
    });
    // An agent's rewrite runs in the same conversation: its nth run got its nth prompt.
    const seen = new Map<string, number>();
    const promptOf = (conversationId: string | null) => {
      const n = seen.get(conversationId ?? "") ?? 0;
      seen.set(conversationId ?? "", n + 1);
      return prompts.filter((p) => p.conversationId === conversationId)[n]?.content ?? "";
    };
    res.json({
      success: true,
      data: runs.map(({ toolInvocations, conversationId, ...run }) => ({
        ...run,
        task: promptOf(conversationId),
        toolCalls: toolCallsOf(toolInvocations),
      })),
    });
  },
);
