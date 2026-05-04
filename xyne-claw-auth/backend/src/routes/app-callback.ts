/**
 * Actionable URL handler for approve/decline callbacks.
 *
 * The frontend calls this URL directly when a user clicks an app action button.
 * On approve (context has messageContent): posts the message to the original channel.
 * On decline: no-op.
 * In both cases: calls Spaces to mark the action as done in the message frontmatter.
 */

import { Router, type Request, type Response } from "express";
import { CONFIG } from "../config.js";
import { prisma } from "../db.js";
import { decrypt } from "../crypto.js";

const router = Router();

async function spacesAppFetch(path: string, body: Record<string, unknown>, appToken: string): Promise<unknown> {
  const url = `${CONFIG.spacesBackendUrl}/api/apps${path}`;
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

async function getAgentToken(agentSlug: string | undefined): Promise<string | null> {
  const agent = agentSlug
    ? await prisma.agent.findUnique({ where: { slug: agentSlug } })
    : await prisma.agent.findFirst({ where: { isDefault: true } });

  if (!agent?.spacesAppToken) return null;

  const [ciphertext, iv, authTag] = agent.spacesAppToken.split(":");
  if (!ciphertext || !iv || !authTag) return null;
  return decrypt(ciphertext, iv, authTag, CONFIG.encryptionKey);
}

router.post("/callback", async (req: Request, res: Response) => {
  const payload = req.body as {
    actionId?: string;
    context?: Record<string, unknown>;
    messageId?: string;
    conversationId?: string;
    callerUserId?: string;
  };

  const { actionId, context = {}, messageId, callerUserId } = payload;

  console.log(`[app-callback] actionId=${actionId} messageId=${messageId} callerUserId=${callerUserId}`);

  // Acknowledge immediately
  res.json({ success: true });

  const actionType = context["actionType"] as string | undefined;

  // ── User answered a question (ask-user-question tool) ──
  if (actionType === "user-answer") {
    const questionId = context["questionId"] as string;
    const answer = context["answer"] as string;
    const answerAgentSlug = context["agentSlug"] as string;
    const answerChannelId = context["channelId"] as string;
    const answerConversationId = context["conversationId"] as string;
    const answerUserId = context["userId"] as string;

    if (!questionId || !answer || !answerUserId) {
      console.error("[app-callback] Missing user-answer fields");
      return;
    }

    // Verify caller is the intended user (XYNE-12145)
    if (callerUserId && callerUserId !== answerUserId) {
      console.error(`[app-callback] Unauthorized: caller ${callerUserId} != expected ${answerUserId}`);
      return;
    }

    const { getQuestion, deleteQuestion } = await import("./pending-questions.js");
    const { setSession } = await import("./webhook.js");
    const question = await getQuestion(questionId);
    const questionText = question?.question ?? "a question";
    const optionsList = question?.options?.join(", ") ?? "";

    try {
      const agent = await prisma.agent.findFirst({ where: { slug: answerAgentSlug } });
      const appToken = agent?.spacesAppToken
        ? decrypt(...agent.spacesAppToken.split(":") as [string, string, string], CONFIG.encryptionKey)
        : "";

      const runUrl = `${CONFIG.selfUrl}/claw/api/v1/run`;
      const runRes = await fetch(runUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: answerUserId,
          task: `The user answered "${answer}" to your question: "${questionText}". Continue the task based on this answer.`,
          context: `Previous question: ${questionText}\nOptions: ${optionsList}\nUser's answer: ${answer}`,
          conversationId: answerConversationId,
          channelId: answerChannelId,
          agentSlug: answerAgentSlug,
          callbackUrl: `${CONFIG.selfUrl}/claw/api/v1/webhook/result`,
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

      console.log(`[app-callback] User answered "${answer}" → new /run (session=${runBody.sessionId})`);
    } catch (err) {
      console.error("[app-callback] Failed to start new run with answer:", err);
    }

    await deleteQuestion(questionId).catch(() => {});
    return;
  }

  // ── Write action approval (HITL) ──
  if (actionType === "write") {
    const serverType = context["serverType"] as string;
    const tool = context["tool"] as string;
    const paramsStr = context["params"] as string;
    const writeUserId = context["userId"] as string;
    const signature = context["signature"] as string;

    if (!serverType || !tool || !paramsStr || !writeUserId || !signature) {
      console.error("[app-callback] Missing write action fields");
      return;
    }

    const params = JSON.parse(paramsStr) as Record<string, unknown>;

    // Verify HMAC signature
    const { verifyActionSignature } = await import("./mcp.js");
    const action = { serverType, tool, params, userId: writeUserId };
    if (!verifyActionSignature(action, signature)) {
      console.error("[app-callback] HMAC verification failed — action may have been tampered with");
      return;
    }

    // Verify caller is the intended user (XYNE-12145)
    if (callerUserId && callerUserId !== writeUserId) {
      console.error(`[app-callback] Unauthorized: caller ${callerUserId} != expected ${writeUserId}`);
      return;
    }

    try {
      // Google (custom) tools — execute directly via xyne-claw-shared
      if (serverType === "google") {
        const { getAllCustomTools } = await import("xyne-claw-shared");
        const toolDef = getAllCustomTools().find((t) => t.slug === tool);
        if (!toolDef) {
          console.error(`[app-callback] Unknown Google tool: ${tool}`);
          return;
        }

        // Fetch a valid Google access token (auto-refreshes if expired)
        const connection = await prisma.userMcpConnection.findFirst({
          where: { userId: writeUserId, mcpServer: { type: "google" } },
        });
        if (!connection) {
          console.error(`[app-callback] No Google connection for user ${writeUserId}`);
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
            console.error(`[app-callback] Google token refresh failed: ${refreshRes.status}`);
            return;
          }
        }

        const result = await toolDef.execute(params, { config: { GOOGLE_ACCESS_TOKEN: accessToken } });
        console.log(`[app-callback] Google write action approved: ${tool} → ${result.slice(0, 100)}`);
        return;
      }

      // Microsoft (custom) tools — execute directly via xyne-claw-shared
      if (serverType === "microsoft") {
        const { getAllCustomTools } = await import("xyne-claw-shared");
        const toolDef = getAllCustomTools().find((t) => t.slug === tool);
        if (!toolDef) {
          console.error(`[app-callback] Unknown Microsoft tool: ${tool}`);
          return;
        }

        // Fetch a valid Microsoft access token (auto-refreshes if expired)
        const connection = await prisma.userMcpConnection.findFirst({
          where: { userId: writeUserId, mcpServer: { type: "microsoft" } },
        });
        if (!connection) {
          console.error(`[app-callback] No Microsoft connection for user ${writeUserId}`);
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
            console.error(`[app-callback] Microsoft token refresh failed: ${refreshRes.status}`);
            return;
          }
        }

        const result = await toolDef.execute(params, { config: { MICROSOFT_ACCESS_TOKEN: accessToken } });
        console.log(`[app-callback] Microsoft write action approved: ${tool} → ${result.slice(0, 100)}`);
        return;
      }

      // MCP-based tools — execute via MCP runner
      const { callTool } = await import("../mcp/runner.js");
      const { hasConnectorDefinition } = await import("../mcp/connector-definitions.js");
      if (!(await hasConnectorDefinition(serverType))) {
        console.error(`[app-callback] No adapter for ${serverType}`);
        return;
      }

      const connection = await prisma.userMcpConnection.findFirst({
        where: { userId: writeUserId, mcpServer: { type: serverType } },
      });
      if (!connection) {
        console.error(`[app-callback] No connection for user ${writeUserId} / ${serverType}`);
        return;
      }

      const decryptedCreds = decrypt(connection.encryptedCreds, connection.iv, connection.authTag, CONFIG.encryptionKey);
      const credentials = JSON.parse(decryptedCreds) as Record<string, unknown>;

      const result = await callTool(writeUserId, serverType, credentials, tool, params);
      console.log(`[app-callback] Write action approved: ${tool} → ${result.content.slice(0, 100)}`);
    } catch (err) {
      console.error(`[app-callback] Failed to execute write action ${tool}:`, err);
    }
    return;
  }

  const targetConversationId = context["targetConversationId"] as string | undefined;
  const messageContent = context["messageContent"] as string | undefined;
  const mentionedUserId = context["mentionedUserId"] as string | undefined;

  // ── Digital Twin approval: post as the mentioned user via S2S internal endpoint ──
  const targetChannelId = context["targetChannelId"] as string | undefined;

  if (targetConversationId && messageContent && targetChannelId && mentionedUserId) {
    // Verify caller is the intended user (XYNE-12145)
    if (callerUserId && callerUserId !== mentionedUserId) {
      console.error(`[app-callback] Unauthorized: caller ${callerUserId} != expected ${mentionedUserId}`);
      return;
    }

    try {
      const s2sKey = process.env["INTERNAL_S2S_KEY"] ?? "";
      const url = `${CONFIG.spacesBackendUrl}/api/internal/postAsUser`;
      const postRes = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-s2s-key": s2sKey,
        },
        body: JSON.stringify({
          channelId: targetChannelId,
          conversationId: targetConversationId,
          markdownText: messageContent,
          userId: mentionedUserId,
          metadata: { contentFormat: "markdown" },
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!postRes.ok) {
        const text = await postRes.text().catch(() => "");
        console.error(`[app-callback] Failed to post: ${postRes.status} ${text.slice(0, 200)}`);
        return;
      }

      console.log(`[app-callback] Posted approved message to conversation ${targetConversationId}`);
    } catch (err) {
      console.error("[app-callback] Failed to post:", err);
    }
  }
});

export { router as appCallbackRouter };
