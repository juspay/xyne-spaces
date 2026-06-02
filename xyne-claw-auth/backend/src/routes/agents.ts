import { Router, type Request, type Response } from "express";
import multer from "multer";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { agentRepository, agentShareRepository, agentRequestRepository, userRepository, userAgentConfigRepository, userProviderCredentialsRepository, agentProviderCredentialsRepository, skillRepository } from "../repositories/index.js";
import { validateSubagentInput, ValidationError as SubagentValidationError } from "../lib/subagent-resolver.js";
import { getSubagentDefinition } from "xyne-claw-shared";
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { encrypt, decrypt } from "../crypto.js";
import { fetchAndStoreSigningSecretFromSpacesApi } from "../lib/spaces-app-secret.js";
import { extractCodexBearer } from "../lib/codex-creds.js";
import { redisService } from "../redis.js";
import {
  requireClawAdmin,
  requireAgentOwnerOrAdmin,
  requireAgentOwnerContributorOrAdmin,
  getRequesterId,
  isClawAdmin,
} from "../middleware/agent-acl.js";
import { writeAuditLog } from "../lib/audit.js";
import { buildAvailableToolsCatalog } from "./tools.js";

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

// ── Suggest tools (proxy to xyne-claw, with catalog from this DB) ────
//
// Frontend sends { systemPrompt | description }. We attach a compressed
// catalog so xyne-claw doesn't need DB access, then forward to its
// /suggest-tools route which does the LLM call. The response is a
// proposal; the UI renders it as a diff for the user to accept.

router.post("/suggest-tools", async (req: Request, res: Response) => {
  try {
    const { systemPrompt, description } = req.body as {
      systemPrompt?: string;
      description?: string;
    };
    const intent = (systemPrompt && systemPrompt.trim()) || (description && description.trim());
    if (!intent) {
      res.status(400).json({ success: false, error: "systemPrompt or description is required" });
      return;
    }

    const full = await buildAvailableToolsCatalog();
    // Compress: drop fields the LLM doesn't need (mcpServers, customGroups,
    // serverTools, writeTools — all derivable from `integrations`).
    const catalog = {
      subagents: full.subagents.map((s) => ({ name: s.name, description: s.description })),
      integrations: full.integrations.map((i) => ({
        slug: i.slug,
        label: i.label,
        readTools: i.readTools.map((t) => ({
          name: t.name, description: t.description, riskLevel: t.riskLevel,
        })),
        writeTools: i.writeTools.map((t) => ({
          name: t.name, description: t.description, riskLevel: t.riskLevel,
        })),
      })),
    };

    const clawRes = await fetch(`${CONFIG.xyneClawUrl}/suggest-tools`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify({ intent, catalog }),
      signal: AbortSignal.timeout(50_000),
    });

    const data = await clawRes.json();
    res.status(clawRes.status).json(data);
  } catch (err) {
    console.error("[agents] suggest-tools proxy error:", err);
    res.status(500).json({ success: false, error: "Failed to suggest tools" });
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
      const share = await agentShareRepository.findByAgentAndUser(existing.id, requesterId);
      const isContributor = share?.role === "EDITOR" || share?.role === "CONTRIBUTOR";

      if (existing.scope === "global" && !admin && !isOwner && !isContributor) {
        res.status(403).json({ success: false, error: "Only admins, the original owner, or contributors can edit global agents" });
        return;
      }

      if (existing.scope === "personal" && existing.ownerUserId) {
        if (!admin && !isOwner && !isContributor) {
          res.status(403).json({ success: false, error: "Only the owner, contributors, or admins can update this agent" });
          return;
        }
      }
    }

    const { slug: nextSlug, name, description, systemPrompt, enabled, color, modelId, config, skills } = req.body as {
      slug?: string;
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

    // Slug rename — owner/admin-only on the route ACL above. Validate
    // format, length, and uniqueness; reject collisions with a typed 409
    // so the frontend can render a useful error.
    if (nextSlug !== undefined) {
      const trimmedSlug = nextSlug.trim().toLowerCase();
      if (trimmedSlug !== existing.slug) {
        if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(trimmedSlug)) {
          res.status(400).json({
            success: false,
            error: "Invalid handle. Use 2-64 lowercase letters, digits, or hyphens. No leading or trailing hyphen.",
            code: "INVALID_SLUG",
          });
          return;
        }
        const collision = await agentRepository.findBySlug(trimmedSlug);
        if (collision && collision.id !== existing.id) {
          res.status(409).json({
            success: false,
            error: `Handle "${trimmedSlug}" is already taken.`,
            code: "SLUG_TAKEN",
          });
          return;
        }
        data.slug = trimmedSlug;
      }
    }

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

    // Batch-fetch agents, skills, requesters, and agent owners to avoid N+1
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

    // Batch-fetch agent owners (distinct from requesters)
    const ownerIds = [...new Set(agents.map((a) => a.ownerUserId).filter((id): id is string => !!id))];
    const owners = await userRepository.findByIds(ownerIds);
    const ownerMap = new Map(owners.map((u) => [u.id, u]));

    const enriched = requests.map((r) => {
      const agent = r.agentId ? agentMap.get(r.agentId) : undefined;
      const skill = r.skillId ? skillMap.get(r.skillId) : undefined;
      const requester = requesterMap.get(r.requesterId);
      const agentOwner = agent?.ownerUserId ? ownerMap.get(agent.ownerUserId) : undefined;
      return { ...r, agentName: agent?.name ?? r.agentSlug, skillName: skill?.name, requesterName: requester?.name, requesterEmail: requester?.email, agentOwnerName: agentOwner?.name, agentOwnerEmail: agentOwner?.email };
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
//
// ACL:
//   - Personal agent  → owner / admin only (preventing contributor-driven
//                       privilege expansion on private agents)
//   - Global agent    → owner / admin / contributors. Contributors can
//                       co-manage the team because everyone can see the
//                       agent anyway; this is about granting EDIT rights.
router.post("/:slug/shares", requireAgentOwnerContributorOrAdmin, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req)!;
    const ctx = (req as Request & { agentContext: import("../middleware/agent-acl.js").AgentContext }).agentContext;
    const agent = ctx.agent;
    // Contributors can only add new contributors on GLOBAL agents.
    // On personal agents they must be promoted to owner/admin first.
    if (!ctx.isOwner && !ctx.isAdmin && agent.scope !== "global") {
      res.status(403).json({
        success: false,
        error: "Contributors can only add other contributors on global agents",
      });
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

    const VALID_ROLES = ["VIEWER", "EDITOR", "CONTRIBUTOR"];
    const shareRole = VALID_ROLES.includes(role ?? "") ? (role as string) : "VIEWER";
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
//
// Same scope-aware ACL as POST: contributors can remove a share only on
// global agents. On personal agents, owner/admin only.
router.delete("/:slug/shares/:userId", requireAgentOwnerContributorOrAdmin, async (req: Request<{ slug: string; userId: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req)!;
    const ctx = (req as Request & { agentContext: import("../middleware/agent-acl.js").AgentContext }).agentContext;
    const agent = ctx.agent;
    if (!ctx.isOwner && !ctx.isAdmin && agent.scope !== "global") {
      res.status(403).json({
        success: false,
        error: "Contributors can only manage shares on global agents",
      });
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

// GET /agents/:slug/shares — list who an agent is shared with.
// Visible to owner, admin, and contributors so contributors can see who
// else is on the team. Read-only — no privilege-escalation risk.
router.get("/:slug/shares", requireAgentOwnerContributorOrAdmin, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const ctx = (req as Request & { agentContext: import("../middleware/agent-acl.js").AgentContext }).agentContext;
    const shares = await agentShareRepository.listByAgent(ctx.agent.id);
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
  return getCookieValue(req, "xyne_session") ?? getCookieValue(req, "user_session_id");
}

function extractWorkspaceId(req: Request): string | undefined {
  const header = req.headers["x-workspace-id"];
  if (typeof header === "string" && header) return header;
  return getCookieValue(req, "xyne_last_workspace");
}

// /api/apps/* routes are mounted on Spaces' legacy `auth.ts` middleware, which
// reads the session ONLY from the `xyne_session` cookie (gated behind a
// truthy workspaceId). Send both Cookie + headers so we work on both legacy
// and authV2 routes; otherwise these calls 401 ~15min after the JWT issues.
function spacesUserAuthHeaders(
  userToken: string,
  sessionId: string | undefined,
  workspaceId: string | undefined,
): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${userToken}` };
  if (sessionId) headers["x-session-id"] = sessionId;
  if (workspaceId) headers["x-workspace-id"] = workspaceId;
  const cookieParts: string[] = [];
  if (sessionId) cookieParts.push(`xyne_session=${sessionId}`);
  if (workspaceId) cookieParts.push(`xyne_last_workspace=${workspaceId}`);
  if (cookieParts.length > 0) headers["Cookie"] = cookieParts.join("; ");
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

    const spacesUrl = CONFIG.spacesInternalUrl;
    const sessionId = extractSessionId(req);
    const workspaceId = extractWorkspaceId(req);
    const createRes = await fetch(`${spacesUrl}/api/apps/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...spacesUserAuthHeaders(userToken, sessionId, workspaceId) },
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

    const spacesUrl = CONFIG.spacesInternalUrl;
    const sessionId = extractSessionId(req);
    const workspaceId = extractWorkspaceId(req);
    const installRes = await fetch(`${spacesUrl}/api/apps/install/${agent.spacesAppId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...spacesUserAuthHeaders(userToken, sessionId, workspaceId) },
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

    const spacesUrl = CONFIG.spacesInternalUrl;
    const sessionId = extractSessionId(req);
    const workspaceId = extractWorkspaceId(req);
    const webhookUrl = `${CONFIG.selfUrl}/claw/api/v1/webhook/${req.params.slug}`;

    const configRes = await fetch(`${spacesUrl}/api/apps/configureWebhook/${agent.spacesAppId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...spacesUserAuthHeaders(userToken, sessionId, workspaceId) },
      body: JSON.stringify({ webhookUrl }),
    });

    if (!configRes.ok) {
      const text = await configRes.text().catch(() => "");
      res.status(configRes.status).json({ success: false, error: `Spaces: ${text.slice(0, 300)}` });
      return;
    }

    console.log(`[agents] Configured webhook for ${req.params.slug}: ${webhookUrl}`);

    // Fetch + persist the per-app signingSecret so verify-spaces-signature can
    // HMAC-check inbound webhook bodies. Best-effort — if Spaces is reachable
    // for configureWebhook (just succeeded above) it's almost certainly
    // reachable for signing-secret too. On failure we log and leave the
    // signature column null; verify middleware stays warn-only for this agent
    // until a future call (or the backfill script) succeeds.
    await fetchAndStoreSigningSecretFromSpacesApi({
      agentId: agent.id,
      spacesAppId: agent.spacesAppId,
      userAuthHeaders: spacesUserAuthHeaders(userToken, sessionId, workspaceId),
    }).catch((err) => {
      console.warn(`[agents] signing-secret fetch swallowed for ${req.params.slug}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    });

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

      const spacesUrl = CONFIG.spacesInternalUrl;
      const sessionId = extractSessionId(req);
      const workspaceId = extractWorkspaceId(req);
      const uploadRes = await fetch(`${spacesUrl}/api/apps/upload-picture/${agent.spacesAppId}`, {
        method: "POST",
        headers: spacesUserAuthHeaders(userToken, sessionId, workspaceId),
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

export async function fetchAnthropicModels(apiKey: string, baseUrl?: string, authType?: string): Promise<ClaudeModelInfo[]> {
  const root = (baseUrl?.trim() || ANTHROPIC_BASE_URL).replace(/\/+$/, "");
  // Anthropic OAuth tokens (Pro/Max via `claude setup-token`) authenticate
  // with Authorization: Bearer + anthropic-beta=oauth-2025-04-20. The API
  // key path (Console keys) uses x-api-key. Sending the OAuth token as
  // x-api-key returns 401 "invalid x-api-key".
  const isOAuth = authType === "oauth_token";
  const headers: Record<string, string> = {
    "anthropic-version": ANTHROPIC_VERSION,
    "content-type": "application/json",
  };
  if (isOAuth) {
    headers["Authorization"] = `Bearer ${apiKey}`;
    headers["anthropic-beta"] = "oauth-2025-04-20";
  } else {
    headers["x-api-key"] = apiKey;
  }
  const res = await fetch(`${root}/v1/models`, {
    method: "GET",
    headers,
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
    const { apiKey, baseUrl, authType } = req.body as { apiKey?: string; baseUrl?: string; authType?: string };
    let resolvedApiKey = apiKey?.trim();
    let resolvedAuthType: string | undefined = authType;

    if (!resolvedApiKey) {
      const existing = await userProviderCredentialsRepository.findByUserAndProvider(req.params.userId, "claude");
      if (existing?.encryptedKey && existing.iv && existing.authTag) {
        resolvedApiKey = decrypt(existing.encryptedKey, existing.iv, existing.authTag, CONFIG.encryptionKey);
        if (!resolvedAuthType) resolvedAuthType = existing.authType ?? undefined;
      }
    }

    if (!resolvedApiKey) {
      res.status(400).json({ success: false, error: "apiKey is required" });
      return;
    }

    const models = await fetchAnthropicModels(resolvedApiKey, baseUrl, resolvedAuthType);
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

// ── Agent-scoped MCP connections ─────────────────────────────────────
//
// Each row pins a specific MCP credential set to this agent. At session
// time, the credentials-resolver checks here BEFORE UserMcpConnection so
// the agent owner's pinned creds always win for that agent's runs.
//
// All writes gated by requireAgentOwnerOrAdmin (same ACL as agent edit).
// GET is gated the same way so we never leak "which MCPs are pinned"
// metadata to non-editors. Decrypted credentials are never returned —
// only { mcpServerId, mcpServerType, mcpServerName, createdByUserId,
// createdAt }. To replace creds, callers POST the full new set; there's
// no partial update.

// Validate an instance slug: lowercase alphanumeric + hyphen, 1-32 chars.
// Used to avoid funny chars leaking into the tool-prefix surface later
// (`<serverType>-<slug>__<tool>`). 'default' is reserved for backfill.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const isValidSlug = (s: unknown): s is string =>
  typeof s === "string" && SLUG_RE.test(s);

router.get("/:slug/mcp/connections", requireAgentOwnerContributorOrAdmin, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const agent = req.agentContext!.agent;
    const connections = await prisma.agentMcpConnection.findMany({
      where: { agentId: agent.id },
      include: { mcpServer: { select: { id: true, type: true, name: true } } },
      orderBy: [{ mcpServerId: "asc" }, { createdAt: "asc" }],
    });
    res.json({
      success: true,
      data: connections.map((c) => ({
        id: c.id,
        mcpServerId: c.mcpServerId,
        mcpServerType: c.mcpServer.type,
        mcpServerName: c.mcpServer.name,
        slug: c.slug,
        displayName: c.displayName ?? c.mcpServer.name,
        createdByUserId: c.createdByUserId,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
    });
  } catch (err) {
    console.error("[agents] list mcp connections error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Create a new agent-MCP instance OR update an existing one in place.
// Identified by (agent, mcpServerType, slug). slug defaults to 'default'
// (same key the backfill migration writes), so old single-instance callers
// that didn't send a slug keep working — they always upsert the same row.
router.post("/:slug/mcp/connections", requireAgentOwnerContributorOrAdmin, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const agent = req.agentContext!.agent;
    const requesterId = getRequesterId(req);
    const { mcpServerType, slug: rawSlug, displayName, credentials } = req.body as {
      mcpServerType?: string;
      slug?: string;
      displayName?: string;
      credentials?: Record<string, unknown>;
    };
    if (!mcpServerType || typeof mcpServerType !== "string") {
      res.status(400).json({ success: false, error: "mcpServerType is required" });
      return;
    }
    if (!credentials || typeof credentials !== "object") {
      res.status(400).json({ success: false, error: "credentials object is required" });
      return;
    }
    const instanceSlug = rawSlug ?? "default";
    if (!isValidSlug(instanceSlug)) {
      res.status(400).json({ success: false, error: "slug must be lowercase alphanumeric + hyphen, 1-32 chars" });
      return;
    }
    const server = await prisma.mcpServer.findUnique({ where: { type: mcpServerType } });
    if (!server) {
      res.status(404).json({ success: false, error: `Unknown mcpServerType: ${mcpServerType}` });
      return;
    }

    const { ciphertext, iv, authTag } = encrypt(JSON.stringify(credentials), CONFIG.encryptionKey);
    const cleanDisplayName = typeof displayName === "string" && displayName.trim().length > 0
      ? displayName.trim()
      : null;

    const row = await prisma.agentMcpConnection.upsert({
      where: { agentId_mcpServerId_slug: { agentId: agent.id, mcpServerId: server.id, slug: instanceSlug } },
      create: {
        agentId: agent.id,
        mcpServerId: server.id,
        slug: instanceSlug,
        displayName: cleanDisplayName,
        encryptedCreds: ciphertext,
        iv,
        authTag,
        ...(requesterId ? { createdByUserId: requesterId } : {}),
      },
      update: {
        encryptedCreds: ciphertext,
        iv,
        authTag,
        // Only overwrite displayName when caller explicitly sent one.
        // Stops a creds-only update from blowing away a previously-set label.
        ...(cleanDisplayName !== null ? { displayName: cleanDisplayName } : {}),
      },
    });

    await writeAuditLog({
      ...(requesterId ? { actorUserId: requesterId } : {}),
      eventType: "AGENT_SHARED", // closest existing enum — TODO: add AGENT_MCP_UPDATED
      targetId: agent.id,
      description: `Updated MCP "${mcpServerType}" / instance "${instanceSlug}" on agent "${agent.slug}"`,
    });

    res.status(201).json({
      success: true,
      data: {
        id: row.id,
        mcpServerId: row.mcpServerId,
        mcpServerType: server.type,
        mcpServerName: server.name,
        slug: row.slug,
        displayName: row.displayName ?? server.name,
        createdByUserId: row.createdByUserId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
    });
  } catch (err) {
    console.error("[agents] upsert mcp connection error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.delete(
  "/:slug/mcp/connections/:mcpServerType/:instanceSlug",
  requireAgentOwnerContributorOrAdmin,
  async (req: Request<{ slug: string; mcpServerType: string; instanceSlug: string }>, res: Response) => {
    try {
      const agent = req.agentContext!.agent;
      const requesterId = getRequesterId(req);
      const { mcpServerType, instanceSlug } = req.params;
      if (!isValidSlug(instanceSlug)) {
        res.status(400).json({ success: false, error: "Invalid instance slug" });
        return;
      }
      const server = await prisma.mcpServer.findUnique({ where: { type: mcpServerType } });
      if (!server) {
        res.status(404).json({ success: false, error: `Unknown mcpServerType: ${mcpServerType}` });
        return;
      }
      await prisma.agentMcpConnection.delete({
        where: { agentId_mcpServerId_slug: { agentId: agent.id, mcpServerId: server.id, slug: instanceSlug } },
      }).catch(() => undefined);

      await writeAuditLog({
        ...(requesterId ? { actorUserId: requesterId } : {}),
        eventType: "AGENT_UNSHARED", // closest existing enum — TODO: add AGENT_MCP_DELETED
        targetId: agent.id,
        description: `Removed MCP "${mcpServerType}" / instance "${instanceSlug}" from agent "${agent.slug}"`,
      });

      res.json({ success: true });
    } catch (err) {
      console.error("[agents] delete mcp connection error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

// ── POST /:slug/fork-subagent ────────────────────────────────────────
//
// One-click "fork a subagent for this agent's MCP instance" — primary
// surface for the multi-instance MCP workflow. Lives on the agent route
// (not the subagent route) because the agent's owner is the one who
// knows BOTH which MCP instances they have AND which subagents they want
// to specialize. The caller picks a source subagent and a slug map; we
// copy the source's prompt/tools/skills into a NEW SubagentDefinition
// with `mcpInstanceMap` set, and optionally enable the new subagent on
// this agent in one shot.
//
// Body:
//   {
//     sourceName: string,                           // existing subagent to fork
//     newName: string,                              // new SubagentDefinition.name
//     mcpInstanceMap: Record<string, string>,       // pin map for the new fork
//     enableOnAgent?: boolean = true,               // append to agent.config.tools.subagents
//   }
//
// Note on builtins: forking a builtin is not supported in this slice — we
// don't carry the builtin's tool surface into a custom row cleanly without
// inventing a tool config. Caller should pick a CUSTOM source. Builtin
// forking is a separate v1.5 follow-up.
router.post("/:slug/fork-subagent", requireAgentOwnerContributorOrAdmin, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const agent = req.agentContext!.agent;
    const requesterId = getRequesterId(req);
    const { sourceName, newName, mcpInstanceMap, enableOnAgent } = req.body as {
      sourceName?: string;
      newName?: string;
      mcpInstanceMap?: Record<string, string>;
      enableOnAgent?: boolean;
    };
    if (!sourceName || typeof sourceName !== "string") {
      res.status(400).json({ success: false, error: "sourceName is required" });
      return;
    }
    if (!newName || typeof newName !== "string") {
      res.status(400).json({ success: false, error: "newName is required" });
      return;
    }
    if (sourceName === newName) {
      res.status(400).json({ success: false, error: "newName must differ from sourceName" });
      return;
    }
    if (!mcpInstanceMap || typeof mcpInstanceMap !== "object" || Array.isArray(mcpInstanceMap)) {
      res.status(400).json({ success: false, error: "mcpInstanceMap is required and must be an object" });
      return;
    }

    // 1) Resolve source. Try DB (custom subagents) first, then fall back to
    //    the in-code SUBAGENT_DEFINITIONS (builtins like "sandbox", "spaces",
    //    "bitbucket", etc.). Forking a builtin creates a NEW custom subagent
    //    in the DB seeded from the builtin's prompt + param shape — the
    //    builtin itself stays untouched.
    // `progressLabels` and `tools` are typed `unknown` here because the
    // validator accepts those shapes broadly — Prisma returns JsonValue
    // shapes that don't narrow cleanly to string[] without a runtime guard
    // we already trust the validator to perform.
    type ForkSource = {
      description: string;
      progressLabels: unknown;
      systemPrompt: string;
      paramName: string;
      paramDescription: string;
      tools: unknown;
      skillIds: string[];
    };

    let source: ForkSource | null = null;

    const customSource = await prisma.subagentDefinition.findUnique({
      where: { name: sourceName },
      include: { skills: { include: { skill: true } } },
    });
    if (customSource) {
      source = {
        description: customSource.description,
        progressLabels: customSource.progressLabels,
        systemPrompt: customSource.systemPrompt,
        paramName: customSource.paramName,
        paramDescription: customSource.paramDescription,
        tools: customSource.tools,
        skillIds: customSource.skills.map((s) => s.skill.id),
      };
    } else {
      // Builtin fallback. Builtin definitions don't carry `tools` or `skills`
      // — the new custom subagent starts with an empty palette and inherits
      // the builtin's MCP server via `mcpInstanceMap` from the request body.
      // Admins can edit the resulting subagent to add tools/skills if needed.
      const builtin = getSubagentDefinition(sourceName);
      if (builtin) {
        source = {
          description: builtin.description,
          progressLabels: builtin.progressLabels,
          systemPrompt: builtin.systemPrompt,
          paramName: builtin.paramName,
          paramDescription: builtin.paramDescription,
          tools: [],
          skillIds: [],
        };
      }
    }

    if (!source) {
      res.status(404).json({
        success: false,
        error: `Source subagent "${sourceName}" not found (neither a custom subagent nor a builtin)`,
      });
      return;
    }

    // 2) Reject duplicate newName up front — friendlier than the unique-key error.
    const collision = await prisma.subagentDefinition.findUnique({ where: { name: newName }, select: { id: true } });
    if (collision) {
      res.status(409).json({ success: false, error: `A subagent named "${newName}" already exists` });
      return;
    }

    // 3) Validate the rest via the standard validator, reusing the source's
    //    fields. validateSubagentInput catches name shape, mcpInstanceMap
    //    shape, and the source's tools/skills format.
    const validated = await validateSubagentInput(
      prisma,
      {
        name: newName,
        description: source.description,
        progressLabels: source.progressLabels,
        systemPrompt: source.systemPrompt,
        paramName: source.paramName,
        paramDescription: source.paramDescription,
        tools: source.tools,
        skillIds: source.skillIds,
        mcpInstanceMap,
      },
      { isCreate: true },
    );

    // 4) Create the new SubagentDefinition AND (optionally) enable it on the
    //    agent in one transaction. If the agent update fails, we don't want
    //    to leak an orphan subagent — Postgres rollback keeps both sides
    //    consistent. Read-back of the agent inside the txn so we work off
    //    fresh config in case someone else just edited it.
    const { created, updatedAgent } = await prisma.$transaction(async (tx) => {
      const createdRow = await tx.subagentDefinition.create({
        data: {
          name: validated.name,
          description: validated.description,
          progressLabels: validated.progressLabels,
          systemPrompt: validated.systemPrompt,
          paramName: validated.paramName,
          paramDescription: validated.paramDescription,
          tools: validated.tools as Prisma.InputJsonValue,
          mcpInstanceMap: Object.keys(validated.mcpInstanceMap).length > 0
            ? (validated.mcpInstanceMap as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          ...(requesterId ? { createdByUserId: requesterId } : {}),
          ...(validated.skillIds.length > 0
            ? { skills: { create: validated.skillIds.map((skillId) => ({ skillId })) } }
            : {}),
        },
        include: { skills: { include: { skill: true } } },
      });

      let nextAgent = agent;
      if (enableOnAgent !== false) {
        const fresh = await tx.agent.findUnique({ where: { id: agent.id } });
        const cfg = (fresh?.config as Record<string, unknown> | null) ?? {};
        const tools = (cfg["tools"] as Record<string, unknown> | undefined) ?? {};
        const existingSubagents = Array.isArray(tools["subagents"]) ? (tools["subagents"] as string[]) : [];
        if (!existingSubagents.includes(createdRow.name)) {
          const nextTools = { ...tools, subagents: [...existingSubagents, createdRow.name] };
          const nextConfig = { ...cfg, tools: nextTools };
          nextAgent = await tx.agent.update({
            where: { id: agent.id },
            data: { config: nextConfig as Prisma.InputJsonValue },
          });
        } else if (fresh) {
          nextAgent = fresh;
        }
      }
      return { created: createdRow, updatedAgent: nextAgent };
    });

    await writeAuditLog({
      ...(requesterId ? { actorUserId: requesterId } : {}),
      eventType: "AGENT_SHARED", // closest existing enum — TODO: AGENT_SUBAGENT_FORKED
      targetId: agent.id,
      description: `Forked subagent "${sourceName}" → "${newName}" on agent "${agent.slug}" with mcpInstanceMap=${JSON.stringify(validated.mcpInstanceMap)}`,
    });

    res.status(201).json({
      success: true,
      data: {
        subagent: {
          id: created.id,
          name: created.name,
          description: created.description,
          systemPrompt: created.systemPrompt,
          paramName: created.paramName,
          paramDescription: created.paramDescription,
          tools: created.tools,
          mcpInstanceMap: created.mcpInstanceMap ?? {},
          createdByUserId: created.createdByUserId,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
          skills: created.skills.map((s) => ({
            id: s.skill.id,
            slug: s.skill.slug,
            name: s.skill.name,
          })),
        },
        agent: {
          slug: updatedAgent.slug,
          subagents: ((((updatedAgent.config as Record<string, unknown> | null) ?? {})["tools"] as Record<string, unknown> | undefined)?.["subagents"] as string[] | undefined) ?? [],
        },
      },
    });
  } catch (err) {
    // Surface validation errors as 400, everything else as 500.
    if (err instanceof SubagentValidationError) {
      res.status(400).json({ success: false, error: err.message, field: err.field });
      return;
    }
    console.error("[agents] fork-subagent error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// `decrypt` is exported from crypto and used by other routes; keep the import
// active here even if we don't decrypt in this slice — future "test connection"
// endpoint will need it.
void decrypt;

// ─────────────────────────────────────────────────────────────────────────────
// Agent-scoped OAuth flows (Codex ChatGPT PKCE + GitHub Copilot device code)
//
// Mirror of the user-scoped flows in routes/settings.ts but targets are:
//   - Redis keys are scoped to (agentId, state) instead of (userId, state)
//   - The minted credential bundle lands in agentProviderCredentials, not
//     userProviderCredentials.
//   - Gated by `requireAgentOwnerOrAdmin` — only owner/admin can wire up the
//     team's Codex sub (or Copilot account) to the shared agent slot.
//
// Why duplicate rather than parameterize the existing user-scoped routes:
//   - The user-scoped routes mix request identity (req.headers["x-user-id"])
//     with storage targeting. Threading an "agentSlug" param into them would
//     require both flows to live in one handler with a permission switch,
//     which is harder to audit. Mirroring keeps each handler's permission
//     contract simple: agent-scoped routes go through `requireAgentOwnerOrAdmin`,
//     user-scoped routes go through user-session middleware. No shared mutable
//     state path.
// ─────────────────────────────────────────────────────────────────────────────

const AGENT_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AGENT_CODEX_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const AGENT_CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
const AGENT_CODEX_REDIRECT_URI = "http://localhost:1455/auth/callback";
const AGENT_CODEX_SCOPE = "openid profile email offline_access";
const AGENT_CODEX_PKCE_PREFIX = "codex-pkce-agent:";
const AGENT_CODEX_PKCE_TTL = 600;

function agentBase64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateAgentCodexPkce(): { verifier: string; challenge: string } {
  const verifier = agentBase64UrlEncode(crypto.randomBytes(32));
  const challenge = agentBase64UrlEncode(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

router.post(
  "/:slug/provider-credentials/codex/oauth/start",
  requireAgentOwnerOrAdmin,
  async (req: Request<{ slug: string }>, res: Response) => {
    try {
      const agent = req.agentContext!.agent;
      const { verifier, challenge } = generateAgentCodexPkce();
      const state = agentBase64UrlEncode(crypto.randomBytes(16));

      const redis = redisService.getConnection();
      await redis.set(`${AGENT_CODEX_PKCE_PREFIX}${agent.id}:${state}`, verifier, "EX", AGENT_CODEX_PKCE_TTL);

      const url = new URL(AGENT_CODEX_AUTHORIZE_URL);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", AGENT_CODEX_CLIENT_ID);
      url.searchParams.set("redirect_uri", AGENT_CODEX_REDIRECT_URI);
      url.searchParams.set("scope", AGENT_CODEX_SCOPE);
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("state", state);
      url.searchParams.set("id_token_add_organizations", "true");
      url.searchParams.set("codex_cli_simplified_flow", "true");
      url.searchParams.set("originator", "codex_cli_rs");

      res.json({ success: true, data: { url: url.toString(), state, expiresIn: AGENT_CODEX_PKCE_TTL } });
    } catch (err) {
      console.error("[agents] codex/oauth/start error:", err);
      res.status(500).json({ success: false, error: "Failed to start Codex login" });
    }
  },
);

router.post(
  "/:slug/provider-credentials/codex/oauth/exchange",
  requireAgentOwnerOrAdmin,
  async (req: Request<{ slug: string }>, res: Response) => {
    try {
      const agent = req.agentContext!.agent;
      const requesterId = getRequesterId(req);
      let { code, state } = (req.body ?? {}) as { code?: string; state?: string };

      // Tolerate user pasting the full callback URL instead of bare code.
      const raw = (code ?? "").trim();
      if (raw && (raw.startsWith("http") || raw.includes("code="))) {
        try {
          const u = raw.startsWith("http") ? new URL(raw) : new URL(`http://x?${raw}`);
          code = u.searchParams.get("code") ?? code;
          state = u.searchParams.get("state") ?? state;
        } catch { /* keep original */ }
      }

      if (!code || !state) {
        res.status(400).json({ success: false, error: "code and state are required" });
        return;
      }

      const redis = redisService.getConnection();
      const key = `${AGENT_CODEX_PKCE_PREFIX}${agent.id}:${state}`;
      const verifier = await redis.get(key);
      if (!verifier) {
        res.status(400).json({ success: false, error: "PKCE verifier expired — start login again" });
        return;
      }
      await redis.del(key);

      const tokRes = await fetch(AGENT_CODEX_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: AGENT_CODEX_CLIENT_ID,
          code,
          code_verifier: verifier,
          redirect_uri: AGENT_CODEX_REDIRECT_URI,
        }),
      });

      if (!tokRes.ok) {
        const text = await tokRes.text().catch(() => "");
        res.status(502).json({ success: false, error: `OpenAI token exchange failed: ${tokRes.status} ${text.slice(0, 200)}` });
        return;
      }

      const tokens = (await tokRes.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
      if (!tokens.access_token || !tokens.refresh_token) {
        res.status(502).json({ success: false, error: "OpenAI did not return tokens" });
        return;
      }

      // Store the bundle (access + refresh + expiry) so a future refresh flow
      // can mint new access tokens without re-prompting.
      const bundle = JSON.stringify({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: Date.now() + (tokens.expires_in ?? 600) * 1000,
      });
      const enc = encrypt(bundle, CONFIG.encryptionKey);

      await agentProviderCredentialsRepository.upsert(agent.id, "codex", {
        encryptedKey: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        authType: "oauth_token",
        baseUrl: "https://api.openai.com/v1",
        ...(requesterId ? { createdByUserId: requesterId } : {}),
      });

      await writeAuditLog({
        ...(requesterId ? { actorUserId: requesterId } : {}),
        eventType: "AGENT_SHARED",
        targetId: agent.id,
        description: `Configured Codex OAuth credentials on agent "${agent.slug}" via ChatGPT sign-in`,
      });

      res.json({ success: true });
    } catch (err) {
      console.error("[agents] codex/oauth/exchange error:", err);
      res.status(500).json({ success: false, error: "Codex login exchange failed" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Agent-level Codex model list — mirror of `/settings/codex/models` but reads
// the agent-scoped credential. ChatGPT OAuth tokens cannot hit OpenAI's
// `/v1/models` (missing `api.model.read` scope, returns 403); Codex CLI works
// around this by calling the ChatGPT backend's `/codex/models` endpoint with
// `originator=codex_cli_rs`, which IS authorized for ChatGPT tokens and
// returns the exact model picker list (gpt-5.5, gpt-5.4, gpt-5.3-codex, etc.).
// API-key mode uses the standard Platform `/v1/models`.
// ─────────────────────────────────────────────────────────────────────────────

const AGENT_CODEX_CHATGPT_BACKEND = "https://chatgpt.com/backend-api";

interface AgentCodexBackendModel {
  slug: string;
  display_name?: string;
  visibility?: string;
  priority?: number;
}

function decodeAgentChatgptAccountId(jwt: string): string | undefined {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3 || !parts[1]) return undefined;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as Record<string, unknown>;
    const auth = payload["https://api.openai.com/auth"] as Record<string, unknown> | undefined;
    const accountId = auth?.["chatgpt_account_id"];
    return typeof accountId === "string" ? accountId : undefined;
  } catch {
    return undefined;
  }
}

router.get(
  "/:slug/provider-credentials/codex/models",
  requireAgentOwnerOrAdmin,
  async (req: Request<{ slug: string }>, res: Response) => {
    try {
      const agent = req.agentContext!.agent;
      const cred = await agentProviderCredentialsRepository.findByAgentAndProvider(agent.id, "codex");
      if (!cred?.encryptedKey || !cred.iv || !cred.authTag) {
        res.status(400).json({ success: false, error: "Codex is not configured on this agent. Sign in or save an API key first." });
        return;
      }

      const decrypted = decrypt(cred.encryptedKey, cred.iv, cred.authTag, CONFIG.encryptionKey);
      const apiKey = extractCodexBearer(decrypted);
      const isOauth = cred.authType === "oauth_token";

      const url = isOauth
        ? `${AGENT_CODEX_CHATGPT_BACKEND}/codex/models?client_version=0.0.0`
        : `${(cred.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "")}/models`;

      const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
      if (isOauth) {
        headers["originator"] = "codex_cli_rs";
        headers["User-Agent"] = "codex_cli_rs/0.0.0 (xyne-claw-auth)";
        const accountId = decodeAgentChatgptAccountId(apiKey);
        if (accountId) headers["ChatGPT-Account-Id"] = accountId;
      } else {
        headers["User-Agent"] = "codex-cli";
      }

      const upstream = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
      if (!upstream.ok) {
        const text = await upstream.text().catch(() => "");
        res.status(502).json({ success: false, error: `Models endpoint ${upstream.status}: ${text.slice(0, 200)}` });
        return;
      }

      if (isOauth) {
        const body = (await upstream.json()) as { models?: AgentCodexBackendModel[] };
        const data = body.models ?? [];
        const models = data
          .filter((m) => m.slug)
          .filter((m) => m.visibility !== "hide" && m.visibility !== "none")
          .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
          .map((m) => ({ id: m.slug, name: m.display_name ?? m.slug }));
        res.json({ success: true, data: models });
        return;
      }

      const body = (await upstream.json()) as { data?: Array<{ id?: string }> };
      const models = (body.data ?? [])
        .filter((m): m is { id: string } => Boolean(m.id))
        .filter((m) => /^(gpt-|o\d|chatgpt-)/i.test(m.id))
        .map((m) => ({ id: m.id, name: m.id }));
      res.json({ success: true, data: models });
    } catch (err) {
      console.error("[agents] codex/models error:", err);
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Failed to fetch models" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Agent-level provider credentials
//
// Shared API keys (Codex sub, team Anthropic key, OpenRouter, etc.) configured
// at the AGENT level. Used as the fallback when a user runs the agent without
// their own personal provider in Settings → Providers.
//
// Permission model:
//   - Write (POST/PATCH/DELETE) → AGENT_OWNER or admin (requireAgentOwnerOrAdmin)
//   - Read status (GET — never the decrypted key) → OWNER / CONTRIBUTOR / admin
//     (requireAgentOwnerContributorOrAdmin)
//   - The decrypted apiKey is NEVER returned by any endpoint; it is only ever
//     decrypted in-process at dispatch time (webhook.ts / agent-chat.ts) and
//     forwarded to xyne-claw inside the /run payload.
//
// Resolution precedence at session dispatch (see webhook.ts ≈ line 962):
//   1. user's personal provider (userAgentConfig + userProviderCredentials)
//   2. agent-level provider (agent.config.provider + THIS TABLE)
//   3. "spaces" / LiteLLM platform default
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_PROVIDERS = new Set(["copilot", "claude", "codex", "openrouter"]);

router.get(
  "/:slug/provider-credentials",
  requireAgentOwnerContributorOrAdmin,
  async (req: Request<{ slug: string }>, res: Response) => {
    try {
      const agent = req.agentContext!.agent;
      const rows = await agentProviderCredentialsRepository.listByAgent(agent.id);
      // Return STATUS only — provider/model/baseUrl/authType + metadata.
      // Never echo encryptedKey, iv, or authTag.
      res.json({
        success: true,
        data: {
          providers: rows.map((r) => ({
            provider: r.provider,
            model: r.model ?? null,
            baseUrl: r.baseUrl ?? null,
            authType: r.authType ?? null,
            reasoningEffort: r.reasoningEffort ?? null,
            configured: Boolean(r.encryptedKey && r.iv && r.authTag),
            createdByUserId: r.createdByUserId ?? null,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          })),
        },
      });
    } catch (err) {
      console.error("[agents] list provider-credentials error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

router.post(
  "/:slug/provider-credentials",
  requireAgentOwnerOrAdmin,
  async (req: Request<{ slug: string }>, res: Response) => {
    try {
      const agent = req.agentContext!.agent;
      const requesterId = getRequesterId(req);
      const body = req.body as {
        provider?: string;
        apiKey?: string;
        model?: string;
        baseUrl?: string;
        authType?: string;
        reasoningEffort?: string | null;
      };

      const provider = (body.provider ?? "").trim();
      const apiKey = (body.apiKey ?? "").trim();
      const model = (body.model ?? "").trim() || null;
      const baseUrl = (body.baseUrl ?? "").trim() || null;
      const authType = (body.authType ?? "").trim() || null;
      const rawEffort = typeof body.reasoningEffort === "string" ? body.reasoningEffort.trim() : body.reasoningEffort;
      let reasoningEffort: string | null;
      if (rawEffort === undefined || rawEffort === null || rawEffort === "") {
        reasoningEffort = null;
      } else if (rawEffort !== "low" && rawEffort !== "medium" && rawEffort !== "high") {
        res.status(400).json({ success: false, error: "reasoningEffort must be 'low', 'medium', or 'high'" });
        return;
      } else {
        reasoningEffort = rawEffort;
      }

      if (!provider || !ALLOWED_PROVIDERS.has(provider)) {
        res.status(400).json({
          success: false,
          error: `provider must be one of: ${[...ALLOWED_PROVIDERS].join(", ")}`,
        });
        return;
      }
      if (authType && authType !== "api_key" && authType !== "oauth_token") {
        res.status(400).json({ success: false, error: "authType must be 'api_key' or 'oauth_token'" });
        return;
      }

      const existing = await agentProviderCredentialsRepository.findByAgentAndProvider(agent.id, provider);

      // Allow model-only / baseUrl-only updates when the credential already
      // exists (no apiKey supplied). The OAuth flow saves the bundle first
      // with no model, then the UI calls back with the chosen model from the
      // dropdown — we must not require apiKey for that follow-up update.
      if (!apiKey && !existing) {
        res.status(400).json({ success: false, error: "apiKey is required for the first save" });
        return;
      }

      if (apiKey) {
        const { ciphertext, iv, authTag } = encrypt(apiKey, CONFIG.encryptionKey);
        await agentProviderCredentialsRepository.upsert(agent.id, provider, {
          encryptedKey: ciphertext,
          iv,
          authTag,
          model,
          baseUrl,
          authType,
          reasoningEffort,
          ...(requesterId ? { createdByUserId: requesterId } : {}),
        });
      } else {
        // Update metadata only — preserve the existing encrypted bundle, iv,
        // authTag, and (where unspecified) authType. Useful for: pick model
        // from dropdown after OAuth, rename baseUrl, etc.
        await agentProviderCredentialsRepository.upsert(agent.id, provider, {
          encryptedKey: existing!.encryptedKey,
          iv: existing!.iv,
          authTag: existing!.authTag,
          model,
          baseUrl: baseUrl ?? existing!.baseUrl,
          authType: authType ?? existing!.authType,
          reasoningEffort: rawEffort === undefined ? existing!.reasoningEffort : reasoningEffort,
          ...(requesterId ? { createdByUserId: requesterId } : {}),
        });
      }

      await writeAuditLog({
        ...(requesterId ? { actorUserId: requesterId } : {}),
        eventType: "AGENT_SHARED", // closest existing enum — TODO: AGENT_PROVIDER_CRED_SET
        targetId: agent.id,
        description: `${existing ? "Updated" : "Set"} ${provider} provider credentials on agent "${agent.slug}" (model=${model ?? "default"}, authType=${authType ?? "api_key"})`,
      });

      res.status(existing ? 200 : 201).json({
        success: true,
        data: {
          provider,
          model,
          baseUrl,
          authType,
          reasoningEffort: rawEffort === undefined ? existing?.reasoningEffort ?? null : reasoningEffort,
          configured: true,
        },
      });
    } catch (err) {
      console.error("[agents] set provider-credentials error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

router.delete(
  "/:slug/provider-credentials/:provider",
  requireAgentOwnerOrAdmin,
  async (req: Request<{ slug: string; provider: string }>, res: Response) => {
    try {
      const agent = req.agentContext!.agent;
      const requesterId = getRequesterId(req);
      const provider = req.params.provider;

      if (!ALLOWED_PROVIDERS.has(provider)) {
        res.status(400).json({ success: false, error: "invalid provider" });
        return;
      }

      try {
        await agentProviderCredentialsRepository.delete(agent.id, provider);
      } catch (err) {
        // Prisma throws P2025 when the row doesn't exist — treat as idempotent 404.
        const code = (err as { code?: string } | undefined)?.code;
        if (code === "P2025") {
          res.status(404).json({ success: false, error: "no credentials configured for that provider" });
          return;
        }
        throw err;
      }

      await writeAuditLog({
        ...(requesterId ? { actorUserId: requesterId } : {}),
        eventType: "AGENT_SHARED", // closest existing enum — TODO: AGENT_PROVIDER_CRED_DELETED
        targetId: agent.id,
        description: `Deleted ${provider} provider credentials from agent "${agent.slug}"`,
      });

      res.json({ success: true });
    } catch (err) {
      console.error("[agents] delete provider-credentials error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

export { router as agentsRouter };
