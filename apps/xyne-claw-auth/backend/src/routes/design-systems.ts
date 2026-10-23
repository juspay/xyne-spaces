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
import { Prisma, type DesignSystem } from "@prisma/client";
import {
  CONTRAST_SLOTS,
  auditContrast,
  auditTokensCss,
  type ContrastAudit,
  type ContrastSlot,
  type ContrastTokens,
} from "xyne-claw-shared";
import {
  designSystemRepository,
  DESIGN_SYSTEM_SOURCES,
  chatMessageRepository,
} from "../repositories/index.js";
import { DESIGN_SYSTEM_MAX_CHARS } from "../repositories/designSystemRepository.js";
import { getOrgId, getRequesterId, isClawAdmin, isOrgAdmin } from "../middleware/agent-acl.js";
import { getRequesterAliases } from "../middleware/pin-user-id-param.js";
import { writeAuditLog } from "../lib/audit.js";
import { asyncHandler, ok, badRequest, unauthorized, forbidden, notFound } from "../lib/http.js";

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

const updateSchema = createSchema.partial();

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

/**
 * A saved system carries its WCAG audit on every single-row response
 * (XYNE-66828), derived from its token CSS rather than stored: an audit is a
 * pure function of the palette, and a stored verdict would go stale the moment
 * a token is edited.
 *
 * The list response carries the counts only — `hasIssues` is all the warning
 * badge needs, and five pair results per row is a lot of payload for a picker.
 * The detail shape is a superset, so a client reading `contrast.hasIssues`
 * works against both.
 */
const withContrast = (row: DesignSystem): DesignSystem & { contrast: ContrastAudit } => ({
  ...row,
  contrast: auditTokensCss(row.tokensCss),
});

const withContrastCounts = (row: DesignSystem) => {
  const audit = auditTokensCss(row.tokensCss);
  return {
    ...row,
    contrast: { audited: audit.audited, failing: audit.failing, hasIssues: audit.hasIssues },
  };
};

designSystemsRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const { orgId } = requireCaller(req);
  const rows = await designSystemRepository.listByOrg(orgId);
  ok(res, rows.map(withContrastCounts));
}));

/**
 * Re-audit a palette the caller is still editing.
 *
 * The review card needs this after a one-click fix: applying a suggestion
 * changes a token that other pairs also use, so the whole set has to be
 * re-measured. Nothing is read or written — it exists so the audit has exactly
 * one implementation, in xyne-claw-shared, rather than a second copy in a
 * frontend that has no workspace dependencies.
 *
 * Takes either a slot map or raw token CSS. Unknown slots are ignored rather
 * than rejected, so a client that learns about a new slot before this server
 * does still gets an answer for the slots it shares.
 */
const contrastAuditSchema = z.object({
  tokens: z.record(z.string().max(64), z.string().max(64)).optional(),
  tokensCss: z.string().max(MAX_TOKENS_CSS_CHARS).optional(),
  names: z.record(z.string().max(64), z.string().max(120)).optional(),
});

const isContrastSlot = (value: string): value is ContrastSlot =>
  (CONTRAST_SLOTS as readonly string[]).includes(value);

const bySlot = <T,>(entries: Record<string, T> | undefined): Partial<Record<ContrastSlot, T>> => {
  const out: Partial<Record<ContrastSlot, T>> = {};
  for (const [key, value] of Object.entries(entries ?? {})) {
    if (isContrastSlot(key)) out[key] = value;
  }
  return out;
};

designSystemsRouter.post("/contrast-audit", asyncHandler(async (req: Request, res: Response) => {
  requireCaller(req);
  const input = parseBody(contrastAuditSchema, req.body);
  if (!input.tokens && input.tokensCss === undefined) {
    throw badRequest("Either tokens or tokensCss is required");
  }

  if (input.tokens) {
    const tokens: ContrastTokens = bySlot(input.tokens);
    ok(res, auditContrast(tokens, { names: bySlot(input.names) }));
    return;
  }
  ok(res, auditTokensCss(input.tokensCss ?? ""));
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
  ok(res, withContrast(created));
}));

designSystemsRouter.get("/:id", asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const { orgId } = requireCaller(req);
  const row = await designSystemRepository.findById(req.params.id, orgId);
  if (!row) throw notFound("Design system not found");
  ok(res, withContrast(row));
}));

designSystemsRouter.patch("/:id", asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const caller = requireCaller(req);
  const input = parseBody(updateSchema, req.body);

  const existing = await designSystemRepository.findById(req.params.id, caller.orgId);
  if (!existing) throw notFound("Design system not found");
  await assertCanWrite(existing.createdBy, caller);

  const updated = await designSystemRepository.update(existing.id, caller.orgId, {
    ...input,
    assets: toJsonInput(input.assets),
  });
  if (!updated) throw notFound("Design system not found");

  await writeAuditLog({
    actorUserId: caller.requesterId,
    eventType: "DESIGN_SYSTEM_UPDATED",
    targetId: updated.id,
    description: `Design system "${updated.name}" updated`,
    metadata: { orgId: caller.orgId, changed: Object.keys(input), version: updated.version },
  });

  ok(res, withContrast(updated));
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
