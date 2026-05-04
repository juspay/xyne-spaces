import { Router, type Request, type Response } from "express";
import multer from "multer";
import type { Prisma } from "@prisma/client";
import { agentRepository, agentShareRepository, agentRequestRepository, userRepository, userAgentConfigRepository, userProviderCredentialsRepository, skillRepository } from "../repositories/index.js";
import { CONFIG } from "../config.js";
import { encrypt, decrypt } from "../crypto.js";
import { redisService } from "../redis.js";
import {
  requireClawAdmin,
  requireAgentOwnerOrAdmin,
  getRequesterId,
  isClawAdmin,
} from "../middleware/agent-acl.js";
import { writeAuditLog } from "../lib/audit.js";

const router = Router();

// ── Generate prompt (proxy to xyne-claw) ─────────────────────────────

router.post("/generate-prompt", async (req: Request, res: Response) => {
  try {
    const clawRes = await fetch(`${CONFIG.xyneClawUrl}/generate-prompt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(35_000),
    });

    const data = await clawRes.json();
    res.status(clawRes.status).json(data);
  } catch (err) {
    console.error("[agents] generate-prompt proxy error:", err);
    res.status(500).json({ success: false, error: "Failed to generate prompt" });
  }
});

// ── Name availability check ──────────────────────────────────────────

router.get("/check-name", async (req: Request, res: Response) => {
  try {
    const name = (req.query["name"] as string ?? "").trim();
    const slug = (req.query["slug"] as string ?? "").trim();

    const slugTaken = slug ? Boolean(await agentRepository.findBySlug(slug)) : false;

    let nameTaken = false;
    if (name) {
      const agentByName = await agentRepository.findByNameInsensitive(name);
      nameTaken = Boolean(agentByName);
    }

    res.json({ success: true, data: { slugAvailable: !slugTaken, nameAvailable: !nameTaken } });
  } catch (err) {
    console.error("[agents] check-name error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Agent CRUD ───────────────────────────────────────────────────────

router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = req.query["userId"] as string | undefined;

    const agents = await agentRepository.listVisible(userId);

    // Don't expose encrypted token value — just whether it's set
    const sanitized = agents.map((a: typeof agents[number]) => ({
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
    const agent = await agentRepository.findBySlugWithRelations(req.params.slug);

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
    const { slug, name, description, systemPrompt, scope, ownerUserId, color, modelId, config, skills } = req.body as {
      slug?: string;
      name?: string;
      description?: string;
      systemPrompt?: string;
      scope?: string;
      ownerUserId?: string;
      color?: string;
      modelId?: string;
      config?: Record<string, unknown>;
      skills?: { name: string; content: string }[];
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

    // Determine scope: only admins can create global agents
    const requesterId = getRequesterId(req);
    const admin = requesterId ? await isClawAdmin(requesterId) : false;
    const effectiveScope = scope === "global" && admin ? "global" : "personal";

    // For personal agents, owner is required
    const effectiveOwner = ownerUserId ?? requesterId;
    if (effectiveScope === "personal" && !effectiveOwner) {
      res.status(400).json({ success: false, error: "ownerUserId or x-user-id header required for personal agents" });
      return;
    }

    const data: Prisma.AgentCreateInput = {
      slug: slug.trim(),
      name: name.trim(),
      description: description?.trim() ?? "",
      systemPrompt: systemPrompt.trim(),
      scope: effectiveScope,
      color: color ?? "#6366f1",
      modelId: modelId ?? "",
      config: (config ?? {}) as Prisma.InputJsonValue,
    };
    if (effectiveOwner) {
      data.owner = { connect: { id: effectiveOwner } };
    }
    const agent = await agentRepository.create(data);

    // Attach skills by ID if provided
    if (skills && Array.isArray(skills) && skills.length > 0) {
      for (const skillId of skills) {
        if (typeof skillId === "string") {
          await agentRepository.upsertSkill(agent.id, skillId);
        }
      }
    }

    res.status(201).json({ success: true, data: agent });
  } catch (err) {
    console.error("[agents] create error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.put("/:slug", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const existing = await agentRepository.findBySlug(req.params.slug);
    if (!existing) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }

    // ACL: check edit permissions based on scope
    const requesterId = getRequesterId(req);
    if (requesterId) {
      const admin = await isClawAdmin(requesterId);
      const isOwner = existing.ownerUserId === requesterId;

      if (existing.scope === "global" && !admin && !isOwner) {
        res.status(403).json({ success: false, error: "Only admins or the original owner can edit global agents" });
        return;
      }

      if (existing.scope === "personal" && existing.ownerUserId) {
        const share = await agentShareRepository.findByAgentAndUser(existing.id, requesterId);
        const isEditor = share?.role === "EDITOR";
        if (!admin && !isOwner && !isEditor) {
          res.status(403).json({ success: false, error: "Only the owner, editors, or admins can update this agent" });
          return;
        }
      }
    }

    const { name, description, systemPrompt, enabled, color, modelId, config, skills } = req.body as {
      name?: string;
      description?: string;
      systemPrompt?: string;
      enabled?: boolean;
      color?: string;
      modelId?: string;
      config?: Record<string, unknown>;
      skills?: string[]; // skill IDs to attach
    };

    const data: Prisma.AgentUpdateInput = {};
    if (name !== undefined) data.name = name.trim();
    if (description !== undefined) data.description = description.trim();
    if (systemPrompt !== undefined) data.systemPrompt = systemPrompt.trim();
    if (enabled !== undefined) data.enabled = enabled;
    if (color !== undefined) data.color = color;
    if (modelId !== undefined) data.modelId = modelId;
    if (config !== undefined) data.config = config as Prisma.InputJsonValue;

    // If skills provided, replace all attached skills with new set
    if (skills !== undefined && Array.isArray(skills)) {
      await agentRepository.deleteAllSkills(existing.id);
      for (const skillId of skills) {
        if (typeof skillId === "string") {
          await agentRepository.upsertSkill(existing.id, skillId);
        }
      }
    }

    const agent = await agentRepository.update(req.params.slug, data);

    res.json({ success: true, data: agent });
  } catch (err) {
    console.error("[agents] update error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.delete("/:slug", requireAgentOwnerOrAdmin, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req)!;
    const agent = await agentRepository.findBySlug(req.params.slug);

    await agentRepository.delete(req.params.slug);

    if (agent) {
      await writeAuditLog({
        actorUserId: requesterId,
        eventType: "AGENT_DELETED",
        targetId: agent.id,
        description: `Agent "${agent.name}" (${agent.slug}) deleted`,
      });
    }

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

// ── Agent Requests (Push to Spaces / Push to Global) ──────────────────────────

// POST /agents/:slug/request — user submits request
router.post("/:slug/request", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) { res.status(401).json({ success: false, error: "x-user-id required" }); return; }

    const { requestType } = req.body as { requestType?: string };
    if (!requestType || !["push_to_spaces", "push_to_global"].includes(requestType)) {
      res.status(400).json({ success: false, error: "requestType must be 'push_to_spaces' or 'push_to_global'" });
      return;
    }

    const agent = await agentRepository.findBySlug(req.params.slug);
    if (!agent) { res.status(404).json({ success: false, error: "Agent not found" }); return; }
    if (agent.ownerUserId !== requesterId) { res.status(403).json({ success: false, error: "Only the owner can request this" }); return; }

    // Check for existing pending request
    const existing = await agentRequestRepository.findPending(agent.id, requestType);
    if (existing) { res.status(409).json({ success: false, error: "A pending request already exists" }); return; }

    const request = await agentRequestRepository.create({ agentId: agent.id, agentSlug: agent.slug, requestType, requesterId });

    await writeAuditLog({
      actorUserId: requesterId,
      eventType: "REQUEST_CREATED",
      targetId: agent.id,
      description: `${requestType} request for "${agent.name}"`,
    });

    res.status(201).json({ success: true, data: request });
  } catch (err) {
    console.error("[agents] request error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// GET /agents/requests/pending — admin lists pending requests
router.get("/requests/pending", requireClawAdmin, async (_req: Request, res: Response) => {
  try {
    const requests = await agentRequestRepository.listPending();

    // Batch-fetch agents, skills, and requesters to avoid N+1
    const agentIds = [...new Set(requests.map((r) => r.agentId).filter((id): id is string => !!id))];
    const skillIds = [...new Set(requests.map((r) => r.skillId).filter((id): id is string => !!id))];
    const requesterIds = [...new Set(requests.map((r) => r.requesterId))];
    const [agents, skills, requesters] = await Promise.all([
      agentRepository.findByIds(agentIds),
      skillRepository.findByIds(skillIds),
      userRepository.findByIds(requesterIds),
    ]);
    const agentMap = new Map(agents.map((a) => [a.id, a]));
    const skillMap = new Map(skills.map((s) => [s.id, s]));
    const requesterMap = new Map(requesters.map((u) => [u.id, u]));

    const enriched = requests.map((r) => {
      const agent = r.agentId ? agentMap.get(r.agentId) : undefined;
      const skill = r.skillId ? skillMap.get(r.skillId) : undefined;
      const requester = requesterMap.get(r.requesterId);
      return { ...r, agentName: agent?.name ?? r.agentSlug, skillName: skill?.name, requesterName: requester?.name, requesterEmail: requester?.email };
    });

    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error("[agents] list requests error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// POST /agents/requests/:requestId/approve — admin approves
router.post("/requests/:requestId/approve", requireClawAdmin, async (req: Request<{ requestId: string }>, res: Response) => {
  try {
    const reviewerId = getRequesterId(req)!;
    const request = await agentRequestRepository.findById(req.params.requestId);
    if (!request || request.status !== "pending") {
      res.status(404).json({ success: false, error: "Request not found or already processed" });
      return;
    }

    // Execute the action based on target type
    if (request.targetType === "skill" && request.skillId) {
      const skill = await skillRepository.findById(request.skillId);
      if (!skill) { res.status(404).json({ success: false, error: "Skill not found" }); return; }

      if (request.requestType === "push_to_global") {
        await skillRepository.update(skill.slug, { scope: "global", promotedBy: reviewerId, promotedAt: new Date() });
      }

      await agentRequestRepository.updateStatus(request.id, "approved", reviewerId);
      await writeAuditLog({
        actorUserId: reviewerId,
        eventType: "REQUEST_APPROVED",
        targetId: skill.id,
        description: `Approved ${request.requestType} for skill "${skill.name}"`,
      });
    } else {
      const agent = request.agentId ? await agentRepository.findById(request.agentId) : null;
      if (!agent) { res.status(404).json({ success: false, error: "Agent not found" }); return; }

      if (request.requestType === "push_to_spaces") {
        // Approved — admin will use Create App / Install / Configure Webhook buttons separately
      } else if (request.requestType === "push_to_global") {
        await agentRepository.updateById(agent.id, { scope: "global", promotedBy: reviewerId, promotedAt: new Date() });
      }

      await agentRequestRepository.updateStatus(request.id, "approved", reviewerId);
      await writeAuditLog({
        actorUserId: reviewerId,
        eventType: "REQUEST_APPROVED",
        targetId: agent.id,
        description: `Approved ${request.requestType} for "${agent.name}"`,
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("[agents] approve request error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// POST /agents/requests/:requestId/reject — admin rejects
router.post("/requests/:requestId/reject", requireClawAdmin, async (req: Request<{ requestId: string }>, res: Response) => {
  try {
    const reviewerId = getRequesterId(req)!;
    const { note } = req.body as { note?: string };

    const request = await agentRequestRepository.findById(req.params.requestId);
    if (!request || request.status !== "pending") {
      res.status(404).json({ success: false, error: "Request not found or already processed" });
      return;
    }

    await agentRequestRepository.updateStatus(request.id, "rejected", reviewerId, note);

    await writeAuditLog({
      actorUserId: reviewerId,
      eventType: "REQUEST_REJECTED",
      targetId: request.agentId ?? request.skillId ?? request.id,
      description: `Rejected ${request.requestType} for "${request.agentSlug ?? request.skillSlug}"${note ? `: ${note}` : ""}`,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("[agents] reject request error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Promote / Demote (Admin only) ─────────────────────────────────────────────

// POST /agents/:slug/promote — move agent from personal → global
router.post("/:slug/promote", requireClawAdmin, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req)!;
    const agent = await agentRepository.findBySlug(req.params.slug);
    if (!agent) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    if (agent.scope === "global") {
      res.status(400).json({ success: false, error: "Agent is already global" });
      return;
    }

    const updated = await agentRepository.update(req.params.slug, { scope: "global", promotedBy: requesterId, promotedAt: new Date() });

    await writeAuditLog({
      actorUserId: requesterId,
      eventType: "AGENT_PROMOTED",
      targetId: agent.id,
      description: `Agent "${agent.name}" (${agent.slug}) promoted to global scope`,
      metadata: { previousOwner: agent.ownerUserId },
    });

    console.log(`[agents] ${req.params.slug} promoted to global by ${requesterId}`);
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error("[agents] promote error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// POST /agents/:slug/demote — move agent from global → personal (back to owner)
router.post("/:slug/demote", requireClawAdmin, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req)!;
    const agent = await agentRepository.findBySlug(req.params.slug);
    if (!agent) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    if (agent.scope !== "global") {
      res.status(400).json({ success: false, error: "Agent is not global" });
      return;
    }

    const updated = await agentRepository.update(req.params.slug, { scope: "personal", promotedBy: null, promotedAt: null });

    await writeAuditLog({
      actorUserId: requesterId,
      eventType: "AGENT_DEMOTED",
      targetId: agent.id,
      description: `Agent "${agent.name}" (${agent.slug}) demoted from global to personal scope`,
      metadata: { ownerId: agent.ownerUserId },
    });

    console.log(`[agents] ${req.params.slug} demoted from global by ${requesterId}`);
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error("[agents] demote error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Agent sharing (owner or admin can share a personal agent) ─────────────────

// POST /agents/:slug/shares — share agent with a user
router.post("/:slug/shares", requireAgentOwnerOrAdmin, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req)!;
    const agent = await agentRepository.findBySlug(req.params.slug);
    if (!agent) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    if (agent.scope === "global") {
      res.status(400).json({ success: false, error: "Global agents are already visible to all users" });
      return;
    }

    const { userId, role } = req.body as { userId?: string; role?: string };
    if (!userId || typeof userId !== "string") {
      res.status(400).json({ success: false, error: "userId is required" });
      return;
    }
    if (userId === agent.ownerUserId) {
      res.status(400).json({ success: false, error: "Cannot share with the agent owner" });
      return;
    }

    const targetUser = await userRepository.findById(userId);
    if (!targetUser) {
      res.status(404).json({ success: false, error: "Target user not found" });
      return;
    }

    const shareRole = role === "EDITOR" ? "EDITOR" : "VIEWER";
    const share = await agentShareRepository.upsert(agent.id, userId, shareRole, requesterId);

    await writeAuditLog({
      actorUserId: requesterId,
      eventType: "AGENT_SHARED",
      targetId: agent.id,
      description: `Agent "${agent.name}" shared with ${targetUser.email} as ${shareRole}`,
      metadata: { sharedWithUserId: userId, role: shareRole },
    });

    res.status(201).json({ success: true, data: share });
  } catch (err) {
    console.error("[agents] share error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// DELETE /agents/:slug/shares/:userId — remove share
router.delete("/:slug/shares/:userId", requireAgentOwnerOrAdmin, async (req: Request<{ slug: string; userId: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req)!;
    const agent = await agentRepository.findBySlug(req.params.slug);
    if (!agent) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }

    await agentShareRepository.delete(agent.id, req.params.userId);

    await writeAuditLog({
      actorUserId: requesterId,
      eventType: "AGENT_UNSHARED",
      targetId: agent.id,
      description: `Agent "${agent.name}" share removed for user ${req.params.userId}`,
    });

    res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2025") {
      res.status(404).json({ success: false, error: "Share not found" });
      return;
    }
    console.error("[agents] unshare error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// GET /agents/:slug/shares — list who an agent is shared with (owner or admin only)
router.get("/:slug/shares", requireAgentOwnerOrAdmin, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const agent = await agentRepository.findBySlug(req.params.slug);
    if (!agent) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }

    const shares = await agentShareRepository.listByAgent(agent.id);

    res.json({ success: true, data: shares });
  } catch (err) {
    console.error("[agents] list shares error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Tool attach/detach ───────────────────────────────────────────────

router.post("/:slug/tools", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const agent = await agentRepository.findBySlug(req.params.slug);
    if (!agent) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }

    const { toolId, permission } = req.body as { toolId?: string; permission?: string };

    if (!toolId || typeof toolId !== "string") {
      res.status(400).json({ success: false, error: "toolId is required" });
      return;
    }

    const tool = await agentRepository.findToolById(toolId);
    if (!tool) {
      res.status(404).json({ success: false, error: "Tool not found" });
      return;
    }

    const agentTool = await agentRepository.upsertTool(agent.id, toolId, permission ?? "allow");

    res.status(201).json({ success: true, data: agentTool });
  } catch (err) {
    console.error("[agents] attach tool error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.delete("/:slug/tools/:toolId", async (req: Request<{ slug: string; toolId: string }>, res: Response) => {
  try {
    const agent = await agentRepository.findBySlug(req.params.slug);
    if (!agent) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }

    await agentRepository.deleteTool(agent.id, req.params.toolId);

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

// ── POST /:slug/register-app (manual) ────────────────────────────────

function getCookieValue(req: Request, name: string): string | undefined {
  const cookie = req.headers["cookie"] ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function extractUserToken(req: Request): string | undefined {
  // Try body
  const bodyToken = (req.body as { userToken?: string }).userToken;
  if (bodyToken) return bodyToken;

  // Try Authorization header
  const authHeader = req.headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);

  // Prefer the Spaces authV2 workspace cookie: xyne_ws_<workspaceId>_token
  const lastWorkspace = getCookieValue(req, "xyne_last_workspace");
  if (lastWorkspace) {
    const wsToken = getCookieValue(req, `xyne_ws_${lastWorkspace}_token`);
    if (wsToken) return wsToken;
  }

  // Fall back to legacy google_access_token — but ONLY if it looks like a JWT.
  // During the authV2 pending-auth window this cookie holds a JSON blob, which
  // is not a valid bearer token.
  const legacy = getCookieValue(req, "google_access_token");
  if (legacy && legacy.split(".").length === 3) return legacy;

  return undefined;
}

function extractSessionId(req: Request): string | undefined {
  const header = req.headers["x-session-id"];
  if (typeof header === "string" && header) return header;
  return getCookieValue(req, "user_session_id");
}

function spacesUserAuthHeaders(userToken: string, sessionId: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${userToken}` };
  if (sessionId) headers["x-session-id"] = sessionId;
  return headers;
}

// ── Step-by-step Spaces App registration (3 separate buttons) ────────

router.post("/:slug/create-app", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const userToken = extractUserToken(req);
    if (!userToken) { res.status(401).json({ success: false, error: "User token required" }); return; }

    const agent = await agentRepository.findBySlug(req.params.slug);
    if (!agent) { res.status(404).json({ success: false, error: "Agent not found" }); return; }
    if (agent.spacesAppId) { res.status(400).json({ success: false, error: "Agent already has a Spaces App" }); return; }

    const spacesUrl = CONFIG.spacesBackendUrl;
    const sessionId = extractSessionId(req);
    const createRes = await fetch(`${spacesUrl}/api/apps/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...spacesUserAuthHeaders(userToken, sessionId) },
      body: JSON.stringify({ name: agent.name, description: agent.description }),
    });

    if (!createRes.ok) {
      const text = await createRes.text().catch(() => "");
      res.status(createRes.status).json({ success: false, error: `Spaces: ${text.slice(0, 300)}` });
      return;
    }

    const body = (await createRes.json()) as { id?: string };
    if (!body.id) { res.status(500).json({ success: false, error: "Spaces did not return app ID" }); return; }

    await agentRepository.update(req.params.slug, { spacesAppId: body.id });

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

    const agent = await agentRepository.findBySlug(req.params.slug);
    if (!agent) { res.status(404).json({ success: false, error: "Agent not found" }); return; }
    if (!agent.spacesAppId) { res.status(400).json({ success: false, error: "Create app first" }); return; }
    if (agent.spacesAppToken) { res.status(400).json({ success: false, error: "App already installed" }); return; }

    const spacesUrl = CONFIG.spacesBackendUrl;
    const sessionId = extractSessionId(req);
    const installRes = await fetch(`${spacesUrl}/api/apps/install/${agent.spacesAppId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...spacesUserAuthHeaders(userToken, sessionId) },
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
    await agentRepository.update(req.params.slug, {
      spacesAppUserId: appUserId,
      spacesAppToken: `${encToken.ciphertext}:${encToken.iv}:${encToken.authTag}`,
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

    const agent = await agentRepository.findBySlug(req.params.slug);
    if (!agent) { res.status(404).json({ success: false, error: "Agent not found" }); return; }
    if (!agent.spacesAppId) { res.status(400).json({ success: false, error: "Create app first" }); return; }

    const spacesUrl = CONFIG.spacesBackendUrl;
    const sessionId = extractSessionId(req);
    const webhookUrl = `${CONFIG.selfUrl}/claw/api/v1/webhook/${req.params.slug}`;

    const configRes = await fetch(`${spacesUrl}/api/apps/configureWebhook/${agent.spacesAppId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...spacesUserAuthHeaders(userToken, sessionId) },
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

// ── Upload bot picture (proxies to spaces /api/apps/upload-picture/:appId) ──────────
const pictureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.post(
  "/:slug/upload-picture",
  pictureUpload.single("picture"),
  async (req: Request<{ slug: string }>, res: Response) => {
    try {
      const userToken = extractUserToken(req);
      if (!userToken) { res.status(401).json({ success: false, error: "User token required" }); return; }

      const agent = await agentRepository.findBySlug(req.params.slug);
      if (!agent) { res.status(404).json({ success: false, error: "Agent not found" }); return; }
      if (!agent.spacesAppId) { res.status(400).json({ success: false, error: "Create app first" }); return; }

      const file = req.file;
      if (!file) { res.status(400).json({ success: false, error: "picture file is required" }); return; }

      const form = new FormData();
      const blob = new Blob([new Uint8Array(file.buffer)], { type: file.mimetype });
      form.append("picture", blob, file.originalname);

      const spacesUrl = CONFIG.spacesBackendUrl;
      const sessionId = extractSessionId(req);
      const uploadRes = await fetch(`${spacesUrl}/api/apps/upload-picture/${agent.spacesAppId}`, {
        method: "POST",
        headers: spacesUserAuthHeaders(userToken, sessionId),
        body: form,
      });

      if (!uploadRes.ok) {
        const text = await uploadRes.text().catch(() => "");
        res.status(uploadRes.status).json({ success: false, error: `Spaces: ${text.slice(0, 300)}` });
        return;
      }

      const body = await uploadRes.json().catch(() => ({})) as { pictureUrl?: string };
      console.log(`[agents] Uploaded picture for ${req.params.slug}`);
      res.json({ success: true, data: body });
    } catch (err) {
      console.error("[agents] upload-picture error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

// ── User Agent Config (per-user provider override) ──────────────────

router.get("/:slug/user-config/:userId", async (req: Request<{ slug: string; userId: string }>, res: Response) => {
  try {
    const config = await userAgentConfigRepository.findByUserAndAgent(req.params.userId, req.params.slug);
    res.json({
      success: true,
      data: { provider: config?.provider ?? "spaces" },
    });
  } catch (err) {
    console.error("[agents] get user-config error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.put("/:slug/user-config/:userId", async (req: Request<{ slug: string; userId: string }>, res: Response) => {
  try {
    const { provider } = req.body as { provider?: string };
    if (!provider || !["spaces", "copilot", "claude", "codex"].includes(provider)) {
      res.status(400).json({ success: false, error: "provider must be 'spaces', 'copilot', 'claude', or 'codex'" });
      return;
    }
    const config = await userAgentConfigRepository.upsert(req.params.userId, req.params.slug, { provider });
    res.json({ success: true, data: { provider: config.provider } });
  } catch (err) {
    console.error("[agents] upsert user-config error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── User Chain Config (per-user agent chaining) ──────────────────────

router.get("/:slug/chain-config/:userId", async (req: Request<{ slug: string; userId: string }>, res: Response) => {
  try {
    const config = await userAgentConfigRepository.findByUserAndAgent(req.params.userId, req.params.slug);
    res.json({ success: true, data: config?.chainConfig ?? null });
  } catch (err) {
    console.error("[agents] get chain-config error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.put("/:slug/chain-config/:userId", async (req: Request<{ slug: string; userId: string }>, res: Response) => {
  try {
    const chainConfig = req.body.chainConfig ?? null;

    await userAgentConfigRepository.upsert(req.params.userId, req.params.slug, { chainConfig });

    res.json({ success: true, data: chainConfig });
  } catch (err) {
    console.error("[agents] upsert chain-config error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.delete("/:slug/user-config/:userId", async (req: Request<{ slug: string; userId: string }>, res: Response) => {
  try {
    await userAgentConfigRepository.delete(req.params.userId, req.params.slug);
    res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2025") {
      res.json({ success: true }); // already deleted
      return;
    }
    console.error("[agents] delete user-config error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── GitHub Copilot Device Code OAuth ────────────────────────────────

const GITHUB_CLIENT_ID = "Ov23li8tweQw6odWQebz"; // Same as OpenCode / GitHub Copilot CLI
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const DEVICE_CODE_PREFIX = "gh-device:";
const DEVICE_CODE_TTL = 900; // 15 minutes

const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

export interface ClaudeModelInfo {
  id: string;
  displayName: string;
}

export async function fetchAnthropicModels(apiKey: string, baseUrl?: string): Promise<ClaudeModelInfo[]> {
  const root = (baseUrl?.trim() || ANTHROPIC_BASE_URL).replace(/\/+$/, "");
  const res = await fetch(`${root}/v1/models`, {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 200)}`);
  }

  const body = (await res.json()) as {
    data?: Array<{ id?: string; display_name?: string }>;
  };

  return (body.data ?? [])
    .filter((m): m is { id: string; display_name?: string } => Boolean(m.id))
    .map((m) => ({
      id: m.id,
      displayName: m.display_name ?? m.id,
    }));
}

router.post("/:slug/user-config/:userId/github-login", async (req: Request<{ slug: string; userId: string }>, res: Response) => {
  try {
    const ghRes = await fetch(GITHUB_DEVICE_CODE_URL, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: new URLSearchParams({ client_id: GITHUB_CLIENT_ID, scope: "read:user" }),
    });

    if (!ghRes.ok) {
      const text = await ghRes.text().catch(() => "");
      res.status(502).json({ success: false, error: `GitHub error: ${text.slice(0, 200)}` });
      return;
    }

    const data = await ghRes.json() as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval: number;
    };

    // Store device_code in Redis so poll endpoint can use it
    const key = `${DEVICE_CODE_PREFIX}${req.params.userId}:${req.params.slug}`;
    const redis = redisService.getConnection();
    await redis.set(key, JSON.stringify({
      device_code: data.device_code,
      interval: data.interval,
    }), "EX", DEVICE_CODE_TTL);

    res.json({
      success: true,
      data: {
        userCode: data.user_code,
        verificationUri: data.verification_uri,
        expiresIn: data.expires_in,
        interval: data.interval,
      },
    });
  } catch (err) {
    console.error("[agents] github-login error:", err);
    res.status(500).json({ success: false, error: "Failed to initiate GitHub login" });
  }
});

router.post("/:slug/user-config/:userId/github-poll", async (req: Request<{ slug: string; userId: string }>, res: Response) => {
  try {
    const key = `${DEVICE_CODE_PREFIX}${req.params.userId}:${req.params.slug}`;
    const redis = redisService.getConnection();
    const raw = await redis.get(key);

    if (!raw) {
      res.status(400).json({ success: false, error: "No pending login — start again" });
      return;
    }

    const { device_code } = JSON.parse(raw) as { device_code: string; interval: number };

    const ghRes = await fetch(GITHUB_ACCESS_TOKEN_URL, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: new URLSearchParams({
        client_id: GITHUB_CLIENT_ID,
        device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const data = await ghRes.json() as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (data.access_token) {
      // Success — encrypt and store the token at user-level
      const encrypted = encrypt(data.access_token, CONFIG.encryptionKey);

      await userProviderCredentialsRepository.upsert(req.params.userId, "copilot", {
        encryptedKey: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        model: "gpt-4o",
        baseUrl: "https://api.githubcopilot.com",
      });
      // Also flip this agent's provider to copilot
      await userAgentConfigRepository.upsert(req.params.userId, req.params.slug, { provider: "copilot" });

      // Cleanup Redis
      await redis.del(key);

      console.log(`[agents] GitHub Copilot login success for user ${req.params.userId} / agent ${req.params.slug}`);
      res.json({ success: true, data: { status: "approved" } });
      return;
    }

    if (data.error === "authorization_pending") {
      res.json({ success: true, data: { status: "pending" } });
      return;
    }

    if (data.error === "slow_down") {
      res.json({ success: true, data: { status: "slow_down" } });
      return;
    }

    // Other error
    await redis.del(key);
    res.json({ success: false, error: data.error_description ?? data.error ?? "Authorization failed" });
  } catch (err) {
    console.error("[agents] github-poll error:", err);
    res.status(500).json({ success: false, error: "Failed to poll GitHub" });
  }
});

router.post("/:slug/user-config/:userId/claude-models", async (req: Request<{ slug: string; userId: string }>, res: Response) => {
  try {
    const { apiKey, baseUrl } = req.body as { apiKey?: string; baseUrl?: string };
    let resolvedApiKey = apiKey?.trim();

    if (!resolvedApiKey) {
      const existing = await userProviderCredentialsRepository.findByUserAndProvider(req.params.userId, "claude");
      if (existing?.encryptedKey && existing.iv && existing.authTag) {
        resolvedApiKey = decrypt(existing.encryptedKey, existing.iv, existing.authTag, CONFIG.encryptionKey);
      }
    }

    if (!resolvedApiKey) {
      res.status(400).json({ success: false, error: "apiKey is required" });
      return;
    }

    const models = await fetchAnthropicModels(resolvedApiKey, baseUrl);
    res.json({ success: true, data: models });
  } catch (err) {
    console.error("[agents] claude-models error:", err);
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : "Failed to fetch Claude models" });
  }
});

// ── Agent Skill attach/detach (mirrors tool pattern) ──────────────────

router.get("/:slug/skills", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const agent = await agentRepository.findBySlug(req.params.slug);
    if (!agent) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    const skills = await agentRepository.listSkills(agent.id);
    res.json({ success: true, data: skills });
  } catch (err) {
    console.error("[agents] list skills error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/:slug/skills", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const agent = await agentRepository.findBySlug(req.params.slug);
    if (!agent) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    const { skillId } = req.body as { skillId?: string };
    if (!skillId || typeof skillId !== "string") {
      res.status(400).json({ success: false, error: "skillId is required" });
      return;
    }
    const agentSkill = await agentRepository.upsertSkill(agent.id, skillId);
    res.status(201).json({ success: true, data: agentSkill });
  } catch (err) {
    console.error("[agents] attach skill error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.delete("/:slug/skills/:skillId", async (req: Request<{ slug: string; skillId: string }>, res: Response) => {
  try {
    const agent = await agentRepository.findBySlug(req.params.slug);
    if (!agent) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    await agentRepository.deleteSkill(agent.id, req.params.skillId);
    res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2025") {
      res.status(404).json({ success: false, error: "Skill not attached to this agent" });
      return;
    }
    console.error("[agents] detach skill error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export { router as agentsRouter };
