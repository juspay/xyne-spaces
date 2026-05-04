import { Router, type Request, type Response } from "express";
import { skillRepository, agentRequestRepository } from "../repositories/index.js";
import { getRequesterId, isClawAdmin, requireClawAdmin } from "../middleware/agent-acl.js";
import { writeAuditLog } from "../lib/audit.js";

const router = Router();

// List skills: global + user's own personal skills
router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = req.query["userId"] as string | undefined;
    const skills = await skillRepository.listVisible(userId);
    res.json({ success: true, data: skills });
  } catch (err) {
    console.error("[skills] list error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Get a single skill by slug
router.get("/:slug", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const skill = await skillRepository.findBySlug(req.params.slug);
    if (!skill) {
      res.status(404).json({ success: false, error: "Skill not found" });
      return;
    }
    res.json({ success: true, data: skill });
  } catch (err) {
    console.error("[skills] get error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Create a new skill (personal by default, admins can create global)
router.post("/", async (req: Request, res: Response) => {
  try {
    const { slug, name, description, content, source } = req.body as {
      slug?: string;
      name?: string;
      description?: string;
      content?: string;
      source?: string;
    };

    if (!slug || !content) {
      res.status(400).json({ success: false, error: "slug and content are required" });
      return;
    }
    const cleanSlug = slug.trim();
    if (!/^[a-z0-9-]+$/.test(cleanSlug) || cleanSlug.startsWith("-") || cleanSlug.endsWith("-") || cleanSlug.includes("--")) {
      res.status(400).json({ success: false, error: "slug must match ^[a-z0-9-]+$ (no leading/trailing/consecutive hyphens)" });
      return;
    }

    const existing = await skillRepository.findBySlug(cleanSlug);
    if (existing) {
      res.status(409).json({ success: false, error: "A skill with this slug already exists" });
      return;
    }

    const requesterId = getRequesterId(req);
    const admin = requesterId ? await isClawAdmin(requesterId) : false;

    // Derive `name` from slug if not provided (UI no longer asks for it; the
    // worker reads pi-format frontmatter from `content` if present).
    const resolvedName = name?.trim()
      || cleanSlug.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");

    const skill = await skillRepository.create({
      slug: cleanSlug,
      name: resolvedName,
      description: description?.trim() ?? "",
      content: content.trim(),
      source: source?.trim() ?? "user-created",
      scope: admin ? "global" : "personal",
      ...(requesterId ? { owner: { connect: { id: requesterId } } } : {}),
    });

    res.status(201).json({ success: true, data: skill });
  } catch (err) {
    console.error("[skills] create error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Update a skill (owner or admin)
router.put("/:slug", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const existing = await skillRepository.findBySlug(req.params.slug);
    if (!existing) {
      res.status(404).json({ success: false, error: "Skill not found" });
      return;
    }

    const requesterId = getRequesterId(req);
    if (requesterId) {
      const admin = await isClawAdmin(requesterId);
      const isOwner = existing.ownerUserId === requesterId;
      if (!admin && !isOwner) {
        res.status(403).json({ success: false, error: "Only the owner or admins can edit this skill" });
        return;
      }
    }

    const { name, description, content, enabled } = req.body as {
      name?: string;
      description?: string;
      content?: string;
      enabled?: boolean;
    };

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name.trim();
    if (description !== undefined) data.description = description.trim();
    if (content !== undefined) data.content = content.trim();
    if (enabled !== undefined) data.enabled = enabled;

    const skill = await skillRepository.update(req.params.slug, data);
    res.json({ success: true, data: skill });
  } catch (err) {
    console.error("[skills] update error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Delete a skill (owner or admin)
router.delete("/:slug", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const existing = await skillRepository.findBySlug(req.params.slug);
    if (!existing) {
      res.status(404).json({ success: false, error: "Skill not found" });
      return;
    }

    const requesterId = getRequesterId(req);
    if (requesterId) {
      const admin = await isClawAdmin(requesterId);
      const isOwner = existing.ownerUserId === requesterId;
      if (!admin && !isOwner) {
        res.status(403).json({ success: false, error: "Only the owner or admins can delete this skill" });
        return;
      }
    }

    await skillRepository.delete(req.params.slug);
    res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2025") {
      res.status(404).json({ success: false, error: "Skill not found" });
      return;
    }
    console.error("[skills] delete error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Promote skill to global (admin only)
router.post("/:slug/promote", requireClawAdmin, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req)!;
    const skill = await skillRepository.findBySlug(req.params.slug);
    if (!skill) { res.status(404).json({ success: false, error: "Skill not found" }); return; }
    if (skill.scope === "global") { res.status(400).json({ success: false, error: "Skill is already global" }); return; }

    const updated = await skillRepository.update(req.params.slug, { scope: "global", promotedBy: requesterId, promotedAt: new Date() });

    await writeAuditLog({
      actorUserId: requesterId,
      eventType: "AGENT_PROMOTED",
      targetId: skill.id,
      description: `Skill "${skill.name}" (${skill.slug}) promoted to global`,
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error("[skills] promote error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Demote skill to personal (admin only)
router.post("/:slug/demote", requireClawAdmin, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req)!;
    const skill = await skillRepository.findBySlug(req.params.slug);
    if (!skill) { res.status(404).json({ success: false, error: "Skill not found" }); return; }
    if (skill.scope !== "global") { res.status(400).json({ success: false, error: "Skill is not global" }); return; }

    const updated = await skillRepository.update(req.params.slug, { scope: "personal", promotedBy: null, promotedAt: null });

    await writeAuditLog({
      actorUserId: requesterId,
      eventType: "AGENT_DEMOTED",
      targetId: skill.id,
      description: `Skill "${skill.name}" (${skill.slug}) demoted to personal`,
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error("[skills] demote error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Request to push skill to global (owner only)
router.post("/:slug/request", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) { res.status(401).json({ success: false, error: "x-user-id required" }); return; }

    const skill = await skillRepository.findBySlug(req.params.slug);
    if (!skill) { res.status(404).json({ success: false, error: "Skill not found" }); return; }
    if (skill.ownerUserId !== requesterId) { res.status(403).json({ success: false, error: "Only the owner can request this" }); return; }
    if (skill.scope === "global") { res.status(400).json({ success: false, error: "Skill is already global" }); return; }

    // Check for existing pending request
    const existing = await agentRequestRepository.findPendingSkill(skill.id);
    if (existing) { res.status(409).json({ success: false, error: "A pending request already exists" }); return; }

    const request = await agentRequestRepository.create({
      targetType: "skill",
      skillId: skill.id,
      skillSlug: skill.slug,
      requestType: "push_to_global",
      requesterId,
    });

    await writeAuditLog({
      actorUserId: requesterId,
      eventType: "REQUEST_CREATED",
      targetId: skill.id,
      description: `push_to_global request for skill "${skill.name}"`,
    });

    res.status(201).json({ success: true, data: request });
  } catch (err) {
    console.error("[skills] request error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export { router as skillsRouter };
