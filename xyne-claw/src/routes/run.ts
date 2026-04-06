import { randomUUID } from "node:crypto";
import { Router, type Response } from "express";
import { runTask } from "../agent.js";
import { validateS2SKey } from "../middleware/auth.js";
import { loadMcpToolsForUser } from "../mcp.js";
import { loadCustomTools } from "../custom-tools.js";
import { SERVER } from "../config.js";
import { createWorkspace, deleteWorkspace } from "../workspace.js";

const router = Router();

router.post("/run", validateS2SKey, (req, res: Response) => {
  const { userId, userName, userEmail, task, context, conversationId, callbackUrl, systemPrompt, agentConfig, agentSlug, channelId } = req.body as {
    userId?: string;
    userName?: string;
    userEmail?: string;
    task?: string;
    context?: string;
    conversationId?: string;
    callbackUrl?: string;
    systemPrompt?: string;
    agentConfig?: Record<string, unknown>;
    agentSlug?: string;
    channelId?: string;
  };

  if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
    res.status(400).json({ success: false, error: "userId is required" });
    return;
  }

  if (!task || typeof task !== "string" || task.trim().length === 0) {
    res.status(400).json({ success: false, error: "task is required and must be a non-empty string" });
    return;
  }

  const sessionId = randomUUID();

  // Return sessionId immediately
  res.json({ success: true, sessionId });

  // Process in background
  processTask(sessionId, userId.trim(), task.trim(), context, userName, userEmail, conversationId, callbackUrl, systemPrompt, agentConfig, agentSlug, channelId);
});

async function processTask(
  sessionId: string,
  userId: string,
  task: string,
  context: string | undefined,
  userName: string | undefined,
  userEmail: string | undefined,
  conversationId: string | undefined,
  callbackUrl: string | undefined,
  systemPrompt: string | undefined,
  agentConfig: Record<string, unknown> | undefined,
  agentSlug: string | undefined,
  channelId: string | undefined,
): Promise<void> {
  let mcpCleanup: (() => Promise<void>) | undefined;

  try {
    console.log(`[run] Session ${sessionId}: starting for user ${userId}`);

    const workspaceDir = await createWorkspace(sessionId);

    const toolPermissions = (agentConfig?.["toolPermissions"] as Record<string, string> | undefined) ?? {};
    const { tools: mcpTools, cleanup, getPendingActions } = await loadMcpToolsForUser(userId, toolPermissions);
    mcpCleanup = cleanup;

    const meta: Record<string, string> = { userId };
    if (agentSlug) meta["agentSlug"] = agentSlug;
    if (channelId) meta["channelId"] = channelId;
    if (conversationId) meta["conversationId"] = conversationId;

    const { tools: customToolDefs, getAttachments, getPendingQuestions } = loadCustomTools(agentConfig, meta);
    const allTools = [...mcpTools, ...customToolDefs];
    const tools = allTools.length > 0 ? allTools : undefined;
    const result = await runTask(userId, task, context, userName, userEmail, tools, systemPrompt, workspaceDir);

    const attachments = getAttachments();
    const pendingQuestions = getPendingQuestions();
    const pendingActions = getPendingActions();

    console.log(`[run] Session ${sessionId}: completed, ${result.toolsUsed.length} tools used, ${attachments.length} attachment(s), ${pendingQuestions.length} question(s), ${pendingActions.length} pending action(s)`);

    await sendCallback(callbackUrl, {
      sessionId,
      userId,
      conversationId: conversationId ?? null,
      status: "completed",
      result: result.text,
      toolsUsed: result.toolsUsed,
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(pendingQuestions.length > 0 ? { pendingQuestions } : {}),
      ...(pendingActions.length > 0 ? { pendingActions } : {}),
    });
  } catch (err) {
    console.error(`[run] Session ${sessionId}: failed`, err);

    await sendCallback(callbackUrl, {
      sessionId,
      userId,
      conversationId: conversationId ?? null,
      status: "failed",
      error: err instanceof Error ? err.message : "Internal error",
    });
  } finally {
    if (mcpCleanup) {
      await mcpCleanup().catch(() => {});
    }
    await deleteWorkspace(sessionId).catch(() => {});
  }
}

async function sendCallback(callbackUrl: string | undefined, payload: Record<string, unknown>): Promise<void> {
  const url = callbackUrl ?? `${SERVER.authServiceUrl}/claw/api/v1/sessions/${payload["sessionId"] as string}/result`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error(`[run] Failed to send callback to ${url}:`, err);
  }
}

export { router as runRouter };
