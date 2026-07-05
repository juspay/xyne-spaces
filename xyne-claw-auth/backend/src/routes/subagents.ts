/**
 * Subagent CRUD + share management.
 *
 * Visibility model:
 *  - All custom subagents (subagent_definitions rows where enabled=true) are
 *    globally visible to every authenticated user. GET routes are open.
 *  - Anyone authenticated can CREATE a new subagent (the requester becomes
 *    the owner via createdByUserId).
 *  - Edit / delete / share-management require: owner OR claw admin OR an
 *    explicit share row with role EDITOR.
 *  - Built-in subagents (xyne-claw-shared SUBAGENT_DEFINITIONS) are
 *    surfaced read-only and validation rejects creating a custom row with
 *    a built-in name, so the runtime resolver's "built-in wins" rule is
 *    unambiguous.
 */

import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import {
  subagentDefinitionRepository,
  subagentShareRepository,
  userRepository,
} from "../repositories/index.js";
import { getRequesterId, isClawAdmin } from "../middleware/agent-acl.js";
import {
  ValidationError,
  validateSubagentInput,
} from "../lib/subagent-resolver.js";
import { SUBAGENT_DEFINITIONS } from "xyne-claw-shared";

import { createLogger } from "../logger.js";
const log = createLogger("subagents");

const router = Router();

// ── Response shapes ──────────────────────────────────────────────────────

function builtinAsListItem(d: typeof SUBAGENT_DEFINITIONS[number]) {
  return {
    source: "builtin" as const,
    name: d.name,
    description: d.description,
    progressLabels: d.progressLabels,
    systemPrompt: d.systemPrompt,
    paramName: d.paramName,
    paramDescription: d.paramDescription,
    serverType: d.serverType,
    enabled: true,
    skills: [] as Array<{ id: string; slug: string; name: string }>,
    createdByUserId: null as string | null,
    createdByName: null as string | null,
    createdByEmail: null as string | null,
    shares: [] as Array<{ userId: string; role: string; name: string; email: string }>,
  };
}

type DbRow = Awaited<ReturnType<typeof subagentDefinitionRepository.findByName>>;

function dbRowAsListItem(
  row: NonNullable<DbRow>,
  shares: Awaited<ReturnType<typeof subagentShareRepository.listBySubagent>> = [],
  creator: { name: string | null; email: string | null } | null = null,
) {
  return {
    source: "custom" as const,
    id: row.id,
    name: row.name,
    description: row.description,
    progressLabels: row.progressLabels,
    systemPrompt: row.systemPrompt,
    paramName: row.paramName,
    paramDescription: row.paramDescription,
    tools: row.tools,
    /** `{ serverType: instanceSlug }` map. `{}` or null = inherit all
     *  agent-pinned instances. Editor UI reads this to render per-server
     *  instance dropdowns. */
    mcpInstanceMap: row.mcpInstanceMap ?? {},
    enabled: row.enabled,
    createdByUserId: row.createdByUserId,
    // Resolved display name/email of the creator (createdByUserId is a bare
    // column with no User relation, so callers batch-resolve and pass it in).
    createdByName: creator?.name ?? null,
    createdByEmail: creator?.email ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    skills: row.skills.map((s) => ({
      id: s.skill.id,
      slug: s.skill.slug,
      name: s.skill.name,
    })),
    shares: shares.map((s) => ({
      userId: s.userId,
      role: s.role,
      name: s.user.name ?? "",
      email: s.user.email ?? "",
    })),
  };
}

function sendValidationError(res: Response, err: unknown): boolean {
  if (err instanceof ValidationError) {
    res.status(400).json({ success: false, error: err.message, field: err.field });
    return true;
  }
  return false;
}

// ── ACL helpers ──────────────────────────────────────────────────────────

/**
 * Return true if `userId` may edit/delete/share-manage this subagent. Owner,
 * CLAW_ADMIN, or any EDITOR share row qualifies.
 */
async function canEditSubagent(row: NonNullable<DbRow>, userId: string): Promise<boolean> {
  if (row.createdByUserId === userId) return true;
  if (await isClawAdmin(userId)) return true;
  const share = await subagentShareRepository.findBySubagentAndUser(row.id, userId);
  return share?.role === "EDITOR";
}

// ── GET / — list all (builtins + customs) ────────────────────────────────
router.get("/", async (_req: Request, res: Response) => {
  try {
    const customs = await subagentDefinitionRepository.listAll();
    // Batch-load shares for every custom in one query so the list view can
    // show share badges without N round-trips.
    const sharesByDef = new Map<string, Awaited<ReturnType<typeof subagentShareRepository.listBySubagent>>>();
    for (const c of customs) {
      const rows = await subagentShareRepository.listBySubagent(c.id);
      sharesByDef.set(c.id, rows);
    }
    // Batch-resolve creator names (createdByUserId has no User relation).
    const creatorIds = [...new Set(customs.map((c) => c.createdByUserId).filter((x): x is string => !!x))];
    const creators = creatorIds.length
      ? await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true, email: true } })
      : [];
    const creatorById = new Map(creators.map((u) => [u.id, u]));
    const items = [
      ...SUBAGENT_DEFINITIONS.map(builtinAsListItem),
      ...customs.map((c) =>
        dbRowAsListItem(c, sharesByDef.get(c.id) ?? [], c.createdByUserId ? creatorById.get(c.createdByUserId) ?? null : null),
      ),
    ];
    res.json({ success: true, data: items });
  } catch (err) {
    log.error("[subagents] list error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── GET /:name — single subagent ─────────────────────────────────────────
router.get("/:name", async (req: Request, res: Response) => {
  try {
    const name = typeof req.params.name === "string" ? req.params.name : "";
    if (!name) return res.status(400).json({ success: false, error: "name is required" });

    const builtin = SUBAGENT_DEFINITIONS.find((d) => d.name === name);
    if (builtin) return res.json({ success: true, data: builtinAsListItem(builtin) });

    const row = await subagentDefinitionRepository.findByName(name);
    if (!row) return res.status(404).json({ success: false, error: "subagent not found" });
    const shares = await subagentShareRepository.listBySubagent(row.id);
    const creator = row.createdByUserId
      ? await prisma.user.findUnique({ where: { id: row.createdByUserId }, select: { name: true, email: true } })
      : null;

    return res.json({ success: true, data: dbRowAsListItem(row, shares, creator) });
  } catch (err) {
    log.error("[subagents] get error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── POST / — create (any authenticated user) ─────────────────────────────
router.post("/", async (req: Request, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      return res.status(401).json({ success: false, error: "x-user-id header is required" });
    }
    const validated = await validateSubagentInput(prisma, req.body, { isCreate: true });

    const created = await subagentDefinitionRepository.create({
      name: validated.name,
      description: validated.description,
      progressLabels: validated.progressLabels,
      systemPrompt: validated.systemPrompt,
      paramName: validated.paramName,
      paramDescription: validated.paramDescription,
      tools: validated.tools as object,
      // Persist only when non-empty. Storing {} would be indistinguishable
      // from "no map set" downstream — null is the canonical empty.
      ...(Object.keys(validated.mcpInstanceMap).length > 0
        ? { mcpInstanceMap: validated.mcpInstanceMap as object }
        : {}),
      createdByUserId: requesterId,
      ...(validated.skillIds.length > 0
        ? {
            skills: {
              create: validated.skillIds.map((skillId) => ({ skillId })),
            },
          }
        : {}),
    });

    return res.status(201).json({ success: true, data: dbRowAsListItem(created, []) });
  } catch (err) {
    if (sendValidationError(res, err)) return;
    log.error("[subagents] create error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── PUT /:name — update (owner OR admin OR EDITOR share) ─────────────────
router.put("/:name", async (req: Request, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      return res.status(401).json({ success: false, error: "x-user-id header is required" });
    }
    const name = typeof req.params.name === "string" ? req.params.name : "";
    if (!name) return res.status(400).json({ success: false, error: "name is required" });

    if (SUBAGENT_DEFINITIONS.some((d) => d.name === name)) {
      return res.status(400).json({
        success: false,
        error: `"${name}" is a built-in subagent and cannot be modified`,
      });
    }
    const existing = await subagentDefinitionRepository.findByName(name);
    if (!existing) return res.status(404).json({ success: false, error: "subagent not found" });

    if (!(await canEditSubagent(existing, requesterId))) {
      return res.status(403).json({
        success: false,
        error: "Only the owner, contributors, or admins can update this subagent",
      });
    }

    const incomingName = (req.body as Record<string, unknown>)?.["name"];
    if (typeof incomingName === "string" && incomingName !== name) {
      return res.status(400).json({ success: false, error: "name is immutable" });
    }

    const validated = await validateSubagentInput(
      prisma,
      { ...(req.body as Record<string, unknown>), name } as Parameters<typeof validateSubagentInput>[1],
      { isCreate: false },
    );

    const updated = await subagentDefinitionRepository.update(name, {
      description: validated.description,
      progressLabels: validated.progressLabels,
      systemPrompt: validated.systemPrompt,
      paramName: validated.paramName,
      paramDescription: validated.paramDescription,
      tools: validated.tools as object,
      // Prisma's nullable-JSON-column convention: use `Prisma.JsonNull` to
      // clear back to inherit-all; non-empty replaces it.
      mcpInstanceMap: Object.keys(validated.mcpInstanceMap).length > 0
        ? (validated.mcpInstanceMap as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    });

    await subagentDefinitionRepository.replaceSkills(updated.id, validated.skillIds);
    const refreshed = await subagentDefinitionRepository.findByName(name);
    const shares = refreshed ? await subagentShareRepository.listBySubagent(refreshed.id) : [];
    return res.json({ success: true, data: dbRowAsListItem(refreshed!, shares) });
  } catch (err) {
    if (sendValidationError(res, err)) return;
    log.error("[subagents] update error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── DELETE /:name — soft-delete (owner OR admin OR EDITOR share) ─────────
router.delete("/:name", async (req: Request, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      return res.status(401).json({ success: false, error: "x-user-id header is required" });
    }
    const name = typeof req.params.name === "string" ? req.params.name : "";
    if (!name) return res.status(400).json({ success: false, error: "name is required" });
    if (SUBAGENT_DEFINITIONS.some((d) => d.name === name)) {
      return res.status(400).json({
        success: false,
        error: `"${name}" is a built-in subagent and cannot be deleted`,
      });
    }
    const existing = await subagentDefinitionRepository.findByName(name);
    if (!existing) return res.status(404).json({ success: false, error: "subagent not found" });
    if (!(await canEditSubagent(existing, requesterId))) {
      return res.status(403).json({
        success: false,
        error: "Only the owner, contributors, or admins can disable this subagent",
      });
    }
    await subagentDefinitionRepository.disable(name);
    return res.json({ success: true });
  } catch (err) {
    log.error("[subagents] delete error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── POST /:name/enable — undo soft-delete (owner OR admin OR EDITOR share) ──
router.post("/:name/enable", async (req: Request, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      return res.status(401).json({ success: false, error: "x-user-id header is required" });
    }
    const name = typeof req.params.name === "string" ? req.params.name : "";
    if (!name) return res.status(400).json({ success: false, error: "name is required" });
    if (SUBAGENT_DEFINITIONS.some((d) => d.name === name)) {
      return res.status(400).json({ success: false, error: "built-ins are always enabled" });
    }
    const existing = await subagentDefinitionRepository.findByName(name);
    if (!existing) return res.status(404).json({ success: false, error: "subagent not found" });
    if (!(await canEditSubagent(existing, requesterId))) {
      return res.status(403).json({
        success: false,
        error: "Only the owner, contributors, or admins can re-enable this subagent",
      });
    }
    const updated = await subagentDefinitionRepository.enable(name);
    const shares = await subagentShareRepository.listBySubagent(updated.id);
    return res.json({ success: true, data: dbRowAsListItem(updated, shares) });
  } catch (err) {
    log.error("[subagents] enable error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Shares ───────────────────────────────────────────────────────────────

router.get("/:name/shares", async (req: Request, res: Response) => {
  try {
    const name = typeof req.params.name === "string" ? req.params.name : "";
    if (!name) return res.status(400).json({ success: false, error: "name is required" });
    if (SUBAGENT_DEFINITIONS.some((d) => d.name === name)) {
      return res.json({ success: true, data: [] });
    }
    const row = await subagentDefinitionRepository.findByName(name);
    if (!row) return res.status(404).json({ success: false, error: "subagent not found" });
    const shares = await subagentShareRepository.listBySubagent(row.id);
    return res.json({
      success: true,
      data: shares.map((s) => ({
        userId: s.userId,
        role: s.role,
        name: s.user.name ?? "",
        email: s.user.email ?? "",
        sharedBy: s.sharedBy ?? null,
        createdAt: s.createdAt,
      })),
    });
  } catch (err) {
    log.error("[subagents] list shares error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/:name/shares", async (req: Request, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      return res.status(401).json({ success: false, error: "x-user-id header is required" });
    }
    const name = typeof req.params.name === "string" ? req.params.name : "";
    if (!name) return res.status(400).json({ success: false, error: "name is required" });
    if (SUBAGENT_DEFINITIONS.some((d) => d.name === name)) {
      return res.status(400).json({ success: false, error: "built-in subagents cannot be shared" });
    }
    const row = await subagentDefinitionRepository.findByName(name);
    if (!row) return res.status(404).json({ success: false, error: "subagent not found" });
    if (!(await canEditSubagent(row, requesterId))) {
      return res.status(403).json({
        success: false,
        error: "Only the owner, contributors, or admins can add a contributor",
      });
    }

    const body = req.body as { userIdOrEmail?: string; role?: string };
    const userIdOrEmail = (body.userIdOrEmail ?? "").trim();
    const role = (body.role ?? "EDITOR").toUpperCase();
    if (!userIdOrEmail) {
      return res.status(400).json({ success: false, error: "userIdOrEmail is required" });
    }
    if (role !== "EDITOR") {
      return res.status(400).json({ success: false, error: 'role must be "EDITOR"' });
    }

    // Resolve userIdOrEmail to a real userId. Accept either form so the
    // frontend can let users type an email without an extra lookup hop.
    let target = await userRepository.findById(userIdOrEmail);
    if (!target) target = await userRepository.findByEmail(userIdOrEmail);
    if (!target) {
      return res.status(404).json({ success: false, error: `No user matches "${userIdOrEmail}"` });
    }
    if (target.id === row.createdByUserId) {
      return res.status(400).json({ success: false, error: "owner is already the creator — no share needed" });
    }

    const share = await subagentShareRepository.upsert(row.id, target.id, role, requesterId);
    return res.status(201).json({
      success: true,
      data: {
        userId: share.userId,
        role: share.role,
        name: share.user.name ?? "",
        email: share.user.email ?? "",
        sharedBy: share.sharedBy ?? null,
        createdAt: share.createdAt,
      },
    });
  } catch (err) {
    log.error("[subagents] add share error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.delete("/:name/shares/:userId", async (req: Request, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      return res.status(401).json({ success: false, error: "x-user-id header is required" });
    }
    const name = typeof req.params.name === "string" ? req.params.name : "";
    const userId = typeof req.params.userId === "string" ? req.params.userId : "";
    if (!name || !userId) {
      return res.status(400).json({ success: false, error: "name and userId are required" });
    }
    const row = await subagentDefinitionRepository.findByName(name);
    if (!row) return res.status(404).json({ success: false, error: "subagent not found" });
    if (!(await canEditSubagent(row, requesterId))) {
      return res.status(403).json({
        success: false,
        error: "Only the owner, contributors, or admins can remove a contributor",
      });
    }
    await subagentShareRepository.delete(row.id, userId).catch(() => undefined);
    return res.json({ success: true });
  } catch (err) {
    log.error("[subagents] remove share error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export default router;
