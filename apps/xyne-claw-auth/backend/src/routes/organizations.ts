/**
 * Organization management — PHASE 1 (org-only foundation).
 *
 * Read + member-management for the org(s) a user belongs to. With one-org-per-
 * user this is effectively the caller's single org, but the routes are written
 * to generalize. Mounted under `requireAuth` (main.ts), so `x-user-id` /
 * `x-org-id` / `x-user-role` are set for every request here.
 *
 * Gating:
 *   - GET routes: any member of the org.
 *   - member mutations (POST/PATCH/DELETE): OWNER or ADMIN (isOrgAdmin).
 *
 * DEFERRED to later phases (NOT here): org creation, invitations + email,
 * workspaces, transfer-ownership, delete-org.
 */

import { Router, type Request, type Response } from "express";
import { asyncHandler, ok, badRequest, unauthorized, forbidden, notFound, conflict, HttpError } from "../lib/http.js";
import { getRequesterId, isOrgAdmin, isOrgOwner } from "../middleware/agent-acl.js";
import { prisma } from "../db.js";
import { findUserByAnyId } from "../lib/users-jit.js";
import { agentScope, CHANNELS_POST_SCOPE, generateServiceToken, SERVICE_TOKEN_SCOPES } from "../lib/service-tokens.js";

import { createLogger } from "../logger.js";
const log = createLogger("organizations");

const router = Router();

type OrgRole = "OWNER" | "ADMIN" | "MEMBER";

/** True if `userId` is a current (non-left) member of `orgId`. */
export async function isOrgMember(userId: string, orgId: string): Promise<boolean> {
  const member = await prisma.orgMember.findUnique({
    where: { userId_orgId: { userId, orgId } },
    select: { leftAt: true },
  });
  return Boolean(member && member.leftAt === null);
}

/**
 * GET /organizations
 * Orgs the caller currently belongs to (with roles).
 */
router.get("/", asyncHandler(async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    throw unauthorized();
  }

  const memberships = await prisma.orgMember.findMany({
    where: { userId: requesterId, leftAt: null },
    select: {
      role: true,
      organization: {
        select: { id: true, name: true, description: true, status: true, createdAt: true },
      },
    },
    orderBy: { joinedAt: "asc" },
  });

  const data = memberships.map((m) => ({ ...m.organization, role: m.role }));
  ok(res, data);
}));

/**
 * GET /organizations/:id/surfaces
 * Connected surfaces for an org. Gated OWNER/ADMIN.
 */
router.get("/:id/surfaces", async (req: Request, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    const orgId = req.params["id"] as string;

    if (!(await isOrgAdmin(requesterId, orgId))) {
      res.status(403).json({ success: false, error: "Requires OWNER or ADMIN" });
      return;
    }

    const surfaces = await prisma.connectedSurface.findMany({
      where: { orgId },
      include: { surface: true },
      orderBy: { createdAt: "asc" },
    });

    const data = surfaces.map((connection) => {
      const raw = connection.config && typeof connection.config === "object" && !Array.isArray(connection.config)
        ? connection.config as Record<string, unknown>
        : {};
      const config = Object.fromEntries(
        Object.entries(raw).filter(([key]) => !/(token|secret)/i.test(key)),
      );
      const hasConfigPair = typeof raw["configAccessToken"] === "string"
        && typeof raw["configRefreshToken"] === "string";
      if (hasConfigPair) {
        const rotatedAt = typeof raw["configTokenRotatedAt"] === "string"
          ? Date.parse(raw["configTokenRotatedAt"])
          : Number.NaN;
        const storedStatus = raw["configTokenStatus"];
        config["configTokenStatus"] = storedStatus === "expired"
          || (Number.isFinite(rotatedAt) && Date.now() - rotatedAt >= 12 * 60 * 60 * 1000)
          ? "expired"
          : storedStatus === "valid" ? "valid" : "present";
        if (Number.isFinite(rotatedAt)) config["configTokenRotatedAt"] = new Date(rotatedAt).toISOString();
      }
      return { ...connection, accessToken: undefined, refreshToken: undefined, config };
    });

    res.json(data);
  } catch (err) {
    log.error("[organizations] list surfaces error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/** Org-managed bearer credentials for unattended external callers. */
router.post("/:id/service-tokens", asyncHandler(async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    throw unauthorized();
  }
  const orgId = req.params["id"] as string;
  if (!(await isOrgAdmin(requesterId, orgId))) {
    throw forbidden("Requires OWNER or ADMIN");
  }

  const body = req.body as { name?: unknown; userId?: unknown; expiresAt?: unknown; allowedAgentSlugs?: unknown; allowChannelPost?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  if (!name) {
    throw badRequest("name is required");
  }
  if (name.length > 60) {
    throw badRequest("name must be 60 characters or fewer");
  }
  if (!userId) {
    throw badRequest("userId is required");
  }
  if (!(await isOrgMember(userId, orgId))) {
    throw badRequest("userId must be a current member of this organization");
  }

  // Agent allowlist is REQUIRED: a service token can only ever invoke the
  // agents it was explicitly minted for (enforced in /run via agent:* scopes).
  const rawSlugs = body.allowedAgentSlugs;
  if (!Array.isArray(rawSlugs) || rawSlugs.length === 0) {
    throw badRequest("allowedAgentSlugs is required: list the agent slugs this token may invoke");
  }
  const allowedAgentSlugs = [...new Set(rawSlugs.map((slug) => typeof slug === "string" ? slug.trim() : "").filter(Boolean))];
  if (allowedAgentSlugs.length === 0 || allowedAgentSlugs.length > 20) {
    throw badRequest("allowedAgentSlugs must contain 1-20 agent slugs");
  }
  const knownAgents = await prisma.agent.findMany({
    where: { slug: { in: allowedAgentSlugs }, orgId },
    select: { slug: true },
  });
  const knownSlugs = new Set(knownAgents.map((agent) => agent.slug));
  const unknown = allowedAgentSlugs.filter((slug) => !knownSlugs.has(slug));
  if (unknown.length > 0) {
    throw badRequest(`Unknown agents in this organization: ${unknown.join(", ")}`);
  }

  let expiresAt: Date | null = null;
  if (body.expiresAt !== undefined && body.expiresAt !== null) {
    if (typeof body.expiresAt !== "string" || !body.expiresAt.trim()) {
      throw badRequest("expiresAt must be an ISO date string or null");
    }
    const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
    expiresAt = new Date(body.expiresAt);
    if (!isoTimestamp.test(body.expiresAt) || Number.isNaN(expiresAt.getTime())) {
      throw badRequest("expiresAt must be a valid ISO date string");
    }
  }

  const surface = await prisma.surface.findUnique({ where: { key: "api" }, select: { id: true } })
    ?? await prisma.surface.findUnique({ where: { key: "cli" }, select: { id: true } });
  if (!surface) {
    throw new HttpError(500, "No API or CLI surface is configured");
  }

  // Elevated: only when the admin explicitly opts in does the token get the
  // spaces:channels:post scope, letting its runs post results and approval
  // cards into Spaces channels the agent's app can reach. Deny-by-default.
  const allowChannelPost = body.allowChannelPost === true;

  const token = generateServiceToken();
  const created = await prisma.surfaceAccessToken.create({
    data: {
      userId,
      orgId,
      surfaceId: surface.id,
      client: "service",
      name,
      tokenHash: token.hashed,
      prefix: token.prefix,
      scopes: [...SERVICE_TOKEN_SCOPES, ...allowedAgentSlugs.map(agentScope), ...(allowChannelPost ? [CHANNELS_POST_SCOPE] : [])],
      expiresAt,
    },
    select: {
      id: true,
      name: true,
      prefix: true,
      userId: true,
      scopes: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });

  res.status(201).json({ success: true, data: { ...created, token: token.raw } });
}));

router.get("/:id/service-tokens", asyncHandler(async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    throw unauthorized();
  }
  const orgId = req.params["id"] as string;
  if (!(await isOrgAdmin(requesterId, orgId))) {
    throw forbidden("Requires OWNER or ADMIN");
  }

  const tokens = await prisma.surfaceAccessToken.findMany({
    where: { orgId, client: "service" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      userId: true,
      scopes: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });
  ok(res, tokens);
}));

router.delete("/:id/service-tokens/:tokenId", asyncHandler(async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    throw unauthorized();
  }
  const orgId = req.params["id"] as string;
  if (!(await isOrgAdmin(requesterId, orgId))) {
    throw forbidden("Requires OWNER or ADMIN");
  }

  const result = await prisma.surfaceAccessToken.updateMany({
    where: { id: req.params["tokenId"] as string, orgId, client: "service" },
    data: { revokedAt: new Date() },
  });
  if (result.count === 0) {
    throw notFound("Service token not found");
  }
  ok(res);
}));

/**
 * GET /organizations/:id
 * Org details + members. Gated: caller must be a member.
 */
router.get("/:id", asyncHandler(async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    throw unauthorized();
  }
  const orgId = req.params["id"] as string;

  if (!(await isOrgMember(requesterId, orgId))) {
    throw forbidden("Not a member of this organization");
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, description: true, status: true, createdAt: true, createdBy: true },
  });
  if (!org) {
    throw notFound("Organization not found");
  }

  const members = await prisma.orgMember.findMany({
    where: { orgId, leftAt: null },
    select: {
      role: true,
      joinedAt: true,
      user: { select: { id: true, email: true, name: true } },
    },
    orderBy: { joinedAt: "asc" },
  });

  ok(res, {
    ...org,
    members: members.map((m) => ({
      userId: m.user.id,
      email: m.user.email,
      name: m.user.name,
      role: m.role,
      joinedAt: m.joinedAt,
    })),
  });
}));

/**
 * POST /organizations/:id/members
 * Add an existing claw user (by id or email) to the org. Gated OWNER/ADMIN.
 * Phase 1 has no invitations/email — the target user must already exist
 * (JIT-mirrored). Body: { userIdOrEmail: string, role?: "ADMIN" | "MEMBER" }.
 */
router.post("/:id/members", asyncHandler(async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    throw unauthorized();
  }
  const orgId = req.params["id"] as string;

  if (!(await isOrgAdmin(requesterId, orgId))) {
    throw forbidden("Requires OWNER or ADMIN");
  }

  const body = req.body as { userIdOrEmail?: string; role?: string };
  const raw = (body.userIdOrEmail ?? "").trim();
  if (!raw) {
    throw badRequest("userIdOrEmail is required");
  }
  // POST never mints an OWNER — new members are MEMBER or ADMIN (an OWNER is
  // promoted afterwards via PATCH, which is OWNER-gated). Fails safe.
  const requestedRole: OrgRole = body.role === "ADMIN" ? "ADMIN" : "MEMBER";

  // `raw` may be a canonical Claw id, a Spaces workspace-scoped alias, or an
  // email — resolve through all three ladders before giving up.
  let targetUser = await findUserByAnyId(raw);
  if (!targetUser) targetUser = await prisma.user.findFirst({ where: { email: raw, orgId } });
  if (!targetUser) {
    throw notFound(`No user matches "${raw}"`);
  }

  const member = await prisma.orgMember.upsert({
    where: { userId_orgId: { userId: targetUser.id, orgId } },
    create: { orgId, userId: targetUser.id, role: requestedRole, invitedBy: requesterId },
    update: { role: requestedRole, leftAt: null },
  });
  // Keep the denormalized pointer on User in sync (single-org phase 1).
  await prisma.user.update({ where: { id: targetUser.id }, data: { orgId } });

  log.info(`[organizations] ${targetUser.email} added to org ${orgId} as ${requestedRole} by ${requesterId}`);
  res.status(201).json({ success: true, data: member });
}));

/**
 * PATCH /organizations/:id/members/:userId
 * Change a member's role. Gated OWNER/ADMIN. Body: { role: "OWNER"|"ADMIN"|"MEMBER" }.
 */
router.patch("/:id/members/:userId", asyncHandler(async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    throw unauthorized();
  }
  const orgId = req.params["id"] as string;

  if (!(await isOrgAdmin(requesterId, orgId))) {
    throw forbidden("Requires OWNER or ADMIN");
  }

  // The URL parameter may be a canonical Claw id OR a Spaces alias —
  // normalize when resolvable; otherwise the membership lookup reports not-found.
  const targetUserId = (await findUserByAnyId(req.params["userId"] as string))?.id
    ?? (req.params["userId"] as string);

  const role = (req.body as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN" && role !== "MEMBER") {
    throw badRequest("role must be OWNER, ADMIN, or MEMBER");
  }

  const existing = await prisma.orgMember.findUnique({
    where: { userId_orgId: { userId: targetUserId, orgId } },
    select: { role: true, leftAt: true },
  });
  if (!existing || existing.leftAt !== null) {
    throw notFound("Member not found in this organization");
  }

  // Anything touching the OWNER role — promoting a member TO owner, or changing
  // an existing OWNER's role — is OWNER-only. An ADMIN cannot self-promote to
  // OWNER or demote an owner (isOrgAdmin alone would allow both). This mirrors
  // the POST route, which never lets an ADMIN mint an OWNER.
  const targetIsOwner = existing.role === "OWNER";
  if ((role === "OWNER" || targetIsOwner) && !(await isOrgOwner(requesterId, orgId))) {
    throw forbidden("Only an OWNER can grant or change the OWNER role");
  }

  // Last-OWNER guard (mirrors DELETE): don't demote the sole OWNER and orphan
  // the org.
  if (targetIsOwner && role !== "OWNER") {
    const owners = await prisma.orgMember.count({ where: { orgId, role: "OWNER", leftAt: null } });
    if (owners <= 1) {
      throw conflict("Cannot demote the last OWNER of the organization");
    }
  }

  const member = await prisma.orgMember.update({
    where: { userId_orgId: { userId: targetUserId, orgId } },
    data: { role },
  });

  log.info(`[organizations] role of ${targetUserId} in org ${orgId} set to ${role} by ${requesterId}`);
  ok(res, member);
}));

/**
 * DELETE /organizations/:id/members/:userId
 * Remove a member (soft — sets leftAt). Gated OWNER/ADMIN. Cannot remove the
 * last OWNER (org would be orphaned).
 */
router.delete("/:id/members/:userId", asyncHandler(async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    throw unauthorized();
  }
  const orgId = req.params["id"] as string;

  if (!(await isOrgAdmin(requesterId, orgId))) {
    throw forbidden("Requires OWNER or ADMIN");
  }

  // The URL parameter may be a canonical Claw id OR a Spaces alias —
  // normalize when resolvable; otherwise the membership lookup reports not-found.
  const targetUserId = (await findUserByAnyId(req.params["userId"] as string))?.id
    ?? (req.params["userId"] as string);

  const target = await prisma.orgMember.findUnique({
    where: { userId_orgId: { userId: targetUserId, orgId } },
    select: { role: true, leftAt: true },
  });
  if (!target || target.leftAt !== null) {
    throw notFound("Member not found in this organization");
  }

  // Guard: don't strip the org of its last OWNER.
  if (target.role === "OWNER") {
    const owners = await prisma.orgMember.count({ where: { orgId, role: "OWNER", leftAt: null } });
    if (owners <= 1) {
      throw conflict("Cannot remove the last OWNER of the organization");
    }
  }

  await prisma.orgMember.update({
    where: { userId_orgId: { userId: targetUserId, orgId } },
    data: { leftAt: new Date() },
  });

  log.info(`[organizations] ${targetUserId} removed from org ${orgId} by ${requesterId}`);
  ok(res);
}));

export const organizationsRouter = router;
