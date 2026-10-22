import { Router, type Request, type Response } from "express";
import { Prisma, type LoopCommandDefinition } from "@prisma/client";
import { LOOP_COMMANDS, LOOP_SKILL_BUNDLES, LOOP_TEMPLATES } from "xyne-claw-shared";
import { asyncHandler, badRequest, forbidden, HttpError, notFound, ok, unauthorized } from "../lib/http.js";
import { prisma } from "../db.js";
import { getOrgId, getRequesterId, isClawAdmin } from "../middleware/agent-acl.js";
import { createLogger } from "../logger.js";
import { LoopCommandValidationError, checkSequenceSteps, validateLoopCommand, type ValidatedLoopCommand } from "../lib/loop-command-defs.js";
import { EXPERIMENT_PROVIDERS } from "../lib/experiment.js";

const log = createLogger("loop-commands");
const router = Router();

function view(row: LoopCommandDefinition, userId: string) {
  return { ...row, command: `/${row.name}`, mine: row.createdByUserId === userId };
}

async function validated(body: unknown, requireName: boolean, orgId: string): Promise<ValidatedLoopCommand> {
  try {
    const v = validateLoopCommand((body ?? {}) as Record<string, unknown>, { requireName });
    if (v.steps) await checkSequenceSteps(orgId, v.steps);
    return v;
  } catch (err) {
    if (err instanceof LoopCommandValidationError) throw new HttpError(400, err.message, undefined, { field: err.field });
    throw err;
  }
}

function columns(v: ValidatedLoopCommand) {
  const { name: _name, steps, ...rest } = v;
  return { ...rest, steps: steps ? (steps as unknown as Prisma.InputJsonValue) : Prisma.JsonNull };
}

function snapshot(v: ValidatedLoopCommand): Prisma.InputJsonValue {
  const { name: _name, ...rest } = v;
  return rest as unknown as Prisma.InputJsonValue;
}

async function editable(req: Request): Promise<{ row: LoopCommandDefinition; userId: string }> {
  const userId = getRequesterId(req);
  if (!userId) throw unauthorized("x-user-id header is required");
  const orgId = getOrgId(req);
  const row = orgId ? await prisma.loopCommandDefinition.findFirst({ where: { id: String(req.params.id), orgId } }) : null;
  if (!row) throw notFound("loop command not found");
  if (row.createdByUserId !== userId && !(await isClawAdmin(userId))) throw forbidden("Only the creator or a claw admin can change this loop command");
  return { row, userId };
}

router.get("/templates", asyncHandler(async (_req: Request, res: Response) => {
  ok(res, {
    templates: LOOP_TEMPLATES,
    skillBundles: LOOP_SKILL_BUNDLES,
    providers: [...EXPERIMENT_PROVIDERS],
    builtinLoops: LOOP_COMMANDS.map((d) => ({ command: d.command, summary: d.start.mode.replace(/^Mode:\s*/, ""), positional: d.positional ?? null })),
  });
}));

router.get("/", asyncHandler(async (req: Request, res: Response) => {
  const userId = getRequesterId(req);
  if (!userId) throw unauthorized("x-user-id header is required");
  const orgId = getOrgId(req);
  if (!orgId) throw badRequest("orgId is required");
  const rows = await prisma.loopCommandDefinition.findMany({
    where: { orgId, OR: [{ published: true }, { createdByUserId: userId }] },
    orderBy: [{ published: "desc" }, { name: "asc" }],
    take: 200,
  });
  ok(res, rows.map((r) => view(r, userId)));
}));

router.get("/:id", asyncHandler(async (req: Request, res: Response) => {
  const userId = getRequesterId(req);
  if (!userId) throw unauthorized("x-user-id header is required");
  const orgId = getOrgId(req);
  const row = orgId ? await prisma.loopCommandDefinition.findFirst({ where: { id: String(req.params.id), orgId } }) : null;
  if (!row || (!row.published && row.createdByUserId !== userId && !(await isClawAdmin(userId)))) throw notFound("loop command not found");
  ok(res, view(row, userId));
}));

router.post("/", asyncHandler(async (req: Request, res: Response) => {
  const userId = getRequesterId(req);
  if (!userId) throw unauthorized("x-user-id header is required");
  const orgId = getOrgId(req);
  if (!orgId) throw badRequest("orgId is required");
  const v = await validated(req.body, true, orgId);
  const taken = await prisma.loopCommandDefinition.findUnique({ where: { orgId_name: { orgId, name: v.name } }, select: { id: true } });
  if (taken) throw new HttpError(409, `/${v.name} already exists in this org`, undefined, { field: "name" });
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.loopCommandDefinition.create({ data: { ...columns(v), name: v.name, orgId, createdByUserId: userId, published: false, version: 1 } });
    await tx.loopCommandVersion.create({ data: { orgId, commandId: created.id, version: 1, snapshot: snapshot(v), createdByUserId: userId } });
    return created;
  });
  log.info(`[loop-commands] created /${row.name} template=${row.template} by=${userId}`);
  res.status(201).json({ success: true, data: view(row, userId) });
}));

async function saveVersion(row: LoopCommandDefinition, v: ValidatedLoopCommand, userId: string) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.loopCommandDefinition.update({ where: { id: row.id }, data: { ...columns(v), version: { increment: 1 } } });
    await tx.loopCommandVersion.create({ data: { orgId: row.orgId, commandId: row.id, version: updated.version, snapshot: snapshot(v), createdByUserId: userId } });
    return updated;
  });
}

router.put("/:id", asyncHandler(async (req: Request, res: Response) => {
  const { row, userId } = await editable(req);
  const v = await validated({ ...(req.body as Record<string, unknown>), name: row.name }, false, row.orgId);
  ok(res, view(await saveVersion(row, v, userId), userId));
}));

router.get("/:id/versions", asyncHandler(async (req: Request, res: Response) => {
  const { row } = await editable(req);
  const versions = await prisma.loopCommandVersion.findMany({ where: { commandId: row.id }, orderBy: { version: "desc" }, take: 50 });
  ok(res, versions.map((x) => ({ version: x.version, createdAt: x.createdAt, createdByUserId: x.createdByUserId, snapshot: x.snapshot, current: x.version === row.version })));
}));

router.post("/:id/rollback", asyncHandler(async (req: Request, res: Response) => {
  const { row, userId } = await editable(req);
  const version = Number((req.body as Record<string, unknown>)?.["version"]);
  if (!Number.isInteger(version) || version < 1) throw badRequest("version must be a positive integer");
  if (version === row.version) throw badRequest(`version ${version} is already current`);
  const target = await prisma.loopCommandVersion.findUnique({ where: { commandId_version: { commandId: row.id, version } } });
  if (!target) throw notFound(`version ${version} not found`);
  const v = await validated({ ...(target.snapshot as Record<string, unknown>), name: row.name }, false, row.orgId);
  const updated = await saveVersion(row, v, userId);
  log.info(`[loop-commands] /${row.name} rolled back to v${version} as v${updated.version} by=${userId}`);
  ok(res, view(updated, userId));
}));

router.post("/:id/publish", asyncHandler(async (req: Request, res: Response) => {
  const { row, userId } = await editable(req);
  const published = (req.body as Record<string, unknown>)?.["published"] !== false;
  const updated = await prisma.loopCommandDefinition.update({ where: { id: row.id }, data: { published } });
  log.info(`[loop-commands] /${row.name} published=${published} by=${userId}`);
  ok(res, view(updated, userId));
}));

router.delete("/:id", asyncHandler(async (req: Request, res: Response) => {
  const { row } = await editable(req);
  await prisma.loopCommandDefinition.delete({ where: { id: row.id } });
  ok(res);
}));

export default router;
