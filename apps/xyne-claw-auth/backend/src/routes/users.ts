import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { asyncHandler, ok, badRequest, forbidden, notFound, HttpError } from "../lib/http.js";
import { prisma } from "../db.js";
import { decrypt, encrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { hasConnectorDefinition } from "../mcp/connector-definitions.js";
import { syncToolsForServer } from "../tool-sync.js";
import { evictSession } from "../mcp/runner.js";
import {
  getDefaultOrgId,
  ensureOrgMembership,
  ensureUserExists,
  findUserByAnyId,
  resolveClawUserIdForSpacesIdentity,
} from "../lib/users-jit.js";
import { getOrgId, getRequesterId } from "../middleware/agent-acl.js";
import { getWorkspaceIdForUser, requestWorkspaceHint } from "../lib/spaces-db.js";
import { getCanonicalRequesterId, matchesAuthenticatedUserId } from "../middleware/pin-user-id-param.js";

import { createLogger } from "../logger.js";
const log = createLogger("users");
const router = Router();

/**
 * GET /users/me
 *
 * The Spaces cookie identifies a workspace-scoped Spaces user, whereas Claw
 * owns the canonical person id. `requireAuth` resolves that identity before
 * this handler runs and stamps both values onto the request. The SPA must use
 * `userId` for every Claw URL; retaining the raw Spaces id here is useful only
 * to callers that also need to call Spaces directly.
 */
router.get("/me", (req: Request, res: Response) => {
  const userId = req.headers["x-user-id"];
  if (typeof userId !== "string" || !userId) {
    res.status(401).json({ success: false, error: "authenticated user required" });
    return;
  }

  const spacesUserId = req.headers["x-spaces-user-id"];
  const spacesWorkspaceId = req.headers["x-spaces-workspace-id"];
  const spacesOrgMemberId = req.headers["x-spaces-org-member-id"];
  res.json({
    success: true,
    data: {
      userId,
      ...(typeof spacesUserId === "string" && spacesUserId ? { spacesUserId } : {}),
      ...(typeof spacesWorkspaceId === "string" && spacesWorkspaceId ? { spacesWorkspaceId } : {}),
      ...(typeof spacesOrgMemberId === "string" && spacesOrgMemberId ? { spacesOrgMemberId } : {}),
    },
  });
});

/**
 * GET /users[?q=<substr>]
 *
 * List claw users for the Contributors typeahead. Only returns people who
 * already exist locally — sharing is limited to people who've actually
 * interacted with claw (webhook, dashboard, scheduled job). New Spaces
 * users become resolvable automatically once they trigger any JIT path.
 *
 * The `q` filter does a case-insensitive substring match on both `email`
 * and `name`. Capped at 20 to keep the dropdown payload small.
 *
 * Response: `{ success: true, data: [{ id, email, name }, ...] }`
 */
router.get("/", asyncHandler(async (req: Request, res: Response) => {
  const qRaw = req.query["q"];
  const q = typeof qRaw === "string" ? qRaw.trim() : "";
  const requesterId = getRequesterId(req);
  const orgId = getOrgId(req)
    ?? (requesterId
      ? (await prisma.user.findUnique({ where: { id: requesterId }, select: { orgId: true } }))?.orgId
      : undefined);
  if (!orgId) {
    log.error(`[users] orgId is required; refusing global user typeahead requesterId=${requesterId ?? "none"} q=${q || "none"}`);
    throw badRequest("orgId is required");
  }

  const users = await prisma.user.findMany({
    where: {
      orgId,
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: "insensitive" as const } },
              { name: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    select: { id: true, email: true, name: true },
    orderBy: { name: "asc" },
    take: 20,
  });

  ok(res, users);
}));

router.post("/", asyncHandler(async (req: Request, res: Response) => {
  const { id, email, name, spacesToken } = req.body as {
    id?: string;
    email?: string;
    name?: string;
    spacesToken?: string;
  };

  if (!id || typeof id !== "string" || id.trim().length === 0) {
    throw badRequest("id is required");
  }

  if (!email || typeof email !== "string" || email.trim().length === 0) {
    throw badRequest("email is required");
  }

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    throw badRequest("name is required");
  }

  if (getCanonicalRequesterId(req) && !matchesAuthenticatedUserId(req, id.trim())) {
    throw forbidden("Body id does not match authenticated session");
  }

  // Org placement (§13): prefer the mapping-aware JIT path so a second-tenant
  // user lands in the RIGHT org (via SurfaceTenantLink), not the default. It
  // creates the row (with the mapped org + membership) if new, then we sync the
  // client-supplied email/name. If JIT can't resolve the Spaces profile
  // (transient DB miss / user not in Spaces), fall back to creating from the
  // request body in the default org — preserves this endpoint's resilience.
  let user;
  const jitOk = await ensureUserExists(id.trim(), "require-auth");
  if (jitOk) {
    // Disambiguate users with memberships in two Spaces workspaces: requireAuth
    // already verified and stamped the requesting workspace on this request.
    const clawUserId = await resolveClawUserIdForSpacesIdentity(id.trim(), requestWorkspaceHint(req));
    if (!clawUserId) {
      log.error(`[users] JIT resolved Spaces user ${id.trim()} but no Claw identity exists`);
      throw new HttpError(503, "User identity is still being synchronized");
    }
    user = await prisma.user.update({
      where: { id: clawUserId },
      data: { email: email.trim(), name: name.trim() },
    });
    // Gap 8: re-assert OrgMembership for a pre-existing user (ensureUserExists
    // short-circuits without touching it when the row already exists). Idempotent.
    await ensureOrgMembership(user.id, user.orgId);
  } else {
    // orgId is NOT NULL — a new user row must carry it at insert time.
    const orgId = await getDefaultOrgId();
    if (!orgId) {
      log.error(`[users] default org not provisioned — cannot create user ${id.trim()}. Run backfill-default-org.ts.`);
      throw new HttpError(503, "Default organization not provisioned");
    }
    // The user may already exist locally under a canonical id (provisioned
    // via spaces-sync or an earlier flow) even when the Spaces profile is
    // unreachable. Resolve before creating or we'd mint a duplicate person.
    const existingUser = await findUserByAnyId(id.trim());
    if (existingUser) {
      user = await prisma.user.update({
        where: { id: existingUser.id },
        data: { email: email.trim(), name: name.trim() },
      });
    } else {
      user = await prisma.user.create({
        data: {
          id: `claw-user-${randomUUID()}`,
          email: email.trim(),
          name: name.trim(),
          orgId,
        },
      });
    }
    // Re-assert membership in the org the row belongs to (the resolved
    // existing row's org may differ from the default used for new rows).
    await ensureOrgMembership(user.id, user.orgId);
  }

  // claw-auth no longer stores users' Spaces tokens or session ids (they let it
  // act as the user indefinitely). Spaces access is per request: the user's own
  // cookie when they are present, or the agent's on-behalf-of token in a run.

  ok(res, user);
}));


/** True when the stored blob already holds exactly these credentials. */
function sameCredentials(
  row: { encryptedCreds: string; iv: string; authTag: string },
  next: Record<string, string>,
): boolean {
  try {
    const current = JSON.parse(decrypt(row.encryptedCreds, row.iv, row.authTag, CONFIG.encryptionKey)) as Record<string, string>;
    const keys = new Set([...Object.keys(current), ...Object.keys(next)]);
    return [...keys].every((k) => current[k] === next[k]);
  } catch {
    // Undecryptable means a key rotation or a corrupt row; rewriting is the fix.
    return false;
  }
}


router.get("/:id", asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const requesterId = getRequesterId(req);
  const orgId =
    getOrgId(req) ??
    (requesterId
      ? (await prisma.user.findUnique({ where: { id: requesterId }, select: { orgId: true } }))?.orgId
      : undefined);
  if (!orgId) {
    log.error(`[users] orgId is required; refusing cross-org user lookup requesterId=${requesterId ?? "none"} id=${req.params.id}`);
    throw badRequest("orgId is required");
  }

  // `:id` may be a canonical Claw id or a Spaces workspace-scoped alias —
  // resolve through the identity/exact-id ladder before scoping by org.
  const resolved = await findUserByAnyId(req.params.id);
  if (!resolved || resolved.orgId !== orgId) {
    throw notFound("User not found");
  }

  ok(res, { id: resolved.id, email: resolved.email, name: resolved.name });
}));

export { router as usersRouter };
