/**
 * Actionable URL handler for approve/decline callbacks.
 *
 * The frontend calls this URL directly when a user clicks an app action button.
 * On approve (context has messageContent): posts the message to the original channel.
 * On decline: no-op.
 * In both cases: calls Spaces to mark the action as done in the message frontmatter.
 *
 * On write-action failure: posts a failure message with Retry/Dismiss buttons.
 * Retry (actionType "write-retry") starts a new /run with failure context so the
 * LLM can diagnose the error and retry with corrected parameters.
 */

import { Router, type Request, type Response } from "express";
import { errMsg } from "../lib/errors.js";
import crypto from "node:crypto";
import { CONFIG } from "../config.js";
import { prisma } from "../db.js";
import { decrypt } from "../crypto.js";
import { expandSpacesMentions } from "../lib/mention-transform.js";
import { agentRunRepository } from "../repositories/index.js";

import { createLogger } from "../logger.js";
const log = createLogger("app-callback");

const router = Router();

/**
 * Flag a conversation's most-recent run as having touched a user-scoped
 * credential, so the admin "All Runs" ACL hides it from other admins. Used by
 * every approved-write branch that executes a user's PERSONAL credential
 * (generic MCP with source==="user", and the Google/Microsoft branches that
 * read the user's own OAuth connection directly). Fire-and-forget — bookkeeping
 * must never block or fail the write. The queue-time mark at /mcp/call keys off
 * the ASKER's identity, which can differ from the executing `writeUserId`
 * (Digital-Twin / on-behalf-of writes), so it can miss; this is the backstop.
 */
function flagUserTokenRun(conversationId: string | undefined, agentSlug: string | undefined): void {
  if (!conversationId) return;
  agentRunRepository
    .markUsedUserTokenByConversation(conversationId, agentSlug)
    .catch((e) =>
      log.warn(
        `[app-callback] markUsedUserToken failed for conv ${conversationId}:`,
        errMsg(e),
      ),
    );
}

function humanizeToolName(tool: string): string {
  return tool
    .replace(/^(spaces-|google-|microsoft-)/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function spacesAppFetch(path: string, body: Record<string, unknown>, appToken: string): Promise<unknown> {
  const url = `${CONFIG.spacesInternalUrl}/api/apps${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${appToken}`,
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

async function findAgent(agentSlug: string | undefined, spacesAppId?: string) {
  if (spacesAppId) return prisma.agent.findFirst({ where: { spacesAppId } });
  if (!agentSlug) {
    log.error(`[app-callback] org/app context is required; refusing global default-agent lookup spacesAppId=${spacesAppId ?? "none"} agentSlug=default`);
    return null;
  }
  const matches = await prisma.agent.findMany({
    where: { slug: agentSlug },
    take: 2,
  });
  if (matches.length > 1) {
    log.error(`[app-callback] ambiguous legacy agent slug=${agentSlug}; refusing global lookup`);
    return null;
  }
  if (matches[0]) {
    log.warn(`[app-callback] deprecated legacy slug-only agent lookup slug=${agentSlug}; pass spacesAppId`);
  }
  return matches[0] ?? null;
}

async function getAgentToken(agentSlug: string | undefined, spacesAppId?: string): Promise<string | null> {
  const agent = await findAgent(agentSlug, spacesAppId);

  if (!agent?.spacesAppToken) return null;

  const [ciphertext, iv, authTag] = agent.spacesAppToken.split(":");
  if (!ciphertext || !iv || !authTag) return null;
  return decrypt(ciphertext, iv, authTag, CONFIG.encryptionKey);
}

async function escalateWriteActionFailure(opts: {
  tool: string;
  serverType: string;
  errorReason: string;
  writeUserId: string;
  signature: string;
  agentSlug: string | undefined;
  spacesAppId?: string | undefined;
  channelId: string | undefined;
  conversationId: string | undefined;
  originalTask: string | undefined;
  paramsStr: string;
}): Promise<void> {
  const {
    tool,
    serverType,
    errorReason,
    writeUserId,
    signature,
    agentSlug,
    spacesAppId,
    channelId,
    conversationId,
    originalTask,
    paramsStr,
  } = opts;

  if (!conversationId && !channelId) {
    log.warn("[app-callback] Cannot post failure message — no conversationId or channelId in context");
    return;
  }

  const appToken = await getAgentToken(agentSlug, spacesAppId);
  if (!appToken) {
    log.error(`[app-callback] Cannot post failure message — no agent token for ${agentSlug ?? "(default)"}`);
    return;
  }

  const agent = await findAgent(agentSlug, spacesAppId);

  const retryId = crypto.randomUUID();
  const dismissId = crypto.randomUUID();
  const callbackBase = `${CONFIG.selfUrl}/claw/api/v1/app/callback`;

  const failureMsg = [
    "---",
    "appActions:",
    `  - actionId: "${retryId}"`,
    `    label: "Retry"`,
    `    type: "button"`,
    `    color: "#22c55e"`,
    `    actionableUrl: "${callbackBase}"`,
    `    context:`,
    `      actionType: "write-retry"`,
    `      serverType: "${serverType}"`,
    `      tool: "${tool}"`,
    `      params: ${JSON.stringify(paramsStr)}`,
    `      userId: "${writeUserId}"`,
    `      signature: "${signature}"`,
    `      agentSlug: "${agentSlug ?? ""}"`,
    ...(agent?.spacesAppId ? [`      spacesAppId: "${agent.spacesAppId}"`] : []),
    ...(channelId ? [`      channelId: "${channelId}"`] : []),
    ...(conversationId ? [`      conversationId: "${conversationId}"`] : []),
    ...(originalTask ? [`      originalTask: ${JSON.stringify(originalTask)}`] : []),
    `      errorReason: ${JSON.stringify(errorReason)}`,
    `  - actionId: "${dismissId}"`,
    `    label: "Dismiss"`,
    `    type: "button"`,
    `    color: "#ef4444"`,
    `    actionableUrl: "${callbackBase}"`,
    `    context:`,
    `      userId: "${writeUserId}"`,
    "---",
    "",
    `❌ **Action failed**: ${errorReason}`,
    "",
    `The agent wanted to execute **${humanizeToolName(tool)}**. Click **Retry** to let the agent try again.`,
  ].join("\n");

  try {
    const body: Record<string, unknown> = {
      markdownText: failureMsg,
      userId: agent?.spacesAppUserId ?? "",
      metadata: { hasAppActions: true, appId: agent?.spacesAppId ?? "", contentFormat: "markdown" },
    };
    if (conversationId) {
      body.conversationId = conversationId;
    } else if (channelId) {
      body.channelId = channelId;
    }

    await spacesAppFetch("/chat/postMessage", body, appToken);
    log.info(`[app-callback] Posted failure message with Retry/Dismiss for ${tool} in ${conversationId ?? channelId}`);
  } catch (err) {
    log.error(`[app-callback] Failed to post failure message:`, errMsg(err));
  }
}

async function startWriteRetryRun(opts: {
  tool: string;
  serverType: string;
  errorReason: string;
  writeUserId: string;
  agentSlug: string | undefined;
  spacesAppId?: string | undefined;
  channelId: string | undefined;
  conversationId: string | undefined;
  originalTask: string | undefined;
  paramsStr: string;
}): Promise<void> {
  const {
    tool,
    serverType,
    errorReason,
    writeUserId,
    agentSlug,
    spacesAppId,
    channelId,
    conversationId,
    originalTask,
    paramsStr,
  } = opts;

  const agent = await findAgent(agentSlug, spacesAppId);

  if (!agent?.spacesAppToken || !agent.spacesAppId) {
    log.error(`[app-callback] write-retry: no agent found for ${agentSlug ?? "(default)"}`);
    return;
  }
  const retryOrgId = agent.orgId
    ?? (await prisma.user.findUnique({ where: { id: writeUserId }, select: { orgId: true } }))?.orgId;
  if (!retryOrgId) {
    log.error(`[app-callback] write-retry: no orgId for user=${writeUserId} agent=${agentSlug ?? "(default)"}`);
    return;
  }

  const appToken = decrypt(...agent.spacesAppToken.split(":") as [string, string, string], CONFIG.encryptionKey);

  const paramsPreview = paramsStr.length > 500 ? paramsStr.slice(0, 500) + "…" : paramsStr;
  const retryTask = originalTask
    ? `The write action ${tool} failed with error: ${errorReason}. Original task: ${originalTask}. Diagnose the failure and retry with corrected parameters, or explain why it cannot be retried.`
    : `The write action ${tool} failed with error: ${errorReason}. Diagnose the failure and retry with corrected parameters, or explain why it cannot be retried.`;

  const retryContext = `Failed tool call: ${tool}(${paramsPreview}). Error: ${errorReason}.${originalTask ? ` Original task: ${originalTask}` : ""}`;

  try {
    const runUrl = `${CONFIG.internalUrl}/claw/api/v1/internal/run`;
    const runRes = await fetch(runUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify({
        userId: writeUserId,
        task: retryTask,
        context: retryContext,
        agentSlug: agentSlug ?? undefined,
        orgId: retryOrgId,
        conversationId: conversationId ?? undefined,
        channelId: channelId ?? undefined,
        callbackUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/result`,
        progressUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`,
      }),
    });

    if (!runRes.ok) {
      log.error(`[app-callback] write-retry: /run returned ${runRes.status}`);
      return;
    }

    const runBody = (await runRes.json()) as { success: boolean; sessionId?: string };
    if (runBody.success && runBody.sessionId) {
      const { setSession } = await import("./webhook.js");
      const sessionContext = {
        mentionedUserId: agent.spacesAppUserId ?? "",
        senderId: writeUserId,
        senderName: "",
        channelId: channelId ?? "",
        channelName: channelId ?? "",
        conversationId: conversationId ?? "",
        task: `Retry after failure: ${originalTask ?? tool}`,
        agentId: agent.id,
        agentOrgId: agent.orgId ?? null,
        agentSlug: agentSlug ?? "",
        responseMode: "conversation" as const,
        appToken,
        spacesAppId: agent.spacesAppId,
        spacesAppUserId: agent.spacesAppUserId ?? "",
      };
      await setSession(runBody.sessionId, sessionContext);

      const { registerRunRecovery } = await import("../queue/run-recovery-worker.js");
      await registerRunRecovery({
        rootSessionId: runBody.sessionId,
        maxRetries: CONFIG.runRecoveryMaxRetries,
        timeoutMs: CONFIG.runRecoveryTimeoutMs,
        retryBackoffMs: CONFIG.runRecoveryBackoffMs,
        dispatchPayload: {
          userId: writeUserId,
          task: retryTask,
          agentSlug: agentSlug ?? "",
          orgId: retryOrgId,
          conversationId: conversationId ?? "",
          channelId: channelId ?? "",
          eventType: "APP_MENTIONED",
          traceId: runBody.sessionId,
          callbackUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/result`,
          progressUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`,
          context: retryContext,
        },
        sessionContext,
      });

      log.info(`[app-callback] write-retry: started new /run session=${runBody.sessionId} for ${tool}`);
    } else {
      log.error(`[app-callback] write-retry: /run failed — ${JSON.stringify(runBody)}`);
    }
  } catch (err) {
    log.error("[app-callback] write-retry: failed to start /run:", errMsg(err));
  }
}

router.post("/callback", async (req: Request, res: Response) => {
  const payload = req.body as {
    actionId?: string;
    context?: Record<string, unknown>;
    messageId?: string;
    conversationId?: string;
    callerUserId?: string;
  };

  const { actionId, context = {}, messageId } = payload;

  // Identity comes from the authenticated session (requireAuth set x-user-id
  // from the Spaces cookie), NOT the request body — the body field was
  // spoofable and the per-branch checks below fail closed on a missing id.
  const callerUserId = (req.headers["x-user-id"] as string | undefined) ?? undefined;

  log.info(`[app-callback] actionId=${actionId} messageId=${messageId} callerUserId=${callerUserId ?? "(none)"}`);

  // Acknowledge immediately
  res.json({ success: true });

  const actionType = context["actionType"] as string | undefined;

  // ── User answered a question (ask-user-question tool) ──
  if (actionType === "user-answer") {
    const questionId = context["questionId"] as string;
    const answer = context["answer"] as string;
    const answerAgentSlug = context["agentSlug"] as string;
    const answerSpacesAppId = context["spacesAppId"] as string | undefined;
    const answerChannelId = context["channelId"] as string;
    const answerConversationId = context["conversationId"] as string;
    const answerUserId = context["userId"] as string;

    if (!questionId || !answer || !answerUserId) {
      log.error("[app-callback] Missing user-answer fields");
      return;
    }

    // Verify caller is the intended user (XYNE-12145). Fail closed.
    if (!callerUserId || callerUserId !== answerUserId) {
      log.error(`[app-callback] Unauthorized: caller ${callerUserId ?? "(none)"} != expected ${answerUserId}`);
      return;
    }

    const { getQuestion, deleteQuestion } = await import("./pending-questions.js");
    const { setSession } = await import("./webhook.js");
    const question = await getQuestion(questionId);
    const firstPrompt = question?.questions?.[0];
    const questionText = firstPrompt?.question ?? "a question";
    const optionsList = firstPrompt?.options?.join(", ") ?? "";

    try {
      const agent = await findAgent(answerAgentSlug, answerSpacesAppId);
      const appToken = agent?.spacesAppToken
        ? decrypt(...agent.spacesAppToken.split(":") as [string, string, string], CONFIG.encryptionKey)
        : "";
      const answerOrgId = agent?.orgId
        ?? (await prisma.user.findUnique({ where: { id: answerUserId }, select: { orgId: true } }))?.orgId;
      if (!answerOrgId) {
        log.error(`[app-callback] answer: no orgId for user=${answerUserId} agent=${answerAgentSlug ?? "(default)"}`);
        return;
      }

      const runUrl = `${CONFIG.internalUrl}/claw/api/v1/internal/run`;
      const runRes = await fetch(runUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
        },
        body: JSON.stringify({
          userId: answerUserId,
          task: `The user answered "${answer}" to your question: "${questionText}". Continue the task based on this answer.`,
          context: `Previous question: ${questionText}\nOptions: ${optionsList}\nUser's answer: ${answer}`,
          conversationId: answerConversationId,
          channelId: answerChannelId,
          agentSlug: answerAgentSlug,
          orgId: answerOrgId,
          callbackUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/result`,
        }),
      });

      const runBody = (await runRes.json()) as { success: boolean; sessionId?: string };
      if (runBody.success && runBody.sessionId && agent) {
        await setSession(runBody.sessionId, {
          mentionedUserId: agent.spacesAppUserId ?? "",
          senderId: answerUserId,
          senderName: "",
          channelId: answerChannelId,
          channelName: answerChannelId,
          conversationId: answerConversationId,
          task: `User answered: ${answer}`,
          agentId: agent.id,
          agentOrgId: agent.orgId ?? null,
          agentSlug: answerAgentSlug,
          responseMode: "conversation",
          appToken,
          spacesAppId: agent.spacesAppId ?? "",
          spacesAppUserId: agent.spacesAppUserId ?? "",
        });
      }

      log.info(`[app-callback] User answered "${answer}" → new /run (session=${runBody.sessionId})`);
    } catch (err) {
      log.error("[app-callback] Failed to start new run with answer:", err);
    }

    await deleteQuestion(questionId).catch(() => {});
    return;
  }

  // (start-goal moved to flow-action.ts — FlowUI v2.0 migration.)

  // ── Write action retry (LLM escalation) ──
  if (actionType === "write-retry") {
    const serverType = context["serverType"] as string;
    const tool = context["tool"] as string;
    const paramsStr = context["params"] as string;
    const writeUserId = context["userId"] as string;
    const signature = context["signature"] as string;
    const agentSlug = context["agentSlug"] as string | undefined;
    const spacesAppId = context["spacesAppId"] as string | undefined;
    const channelId = context["channelId"] as string | undefined;
    const conversationId = context["conversationId"] as string | undefined;
    const originalTask = context["originalTask"] as string | undefined;
    const errorReason = context["errorReason"] as string | undefined;

    if (!writeUserId) {
      log.error("[app-callback] write-retry: missing userId");
      return;
    }

    if (!callerUserId || callerUserId !== writeUserId) {
      log.error(`[app-callback] write-retry: Unauthorized: caller ${callerUserId ?? "(none)"} != expected ${writeUserId}`);
      return;
    }

    const appToken = await getAgentToken(agentSlug, spacesAppId);
    if (appToken && (conversationId || channelId)) {
      try {
        const body: Record<string, unknown> = {
          markdownText: `🔄 Retrying **${humanizeToolName(tool ?? "unknown")}** — the agent is diagnosing the failure and will attempt again.`,
          userId: (await findAgent(agentSlug, spacesAppId))?.spacesAppUserId ?? "",
          metadata: { contentFormat: "markdown" },
        };
        if (conversationId) body.conversationId = conversationId;
        else if (channelId) body.channelId = channelId;
        await spacesAppFetch("/chat/postMessage", body, appToken);
      } catch { /* non-fatal */ }
    }

    await startWriteRetryRun({
      tool: tool ?? "unknown",
      serverType: serverType ?? "unknown",
      errorReason: errorReason ?? "Unknown error",
      writeUserId,
      agentSlug,
      spacesAppId,
      channelId,
      conversationId,
      originalTask,
      paramsStr: paramsStr ?? "{}",
    });
    return;
  }

  // ── Write action approval (HITL) ──
  if (actionType === "write") {
    const serverType = context["serverType"] as string;
    const tool = context["tool"] as string;
    const paramsStr = context["params"] as string;
    const writeUserId = context["userId"] as string;
    const signature = context["signature"] as string;
    const agentSlug = context["agentSlug"] as string | undefined;
    const spacesAppId = context["spacesAppId"] as string | undefined;
    const actionChannelId = context["channelId"] as string | undefined;
    const actionConversationId = context["conversationId"] as string | undefined;
    const actionOriginalTask = context["originalTask"] as string | undefined;

    if (!serverType || !tool || !paramsStr || !writeUserId || !signature) {
      log.error("[app-callback] Missing write action fields");
      return;
    }

    const params = JSON.parse(paramsStr) as Record<string, unknown>;

    // Verify HMAC signature
    const { verifyActionSignature } = await import("./mcp.js");
    const action = { serverType, tool, params, userId: writeUserId };
    if (!verifyActionSignature(action, signature)) {
      log.error("[app-callback] HMAC verification failed — action may have been tampered with");
      return;
    }

    // Verify caller is the intended user (XYNE-12145). Fail closed.
    if (!callerUserId || callerUserId !== writeUserId) {
      log.error(`[app-callback] Unauthorized: caller ${callerUserId ?? "(none)"} != expected ${writeUserId}`);
      return;
    }

    try {
      // xyne-spaces write tools — execute using the bot's app token, not the user's JWT
      if (serverType === "xyne-spaces" && tool === "spaces-send-message") {
        // Look up the agent that triggered this action by slug, falling back to default
        const agent = await findAgent(agentSlug, spacesAppId);
        if (!agent?.spacesAppToken) {
          log.error(`[app-callback] spaces-send-message: no spacesAppToken for agent ${agentSlug ?? "(default)"}`);
          return;
        }
        const tokenParts = agent.spacesAppToken.split(":");
        if (tokenParts.length < 3 || !tokenParts[0] || !tokenParts[1] || !tokenParts[2]) {
          log.error("[app-callback] spaces-send-message: invalid spacesAppToken format");
          return;
        }
        const appToken = decrypt(tokenParts[0], tokenParts[1], tokenParts[2], CONFIG.encryptionKey);

        const content = params["content"] as string;
        const conversationId = params["conversationId"] as string | undefined;
        const channelId = params["channelId"] as string | undefined;
        const targetChannelId = params["targetChannelId"] as string | undefined;
        const sourceConversationId = (params["sourceConversationId"] as string | undefined) ?? conversationId;

        if (!targetChannelId) {
          // Simple send: conversationId → reply in thread, channelId → post in channel
          const body = conversationId
            ? { conversationId, text: content }
            : { channelId: channelId, text: content };
          await spacesAppFetch("/chat/postMessage", body, appToken);
          log.info(`[app-callback] spaces-send-message: sent to ${conversationId ?? channelId}`);
          return;
        }

        // Cross-channel posting:
        // Use spacesAppFetch for join — it handles visibility check (403 = private),
        // returns channelName, and is idempotent (safe to call if already a member).
        let channelName = targetChannelId;
        try {
          const joinRes = (await spacesAppFetch(`/channel/${targetChannelId}/join`, {}, appToken)) as { channelName?: string; channelId?: string };
          channelName = joinRes.channelName ?? targetChannelId;
          log.info(`[app-callback] spaces-send-message: ensured membership in #${channelName}`);
        } catch (e) {
          const errText = errMsg(e);
          // 403 with "private" in the message means private channel — report and bail
          // (other 403s like "bot/app users" from the join endpoint are logged and we still attempt the post)
          if (errText.includes("private")) {
            const failMsg = `❌ I need to be added to #${targetChannelId} (private channel) to post there. Please add me and try again.`;
            if (sourceConversationId) {
              await spacesAppFetch("/chat/postMessage", { conversationId: sourceConversationId, text: failMsg }, appToken).catch(() => {});
            }
            log.info(`[app-callback] spaces-send-message: private channel, cannot join`);
            return;
          }
          // Other errors (network, 404) — still attempt the post, channel name unknown
          log.error(`[app-callback] spaces-send-message: join failed (will still attempt post):`, e);
        }

        // Post in target channel
        await spacesAppFetch("/chat/postMessage", { channelId: targetChannelId, text: content }, appToken);

        // Confirm in source thread
        const confirmMsg = `✅ Posted in #${channelName}`;
        if (sourceConversationId) {
          await spacesAppFetch("/chat/postMessage", { conversationId: sourceConversationId, text: confirmMsg }, appToken).catch((e) => {
            log.error("[app-callback] spaces-send-message: failed to send confirmation:", e);
          });
        }

        log.info(`[app-callback] spaces-send-message: cross-posted to #${channelName}`);
        return;
      }

      // Google (custom) tools — execute directly via xyne-claw-shared
      if (serverType === "google") {
        const { getAllCustomTools } = await import("xyne-claw-shared");
        const toolDef = getAllCustomTools().find((t) => t.slug === tool);
        if (!toolDef) {
          log.error(`[app-callback] Unknown Google tool: ${tool}`);
          return;
        }

        // Fetch a valid Google access token (auto-refreshes if expired)
        const connection = await prisma.userMcpConnection.findFirst({
          where: { userId: writeUserId, mcpServer: { type: "google" } },
        });
        if (!connection) {
          log.error(`[app-callback] No Google connection for user ${writeUserId}`);
          return;
        }
        const decryptedCreds = decrypt(connection.encryptedCreds, connection.iv, connection.authTag, CONFIG.encryptionKey);
        const creds = JSON.parse(decryptedCreds) as { accessToken: string; refreshToken: string; expires: number };

        let accessToken = creds.accessToken;

        // Refresh if expired (60s buffer)
        if (Date.now() > creds.expires - 60_000) {
          const clientId = process.env["GOOGLE_CLIENT_ID"]!;
          const clientSecret = process.env["GOOGLE_CLIENT_SECRET"]!;
          const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: clientId,
              client_secret: clientSecret,
              refresh_token: creds.refreshToken,
              grant_type: "refresh_token",
            }),
          });
          if (refreshRes.ok) {
            const tokens = (await refreshRes.json()) as { access_token: string; expires_in: number };
            accessToken = tokens.access_token;
            // Update stored token
            const { encrypt } = await import("../crypto.js");
            const newCreds = { accessToken, refreshToken: creds.refreshToken, expires: Date.now() + tokens.expires_in * 1000 };
            const encrypted = encrypt(JSON.stringify(newCreds), CONFIG.encryptionKey);
            await prisma.userMcpConnection.update({
              where: { id: connection.id },
              data: { encryptedCreds: encrypted.ciphertext, iv: encrypted.iv, authTag: encrypted.authTag },
            });
          } else {
            log.error(`[app-callback] Google token refresh failed: ${refreshRes.status}`);
            return;
          }
        }

        // Executes the user's personal Google OAuth token → ACL-flag the run.
        flagUserTokenRun(actionConversationId, agentSlug);
        const result = await toolDef.execute(params, { config: { GOOGLE_ACCESS_TOKEN: accessToken } });
        log.info(`[app-callback] Google write action approved: ${tool} → ${result.slice(0, 100)}`);
        return;
      }

      // Microsoft (custom) tools — execute directly via xyne-claw-shared
      if (serverType === "microsoft") {
        const { getAllCustomTools } = await import("xyne-claw-shared");
        const toolDef = getAllCustomTools().find((t) => t.slug === tool);
        if (!toolDef) {
          log.error(`[app-callback] Unknown Microsoft tool: ${tool}`);
          return;
        }

        // Fetch a valid Microsoft access token (auto-refreshes if expired)
        const connection = await prisma.userMcpConnection.findFirst({
          where: { userId: writeUserId, mcpServer: { type: "microsoft" } },
        });
        if (!connection) {
          log.error(`[app-callback] No Microsoft connection for user ${writeUserId}`);
          return;
        }
        const decryptedCreds = decrypt(connection.encryptedCreds, connection.iv, connection.authTag, CONFIG.encryptionKey);
        const creds = JSON.parse(decryptedCreds) as { accessToken: string; refreshToken: string; expires: number };

        let accessToken = creds.accessToken;

        // Refresh if expired (60s buffer) — Microsoft rotates refresh tokens
        if (Date.now() > creds.expires - 60_000) {
          const clientId = process.env["MICROSOFT_CLIENT_ID"]!;
          const clientSecret = process.env["MICROSOFT_CLIENT_SECRET"]!;
          const tenantId = process.env["MICROSOFT_TENANT_ID"] ?? "common";
          const refreshRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: clientId,
              client_secret: clientSecret,
              refresh_token: creds.refreshToken,
              grant_type: "refresh_token",
            }),
          });
          if (refreshRes.ok) {
            const tokens = (await refreshRes.json()) as { access_token: string; refresh_token: string; expires_in: number };
            accessToken = tokens.access_token;
            // Update stored token (Microsoft rotates refresh tokens)
            const { encrypt } = await import("../crypto.js");
            const newCreds = { accessToken, refreshToken: tokens.refresh_token, expires: Date.now() + tokens.expires_in * 1000 };
            const encrypted = encrypt(JSON.stringify(newCreds), CONFIG.encryptionKey);
            await prisma.userMcpConnection.update({
              where: { id: connection.id },
              data: { encryptedCreds: encrypted.ciphertext, iv: encrypted.iv, authTag: encrypted.authTag },
            });
          } else {
            log.error(`[app-callback] Microsoft token refresh failed: ${refreshRes.status}`);
            return;
          }
        }

        // Executes the user's personal Microsoft OAuth token → ACL-flag the run.
        flagUserTokenRun(actionConversationId, agentSlug);
        const result = await toolDef.execute(params, { config: { MICROSOFT_ACCESS_TOKEN: accessToken } });
        log.info(`[app-callback] Microsoft write action approved: ${tool} → ${result.slice(0, 100)}`);
        return;
      }

      // MCP-based tools — execute via MCP runner
      const { callTool } = await import("../mcp/runner.js");
      const { hasConnectorDefinition } = await import("../mcp/connector-definitions.js");
      const { loadEffectiveCredentials, isPrivateUserCredential } = await import("../lib/credentials-loader.js");
      if (!(await hasConnectorDefinition(serverType))) {
        log.error(`[app-callback] No adapter for ${serverType}`);
        return;
      }

      const effective = await loadEffectiveCredentials(writeUserId, serverType, agentSlug);
      if (!effective) {
        log.error(`[app-callback] No connection for user ${writeUserId} / ${serverType}`);
        return;
      }

      // Private user credential on an approved write → flag the run for the ACL
      // (excludes the ambient Spaces session — see isPrivateUserCredential).
      if (isPrivateUserCredential(serverType, effective.source)) flagUserTokenRun(actionConversationId, agentSlug);

      const result = await callTool(writeUserId, serverType, effective.credentials, tool, params, agentSlug);
      log.info(`[app-callback] Write action approved: ${tool} → ${result.content.slice(0, 100)}`);
    } catch (err) {
      const errText = errMsg(err);
      log.error(`[app-callback] Failed to execute write action ${tool}:`, errText);

      await escalateWriteActionFailure({
        tool,
        serverType,
        errorReason: errText.slice(0, 500),
        writeUserId,
        signature,
        agentSlug,
        spacesAppId,
        channelId: actionChannelId,
        conversationId: actionConversationId,
        originalTask: actionOriginalTask,
        paramsStr,
      });
    }
    return;
  }

  const targetConversationId = context["targetConversationId"] as string | undefined;
  const messageContent = context["messageContent"] as string | undefined;
  const mentionedUserId = context["mentionedUserId"] as string | undefined;

  // ── Digital Twin approval: post as the mentioned user via S2S internal endpoint ──
  const targetChannelId = context["targetChannelId"] as string | undefined;
  // workspaceId is captured at webhook-receive time and threaded through the
  // Approve-button context. Spaces' /api/internal/postAsUser REQUIRES it to
  // mint a JWT for the user — without this header, the post silently fails.
  const workspaceId = context["workspaceId"] as string | undefined;

  if (targetConversationId && messageContent && targetChannelId && mentionedUserId && workspaceId) {
    // Verify caller is the intended user (XYNE-12145). Fail closed.
    if (!callerUserId || callerUserId !== mentionedUserId) {
      log.error(`[app-callback] Unauthorized: caller ${callerUserId ?? "(none)"} != expected ${mentionedUserId}`);
      return;
    }

    try {
      const s2sKey = process.env["INTERNAL_S2S_KEY"] ?? "";
      const url = `${CONFIG.spacesInternalUrl}/api/internal/postAsUser`;
      const postRes = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-s2s-key": s2sKey,
        },
        body: JSON.stringify({
          channelId: targetChannelId,
          conversationId: targetConversationId,
          markdownText: expandSpacesMentions(messageContent),
          userId: mentionedUserId,
          workspaceId,
          metadata: { contentFormat: "markdown" },
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!postRes.ok) {
        const text = await postRes.text().catch(() => "");
        log.error(`[app-callback] Failed to post: ${postRes.status} ${text.slice(0, 200)}`);
        return;
      }

      log.info(`[app-callback] Posted approved message to conversation ${targetConversationId}`);
    } catch (err) {
      log.error("[app-callback] Failed to post:", err);
    }
  }
});

export { router as appCallbackRouter };
