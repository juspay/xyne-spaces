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
import { asyncHandler, ok, badRequest, unauthorized, forbidden, notFound, HttpError } from "../lib/http.js";
import { prisma } from "../db.js";
import {
  subagentDefinitionRepository,
  subagentShareRepository,
  userRepository,
} from "../repositories/index.js";
import { getRequesterId, getOrgId, isClawAdmin } from "../middleware/agent-acl.js";
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
router.get("/", asyncHandler(async (req: Request, res: Response) => {
  // Phase-2: org-scope custom subagents (built-ins are platform-wide below).
  const customs = await subagentDefinitionRepository.listAll(getOrgId(req));
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
  ok(res, items);
}));

// ── GET /:name — single subagent ─────────────────────────────────────────
router.get("/:name", asyncHandler(async (req: Request, res: Response) => {
  const name = typeof req.params.name === "string" ? req.params.name : "";
  if (!name) throw badRequest("name is required");

  const builtin = SUBAGENT_DEFINITIONS.find((d) => d.name === name);
  if (builtin) return ok(res, builtinAsListItem(builtin));

  const row = await subagentDefinitionRepository.findByName(name, getOrgId(req));
  if (!row) {
    log.warn(`[subagents/get] subagent org-scoped miss name=${name} orgId=${getOrgId(req) ?? "none"} userId=${getRequesterId(req) ?? "none"}`);
    throw notFound("subagent not found");
  }
  const shares = await subagentShareRepository.listBySubagent(row.id);
  const creator = row.createdByUserId
    ? await prisma.user.findUnique({
      where: { id: row.createdByUserId },
      select: { name: true, email: true },
    })
    : null;

  ok(res, dbRowAsListItem(row, shares, creator));
}));

// ── POST / — create (any authenticated user) ─────────────────────────────
router.post("/", asyncHandler(async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    throw unauthorized("x-user-id header is required");
  }
  const orgId = getOrgId(req);
  if (!orgId) {
    log.warn(`[subagents/create] orgId is required requesterId=${requesterId} name=${typeof req.body?.name === "string" ? req.body.name : "none"}`);
    throw badRequest("orgId is required");
  }
  const validated = await validateSubagentInput(prisma, req.body, { isCreate: true, orgId }).catch((err) => {
    if (err instanceof ValidationError) throw new HttpError(400, err.message, undefined, { field: err.field });
    throw err;
  });

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
    // Phase-2: stamp the creating org so no null-org subagent is minted (which
    // would block the future NOT-NULL flip).
    org: { connect: { id: orgId } },
    ...(validated.skillIds.length > 0
      ? {
          skills: {
            create: validated.skillIds.map((skillId) => ({ skillId })),
          },
        }
      : {}),
  });

  res.status(201).json({ success: true, data: dbRowAsListItem(created, []) });
}));

// ── PUT /:name — update (owner OR admin OR EDITOR share) ─────────────────
router.put("/:name", asyncHandler(async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    throw unauthorized("x-user-id header is required");
  }
  const name = typeof req.params.name === "string" ? req.params.name : "";
  if (!name) throw badRequest("name is required");

  if (SUBAGENT_DEFINITIONS.some((d) => d.name === name)) {
    throw badRequest(`"${name}" is a built-in subagent and cannot be modified`);
  }
  const existing = await subagentDefinitionRepository.findByName(name, getOrgId(req));
  if (!existing) {
    log.warn(`[subagents/update] subagent org-scoped miss name=${name} orgId=${getOrgId(req) ?? "none"} userId=${requesterId}`);
    throw notFound("subagent not found");
  }

  if (!(await canEditSubagent(existing, requesterId))) {
    throw forbidden("Only the owner, contributors, or admins can update this subagent");
  }

  const incomingName = (req.body as Record<string, unknown>)?.["name"];
  if (typeof incomingName === "string" && incomingName !== name) {
    throw badRequest("name is immutable");
  }

  const validated = await validateSubagentInput(
    prisma,
    { ...(req.body as Record<string, unknown>), name } as Parameters<typeof validateSubagentInput>[1],
    { isCreate: false, orgId: existing.orgId },
  ).catch((err) => {
    if (err instanceof ValidationError) throw new HttpError(400, err.message, undefined, { field: err.field });
    throw err;
  });

  const updated = await subagentDefinitionRepository.update(name, existing.orgId, {
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
  const refreshed = await subagentDefinitionRepository.findByName(name, getOrgId(req));
  const shares = refreshed ? await subagentShareRepository.listBySubagent(refreshed.id) : [];
  ok(res, dbRowAsListItem(refreshed!, shares));
}));

// ── DELETE /:name — soft-delete (owner OR admin OR EDITOR share) ─────────
router.delete("/:name", asyncHandler(async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    throw unauthorized("x-user-id header is required");
  }
  const name = typeof req.params.name === "string" ? req.params.name : "";
  if (!name) throw badRequest("name is required");
  if (SUBAGENT_DEFINITIONS.some((d) => d.name === name)) {
    throw badRequest(`"${name}" is a built-in subagent and cannot be deleted`);
  }
  const existing = await subagentDefinitionRepository.findByName(name, getOrgId(req));
  if (!existing) {
    log.warn(`[subagents/delete] subagent org-scoped miss name=${name} orgId=${getOrgId(req) ?? "none"} userId=${requesterId}`);
    throw notFound("subagent not found");
  }
  if (!(await canEditSubagent(existing, requesterId))) {
    throw forbidden("Only the owner, contributors, or admins can disable this subagent");
  }
  await subagentDefinitionRepository.disable(name, existing.orgId);
  ok(res);
}));

// ── POST /:name/enable — undo soft-delete (owner OR admin OR EDITOR share) ──
router.post("/:name/enable", asyncHandler(async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    throw unauthorized("x-user-id header is required");
  }
  const name = typeof req.params.name === "string" ? req.params.name : "";
  if (!name) throw badRequest("name is required");
  if (SUBAGENT_DEFINITIONS.some((d) => d.name === name)) {
    throw badRequest("built-ins are always enabled");
  }
  const existing = await subagentDefinitionRepository.findByName(name, getOrgId(req));
  if (!existing) {
    log.warn(`[subagents/restore] subagent org-scoped miss name=${name} orgId=${getOrgId(req) ?? "none"} userId=${requesterId}`);
    throw notFound("subagent not found");
  }
  if (!(await canEditSubagent(existing, requesterId))) {
    throw forbidden("Only the owner, contributors, or admins can re-enable this subagent");
  }
  const updated = await subagentDefinitionRepository.enable(name, existing.orgId);
  const shares = await subagentShareRepository.listBySubagent(updated.id);
  ok(res, dbRowAsListItem(updated, shares));
}));

// ── Shares ───────────────────────────────────────────────────────────────

router.get("/:name/shares", asyncHandler(async (req: Request, res: Response) => {
  const name = typeof req.params.name === "string" ? req.params.name : "";
  if (!name) throw badRequest("name is required");
  if (SUBAGENT_DEFINITIONS.some((d) => d.name === name)) {
    return ok(res, []);
  }
  const row = await subagentDefinitionRepository.findByName(name, getOrgId(req));
  if (!row) {
    log.warn(`[subagents/shares] subagent org-scoped miss name=${name} orgId=${getOrgId(req) ?? "none"} userId=${getRequesterId(req) ?? "none"}`);
    throw notFound("subagent not found");
  }
  const shares = await subagentShareRepository.listBySubagent(row.id);
  ok(res, shares.map((s) => ({
    userId: s.userId,
    role: s.role,
    name: s.user.name ?? "",
    email: s.user.email ?? "",
    sharedBy: s.sharedBy ?? null,
    createdAt: s.createdAt,
  })));
}));

router.post("/:name/shares", asyncHandler(async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    throw unauthorized("x-user-id header is required");
  }
  const name = typeof req.params.name === "string" ? req.params.name : "";
  if (!name) throw badRequest("name is required");
  if (SUBAGENT_DEFINITIONS.some((d) => d.name === name)) {
    throw badRequest("built-in subagents cannot be shared");
  }
  const row = await subagentDefinitionRepository.findByName(name, getOrgId(req));
  if (!row) {
    log.warn(`[subagents/share] subagent org-scoped miss name=${name} orgId=${getOrgId(req) ?? "none"} userId=${requesterId}`);
    throw notFound("subagent not found");
  }
  if (!(await canEditSubagent(row, requesterId))) {
    throw forbidden("Only the owner, contributors, or admins can add a contributor");
  }

  const body = req.body as { userIdOrEmail?: string; role?: string };
  const userIdOrEmail = (body.userIdOrEmail ?? "").trim();
  const role = (body.role ?? "EDITOR").toUpperCase();
  if (!userIdOrEmail) {
    throw badRequest("userIdOrEmail is required");
  }
  if (role !== "EDITOR") {
    throw badRequest('role must be "EDITOR"');
  }

  // Resolve userIdOrEmail to a real userId. Accept either form so the
  // frontend can let users type an email without an extra lookup hop.
  let target = await userRepository.findById(userIdOrEmail);
  const requesterOrgId = getOrgId(req);
  if (!target && requesterOrgId) {
    target = await prisma.user.findFirst({ where: { email: userIdOrEmail, orgId: requesterOrgId } });
  }
  if (!target) {
    throw notFound(`No user matches "${userIdOrEmail}"`);
  }
  if (target.id === row.createdByUserId) {
    throw badRequest("owner is already the creator — no share needed");
  }

  const share = await subagentShareRepository.upsert(row.id, target.id, role, requesterId);
  res.status(201).json({
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
}));

router.delete("/:name/shares/:userId", asyncHandler(async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    throw unauthorized("x-user-id header is required");
  }
  const name = typeof req.params.name === "string" ? req.params.name : "";
  const userId = typeof req.params.userId === "string" ? req.params.userId : "";
  if (!name || !userId) {
    throw badRequest("name and userId are required");
  }
  const row = await subagentDefinitionRepository.findByName(name, getOrgId(req));
  if (!row) {
    log.warn(`[subagents/unshare] subagent org-scoped miss name=${name} orgId=${getOrgId(req) ?? "none"} userId=${requesterId} targetUserId=${userId}`);
    throw notFound("subagent not found");
  }
  if (!(await canEditSubagent(row, requesterId))) {
    throw forbidden("Only the owner, contributors, or admins can remove a contributor");
  }
  await subagentShareRepository.delete(row.id, userId).catch(() => undefined);
  ok(res);
}));

export default router;
