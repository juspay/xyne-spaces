/**
 * Org-level design systems.
 *
 * A design system used to be one free-text blob per agent
 * (`agent.config.designSystem`, edited through `PATCH /agents/:slug/design-system`).
 * These routes serve the record form: several per org, each with its own
 * DESIGN.md, token CSS and asset descriptors.
 *
 * Two notes on the ACL, because it is NOT a copy of the agent rule:
 *
 *  - The agent rule is "owner, EDITOR/CONTRIBUTOR share, or CLAW_ADMIN", and it
 *    is scoped by agent slug. A DesignSystem has no slug and no share rows — it
 *    belongs to the org — so the write rule is the org-level analogue:
 *    **creator, org ADMIN/OWNER, or CLAW_ADMIN**.
 *  - Reads are org-wide on purpose. Every agent in the org can be pointed at any
 *    of these, so hiding one from a member who can already select it would only
 *    make the picker lie.
 *
 * Cross-org access returns 404 rather than 403: every lookup is filtered by the
 * caller's orgId, so another org's row is indistinguishable from a missing one.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import {
  designSystemRepository,
  DESIGN_SYSTEM_SOURCES,
  chatMessageRepository,
} from "../repositories/index.js";
import { DESIGN_SYSTEM_MAX_CHARS } from "../repositories/designSystemRepository.js";
import { getOrgId, getRequesterId, isClawAdmin, isOrgAdmin } from "../middleware/agent-acl.js";
import { getRequesterAliases } from "../middleware/pin-user-id-param.js";
import { writeAuditLog } from "../lib/audit.js";
import { asyncHandler, ok, badRequest, conflict, unauthorized, forbidden, notFound } from "../lib/http.js";

import { createLogger } from "../logger.js";
const log = createLogger("design-systems");

export const designSystemsRouter: Router = Router();

const MAX_NAME_CHARS = 120;
/** Token CSS is not prompt-injected, so it is not bound by the 32k prompt cap. */
const MAX_TOKENS_CSS_CHARS = 64_000;

const assetsSchema = z.record(z.string(), z.unknown());

const createSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_CHARS),
  designMd: z.string().max(DESIGN_SYSTEM_MAX_CHARS).optional(),
  tokensCss: z.string().max(MAX_TOKENS_CSS_CHARS).optional(),
  assets: assetsSchema.nullable().optional(),
  source: z.enum(DESIGN_SYSTEM_SOURCES).optional(),
  sourceUrl: z.string().url().max(2048).nullable().optional(),
  sourceRepo: z.string().max(512).nullable().optional(),
  sourceCommit: z.string().max(128).nullable().optional(),
});

const updateSchema = createSchema.partial().extend({
  /** Optional optimistic-concurrency guard. A caller that showed the user a
   *  diff against a version sends that version, and the write is refused with
   *  409 if the row has moved since. Absent, last write wins as before. */
  expectedVersion: z.number().int().positive().optional(),
});

/** 32k is the cap the claw runtime enforces before injecting
 *  (apps/xyne-claw/src/task-commands.ts). Rejecting at write time keeps a saved
 *  system from being silently dropped at run time. */
const describeZodError = (err: z.ZodError): string =>
  err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");

function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw badRequest(describeZodError(parsed.error));
  return parsed.data;
}

interface Caller {
  requesterId: string;
  orgId: string;
}

function requireCaller(req: Request): Caller {
  const requesterId = getRequesterId(req);
  if (!requesterId) throw unauthorized("Authenticated user is required");
  const orgId = getOrgId(req);
  if (!orgId) throw badRequest("Organization context is required");
  return { requesterId, orgId };
}

/** Creator, org ADMIN/OWNER, or CLAW_ADMIN. See the header note on why this is
 *  the org-level analogue of the agent rule rather than the agent rule itself. */
async function assertCanWrite(createdBy: string, caller: Caller): Promise<void> {
  if (createdBy === caller.requesterId) return;
  if (await isClawAdmin(caller.requesterId)) return;
  if (await isOrgAdmin(caller.requesterId, caller.orgId)) return;
  throw forbidden("Only the design system's creator, an org admin, or a CLAW_ADMIN can modify it");
}

const toJsonInput = (assets: Record<string, unknown> | null | undefined) =>
  assets === undefined ? undefined : (assets as Prisma.InputJsonValue | null);

designSystemsRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const { orgId } = requireCaller(req);
  ok(res, await designSystemRepository.listByOrg(orgId));
}));

designSystemsRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  const caller = requireCaller(req);
  const input = parseBody(createSchema, req.body);

  const created = await designSystemRepository.create(caller.orgId, caller.requesterId, {
    ...input,
    assets: toJsonInput(input.assets),
  });

  await writeAuditLog({
    actorUserId: caller.requesterId,
    eventType: "DESIGN_SYSTEM_CREATED",
    targetId: created.id,
    description: `Design system "${created.name}" created`,
    metadata: { orgId: caller.orgId, source: created.source },
  });

  res.status(201);
  ok(res, created);
}));

designSystemsRouter.get("/:id", asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const { orgId } = requireCaller(req);
  const row = await designSystemRepository.findById(req.params.id, orgId);
  if (!row) throw notFound("Design system not found");
  ok(res, row);
}));

// Version history (XYNE-66824). Reads, so org scope is the only gate — the same
// rule as `GET /:id`. Editing is still creator-or-admin; being able to read a
// system's current content and not its previous content would be a strange
// line to draw.
//
// No route-order note needed: `:id` matches a single segment, so `/:id/versions`
// cannot be swallowed by `/:id` whichever is registered first.
designSystemsRouter.get(
  "/:id/versions",
  asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
    const { orgId } = requireCaller(req);
    // The parent read is what enforces "exists, and in your org"; it also
    // supplies `version`, which is how a row is marked current.
    const row = await designSystemRepository.findById(req.params.id, orgId);
    if (!row) throw notFound("Design system not found");
    const versions = await designSystemRepository.listVersions(row.id, orgId);
    ok(
      res,
      versions.map((v) => ({
        version: v.version,
        changeSummary: v.changeSummary,
        createdBy: v.createdBy,
        createdAt: v.createdAt,
        current: v.version === row.version,
      })),
    );
  }),
);

designSystemsRouter.get(
  "/:id/versions/:version",
  asyncHandler(async (req: Request<{ id: string; version: string }>, res: Response) => {
    const { orgId } = requireCaller(req);
    const version = Number(req.params.version);
    if (!Number.isInteger(version) || version < 1) {
      throw badRequest("version must be a positive integer");
    }
    const row = await designSystemRepository.findById(req.params.id, orgId);
    if (!row) throw notFound("Design system not found");
    const archived = await designSystemRepository.getVersion(row.id, version, orgId);
    if (!archived) {
      // The current version always answers, even with no row behind it. During
      // a rollout an old pod can still save without writing a snapshot, which
      // would leave the version the system is ON returning 404 — the one read a
      // client is most likely to make. The parent row holds that content
      // anyway, so serve it rather than deny it.
      if (version === row.version) {
        ok(res, {
          version: row.version,
          designMd: row.designMd,
          tokensCss: row.tokensCss,
          assets: row.assets,
          changeSummary: null,
          createdBy: row.createdBy,
          createdAt: row.updatedAt,
          current: true,
        });
        return;
      }
      // A real miss: a system edited before version history existed keeps only
      // the revision that survived the migration, so an earlier number is gone
      // rather than wrong.
      throw notFound(`Version ${version} not found for this design system`);
    }
    ok(res, {
      version: archived.version,
      designMd: archived.designMd,
      tokensCss: archived.tokensCss,
      assets: archived.assets,
      changeSummary: archived.changeSummary,
      createdBy: archived.createdBy,
      createdAt: archived.createdAt,
      current: archived.version === row.version,
    });
  }),
);

designSystemsRouter.patch("/:id", asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const caller = requireCaller(req);
  const input = parseBody(updateSchema, req.body);

  const existing = await designSystemRepository.findById(req.params.id, caller.orgId);
  if (!existing) throw notFound("Design system not found");
  await assertCanWrite(existing.createdBy, caller);

  const result = await designSystemRepository.update(existing.id, caller.orgId, {
    ...input,
    assets: toJsonInput(input.assets),
    updatedBy: caller.requesterId,
  });
  if (result.status === "not-found") throw notFound("Design system not found");
  if (result.status === "conflict") {
    // Someone saved between this caller's read and its write. Returning the
    // current version rather than just refusing, so a re-import can re-diff
    // against it instead of asking the user to guess what changed.
    throw conflict(
      `This design system has moved on to version ${result.currentVersion} since you loaded it. Reload and reapply your change.`,
    );
  }
  const updated = result.row;

  await writeAuditLog({
    actorUserId: caller.requesterId,
    eventType: "DESIGN_SYSTEM_UPDATED",
    targetId: updated.id,
    description: `Design system "${updated.name}" updated`,
    metadata: { orgId: caller.orgId, changed: Object.keys(input), version: updated.version },
  });

  ok(res, updated);
}));

designSystemsRouter.delete("/:id", asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const caller = requireCaller(req);

  const existing = await designSystemRepository.findById(req.params.id, caller.orgId);
  if (!existing) throw notFound("Design system not found");
  await assertCanWrite(existing.createdBy, caller);

  const removed = await designSystemRepository.remove(existing.id, caller.orgId);
  if (!removed) throw notFound("Design system not found");

  await writeAuditLog({
    actorUserId: caller.requesterId,
    eventType: "DESIGN_SYSTEM_DELETED",
    targetId: existing.id,
    description: `Design system "${existing.name}" deleted`,
    metadata: { orgId: caller.orgId },
  });

  log.info(`[design-systems] deleted id=${existing.id} org=${caller.orgId} by=${caller.requesterId}`);
  ok(res, { id: existing.id });
}));

/**
 * The caller must hold a turn in the conversation. Chat rows may be keyed under
 * EITHER the canonical id or the raw Spaces id, so match the whole alias set —
 * the same rule `agent-chat.ts` applies to title and pin.
 */
async function assertConversationAccess(req: Request, conversationId: string): Promise<void> {
  const aliases = getRequesterAliases(req);
  const messages = await chatMessageRepository.findByConversation(conversationId);
  if (!messages.some((message) => aliases.includes(message.userId))) {
    throw notFound("Conversation not found");
  }
}

designSystemsRouter.put(
  "/conversations/:conversationId",
  asyncHandler(async (req: Request<{ conversationId: string }>, res: Response) => {
    const caller = requireCaller(req);
    const { designSystemId } = parseBody(
      z.object({ designSystemId: z.string().min(1) }),
      req.body,
    );

    await assertConversationAccess(req, req.params.conversationId);

    const system = await designSystemRepository.findById(designSystemId, caller.orgId);
    if (!system) throw notFound("Design system not found");

    ok(res, await designSystemRepository.pinConversation(
      req.params.conversationId,
      system.id,
      caller.orgId,
      caller.requesterId,
    ));
  }),
);

designSystemsRouter.delete(
  "/conversations/:conversationId",
  asyncHandler(async (req: Request<{ conversationId: string }>, res: Response) => {
    requireCaller(req);
    await assertConversationAccess(req, req.params.conversationId);
    const removed = await designSystemRepository.unpinConversation(req.params.conversationId);
    ok(res, { conversationId: req.params.conversationId, unpinned: removed });
  }),
);
