import { Router, type Request, type Response } from "express";
import { skillRepository, agentRequestRepository } from "../repositories/index.js";
import { getRequesterId, getOrgId, isClawAdmin, requireClawAdmin } from "../middleware/agent-acl.js";
import { writeAuditLog } from "../lib/audit.js";

import { createLogger } from "../logger.js";
const log = createLogger("skills");

const router = Router();

// List skills: global + user's own personal skills (admins see ALL)
router.get("/", async (req: Request, res: Response) => {
  try {
    const scopeUserId = (req.query["userId"] as string | undefined) ?? undefined;
    const authedUserId = String(req.headers["x-user-id"] ?? "");
    const admin = authedUserId ? await isClawAdmin(authedUserId) : false;
    // Gate the admin "see ALL (incl. others' private)" bypass behind ?scope=all,
    // mirroring GET /agents. Without this an admin's normal skill list leaks
    // every user's private skills (the same regression agents.ts already fixed).
    const wantAllSkills = req.query["scope"] === "all";
    const listOrgId = getOrgId(req);
    const skills = await skillRepository.listVisible({
      ...(scopeUserId ? { userId: scopeUserId } : {}),
      ...(listOrgId ? { orgId: listOrgId } : {}),
      isAdmin: admin && wantAllSkills,
    });
    res.json({ success: true, data: skills });
  } catch (err) {
    log.error("[skills] list error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Get a single skill by slug
router.get("/:slug", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    // Phase-2: org-scope this read (global fallback while slug is globally unique).
    const skill = await skillRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!skill) {
      log.warn(`[skills/get] skill org-scoped miss slug=${req.params.slug} orgId=${getOrgId(req) ?? "none"} userId=${getRequesterId(req) ?? "none"}`);
      res.status(404).json({ success: false, error: "Skill not found" });
      return;
    }
    res.json({ success: true, data: skill });
  } catch (err) {
    log.error("[skills] get error:", err);
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

    const orgId = getOrgId(req);
    if (!orgId) {
      log.warn(`[skills/create] orgId is required requesterId=${getRequesterId(req) ?? "none"} slug=${cleanSlug} source=${source ?? "none"}`);
      res.status(400).json({ success: false, error: "orgId is required" });
      return;
    }

    const existing = await skillRepository.findBySlug(cleanSlug, orgId);
    if (existing) {
      res.status(409).json({ success: false, error: "A skill with this slug already exists" });
      return;
    }

    const requesterId = getRequesterId(req);
    // Note: removed the `isClawAdmin` lookup here. It was only used to
    // decide create-time scope ("admin → global, everyone else →
    // personal"). Now everyone gets `personal` at create; admins who
    // want global can call POST /skills/:slug/promote separately. Saves
    // one DB query per skill create.

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
      // Always create at personal scope. Previously admins got a silent
      // auto-promotion to "global" on create — that bypassed the
      // publish-review flow entirely, so the Publish button in the UI
      // never appeared for their own skills (it correctly hides for
      // already-global skills). Admins who want to skip review can
      // still use POST /skills/:slug/promote after create — one click,
      // explicit intent, and the UI now matches what non-admins see.
      scope: "personal",
      ...(requesterId ? { owner: { connect: { id: requesterId } } } : {}),
      // Phase-2: stamp the creating org.
      org: { connect: { id: orgId } },
    });

    res.status(201).json({ success: true, data: skill });
  } catch (err) {
    log.error("[skills] create error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Update a skill (owner or admin)
router.put("/:slug", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const existing = await skillRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!existing) {
      log.warn(`[skills/update] skill org-scoped miss slug=${req.params.slug} orgId=${getOrgId(req) ?? "none"} userId=${getRequesterId(req) ?? "none"}`);
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

    const skill = await skillRepository.update(req.params.slug, existing.orgId, data);
    res.json({ success: true, data: skill });
  } catch (err) {
    log.error("[skills] update error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Delete a skill (owner or admin)
router.delete("/:slug", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const existing = await skillRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!existing) {
      log.warn(`[skills/delete] skill org-scoped miss slug=${req.params.slug} orgId=${getOrgId(req) ?? "none"} userId=${getRequesterId(req) ?? "none"}`);
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

    await skillRepository.delete(req.params.slug, existing.orgId);
    res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2025") {
      res.status(404).json({ success: false, error: "Skill not found" });
      return;
    }
    log.error("[skills] delete error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Promote skill to global (admin only)
router.post("/:slug/promote", requireClawAdmin, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req)!;
    const skill = await skillRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!skill) { log.warn(`[skills/promote] skill org-scoped miss slug=${req.params.slug} orgId=${getOrgId(req) ?? "none"} userId=${requesterId}`); res.status(404).json({ success: false, error: "Skill not found" }); return; }
    if (skill.scope === "global") { res.status(400).json({ success: false, error: "Skill is already global" }); return; }

    const updated = await skillRepository.update(req.params.slug, skill.orgId, { scope: "global", promotedBy: requesterId, promotedAt: new Date() });

    await writeAuditLog({
      actorUserId: requesterId,
      eventType: "AGENT_PROMOTED",
      targetId: skill.id,
      description: `Skill "${skill.name}" (${skill.slug}) promoted to global`,
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    log.error("[skills] promote error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Demote skill to personal (admin only)
router.post("/:slug/demote", requireClawAdmin, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req)!;
    const skill = await skillRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!skill) { log.warn(`[skills/demote] skill org-scoped miss slug=${req.params.slug} orgId=${getOrgId(req) ?? "none"} userId=${requesterId}`); res.status(404).json({ success: false, error: "Skill not found" }); return; }
    if (skill.scope !== "global") { res.status(400).json({ success: false, error: "Skill is not global" }); return; }

    const updated = await skillRepository.update(req.params.slug, skill.orgId, { scope: "personal", promotedBy: null, promotedAt: null });

    await writeAuditLog({
      actorUserId: requesterId,
      eventType: "AGENT_DEMOTED",
      targetId: skill.id,
      description: `Skill "${skill.name}" (${skill.slug}) demoted to personal`,
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    log.error("[skills] demote error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Request to push skill to global (owner only)
router.post("/:slug/request", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) { res.status(401).json({ success: false, error: "x-user-id required" }); return; }

    const skill = await skillRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!skill) { log.warn(`[skills/request] skill org-scoped miss slug=${req.params.slug} orgId=${getOrgId(req) ?? "none"} userId=${requesterId}`); res.status(404).json({ success: false, error: "Skill not found" }); return; }
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
      orgId: skill.orgId,
    });

    await writeAuditLog({
      actorUserId: requesterId,
      eventType: "REQUEST_CREATED",
      targetId: skill.id,
      description: `push_to_global request for skill "${skill.name}"`,
    });

    res.status(201).json({ success: true, data: request });
  } catch (err) {
    log.error("[skills] request error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Skill files (directory uploads) ──────────────────────────────────
//
// Each Skill row's `content` field is the canonical SKILL.md body. Sibling
// files (scripts, examples, assets) live in the SkillFile table and are
// materialized into the session workspace at run start alongside SKILL.md.
//
// Upload model:
//   POST /skills/:slug/files
//   Body: { files: [{ relativePath, content, contentType? }] }
//   Semantics: REPLACES the entire SkillFile set for this skill atomically.
//   "SKILL.md" is rejected — that file is owned by Skill.content.
//
// Per-file size cap = 1 MB; total bundle cap = 5 MB. Content is treated as
// UTF-8 text (the existing `Skill.content` field is text); for binaries
// upstream should base64-encode and set contentType.

const MAX_FILE_BYTES = 1_000_000;       // 1 MB per file
const MAX_BUNDLE_BYTES = 5_000_000;     // 5 MB total per skill

router.get("/:slug/files", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const skill = await skillRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!skill) {
      log.warn(`[skills/files] skill org-scoped miss slug=${req.params.slug} orgId=${getOrgId(req) ?? "none"} userId=${getRequesterId(req) ?? "none"}`);
      res.status(404).json({ success: false, error: "Skill not found" });
      return;
    }
    const files = await skillRepository.listFiles(skill.id);
    res.json({
      success: true,
      data: files.map((f) => ({
        id: f.id,
        relativePath: f.relativePath,
        contentType: f.contentType,
        sizeBytes: f.sizeBytes,
        createdAt: f.createdAt,
      })),
    });
  } catch (err) {
    log.error("[skills] list files error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.get("/:slug/files/:fileId", async (req: Request<{ slug: string; fileId: string }>, res: Response) => {
  try {
    const skill = await skillRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!skill) {
      log.warn(`[skills/file] skill org-scoped miss slug=${req.params.slug} orgId=${getOrgId(req) ?? "none"} fileId=${req.params.fileId} userId=${getRequesterId(req) ?? "none"}`);
      res.status(404).json({ success: false, error: "Skill not found" });
      return;
    }
    const files = await skillRepository.listFiles(skill.id);
    const file = files.find((f) => f.id === req.params.fileId);
    if (!file) {
      res.status(404).json({ success: false, error: "File not found" });
      return;
    }
    res.json({
      success: true,
      data: {
        id: file.id,
        relativePath: file.relativePath,
        content: file.content,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
      },
    });
  } catch (err) {
    log.error("[skills] get file error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.put("/:slug/files", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "x-user-id header is required" });
      return;
    }
    const skill = await skillRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!skill) {
      log.warn(`[skills/upsert-files] skill org-scoped miss slug=${req.params.slug} orgId=${getOrgId(req) ?? "none"} userId=${requesterId}`);
      res.status(404).json({ success: false, error: "Skill not found" });
      return;
    }
    // ACL: owner of a personal skill, OR admin (for any skill).
    const admin = await isClawAdmin(requesterId);
    if (!admin) {
      if (skill.scope !== "personal" || skill.ownerUserId !== requesterId) {
        res.status(403).json({
          success: false,
          error: "Only the skill owner or a CLAW_ADMIN can update files",
        });
        return;
      }
    }

    const body = req.body as { files?: Array<{ relativePath?: string; content?: string; contentType?: string }> };
    const rawFiles = Array.isArray(body.files) ? body.files : [];

    // Validate before touching the DB so a bad payload doesn't half-replace.
    let totalBytes = 0;
    const sanitized: Array<{ relativePath: string; content: string; contentType?: string }> = [];
    for (const f of rawFiles) {
      if (typeof f?.content !== "string") {
        res.status(400).json({ success: false, error: "each file must have a string `content`" });
        return;
      }
      const bytes = Buffer.byteLength(f.content, "utf8");
      if (bytes > MAX_FILE_BYTES) {
        res.status(413).json({ success: false, error: `${f.relativePath ?? "(file)"} exceeds the ${MAX_FILE_BYTES}-byte per-file limit` });
        return;
      }
      totalBytes += bytes;
      sanitized.push({
        relativePath: String(f.relativePath ?? ""),
        content: f.content,
        ...(f.contentType ? { contentType: String(f.contentType) } : {}),
      });
    }
    if (totalBytes > MAX_BUNDLE_BYTES) {
      res.status(413).json({ success: false, error: `total bundle exceeds the ${MAX_BUNDLE_BYTES}-byte limit` });
      return;
    }

    try {
      await skillRepository.replaceFiles(skill.id, sanitized);
    } catch (err) {
      res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
      return;
    }

    const files = await skillRepository.listFiles(skill.id);
    res.json({
      success: true,
      data: files.map((f) => ({
        id: f.id,
        relativePath: f.relativePath,
        contentType: f.contentType,
        sizeBytes: f.sizeBytes,
      })),
    });
  } catch (err) {
    log.error("[skills] replace files error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

void requireClawAdmin;

export { router as skillsRouter };
