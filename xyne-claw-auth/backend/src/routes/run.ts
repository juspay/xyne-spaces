import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";

const router = Router();

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

// ── Resolve agent config ──

async function resolveAgent(agentSlug: string | undefined): Promise<{
  systemPrompt: string;
  modelId?: string | undefined;
  agentConfig: Record<string, unknown>;
} | { error: string }> {
  // Find by slug, or fall back to default agent
  const agent = agentSlug
    ? await prisma.agent.findUnique({ where: { slug: agentSlug } })
    : await prisma.agent.findFirst({ where: { isDefault: true } });

  if (!agent) {
    return { error: agentSlug ? `Agent '${agentSlug}' not found` : "No default agent configured" };
  }
  if (!agent.enabled) {
    return { error: `Agent '${agent.slug}' is disabled` };
  }

  return {
    systemPrompt: agent.systemPrompt,
    modelId: agent.modelId || undefined,
    agentConfig: agent.config as Record<string, unknown>,
  };
}

// ── POST /run — accept task, resolve identity + agent, forward to xyne-claw ──

router.post("/run", async (req: Request, res: Response) => {
  try {
    const { task, context, conversationId, agentSlug, callbackUrl, channelId } = req.body as {
      task?: string;
      context?: string;
      conversationId?: string;
      agentSlug?: string;
      callbackUrl?: string;
      channelId?: string;
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

    // Resolve agent (only if explicitly requested)
    const agent = await resolveAgent(agentSlug);
    if ("error" in agent) {
      res.status(400).json({ success: false, error: agent.error });
      return;
    }

    // Forward to xyne-claw (returns sessionId immediately)
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
        ...(agent.systemPrompt ? { systemPrompt: agent.systemPrompt } : {}),
        ...(agent.modelId ? { modelId: agent.modelId } : {}),
        agentConfig: agent.agentConfig,
        agentSlug,
        channelId,
      }),
    });

    const body = (await clawRes.json()) as { success: boolean; sessionId?: string; error?: string };

    if (!body.success || !body.sessionId) {
      res.status(clawRes.status).json(body);
      return;
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
