import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { skillRepository, agentRequestRepository, userRepository } from "../repositories/index.js";
import { getRequesterId, getOrgId, isClawAdmin, requireClawAdmin, getAgentEditAccess } from "../middleware/agent-acl.js";
import { writeAuditLog } from "../lib/audit.js";
import { getWorkspaceIdForUser } from "../lib/spaces-db.js";
import { decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { spacesAppFetch } from "../lib/spaces-api.js";
import {
  normalizeSkillContent,
  hashSkillContent,
  computeSkillDiff,
  type SkillDiff,
  resolveSkillUpdateApprover,
  authorizeSkillUpdateApproval,
  buildSkillUpdateApprovalFlow,
} from "xyne-claw-shared";

import { createLogger } from "../logger.js";
const log = createLogger("skills");

const router = Router();

/**
 * R1: may the proposer's chosen agent post the approval DM under that agent's
 * Spaces bot identity? Allowed only when the requester is genuinely entitled to
 * act as it — its owner or a contributor (EDITOR/CONTRIBUTOR share) — or when it
 * is a shared global agent any org member may use. `access` is the ORG-SCOPED
 * result of getAgentEditAccess (null ⇒ cross-org, another user's private agent,
 * or unknown slug ⇒ never allowed). Type guard so the caller narrows to non-null.
 */
export function canProposerPostAsAgent<T extends { canEdit: boolean; agent: { scope: string } }>(
  access: T | null | undefined,
): access is T {
  return !!access && (access.canEdit || access.agent.scope === "global");
}

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


// ── Skill-update proposal + owner-approval ───────────────────────────────────
// The `update-skill` tool cannot self-apply: an agent-authored change must be
// approved by the skill's OWNER (personal) or an admin (global). This mirrors
// the agent clone-approval flow — a request row + a DM card carrying only the
// requestId, with the diff/content held server-side.

/**
 * DM the skill's approver a card showing ONLY the diff. Best-effort; posted with
 * the PROPOSER's agent Spaces credentials (agentSlug), like the clone notifier.
 */
async function notifyApproverOfSkillUpdateInSpaces(args: {
  approverUserId: string;
  requestId: string;
  skillSlug: string;
  skillName: string;
  proposerName: string;
  diff: SkillDiff;
  summary?: string | null;
  // R1: a pre-validated agent object resolved from TRUSTED context by the
  // caller (org-scoped + authorization-checked). Never re-looked-up from a
  // body-supplied slug in here — mirrors notifyOwnerOfCloneRequestInSpaces,
  // which is handed the resource agent resolved from the trusted URL param.
  agent: {
    slug: string;
    spacesAppId: string | null;
    spacesAppToken: string | null;
    spacesAppUserId: string | null;
  };
}): Promise<void> {
  try {
    const { agent } = args;
    if (!agent.spacesAppId || !agent.spacesAppToken || !agent.spacesAppUserId) {
      log.info(`[skills/propose-update] owner DM skipped for ${args.skillSlug}: agent ${agent.slug} not Spaces-registered`);
      return;
    }
    const [ciphertext, iv, authTag] = agent.spacesAppToken.split(":");
    if (!ciphertext || !iv || !authTag) return;
    const token = decrypt(ciphertext, iv, authTag, CONFIG.encryptionKey);

    const workspaceId = (await getWorkspaceIdForUser(args.approverUserId, "skill-update-owner-dm")) ?? "";
    if (!workspaceId) {
      log.warn(`[skills/propose-update] owner DM skipped for ${args.skillSlug}: no workspaceId for approver ${args.approverUserId}`);
      return;
    }
    const dm = (await spacesAppFetch("/channel/openDm", {
      targetUserId: args.approverUserId,
      workspaceId,
    }, token)) as { channelId: string };

    const flow = buildSkillUpdateApprovalFlow({
      requestId: args.requestId,
      approverUserId: args.approverUserId,
      skillSlug: args.skillSlug,
      skillName: args.skillName,
      proposerName: args.proposerName,
      diff: args.diff,
      ...(args.summary ? { summary: args.summary } : {}),
      agentSlug: agent.slug,
      spacesAppId: agent.spacesAppId,
      spacesBaseUrl: CONFIG.spacesAppUrl,
    });

    await spacesAppFetch("/chat/postMessage", {
      channelId: dm.channelId,
      flow,
      userId: agent.spacesAppUserId,
    }, token);
    log.info(`[skills/propose-update] sent skill-update DM to approver ${args.approverUserId} for ${args.skillSlug}`);
  } catch (err) {
    log.warn(`[skills/propose-update] owner DM failed for ${args.skillSlug}:`, err instanceof Error ? err.message : String(err));
  }
}

// POST /skills/:slug/propose-update — the update-skill tool proposes a full
// replacement. Validates requester + org, computes the diff, records a
// skill_update AgentRequest, and DMs the approver the diff. Never applies here.
router.post("/:slug/propose-update", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) { res.status(401).json({ success: false, error: "x-user-id required" }); return; }
    const orgId = getOrgId(req);
    if (!orgId) { res.status(400).json({ success: false, error: "orgId is required" }); return; }

    const { content: rawContent, edits, summary, agentSlug } = req.body as {
      content?: string;
      edits?: Array<{ oldText?: string; newText?: string }>;
      summary?: string;
      agentSlug?: string;
    };

    const skill = await skillRepository.findBySlug(req.params.slug, orgId);
    if (!skill) { res.status(404).json({ success: false, error: "Skill not found" }); return; }

    // ── Construct the proposed content ────────────────────────────────────
    // PATCH MODE (preferred, 2026-07-15): anchored {oldText,newText} edits
    // applied server-side to the CURRENT content. Tool arguments then scale
    // with the CHANGE, not the file — a full body does NOT survive as one
    // LLM tool argument (output-token truncation silently destroyed a
    // 318-rule skill today). Full-replacement `content` stays only for small
    // skills, where truncation cannot occur.
    const FULL_REPLACEMENT_MAX_CHARS = 8_000;
    let content: string;
    if (Array.isArray(edits) && edits.length > 0) {
      let working = normalizeSkillContent(skill.content);
      for (const [i, e] of edits.entries()) {
        const oldText = typeof e?.oldText === "string" ? e.oldText : "";
        const newText = typeof e?.newText === "string" ? e.newText : "";
        if (!oldText) { res.status(400).json({ success: false, error: `edits[${i}].oldText is required` }); return; }
        const first = working.indexOf(oldText);
        if (first === -1) {
          res.status(400).json({ success: false, error: `edits[${i}].oldText not found in the current skill — copy it EXACTLY (read the skill first; it may have changed since you read it).` });
          return;
        }
        if (working.indexOf(oldText, first + 1) !== -1) {
          res.status(400).json({ success: false, error: `edits[${i}].oldText matches more than once — include more surrounding context to make it unique.` });
          return;
        }
        working = working.slice(0, first) + newText + working.slice(first + oldText.length);
      }
      content = working;
    } else if (rawContent && rawContent.trim()) {
      if (normalizeSkillContent(skill.content).length > FULL_REPLACEMENT_MAX_CHARS) {
        res.status(400).json({
          success: false,
          error: `This skill is ${skill.content.length} chars — too large for full-replacement mode (tool arguments get truncated and would destroy it). Use \`edits\` ({oldText, newText} anchored replacements) instead.`,
        });
        return;
      }
      content = rawContent;
    } else {
      res.status(400).json({ success: false, error: "Provide `edits` (preferred) or `content`." });
      return;
    }

    // Hard shrink guard: a proposal that deletes most of the skill is almost
    // always a truncated "full replacement", never an intentional edit —
    // reject rather than warn (the card also warns for smaller shrinks).
    const baseLen = normalizeSkillContent(skill.content).length;
    const newLen = normalizeSkillContent(content).length;
    if (baseLen > 2_000 && newLen < baseLen * 0.6) {
      res.status(400).json({
        success: false,
        error: `Proposed content is ${newLen} chars vs the current ${baseLen} — it removes over 40% of the skill. If this is intentional, make the deletions via explicit \`edits\` so the diff shows exactly what is removed.`,
      });
      return;
    }

    // Route the approval: personal → owner, global → admin (notify owner/promoter).
    const approver = resolveSkillUpdateApprover({
      scope: skill.scope === "global" ? "global" : "personal",
      ownerUserId: skill.ownerUserId ?? null,
      promotedBy: skill.promotedBy ?? null,
    });
    if (!approver.ok || !approver.approverUserId) {
      res.status(409).json({ success: false, error: "This skill has no owner or admin to approve an update." });
      return;
    }

    // No-op guard: reject an update identical to the current content (409).
    const diff = computeSkillDiff(skill.content, content);
    if (!diff.hasChanges) {
      res.status(409).json({ success: false, error: "Your update is identical to the current skill — nothing to propose." });
      return;
    }

    const baseContentHash = hashSkillContent(skill.content);
    const proposedContentHash = hashSkillContent(content);

    // One pending proposal per (skill, proposer) — enforced by the partial
    // unique index `agent_requests_pending_skill_update_uniq`. A re-propose
    // SUPERSEDES the proposer's stale pending row instead of 409ing: the
    // proposer has no way to withdraw a queued proposal, so a plain 409
    // deadlocked the slot until the owner declined the old card by hand
    // (2026-07-16, xyne-spaces-review-guidelines). The stale card resolves to
    // "already handled" via the pending-only claim.
    let request: Awaited<ReturnType<typeof agentRequestRepository.supersedeAndCreateSkillUpdate>>["request"];
    let supersededCount = 0;
    try {
      const outcome = await agentRequestRepository.supersedeAndCreateSkillUpdate({
        skillId: skill.id,
        skillSlug: skill.slug,
        requesterId,
        orgId,
        proposedContent: normalizeSkillContent(content),
        baseContentHash,
        proposedContentHash,
        requestNote: summary?.trim() || null,
      });
      request = outcome.request;
      supersededCount = outcome.supersededCount;
      if (supersededCount > 0) {
        log.info(`[skills/propose-update] superseded ${supersededCount} stale pending proposal(s) for ${skill.slug} by ${requesterId}`);
      }
    } catch (err) {
      // Two concurrent proposals from the same proposer: both supersede zero
      // rows, one create loses on the unique index. The winner's proposal is
      // live, so this is a duplicate submission, not a deadlock.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        res.status(409).json({ success: false, error: "A proposal you just submitted for this skill is already pending — this looks like a duplicate. Propose again if this version was different." });
        return;
      }
      throw err;
    }

    await writeAuditLog({
      actorUserId: requesterId,
      eventType: "REQUEST_CREATED",
      targetId: skill.id,
      description: `skill_update request for "${skill.name}" (${skill.slug})`,
    });

    // R1: resolve + AUTHORIZE the posting agent from trusted context before
    // using its Spaces bot identity to DM the approver. The DM is sent AS this
    // agent, so the requester must actually be entitled to act as it: its
    // owner, a contributor (EDITOR/CONTRIBUTOR share), or — for a shared global
    // agent — any member of the same org. getAgentEditAccess org-scopes the
    // lookup (cross-org ⇒ null), so a body-supplied slug can never borrow an
    // agent from another org or another user's private agent. An unauthorized
    // or unknown slug simply skips the best-effort DM (the request row + inbox
    // stay authoritative) — it NEVER decrypts or posts with that identity.
    const requester = await userRepository.findById(requesterId);
    const proposerName = requester?.name ?? requester?.email ?? "A user";
    if (agentSlug) {
      const access = await getAgentEditAccess(requesterId, agentSlug, orgId);
      if (canProposerPostAsAgent(access)) {
        void notifyApproverOfSkillUpdateInSpaces({
          approverUserId: approver.approverUserId,
          requestId: request.id,
          skillSlug: skill.slug,
          skillName: skill.name,
          proposerName,
          diff,
          summary: summary?.trim() || null,
          agent: access.agent,
        });
      } else {
        log.warn(
          `[skills/propose-update] owner DM skipped for ${skill.slug}: requester ${requesterId} not authorized to post as agent ${agentSlug}`,
        );
      }
    } else {
      log.info(`[skills/propose-update] owner DM skipped for ${skill.slug}: no agentSlug on proposal`);
    }

    res.status(202).json({
      success: true,
      data: {
        requestId: request.id,
        status: "pending_approval",
        requiresAdmin: approver.requiresAdmin,
        // Lets the agent tell the user their earlier stale proposal was replaced.
        ...(supersededCount > 0 ? { supersededPreviousProposal: true } : {}),
      },
    });
  } catch (err) {
    log.error("[skills] propose-update error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * Apply-or-reject a skill_update request. Enforced twice (defense in depth):
 * the flow-action card check (caller === approverUserId baked into the card)
 * AND this function re-reading the live skill to confirm the caller is really
 * the owner/admin and that the skill has not drifted since the proposal.
 */
export async function resolveSkillUpdateRequest(
  requestId: string,
  callerUserId: string,
  decision: "approve" | "reject",
): Promise<
  | { ok: true; status: "approved" | "rejected"; alreadyResolved?: boolean }
  | { ok: false; code: 400 | 403 | 404 | 409; error: string }
> {
  const request = await agentRequestRepository.findById(requestId);
  if (!request || request.requestType !== "skill_update" || !request.skillId) {
    return { ok: false, code: 404, error: "Skill update request not found" };
  }
  const skill = await skillRepository.findById(request.skillId);
  if (!skill) return { ok: false, code: 404, error: "Skill not found" };

  // Re-derive the true approver from the LIVE skill row — never trust the card.
  const approver = resolveSkillUpdateApprover({
    scope: skill.scope === "global" ? "global" : "personal",
    ownerUserId: skill.ownerUserId ?? null,
    promotedBy: skill.promotedBy ?? null,
  });
  if (!approver.ok || !approver.approverUserId) return { ok: false, code: 409, error: "Skill has no valid approver" };

  const authz = authorizeSkillUpdateApproval({
    approverUserId: approver.approverUserId,
    requiresAdmin: approver.requiresAdmin,
    callerUserId,
    callerIsAdmin: await isClawAdmin(callerUserId),
    currentContentHash: hashSkillContent(skill.content),
    baseContentHash: request.baseContentHash ?? "",
  });
  if (!authz.ok) {
    return { ok: false, code: authz.code, error: authz.reason };
  }

  // Idempotency fast-path (also enforced atomically by the claim below).
  if (request.status !== "pending") {
    return { ok: true, status: request.status === "approved" ? "approved" : "rejected", alreadyResolved: true };
  }

  const alreadyResolved = async () => {
    const fresh = await agentRequestRepository.findById(request.id);
    return { ok: true as const, status: (fresh?.status === "approved" ? "approved" : "rejected") as "approved" | "rejected", alreadyResolved: true };
  };

  if (decision === "reject") {
    const claim = await agentRequestRepository.claimPendingSkillUpdate(request.id, "rejected", callerUserId);
    if (claim.count === 0) return alreadyResolved();
    await writeAuditLog({ actorUserId: callerUserId, eventType: "REQUEST_REJECTED", targetId: skill.id, description: `Rejected skill update of "${skill.name}"` });
    return { ok: true, status: "rejected" };
  }

  // approve → claim first so two concurrent approvals can't double-apply.
  const claim = await agentRequestRepository.claimPendingSkillUpdate(request.id, "approved", callerUserId);
  if (claim.count === 0) return alreadyResolved();

  try {
    // Integrity: the stored proposal must hash to what was reviewed.
    const proposed = request.proposedContent ?? "";
    if (hashSkillContent(proposed) !== (request.proposedContentHash ?? "")) {
      await agentRequestRepository.revertSkillUpdateToPending(request.id).catch(() => {});
      return { ok: false, code: 409, error: "Proposed content failed integrity check" };
    }
    await skillRepository.update(skill.slug, skill.orgId, { content: normalizeSkillContent(proposed) });
  } catch (err) {
    await agentRequestRepository.revertSkillUpdateToPending(request.id).catch(() => {});
    throw err;
  }

  await writeAuditLog({ actorUserId: callerUserId, eventType: "REQUEST_APPROVED", targetId: skill.id, description: `Approved skill update of "${skill.name}" proposed by ${request.requesterId}` });
  return { ok: true, status: "approved" };
}

// REST parity endpoints (used by tests / non-card callers). The card path in
// flow-action.ts calls resolveSkillUpdateRequest directly.
router.post("/skill-update-requests/:requestId/approve", async (req: Request<{ requestId: string }>, res: Response) => {
  try {
    const callerUserId = getRequesterId(req);
    if (!callerUserId) { res.status(401).json({ success: false, error: "x-user-id required" }); return; }
    const result = await resolveSkillUpdateRequest(req.params.requestId, callerUserId, "approve");
    if (!result.ok) { res.status(result.code).json({ success: false, error: result.error }); return; }
    res.json({ success: true, alreadyResolved: result.alreadyResolved ?? false });
  } catch (err) {
    log.error("[skills] approve skill-update error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/skill-update-requests/:requestId/reject", async (req: Request<{ requestId: string }>, res: Response) => {
  try {
    const callerUserId = getRequesterId(req);
    if (!callerUserId) { res.status(401).json({ success: false, error: "x-user-id required" }); return; }
    const result = await resolveSkillUpdateRequest(req.params.requestId, callerUserId, "reject");
    if (!result.ok) { res.status(result.code).json({ success: false, error: result.error }); return; }
    res.json({ success: true, alreadyResolved: result.alreadyResolved ?? false });
  } catch (err) {
    log.error("[skills] reject skill-update error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

void requireClawAdmin;

export { router as skillsRouter };
