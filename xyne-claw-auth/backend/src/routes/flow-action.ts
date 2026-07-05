/**
 * Flow action webhook handler.
 *
 * Spaces' FlowController calls this endpoint (POST /claw/api/v1/flow/action)
 * when a user interacts with a Flow UI widget embedded in a chat message.
 *
 * Replaces the legacy YAML frontmatter + app-callback.ts pattern entirely.
 *
 * Three patterns handled:
 *   1. approve-write / decline-write  — HITL write tool approval
 *   2. twin-approve / twin-decline    — Digital Twin draft approve/decline
 *   3. user-answer                    — Agent question answered via radio/select
 */

import { Router, type NextFunction, type Request, type Response } from "express";
import { CONFIG } from "../config.js";
import { prisma } from "../db.js";
import { decrypt } from "../crypto.js";
import { expandSpacesMentions } from "../lib/mention-transform.js";
import { verifySpacesSignature } from "../middleware/verify-spaces-signature.js";
import { agentRunRepository } from "../repositories/index.js";
import type { FlowDefinition } from "xyne-claw-shared";

import { createLogger } from "../logger.js";
const log = createLogger("flow-action");

const router = Router();

/**
 * Flag a conversation's most-recent run as having touched a user-scoped
 * credential (see app-callback.ts for the full rationale). Called from every
 * FlowUI approved-write branch that executes a user's personal credential.
 * Fire-and-forget — never block the write on bookkeeping.
 */
function flagUserTokenRun(conversationId: string | undefined, agentSlug: string | undefined): void {
  if (!conversationId) return;
  agentRunRepository
    .markUsedUserTokenByConversation(conversationId, agentSlug)
    .catch((e) =>
      log.warn(
        `[flow-action] markUsedUserToken failed for conv ${conversationId}:`,
        e instanceof Error ? e.message : String(e),
      ),
    );
}

// ── Spaces signature re-verification ─────────────────────────────────────────
// The handler below trusts body-supplied identity (context.userId = the user
// who clicked the Flow button). requireStrictS2S at the mount only proves the
// caller holds the shared S2S key — it does NOT bind that identity, so a key
// holder could act as any user. The webhook /:agentSlug proxy forwards the
// original raw bytes, Spaces' X-Xyne-Signature, and the agent slug; here we
// re-run the per-agent HMAC check so context.userId is bound to a payload
// Spaces actually signed. verifySpacesSignature keys off req.params.agentSlug,
// so pin it from the forwarded header first. Honors the same
// SPACES_WEBHOOK_VERIFY_MODE warn/enforce rollout switch.
function pinAgentSlugFromHeader(req: Request, _res: Response, next: NextFunction): void {
  const slug = req.headers["x-agent-slug"];
  if (typeof slug === "string" && slug.trim()) {
    (req.params as Record<string, string>)["agentSlug"] = slug.trim();
  }
  next();
}

// ── Post-action message update ────────────────────────────────────────────────
// After an action is executed, replace the interactive flow card with static
// text so the buttons are permanently removed and cannot be re-clicked.
async function replaceFlowCardWithText(
  messageId: string,
  agentSlug: string | undefined,
  text: string,
  conversationId?: string,
  channelId?: string,
): Promise<void> {
  if (!messageId) return;
  const agent = await getAgentTokenAndUserId(agentSlug);
  if (!agent) {
    log.warn(`[flow-action] replaceFlowCardWithText: no agent token/userId for slug=${agentSlug ?? "(default)"}`);
    return;
  }
  try {
    const spacesBase = `${CONFIG.spacesInternalUrl}/api/apps`;
    const res = await fetch(`${spacesBase}/chat/updateMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${agent.token}` },
      body: JSON.stringify({
        messageId,
        markdownText: text,
        userId: agent.userId,
        // validateChannelAccessForPost middleware requires one of channelId/conversationId.
        // Prefer channelId (direct) over conversationId (requires a DB lookup).
        ...(channelId ? { channelId } : conversationId ? { conversationId } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.warn(`[flow-action] updateMessage HTTP ${res.status} for message ${messageId}: ${body.slice(0, 200)}`);
    }
  } catch (err) {
    log.warn(`[flow-action] Failed to replace flow card for message ${messageId}:`, err instanceof Error ? err.message : String(err));
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ActionRequest {
  actionId: string;
  type: "submit" | "inputChange";
  values: Record<string, unknown>;
  context: {
    flowJSON: FlowDefinition;
    messageId: string;
    conversationId: string;
    userId: string | null;
  };
}

type AppActionResponse =
  | { type: "open_screen"; flowJSON: FlowDefinition; message?: string }
  | { type: "next_screen"; flowJSON: FlowDefinition; message?: string }
  | { type: "close_screen"; finalMessage?: string; message?: string }
  | { type: "update_screen_data"; data: Record<string, unknown>; componentUpdates?: Record<string, unknown> }
  | { type: "ack"; message?: string }
  | { type: "error"; message: string; code?: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getAgentTokenAndUserId(agentSlug: string | undefined): Promise<{ token: string; userId: string } | null> {
  const agent = agentSlug
    ? await prisma.agent.findUnique({ where: { slug: agentSlug } })
    : await prisma.agent.findFirst({ where: { isDefault: true } });
  if (!agent?.spacesAppToken || !agent.spacesAppUserId) return null;
  const [ciphertext, iv, authTag] = agent.spacesAppToken.split(":");
  if (!ciphertext || !iv || !authTag) return null;
  const token = decrypt(ciphertext, iv, authTag, CONFIG.encryptionKey);
  return { token, userId: agent.spacesAppUserId };
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.post("/action", pinAgentSlugFromHeader, verifySpacesSignature, async (req: Request, res: Response): Promise<void> => {
  const body = req.body as ActionRequest;
  const { actionId, values, context } = body;
  const { flowJSON, messageId, conversationId, userId: callerUserId } = context;
  const data = (flowJSON.data ?? {}) as Record<string, unknown>;
  const actionType = data["actionType"] as string | undefined;

  log.info(`[flow-action] actionId=${actionId} actionType=${actionType} conversationId=${conversationId}`);

  let resp: AppActionResponse;

  try {
    // ── 1. Write tool approval (HITL) ─────────────────────────────────────────
    if (actionType === "write") {
      const serverType = data["serverType"] as string;
      const tool = data["tool"] as string;
      const paramsStr = data["params"] as string;
      const writeUserId = data["userId"] as string;
      const signature = data["signature"] as string;
      const agentSlug = data["agentSlug"] as string | undefined;

      if (!serverType || !tool || !paramsStr || !writeUserId || !signature) {
        res.status(400).json({ type: "error", message: "Missing write action fields in flowJSON.data" } satisfies AppActionResponse);
        return;
      }

      // Verify caller is the intended user. Fail closed: a missing callerUserId
      // must not skip the check (it previously did, allowing impersonation).
      if (!callerUserId || callerUserId !== writeUserId) {
        log.error(`[flow-action] Unauthorized: caller ${callerUserId ?? "(none)"} != expected ${writeUserId}`);
        res.status(403).json({ type: "error", message: "Unauthorized" } satisfies AppActionResponse);
        return;
      }

      if (actionId === "decline-write") {
        resp = { type: "close_screen", finalMessage: "❌ Action declined." };
        res.json(resp);
        void replaceFlowCardWithText(messageId, agentSlug, "❌ **Action declined.**", conversationId);
        return;
      }

      // actionId === "approve-write"
      const params = JSON.parse(paramsStr) as Record<string, unknown>;

      // Verify HMAC signature
      const { verifyActionSignature } = await import("./mcp.js");
      const actionPayload = { serverType, tool, params, userId: writeUserId };
      if (!verifyActionSignature(actionPayload, signature)) {
        log.error("[flow-action] HMAC verification failed");
        res.json({ type: "error", message: "HMAC verification failed — action may have been tampered with" } satisfies AppActionResponse);
        return;
      }

      // Execute the tool
      if (serverType === "xyne-spaces" && tool === "spaces-send-message") {
        const agent = agentSlug
          ? await prisma.agent.findUnique({ where: { slug: agentSlug } })
          : await prisma.agent.findFirst({ where: { isDefault: true } });
        if (!agent?.spacesAppToken) {
          res.json({ type: "error", message: `No spacesAppToken for agent ${agentSlug ?? "(default)"}` } satisfies AppActionResponse);
          return;
        }
        const parts = agent.spacesAppToken.split(":");
        if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) {
          res.json({ type: "error", message: "Invalid spacesAppToken format" } satisfies AppActionResponse);
          return;
        }
        const appToken = decrypt(parts[0], parts[1], parts[2], CONFIG.encryptionKey);

        const content = params["content"] as string;
        const targetChannelId = params["targetChannelId"] as string | undefined;
        const msgConversationId = params["conversationId"] as string | undefined;
        const channelId = params["channelId"] as string | undefined;
        const sourceConversationId = (params["sourceConversationId"] as string | undefined) ?? msgConversationId;
        const spacesBase = `${CONFIG.spacesInternalUrl}/api/apps`;

        const spacesPost = async (path: string, b: Record<string, unknown>) => {
          const r = await fetch(`${spacesBase}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${appToken}` },
            body: JSON.stringify(b),
            signal: AbortSignal.timeout(30_000),
          });
          if (!r.ok) throw new Error(`Spaces ${r.status}: ${(await r.text().catch(() => "")).slice(0, 300)}`);
          return r.json();
        };

        if (!targetChannelId) {
          const b = msgConversationId ? { conversationId: msgConversationId, text: content } : { channelId, text: content };
          await spacesPost("/chat/postMessage", b);
          resp = { type: "close_screen", finalMessage: "✅ Message sent." };
        } else {
          let channelName = targetChannelId;
          try {
            const joinRes = (await spacesPost(`/channel/${targetChannelId}/join`, {})) as { channelName?: string };
            channelName = joinRes.channelName ?? targetChannelId;
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            if (errMsg.includes("private")) {
              resp = { type: "close_screen", finalMessage: `❌ Cannot post to #${targetChannelId} — private channel. Add me first.` };
              res.json(resp);
              void replaceFlowCardWithText(messageId, agentSlug, `❌ Cannot post to #${targetChannelId} — private channel.`, conversationId);
              return;
            }
          }
          await spacesPost("/chat/postMessage", { channelId: targetChannelId, text: content });
          if (sourceConversationId) {
            await spacesPost("/chat/postMessage", { conversationId: sourceConversationId, text: `✅ Posted in #${channelName}` }).catch(() => {});
          }
          resp = { type: "close_screen", finalMessage: `✅ Posted in #${channelName}` };
        }
        res.json(resp);
        void replaceFlowCardWithText(messageId, agentSlug, typeof resp === "object" && "finalMessage" in resp ? (resp.finalMessage ?? "✅ Done.") : "✅ Done.", conversationId);
        return;
      }

      if (serverType === "google") {
        const { getAllCustomTools } = await import("xyne-claw-shared");
        const toolDef = getAllCustomTools().find((t) => t.slug === tool);
        if (!toolDef) {
          res.json({ type: "error", message: `Unknown Google tool: ${tool}` } satisfies AppActionResponse);
          return;
        }
        const connection = await prisma.userMcpConnection.findFirst({ where: { userId: writeUserId, mcpServer: { type: "google" } } });
        if (!connection) {
          res.json({ type: "error", message: `No Google connection for user ${writeUserId}` } satisfies AppActionResponse);
          return;
        }
        const decCreds = decrypt(connection.encryptedCreds, connection.iv, connection.authTag, CONFIG.encryptionKey);
        const creds = JSON.parse(decCreds) as { accessToken: string; refreshToken: string; expires: number };
        let accessToken = creds.accessToken;

        if (Date.now() > creds.expires - 60_000) {
          const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: process.env["GOOGLE_CLIENT_ID"]!,
              client_secret: process.env["GOOGLE_CLIENT_SECRET"]!,
              refresh_token: creds.refreshToken,
              grant_type: "refresh_token",
            }),
          });
          if (refreshRes.ok) {
            const tokens = (await refreshRes.json()) as { access_token: string; expires_in: number };
            accessToken = tokens.access_token;
            const { encrypt } = await import("../crypto.js");
            const newCreds = { accessToken, refreshToken: creds.refreshToken, expires: Date.now() + tokens.expires_in * 1000 };
            const enc = encrypt(JSON.stringify(newCreds), CONFIG.encryptionKey);
            await prisma.userMcpConnection.update({ where: { id: connection.id }, data: { encryptedCreds: enc.ciphertext, iv: enc.iv, authTag: enc.authTag } });
          } else {
            res.json({ type: "error", message: "Google token refresh failed" } satisfies AppActionResponse);
            return;
          }
        }

        // Executes the user's personal Google OAuth token → ACL-flag the run.
        flagUserTokenRun(conversationId, agentSlug);
        const result = await toolDef.execute(params, { config: { GOOGLE_ACCESS_TOKEN: accessToken } });
        log.info(`[flow-action] Google write action approved: ${tool} → ${result.slice(0, 100)}`);
        resp = { type: "close_screen", finalMessage: `✅ ${tool} executed successfully.` };
        res.json(resp);
        void replaceFlowCardWithText(messageId, agentSlug, `✅ **${tool}** executed successfully.`, conversationId);
        return;
      }

      if (serverType === "microsoft") {
        const { getAllCustomTools } = await import("xyne-claw-shared");
        const toolDef = getAllCustomTools().find((t) => t.slug === tool);
        if (!toolDef) {
          res.json({ type: "error", message: `Unknown Microsoft tool: ${tool}` } satisfies AppActionResponse);
          return;
        }
        const connection = await prisma.userMcpConnection.findFirst({ where: { userId: writeUserId, mcpServer: { type: "microsoft" } } });
        if (!connection) {
          res.json({ type: "error", message: `No Microsoft connection for user ${writeUserId}` } satisfies AppActionResponse);
          return;
        }
        const decCreds = decrypt(connection.encryptedCreds, connection.iv, connection.authTag, CONFIG.encryptionKey);
        const creds = JSON.parse(decCreds) as { accessToken: string; refreshToken: string; expires: number };
        let accessToken = creds.accessToken;

        if (Date.now() > creds.expires - 60_000) {
          const tenantId = process.env["MICROSOFT_TENANT_ID"] ?? "common";
          const refreshRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: process.env["MICROSOFT_CLIENT_ID"]!,
              client_secret: process.env["MICROSOFT_CLIENT_SECRET"]!,
              refresh_token: creds.refreshToken,
              grant_type: "refresh_token",
            }),
          });
          if (refreshRes.ok) {
            const tokens = (await refreshRes.json()) as { access_token: string; refresh_token: string; expires_in: number };
            accessToken = tokens.access_token;
            const { encrypt } = await import("../crypto.js");
            const newCreds = { accessToken, refreshToken: tokens.refresh_token, expires: Date.now() + tokens.expires_in * 1000 };
            const enc = encrypt(JSON.stringify(newCreds), CONFIG.encryptionKey);
            await prisma.userMcpConnection.update({ where: { id: connection.id }, data: { encryptedCreds: enc.ciphertext, iv: enc.iv, authTag: enc.authTag } });
          } else {
            res.json({ type: "error", message: "Microsoft token refresh failed" } satisfies AppActionResponse);
            return;
          }
        }

        // Executes the user's personal Microsoft OAuth token → ACL-flag the run.
        flagUserTokenRun(conversationId, agentSlug);
        const result = await toolDef.execute(params, { config: { MICROSOFT_ACCESS_TOKEN: accessToken } });
        log.info(`[flow-action] Microsoft write action approved: ${tool} → ${result.slice(0, 100)}`);
        resp = { type: "close_screen", finalMessage: `✅ ${tool} executed successfully.` };
        res.json(resp);
        void replaceFlowCardWithText(messageId, agentSlug, `✅ **${tool}** executed successfully.`, conversationId);
        return;
      }

      // MCP-based tools
      const { callTool } = await import("../mcp/runner.js");
      const { hasConnectorDefinition } = await import("../mcp/connector-definitions.js");
      const { loadEffectiveCredentials, isPrivateUserCredential } = await import("../lib/credentials-loader.js");
      if (!(await hasConnectorDefinition(serverType))) {
        res.json({ type: "error", message: `No adapter for ${serverType}` } satisfies AppActionResponse);
        return;
      }
      const effective = await loadEffectiveCredentials(writeUserId, serverType, agentSlug);
      if (!effective) {
        res.json({ type: "error", message: `No connection for user ${writeUserId} / ${serverType}` } satisfies AppActionResponse);
        return;
      }
      // Private user credential on an approved write → flag the run for the ACL
      // (excludes the ambient Spaces session — see isPrivateUserCredential).
      if (isPrivateUserCredential(serverType, effective.source)) flagUserTokenRun(conversationId, agentSlug);

      const toolResult = await callTool(writeUserId, serverType, effective.credentials, tool, params);
      log.info(`[flow-action] Write action approved: ${tool} → ${toolResult.content.slice(0, 100)}`);
      resp = { type: "close_screen", finalMessage: `✅ ${tool} executed successfully.` };
      res.json(resp);
      void replaceFlowCardWithText(messageId, agentSlug, `✅ **${tool}** executed successfully.`, conversationId);
      return;
    }

    // ── 2. Digital Twin approval ───────────────────────────────────────────────
    if (actionType === "twin-approval") {
      const targetChannelId = data["targetChannelId"] as string;
      const targetConversationId = data["targetConversationId"] as string;
      const mentionedUserId = data["mentionedUserId"] as string;
      const workspaceId = data["workspaceId"] as string;
      const messageContent = data["messageContent"] as string;

      if (!targetChannelId || !targetConversationId || !mentionedUserId || !workspaceId || !messageContent) {
        res.status(400).json({ type: "error", message: "Missing twin-approval fields in flowJSON.data" } satisfies AppActionResponse);
        return;
      }

      // Verify caller is the intended user. Fail closed on missing callerUserId.
      if (!callerUserId || callerUserId !== mentionedUserId) {
        log.error(`[flow-action] Unauthorized: caller ${callerUserId ?? "(none)"} != expected ${mentionedUserId}`);
        res.status(403).json({ type: "error", message: "Unauthorized" } satisfies AppActionResponse);
        return;
      }

      if (actionId === "twin-decline") {
        resp = { type: "close_screen", finalMessage: "❌ Response declined." };
        res.json(resp);
        void replaceFlowCardWithText(messageId, data["agentSlug"] as string | undefined, "❌ **Response declined.**", conversationId, data["dmChannelId"] as string | undefined);
        return;
      }

      // actionId === "twin-approve": use edited content if provided, else original
      const editedContent = (values["editedContent"] as string | undefined)?.trim();
      const finalContent = editedContent && editedContent.length > 0 ? editedContent : messageContent;

      try {
        const s2sKey = process.env["INTERNAL_S2S_KEY"] ?? "";
        const postRes = await fetch(`${CONFIG.spacesInternalUrl}/api/internal/postAsUser`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-s2s-key": s2sKey },
          body: JSON.stringify({
            channelId: targetChannelId,
            conversationId: targetConversationId,
            markdownText: expandSpacesMentions(finalContent),
            userId: mentionedUserId,
            workspaceId,
            metadata: { contentFormat: "markdown" },
          }),
          signal: AbortSignal.timeout(30_000),
        });

        if (!postRes.ok) {
          const text = await postRes.text().catch(() => "");
          log.error(`[flow-action] Failed to post as user: ${postRes.status} ${text.slice(0, 200)}`);
          resp = { type: "error", message: `Failed to post: ${postRes.status}` };
          res.json(resp);
          return;
        }

        log.info(`[flow-action] Twin approved — posted to conversation ${targetConversationId}`);
        resp = { type: "close_screen", finalMessage: "✅ Response sent." };
        res.json(resp);
        void replaceFlowCardWithText(messageId, data["agentSlug"] as string | undefined, "✅ **Response sent.**", conversationId, data["dmChannelId"] as string | undefined);
      } catch (err) {
        log.error("[flow-action] Twin approval error:", err);
        resp = { type: "error", message: "Failed to post response" };
        res.json(resp);
      }
      return;
    }

    // ── 3. User question answer ───────────────────────────────────────────────
    if (actionType === "user-answer") {
      const questionId = data["questionId"] as string;
      const answerAgentSlug = data["agentSlug"] as string;
      const answerChannelId = data["channelId"] as string;
      const answerConversationId = data["conversationId"] as string;
      const answerUserId = data["userId"] as string;
      const answer = values["answer"] as string | undefined;

      if (!questionId || !answer || !answerUserId) {
        res.status(400).json({ type: "error", message: "Missing user-answer fields" } satisfies AppActionResponse);
        return;
      }

      // Verify caller is the intended user. Fail closed on missing callerUserId.
      if (!callerUserId || callerUserId !== answerUserId) {
        log.error(`[flow-action] Unauthorized: caller ${callerUserId ?? "(none)"} != expected ${answerUserId}`);
        res.status(403).json({ type: "error", message: "Unauthorized" } satisfies AppActionResponse);
        return;
      }

      // Acknowledge immediately so the widget closes
      resp = { type: "close_screen", finalMessage: `✅ You answered: "${answer}"` };
      res.json(resp);
      void replaceFlowCardWithText(messageId, answerAgentSlug, `✅ You answered: **"${answer}"**`, answerConversationId);

      // Fire-and-forget: start new /run with the answer as context
      try {
        const { getQuestion, deleteQuestion } = await import("./pending-questions.js");
        const { setSession } = await import("./webhook.js");

        const question = await getQuestion(questionId);
        const questionText = question?.question ?? "a question";
        const optionsList = question?.options?.join(", ") ?? "";

        const agent = await prisma.agent.findFirst({ where: { slug: answerAgentSlug } });
        const appToken = agent?.spacesAppToken
          ? decrypt(...(agent.spacesAppToken.split(":") as [string, string, string]), CONFIG.encryptionKey)
          : "";

        const runRes = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run`, {
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
            agentSlug: answerAgentSlug,
            responseMode: "conversation",
            appToken,
            spacesAppId: agent.spacesAppId ?? "",
            spacesAppUserId: agent.spacesAppUserId ?? "",
          });
        }

        log.info(`[flow-action] User answered "${answer}" → new /run (session=${runBody.sessionId})`);
        await deleteQuestion(questionId).catch(() => {});
      } catch (err) {
        log.error("[flow-action] Failed to start new run with answer:", err);
      }
      return;
    }

    // ── 4. Start /goal autonomous loop (from suggest-goal card) ───────────────
    // Triggered when the user taps "▶ Run autonomously as /goal" on the card
    // posted by webhook.ts buildGoalSuggestionFlow. Mirrors the typed
    // `/goal <condition>` path: handleSlashCommandBeforeRun builds the
    // firstTurnTask, dispatch /run + persistGoalStart so the relooper can
    // replay turn-by-turn.
    // ── Agent clone approval ──────────────────────────────────────
    // Source agent's owner approves/declines a clone request from the DM card.
    // Authorization is enforced twice: (1) fail-closed callerUserId === the
    // ownerUserId baked into the card, and (2) resolveCloneRequest re-checks
    // owner/admin against the live DB row. Both must pass.
    if (actionType === "clone-approval") {
      const requestId = data["requestId"] as string | undefined;
      const ownerUserId = data["ownerUserId"] as string | undefined;
      const cloneAgentSlug = data["agentSlug"] as string | undefined;

      if (!requestId || !ownerUserId) {
        res.status(400).json({ type: "error", message: "Missing clone-approval fields in flowJSON.data" } satisfies AppActionResponse);
        return;
      }

      if (!callerUserId || callerUserId !== ownerUserId) {
        log.error(`[flow-action] clone-approval: unauthorized — caller ${callerUserId ?? "(none)"} != expected ${ownerUserId}`);
        res.status(403).json({ type: "error", message: "Unauthorized" } satisfies AppActionResponse);
        return;
      }

      const { resolveCloneRequest } = await import("./agents.js");
      const decision = actionId === "clone-approve" ? "approve" : "reject";
      const result = await resolveCloneRequest(requestId, callerUserId, decision);

      if (!result.ok) {
        resp = { type: "close_screen", finalMessage: result.error };
        res.json(resp);
        void replaceFlowCardWithText(messageId, cloneAgentSlug, `⚠️ ${result.error}`, conversationId);
        return;
      }

      const finalText = result.alreadyResolved
        ? (result.status === "approved" ? "✅ **Clone already approved.**" : "❌ **Clone request already declined.**")
        : (result.status === "approved" ? "✅ **Clone approved.** The requester now has their own copy." : "❌ **Clone request declined.**");
      resp = { type: "close_screen", finalMessage: finalText };
      res.json(resp);
      void replaceFlowCardWithText(messageId, cloneAgentSlug, finalText, conversationId);
      return;
    }

    if (actionType === "start-goal") {
      const condition = data["condition"] as string | undefined;
      const goalAgentSlug = data["agentSlug"] as string | undefined;
      const goalChannelId = data["channelId"] as string | undefined;
      const goalConversationId = data["conversationId"] as string | undefined;
      const goalUserId = data["userId"] as string | undefined;

      if (!condition || !goalAgentSlug || !goalChannelId || !goalConversationId || !goalUserId) {
        res.status(400).json({ type: "error", message: "Missing start-goal fields in flowJSON.data" } satisfies AppActionResponse);
        return;
      }

      // Only the original recipient (the user the suggestion was offered to)
      // can promote it. Prevents anyone else in the thread from hijacking
      // the button to start a goal under someone else's identity.
      if (!callerUserId || callerUserId !== goalUserId) {
        log.error(`[flow-action] start-goal: unauthorized — caller ${callerUserId ?? "(none)"} != expected ${goalUserId}`);
        res.status(403).json({ type: "error", message: "Unauthorized" } satisfies AppActionResponse);
        return;
      }

      // Close the card immediately so the user gets visual feedback even if
      // /run dispatch is slow. replaceFlowCardWithText below makes the
      // confirmation permanent (so the button can't be re-tapped).
      resp = { type: "close_screen", finalMessage: "▶ Starting /goal — running autonomously…" };
      res.json(resp);
      void replaceFlowCardWithText(
        messageId,
        goalAgentSlug,
        "▶ **/goal started — running autonomously.** I'll keep working until the exit condition is met (or the turn cap is reached). Use `/goal status` to check progress or `/stop` to cancel.",
        goalConversationId,
        goalChannelId,
      );

      // Fire-and-forget: dispatch the actual /run + relooper persistence.
      // Errors here are logged but don't roll back the user-visible confirmation —
      // a stuck dispatch is recoverable; a broken UI promise is not.
      (async () => {
        try {
          const agent = await prisma.agent.findFirst({ where: { slug: goalAgentSlug } });
          if (!agent) {
            log.error(`[flow-action] start-goal: agent ${goalAgentSlug} not found`);
            return;
          }
          const appToken = agent.spacesAppToken
            ? decrypt(...(agent.spacesAppToken.split(":") as [string, string, string]), CONFIG.encryptionKey)
            : "";

          const { handleSlashCommandBeforeRun, persistGoalStart } = await import("../services/goalRelooper.js");
          const { setSession } = await import("./webhook.js");

          const intercept = await handleSlashCommandBeforeRun({
            command: { kind: "goalStart", condition: condition.slice(0, 2_000) },
            conversationId: goalConversationId,
          });
          if (intercept.kind !== "goalStarted") {
            log.error("[flow-action] start-goal: unexpected intercept kind", { kind: intercept.kind });
            return;
          }

          // Same dispatch shape as routes/webhook.ts uses for typed /goal —
          // the relooper replays this verbatim with `task` overwritten by
          // NEXT_TURN_TASK_TEMPLATE on each subsequent turn.
          const dispatchPayload: Record<string, unknown> = {
            userId: goalUserId,
            task: intercept.firstTurnTask,
            conversationId: goalConversationId,
            channelId: goalChannelId,
            agentSlug: goalAgentSlug,
            callbackUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/result`,
          };

          const runRes = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
            },
            body: JSON.stringify(dispatchPayload),
          });
          const runBody = (await runRes.json()) as { success: boolean; sessionId?: string };

          if (runBody.success && runBody.sessionId) {
            // Register session so /webhook/result can resolve agent context
            // when turn-1 finishes — no prior /webhook event for this run.
            await setSession(runBody.sessionId, {
              mentionedUserId: agent.spacesAppUserId ?? "",
              senderId: goalUserId,
              senderName: "",
              channelId: goalChannelId,
              channelName: goalChannelId,
              conversationId: goalConversationId,
              task: intercept.firstTurnTask,
              agentSlug: goalAgentSlug,
              responseMode: "conversation",
              appToken,
              spacesAppId: agent.spacesAppId ?? "",
              spacesAppUserId: agent.spacesAppUserId ?? "",
            });

            // Persist after /run has acknowledged — persisting earlier risks
            // the relooper firing turn-2 before turn-1's session is registered.
            await persistGoalStart({
              conversationId: goalConversationId,
              channelId: goalChannelId,
              userId: goalUserId,
              agentSlug: goalAgentSlug,
              condition: intercept.condition,
              runPayload: dispatchPayload as Parameters<typeof persistGoalStart>[0]["runPayload"],
            }).catch((err) => {
              log.warn("[flow-action] start-goal: persistGoalStart failed — loop will not auto-continue", {
                error: err instanceof Error ? err.message : String(err),
              });
            });

            log.info(`[flow-action] start-goal: launched session=${runBody.sessionId} for conv=${goalConversationId}`);
          } else {
            log.error("[flow-action] start-goal: /run dispatch failed", { runBody });
          }
        } catch (err) {
          log.error("[flow-action] start-goal: dispatch errored:", err instanceof Error ? err.message : String(err));
        }
      })();
      return;
    }

    // ── 5. Promote provider (escalate to agent's premium model) ───────────────
    // Triggered when the user taps "Yes, retry with <provider>" / "No" on the
    // promote-provider card posted by webhook.ts after a default-model failure.
    // Accept → write `escalatedProvider` on the conversation's SessionContext
    // so future turns use the premium provider, AND re-dispatch the original
    // task with the agent's credentials. Decline → just close the card.
    if (actionType === "promote-provider") {
      const provider = data["provider"] as string | undefined;
      const promoteAgentSlug = data["agentSlug"] as string | undefined;
      const promoteChannelId = data["channelId"] as string | undefined;
      const promoteConversationId = data["conversationId"] as string | undefined;
      const promoteUserId = data["userId"] as string | undefined;
      const originalTask = data["originalTask"] as string | undefined;

      if (!provider || !promoteAgentSlug || !promoteChannelId || !promoteConversationId || !promoteUserId) {
        res.status(400).json({ type: "error", message: "Missing promote-provider fields in flowJSON.data" } satisfies AppActionResponse);
        return;
      }

      // Only the intended recipient can answer — prevents thread bystanders
      // from charging the agent's premium creds against someone else's task.
      if (!callerUserId || callerUserId !== promoteUserId) {
        log.error(`[flow-action] promote-provider: unauthorized — caller ${callerUserId ?? "(none)"} != expected ${promoteUserId}`);
        res.status(403).json({ type: "error", message: "Unauthorized" } satisfies AppActionResponse);
        return;
      }

      if (actionId === "promote-provider-decline") {
        resp = { type: "close_screen", finalMessage: "Stayed on default." };
        res.json(resp);
        void replaceFlowCardWithText(
          messageId,
          promoteAgentSlug,
          "✋ **Stayed on default.** Send `/upgrade` any time to switch, or mention me again to retry.",
          promoteConversationId,
          promoteChannelId,
        );
        return;
      }

      // actionId === "promote-provider-accept"
      resp = { type: "close_screen", finalMessage: `▶ Retrying with ${provider}…` };
      res.json(resp);
      void replaceFlowCardWithText(
        messageId,
        promoteAgentSlug,
        `▶ **Retrying with ${provider}.** Will use it for the rest of this conversation.`,
        promoteConversationId,
        promoteChannelId,
      );

      // Fire-and-forget: flip the escalation flag + dispatch the original task.
      (async () => {
        try {
          const { extractCodexBearer } = await import("../lib/codex-creds.js");
          const { agentProviderCredentialsRepository } = await import("../repositories/index.js");
          const { setSession, getSessionByConv } = await import("./webhook.js");

          const agent = await prisma.agent.findFirst({ where: { slug: promoteAgentSlug } });
          if (!agent) {
            log.error(`[flow-action] promote-provider: agent ${promoteAgentSlug} not found`);
            return;
          }
          const appToken = agent.spacesAppToken
            ? decrypt(...(agent.spacesAppToken.split(":") as [string, string, string]), CONFIG.encryptionKey)
            : "";

          // Build the provider config for the promoted provider — same
          // shape as webhook.ts buildProviderConfig (kept inline here to
          // avoid a heavier refactor; if a third call site appears, extract).
          const credRow = await agentProviderCredentialsRepository.findByAgentAndProvider(agent.id, provider);
          if (!credRow?.encryptedKey || !credRow.iv || !credRow.authTag) {
            log.error(`[flow-action] promote-provider: no creds for ${provider} on agent ${promoteAgentSlug}`);
            return;
          }
          let apiKey: string;
          try {
            const decrypted = decrypt(credRow.encryptedKey, credRow.iv, credRow.authTag, CONFIG.encryptionKey);
            apiKey = provider === "codex" ? extractCodexBearer(decrypted) : decrypted;
          } catch (err) {
            log.error(`[flow-action] promote-provider: failed to decrypt ${provider} key:`, err instanceof Error ? err.message : err);
            return;
          }
          const defaultModel =
            provider === "copilot" ? "gpt-4o" :
            provider === "codex" ? "gpt-4.1" :
            "claude-sonnet-4-5";
          const providerConfigs: Record<string, { apiKey: string; model: string; baseUrl?: string; authType?: string; reasoningEffort?: string }> = {
            [provider]: {
              apiKey,
              model: credRow.model ?? defaultModel,
              ...(credRow.baseUrl ? { baseUrl: credRow.baseUrl } : {}),
              ...(credRow.authType ? { authType: credRow.authType } : {}),
              ...(credRow.reasoningEffort ? { reasoningEffort: credRow.reasoningEffort } : {}),
            },
          };

          // Update the conversation's SessionContext with the escalation
          // flag. Preserve any existing fields (workflowId, traceId, etc.)
          // so chain hops and goal loops continue to work.
          const priorCtx = await getSessionByConv(promoteConversationId, promoteAgentSlug);
          const baseCtx = priorCtx ?? {
            mentionedUserId: agent.spacesAppUserId ?? "",
            senderId: promoteUserId,
            senderName: "",
            channelId: promoteChannelId,
            channelName: promoteChannelId,
            conversationId: promoteConversationId,
            task: originalTask ?? "",
            agentSlug: promoteAgentSlug,
            responseMode: "conversation" as const,
            appToken,
            spacesAppId: agent.spacesAppId ?? "",
            spacesAppUserId: agent.spacesAppUserId ?? "",
          };

          // Re-dispatch the original task with the escalated provider.
          const dispatchPayload: Record<string, unknown> = {
            userId: promoteUserId,
            task: originalTask ?? "",
            conversationId: promoteConversationId,
            channelId: promoteChannelId,
            agentSlug: promoteAgentSlug,
            callbackUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/result`,
            progressUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`,
            provider,
            providerOrder: [provider],
            providerConfigs,
          };
          const runRes = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
            },
            body: JSON.stringify(dispatchPayload),
          });
          const runBody = (await runRes.json()) as { success: boolean; sessionId?: string };

          if (runBody.success && runBody.sessionId) {
            await setSession(runBody.sessionId, {
              ...baseCtx,
              task: originalTask ?? baseCtx.task,
              provider,
              escalatedProvider: provider,
            });
            log.info(`[flow-action] promote-provider: dispatched session=${runBody.sessionId} provider=${provider} conv=${promoteConversationId}`);
          } else {
            log.error("[flow-action] promote-provider: /run dispatch failed", { runBody });
            // Still flip the flag so the user's NEXT message uses the
            // escalated provider even if the auto-retry didn't fire.
            await setSession(`promote-flag-${Date.now()}`, {
              ...baseCtx,
              escalatedProvider: provider,
            });
          }
        } catch (err) {
          log.error("[flow-action] promote-provider: dispatch errored:", err instanceof Error ? err.message : String(err));
        }
      })();
      return;
    }

    // ── Unknown action ────────────────────────────────────────────────────────
    log.warn(`[flow-action] Unknown actionId=${actionId} actionType=${actionType}`);
    resp = { type: "ack", message: `Unhandled action: ${actionId}` };
    res.json(resp);
  } catch (err) {
    log.error("[flow-action] Unexpected error:", err);
    res.status(500).json({ type: "error", message: "Internal server error" } satisfies AppActionResponse);
  }
});

export { router as flowActionRouter };
