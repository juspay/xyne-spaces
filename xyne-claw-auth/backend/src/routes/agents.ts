import { Router, type Request, type Response } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { encrypt } from "../crypto.js";

const router = Router();

// ── Agent CRUD ───────────────────────────────────────────────────────

router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = req.query["userId"] as string | undefined;

    // Return global agents + user's own agents
    const where: Prisma.AgentWhereInput = userId
      ? { OR: [{ scope: "global" }, { ownerUserId: userId }] }
      : { scope: "global" };

    const agents = await prisma.agent.findMany({
      where,
      include: { tools: { include: { tool: true } } },
      orderBy: { name: "asc" },
    });

    // Don't expose encrypted token value — just whether it's set
    const sanitized = agents.map((a) => ({
      ...a,
      spacesAppToken: a.spacesAppToken ? "(set)" : null,
    }));

    res.json({ success: true, data: sanitized });
  } catch (err) {
    console.error("[agents] list error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.get("/:slug", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const agent = await prisma.agent.findUnique({
      where: { slug: req.params.slug },
      include: { tools: { include: { tool: true } }, owner: true },
    });

    if (!agent) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }

    res.json({ success: true, data: agent });
  } catch (err) {
    console.error("[agents] get error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const { slug, name, description, systemPrompt, scope, ownerUserId, color, modelId, config } = req.body as {
      slug?: string;
      name?: string;
      description?: string;
      systemPrompt?: string;
      scope?: string;
      ownerUserId?: string;
      color?: string;
      modelId?: string;
      config?: Record<string, unknown>;
    };

    if (!slug || typeof slug !== "string" || slug.trim().length === 0) {
      res.status(400).json({ success: false, error: "slug is required" });
      return;
    }

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ success: false, error: "name is required" });
      return;
    }

    if (!systemPrompt || typeof systemPrompt !== "string" || systemPrompt.trim().length === 0) {
      res.status(400).json({ success: false, error: "systemPrompt is required" });
      return;
    }

    const data: Prisma.AgentCreateInput = {
      slug: slug.trim(),
      name: name.trim(),
      description: description?.trim() ?? "",
      systemPrompt: systemPrompt.trim(),
      scope: scope === "user" ? "user" : "global",
      color: color ?? "#6366f1",
      modelId: modelId ?? "",
      config: (config ?? {}) as Prisma.InputJsonValue,
    };
    if (scope === "user" && ownerUserId) {
      data.owner = { connect: { id: ownerUserId } };
    }

    const agent = await prisma.agent.create({ data });

    // Auto-register as Spaces App if user token available
    const userToken = extractUserToken(req);
    if (userToken) {
      registerAgentAsSpacesApp(agent.slug, userToken).catch((err) => {
        console.error(`[agents] auto-register failed for ${agent.slug}:`, err);
      });
    }

    res.status(201).json({ success: true, data: agent });
  } catch (err) {
    console.error("[agents] create error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.put("/:slug", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const existing = await prisma.agent.findUnique({ where: { slug: req.params.slug } });
    if (!existing) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }

    const { name, description, systemPrompt, enabled, color, modelId, config } = req.body as {
      name?: string;
      description?: string;
      systemPrompt?: string;
      enabled?: boolean;
      color?: string;
      modelId?: string;
      config?: Record<string, unknown>;
    };

    const data: Prisma.AgentUpdateInput = {};
    if (name !== undefined) data.name = name.trim();
    if (description !== undefined) data.description = description.trim();
    if (systemPrompt !== undefined) data.systemPrompt = systemPrompt.trim();
    if (enabled !== undefined) data.enabled = enabled;
    if (color !== undefined) data.color = color;
    if (modelId !== undefined) data.modelId = modelId;
    if (config !== undefined) data.config = config as Prisma.InputJsonValue;

    const agent = await prisma.agent.update({
      where: { slug: req.params.slug },
      data,
      include: { tools: { include: { tool: true } } },
    });

    res.json({ success: true, data: agent });
  } catch (err) {
    console.error("[agents] update error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.delete("/:slug", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    await prisma.agent.delete({ where: { slug: req.params.slug } });
    res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2025") {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    console.error("[agents] delete error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Tool attach/detach ───────────────────────────────────────────────

router.post("/:slug/tools", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const agent = await prisma.agent.findUnique({ where: { slug: req.params.slug } });
    if (!agent) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }

    const { toolId, permission } = req.body as { toolId?: string; permission?: string };

    if (!toolId || typeof toolId !== "string") {
      res.status(400).json({ success: false, error: "toolId is required" });
      return;
    }

    const tool = await prisma.tool.findUnique({ where: { id: toolId } });
    if (!tool) {
      res.status(404).json({ success: false, error: "Tool not found" });
      return;
    }

    const agentTool = await prisma.agentTool.upsert({
      where: { agentId_toolId: { agentId: agent.id, toolId } },
      create: {
        agentId: agent.id,
        toolId,
        permission: permission ?? "allow",
      },
      update: {
        permission: permission ?? "allow",
      },
      include: { tool: true },
    });

    res.status(201).json({ success: true, data: agentTool });
  } catch (err) {
    console.error("[agents] attach tool error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.delete("/:slug/tools/:toolId", async (req: Request<{ slug: string; toolId: string }>, res: Response) => {
  try {
    const agent = await prisma.agent.findUnique({ where: { slug: req.params.slug } });
    if (!agent) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }

    await prisma.agentTool.delete({
      where: { agentId_toolId: { agentId: agent.id, toolId: req.params.toolId } },
    });

    res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2025") {
      res.status(404).json({ success: false, error: "Tool not attached to this agent" });
      return;
    }
    console.error("[agents] detach tool error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Spaces App registration (reusable) ───────────────────────────────

async function registerAgentAsSpacesApp(agentSlug: string, userToken: string): Promise<{ spacesAppId: string; spacesAppUserId: string | null } | { error: string }> {
  const agent = await prisma.agent.findUnique({ where: { slug: agentSlug } });
  if (!agent) return { error: "Agent not found" };
  if (agent.spacesAppId) return { error: "Agent already registered as a Spaces App" };

  const spacesUrl = CONFIG.spacesBackendUrl;

  // /create and /configureWebhook require a real user token with XYNE-APPS:WRITE
  const userHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${userToken}`,
  };

  // 1. Create app (requires user auth)
  const createRes = await fetch(`${spacesUrl}/api/apps/create`, {
    method: "POST",
    headers: userHeaders,
    body: JSON.stringify({ name: agent.name, description: agent.description }),
  });
  if (!createRes.ok) {
    const text = await createRes.text().catch(() => "");
    return { error: `Failed to create Spaces app: ${text.slice(0, 200)}` };
  }
  const createBody = (await createRes.json()) as { id?: string };
  const appId = createBody?.id;
  if (!appId) return { error: "Spaces did not return app ID" };

  // 2. Install (no auth required)
  const installRes = await fetch(`${spacesUrl}/api/apps/install/${appId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!installRes.ok) {
    const text = await installRes.text().catch(() => "");
    return { error: `Failed to install Spaces app: ${text.slice(0, 200)}` };
  }
  const installBody = (await installRes.json()) as { jwtToken?: string };
  if (!installBody.jwtToken) {
    return { error: "Spaces did not return JWT token" };
  }

  // Decode JWT to extract appUserId (payload: { appId, userId })
  const jwtParts = installBody.jwtToken.split(".");
  let appUserId: string | null = null;
  if (jwtParts[1]) {
    try {
      const decoded = JSON.parse(Buffer.from(jwtParts[1], "base64url").toString()) as { userId?: string };
      appUserId = decoded.userId ?? null;
    } catch {
      // ignore decode errors
    }
  }

  // 3. Configure webhook (requires user auth)
  const webhookUrl = `${CONFIG.selfUrl}/claw/api/v1/webhook/${agentSlug}`;
  await fetch(`${spacesUrl}/api/apps/configureWebhook/${appId}`, {
    method: "POST",
    headers: userHeaders,
    body: JSON.stringify({ webhookUrl }),
  }).catch(() => {
    console.warn(`[agents] Webhook config failed for ${agentSlug}, continuing`);
  });

  // 4. Store encrypted token (no signing secret — Spaces keeps it internally)
  const encToken = encrypt(installBody.jwtToken, CONFIG.encryptionKey);

  await prisma.agent.update({
    where: { slug: agentSlug },
    data: {
      spacesAppId: appId,
      spacesAppUserId: appUserId,
      spacesAppToken: `${encToken.ciphertext}:${encToken.iv}:${encToken.authTag}`,
    },
  });

  console.log(`[agents] Registered ${agentSlug} as Spaces App ${appId} (botUser=${appUserId})`);
  return { spacesAppId: appId, spacesAppUserId: appUserId };
}

// ── POST /:slug/register-app (manual) ────────────────────────────────

function extractUserToken(req: Request): string | undefined {
  // Try body
  const bodyToken = (req.body as { userToken?: string }).userToken;
  if (bodyToken) return bodyToken;

  // Try Authorization header
  const authHeader = req.headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);

  // Try cookie
  const cookie = req.headers["cookie"] ?? "";
  const match = cookie.match(/(?:^|;\s*)google_access_token=([^;]*)/);
  if (match?.[1]) return decodeURIComponent(match[1]);

  return undefined;
}

router.post("/:slug/register-app", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const userToken = extractUserToken(req);

    if (!userToken) {
      res.status(401).json({ success: false, error: "User token required — log in to Xyne Spaces first" });
      return;
    }

    const result = await registerAgentAsSpacesApp(req.params.slug, userToken);
    if ("error" in result) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true, data: result });
  } catch (err) {
    console.error("[agents] register-app error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Step-by-step Spaces App registration ─────────────────────────────

router.post("/:slug/create-app", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const userToken = extractUserToken(req);
    if (!userToken) { res.status(401).json({ success: false, error: "User token required" }); return; }

    const agent = await prisma.agent.findUnique({ where: { slug: req.params.slug } });
    if (!agent) { res.status(404).json({ success: false, error: "Agent not found" }); return; }
    if (agent.spacesAppId) { res.status(400).json({ success: false, error: "Agent already has a Spaces App" }); return; }

    const spacesUrl = CONFIG.spacesBackendUrl;
    const createRes = await fetch(`${spacesUrl}/api/apps/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ name: agent.name, description: agent.description }),
    });

    if (!createRes.ok) {
      const text = await createRes.text().catch(() => "");
      res.status(createRes.status).json({ success: false, error: `Spaces: ${text.slice(0, 300)}` });
      return;
    }

    const body = (await createRes.json()) as { id?: string };
    if (!body.id) { res.status(500).json({ success: false, error: "Spaces did not return app ID" }); return; }

    await prisma.agent.update({ where: { slug: req.params.slug }, data: { spacesAppId: body.id } });

    console.log(`[agents] Created Spaces App ${body.id} for ${req.params.slug}`);
    res.json({ success: true, data: { spacesAppId: body.id } });
  } catch (err) {
    console.error("[agents] create-app error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/:slug/install-app", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const userToken = extractUserToken(req);
    if (!userToken) { res.status(401).json({ success: false, error: "User token required" }); return; }

    const agent = await prisma.agent.findUnique({ where: { slug: req.params.slug } });
    if (!agent) { res.status(404).json({ success: false, error: "Agent not found" }); return; }
    if (!agent.spacesAppId) { res.status(400).json({ success: false, error: "Create app first" }); return; }
    if (agent.spacesAppToken) { res.status(400).json({ success: false, error: "App already installed" }); return; }

    const spacesUrl = CONFIG.spacesBackendUrl;
    const installRes = await fetch(`${spacesUrl}/api/apps/install/${agent.spacesAppId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
    });

    if (!installRes.ok) {
      const text = await installRes.text().catch(() => "");
      res.status(installRes.status).json({ success: false, error: `Spaces: ${text.slice(0, 300)}` });
      return;
    }

    const body = (await installRes.json()) as { jwtToken?: string };
    if (!body.jwtToken) { res.status(500).json({ success: false, error: "Spaces did not return JWT token" }); return; }

    // Decode JWT to extract appUserId
    let appUserId: string | null = null;
    const jwtParts = body.jwtToken.split(".");
    if (jwtParts[1]) {
      try {
        const decoded = JSON.parse(Buffer.from(jwtParts[1], "base64url").toString()) as { userId?: string };
        appUserId = decoded.userId ?? null;
      } catch { /* ignore */ }
    }

    const encToken = encrypt(body.jwtToken, CONFIG.encryptionKey);
    await prisma.agent.update({
      where: { slug: req.params.slug },
      data: {
        spacesAppUserId: appUserId,
        spacesAppToken: `${encToken.ciphertext}:${encToken.iv}:${encToken.authTag}`,
      },
    });

    console.log(`[agents] Installed Spaces App ${agent.spacesAppId} for ${req.params.slug} (botUser=${appUserId})`);
    res.json({ success: true, data: { spacesAppUserId: appUserId } });
  } catch (err) {
    console.error("[agents] install-app error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/:slug/configure-webhook", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const userToken = extractUserToken(req);
    if (!userToken) { res.status(401).json({ success: false, error: "User token required" }); return; }

    const agent = await prisma.agent.findUnique({ where: { slug: req.params.slug } });
    if (!agent) { res.status(404).json({ success: false, error: "Agent not found" }); return; }
    if (!agent.spacesAppId) { res.status(400).json({ success: false, error: "Create app first" }); return; }

    const spacesUrl = CONFIG.spacesBackendUrl;
    const webhookUrl = `${CONFIG.selfUrl}/claw/api/v1/webhook/${req.params.slug}`;

    const configRes = await fetch(`${spacesUrl}/api/apps/configureWebhook/${agent.spacesAppId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ webhookUrl }),
    });

    if (!configRes.ok) {
      const text = await configRes.text().catch(() => "");
      res.status(configRes.status).json({ success: false, error: `Spaces: ${text.slice(0, 300)}` });
      return;
    }

    console.log(`[agents] Configured webhook for ${req.params.slug}: ${webhookUrl}`);
    res.json({ success: true, data: { webhookUrl } });
  } catch (err) {
    console.error("[agents] configure-webhook error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export { router as agentsRouter, registerAgentAsSpacesApp };
