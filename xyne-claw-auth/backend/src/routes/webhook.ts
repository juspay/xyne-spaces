/**
 * Webhook handler for Xyne Spaces app events.
 *
 * POST /webhook       — receives USER_MENTIONED events, starts xyne-claw for the mentioned user
 * POST /webhook/result — callback from xyne-claw, sends result to mentioned user's DM with approve/decline
 */

import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { CONFIG } from "../config.js";
import { prisma } from "../db.js";
import { decrypt } from "../crypto.js";
import { redisService } from "../redis.js";

const router = Router();

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
  };
  timestamp: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

function verifySignature(body: string, signature: string | undefined, secret: string): boolean {
  if (!signature || !secret) return false;
  try {
    const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

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
  const agent = await prisma.agent.findFirst({
    where: { spacesAppUserId: appUserId },
  });

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
  const agent = await prisma.agent.findFirst({
    where: { isDefault: true, enabled: true },
  });

  if (!agent?.spacesAppToken || !agent.spacesAppId) return null;

  return {
    slug: agent.slug,
    appToken: decryptStoredField(agent.spacesAppToken),
    spacesAppId: agent.spacesAppId,
    spacesAppUserId: agent.spacesAppUserId ?? "",
    isDefault: true,
  };
}

async function fetchConversationHistory(
  conversationId: string,
  appToken?: string,
): Promise<string | undefined> {
  try {
    const data = await spacesAppFetchGet(
      `/chat/conversationReplies?conversationId=${encodeURIComponent(conversationId)}`,
      appToken,
    ) as { items?: Array<{ userId: string; cleanContent: string; createdAt: string }> };

    const items = data.items ?? [];
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
    `    context: {}`,
    "---",
    "",
    contextHeader + result,
  ];

  return frontmatter.join("\n");
}

// ── POST /webhook and /webhook/:agentSlug — receive events from Xyne Spaces ──

async function handleWebhook(req: Request, res: Response): Promise<void> {
  const rawBody = JSON.stringify(req.body);
  const signature = req.headers["x-xyne-signature"] as string | undefined;

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
    // Agent-specific webhook: /webhook/:agentSlug
    const agentRow = await prisma.agent.findUnique({ where: { slug: agentSlugFromUrl } });
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
      agent = await resolveAgentByAppUserId(mentionedUserIds[0]!);
    }
  }

  // Fall back to default agent
  if (!agent) {
    agent = await getDefaultAgent();
  }

  if (!agent) {
    console.error("[webhook] No agent found and no default agent registered");
    res.json({ success: true });
    return;
  }

  console.log(`[webhook] ${eventType} from user ${payload.userId} → agent ${agent.slug}`);

  // Acknowledge immediately
  res.json({ success: true });

  const task = payload.cleanContent?.trim();
  if (!task) return;

  try {
    // Fetch thread history to give the agent context
    const history = await fetchConversationHistory(payload.conversationId, agent.appToken);

    // For USER_MENTIONED: run as the mentioned user (their tools, their twin)
    const allMentionedIds = (payload as { mentionedUserIds?: string[] }).mentionedUserIds ?? [];
    const targetUserId = eventType === "USER_MENTIONED" && allMentionedIds.length > 0
      ? allMentionedIds[0]! : payload.userId;

    const runUrl = `${CONFIG.selfUrl}/claw/api/v1/run`;
    const runRes = await fetch(runUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: targetUserId,
        task,
        conversationId: payload.conversationId,
        agentSlug: agent.slug,
        callbackUrl: `${CONFIG.selfUrl}/claw/api/v1/webhook/result`,
        ...(history ? { context: history } : {}),
      }),
    });

    const body = (await runRes.json()) as { success: boolean; sessionId?: string };

    if (body.success && body.sessionId) {
      const mentionedUserIds = (payload as { mentionedUserIds?: string[] }).mentionedUserIds ?? [];

      await setSession(body.sessionId, {
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
      });

      console.log(`[webhook] Forwarded to xyne-claw, sessionId=${body.sessionId}`);
    }
  } catch (err) {
    console.error("[webhook] Error forwarding:", err);
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
    attachments?: Array<{ fileName: string; mimeType: string; data: string }>;
  };

  const sessionId = payload.sessionId ?? "";
  console.log(`[webhook/result] Session ${sessionId}: status=${payload.status}`);

  // Acknowledge immediately
  res.json({ success: true });

  if (payload.status !== "completed" || !payload.result?.trim()) return;

  const ctx = await getSession(sessionId);
  if (!ctx) {
    console.warn(`[webhook/result] No session context for ${sessionId}`);
    return;
  }

  // Don't delete session yet — agent conversations may continue
  // sessionStore.delete(sessionId);

  try {
    const token = ctx.appToken;

    if (ctx.responseMode === "approval") {
      // ── Digital Twin mode: DM the mentioned user with approve/decline ──
      const dmResult = (await spacesAppFetch("/channel/openDm", {
        targetUserId: ctx.mentionedUserId,
      }, token)) as { channelId: string };

      const messageContent = buildAppActionFrontmatter(
        payload.result,
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
        form.append("text", messageContent);
        form.append("metadata", JSON.stringify(metadata));

        await spacesAppFetchMultipart("/files/filesUpload", form, token);
      } else {
        await spacesAppFetch("/chat/postMessage", {
          channelId: dmResult.channelId,
          text: messageContent,
          userId: ctx.spacesAppUserId,
          contentFormat: "markdown",
          metadata,
        }, token);
      }

      console.log(`[webhook/result] Digital Twin: sent approve/decline DM to ${ctx.mentionedUserId} (asked by ${ctx.senderId})`);
      await deleteSession(sessionId);
    } else {
      // ── Agent conversation mode: reply in the same thread ──
      const convMetadata = { contentFormat: "markdown" };

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
        form.append("text", payload.result);
        form.append("metadata", JSON.stringify(convMetadata));
        await spacesAppFetchMultipart("/files/filesUpload", form, token);
        console.log(`[webhook/result] Agent ${ctx.agentSlug}: replied with ${payload.attachments.length} attachment(s)`);
      } else {
        await spacesAppFetch("/chat/postMessage", {
          channelId: ctx.channelId,
          conversationId: ctx.conversationId,
          text: payload.result,
          userId: ctx.spacesAppUserId,
          contentFormat: "markdown",
        }, token);
        console.log(`[webhook/result] Agent ${ctx.agentSlug}: replied in thread ${ctx.conversationId}`);
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
          text: questionMsg,
          userId: ctx.spacesAppUserId,
          metadata: { hasAppActions: true, appId: ctx.spacesAppId, contentFormat: "markdown" },
        }, token);
      }
      console.log(`[webhook/result] Posted ${pendingQuestions.length} question(s) in thread ${ctx.conversationId}`);
    }

    // ── Send approval DMs for pending write actions (HITL) ──
    const pendingActionsPayload = (payload as { pendingActions?: Array<Record<string, unknown>> }).pendingActions;
    if (pendingActionsPayload?.length) {
      for (const action of pendingActionsPayload) {
        const actionDesc = `**${action["tool"] as string}**\n\`\`\`json\n${JSON.stringify(action["params"], null, 2).slice(0, 500)}\n\`\`\``;
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
          `    context: {}`,
          "---",
          "",
          `The agent wants to execute:\n\n${actionDesc}`,
        ].join("\n");

        // Post in the same thread where the conversation happened
        await spacesAppFetch("/chat/postMessage", {
          channelId: ctx.channelId,
          conversationId: ctx.conversationId,
          text: actionMsg,
          userId: ctx.spacesAppUserId,
          metadata: { hasAppActions: true, appId: ctx.spacesAppId, contentFormat: "markdown" },
        }, token);
      }

      console.log(`[webhook/result] Sent ${pendingActionsPayload.length} write action approval(s) to ${ctx.senderId}`);
    }
  } catch (err) {
    console.error("[webhook/result] Failed to send result:", err);
  }
});

// Register webhook routes — generic and agent-specific (AFTER /result to avoid param catch)
router.post("/", handleWebhook);
router.post("/:agentSlug", handleWebhook);

export { router as webhookRouter };
