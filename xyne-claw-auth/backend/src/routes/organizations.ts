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
import { getRequesterId, isOrgAdmin, isOrgOwner } from "../middleware/agent-acl.js";
import { userRepository } from "../repositories/index.js";
import { prisma } from "../db.js";
import { generateServiceToken, SERVICE_TOKEN_SCOPES } from "../lib/service-tokens.js";

import { createLogger } from "../logger.js";
const log = createLogger("organizations");

const router = Router();

type OrgRole = "OWNER" | "ADMIN" | "MEMBER";

/** True if `userId` is a current (non-left) member of `orgId`. */
async function isOrgMember(userId: string, orgId: string): Promise<boolean> {
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
router.get("/", async (req: Request, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
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
    res.json({ success: true, data });
  } catch (err) {
    log.error("[organizations] list error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

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
router.post("/:id/service-tokens", async (req: Request, res: Response) => {
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

    const body = req.body as { name?: unknown; userId?: unknown; expiresAt?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    if (!name) {
      res.status(400).json({ success: false, error: "name is required" });
      return;
    }
    if (name.length > 60) {
      res.status(400).json({ success: false, error: "name must be 60 characters or fewer" });
      return;
    }
    if (!userId) {
      res.status(400).json({ success: false, error: "userId is required" });
      return;
    }
    if (!(await isOrgMember(userId, orgId))) {
      res.status(400).json({ success: false, error: "userId must be a current member of this organization" });
      return;
    }

    let expiresAt: Date | null = null;
    if (body.expiresAt !== undefined && body.expiresAt !== null) {
      if (typeof body.expiresAt !== "string" || !body.expiresAt.trim()) {
        res.status(400).json({ success: false, error: "expiresAt must be an ISO date string or null" });
        return;
      }
      const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
      expiresAt = new Date(body.expiresAt);
      if (!isoTimestamp.test(body.expiresAt) || Number.isNaN(expiresAt.getTime())) {
        res.status(400).json({ success: false, error: "expiresAt must be a valid ISO date string" });
        return;
      }
    }

    const surface = await prisma.surface.findUnique({ where: { key: "api" }, select: { id: true } })
      ?? await prisma.surface.findUnique({ where: { key: "cli" }, select: { id: true } });
    if (!surface) {
      res.status(500).json({ success: false, error: "No API or CLI surface is configured" });
      return;
    }

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
        scopes: SERVICE_TOKEN_SCOPES,
        expiresAt,
      },
      select: {
        id: true,
        name: true,
        prefix: true,
        userId: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });

    res.status(201).json({ success: true, data: { ...created, token: token.raw } });
  } catch (err) {
    log.error("[organizations] mint service token error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.get("/:id/service-tokens", async (req: Request, res: Response) => {
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

    const tokens = await prisma.surfaceAccessToken.findMany({
      where: { orgId, client: "service" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        prefix: true,
        userId: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
    res.json({ success: true, data: tokens });
  } catch (err) {
    log.error("[organizations] list service tokens error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.delete("/:id/service-tokens/:tokenId", async (req: Request, res: Response) => {
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

    const result = await prisma.surfaceAccessToken.updateMany({
      where: { id: req.params["tokenId"] as string, orgId, client: "service" },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) {
      res.status(404).json({ success: false, error: "Service token not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    log.error("[organizations] revoke service token error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * GET /organizations/:id
 * Org details + members. Gated: caller must be a member.
 */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    const orgId = req.params["id"] as string;

    if (!(await isOrgMember(requesterId, orgId))) {
      res.status(403).json({ success: false, error: "Not a member of this organization" });
      return;
    }

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, description: true, status: true, createdAt: true, createdBy: true },
    });
    if (!org) {
      res.status(404).json({ success: false, error: "Organization not found" });
      return;
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

    res.json({
      success: true,
      data: {
        ...org,
        members: members.map((m) => ({
          userId: m.user.id,
          email: m.user.email,
          name: m.user.name,
          role: m.role,
          joinedAt: m.joinedAt,
        })),
      },
    });
  } catch (err) {
    log.error("[organizations] get error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * POST /organizations/:id/members
 * Add an existing claw user (by id or email) to the org. Gated OWNER/ADMIN.
 * Phase 1 has no invitations/email — the target user must already exist
 * (JIT-mirrored). Body: { userIdOrEmail: string, role?: "ADMIN" | "MEMBER" }.
 */
router.post("/:id/members", async (req: Request, res: Response) => {
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

    const body = req.body as { userIdOrEmail?: string; role?: string };
    const raw = (body.userIdOrEmail ?? "").trim();
    if (!raw) {
      res.status(400).json({ success: false, error: "userIdOrEmail is required" });
      return;
    }
    // POST never mints an OWNER — new members are MEMBER or ADMIN (an OWNER is
    // promoted afterwards via PATCH, which is OWNER-gated). Fails safe.
    const requestedRole: OrgRole = body.role === "ADMIN" ? "ADMIN" : "MEMBER";

    let targetUser = await userRepository.findById(raw);
    if (!targetUser) targetUser = await prisma.user.findFirst({ where: { email: raw, orgId } });
    if (!targetUser) {
      res.status(404).json({ success: false, error: `No user matches "${raw}"` });
      return;
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
  } catch (err) {
    log.error("[organizations] add member error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * PATCH /organizations/:id/members/:userId
 * Change a member's role. Gated OWNER/ADMIN. Body: { role: "OWNER"|"ADMIN"|"MEMBER" }.
 */
router.patch("/:id/members/:userId", async (req: Request, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    const orgId = req.params["id"] as string;
    const targetUserId = req.params["userId"] as string;

    if (!(await isOrgAdmin(requesterId, orgId))) {
      res.status(403).json({ success: false, error: "Requires OWNER or ADMIN" });
      return;
    }

    const role = (req.body as { role?: string }).role;
    if (role !== "OWNER" && role !== "ADMIN" && role !== "MEMBER") {
      res.status(400).json({ success: false, error: "role must be OWNER, ADMIN, or MEMBER" });
      return;
    }

    const existing = await prisma.orgMember.findUnique({
      where: { userId_orgId: { userId: targetUserId, orgId } },
      select: { role: true, leftAt: true },
    });
    if (!existing || existing.leftAt !== null) {
      res.status(404).json({ success: false, error: "Member not found in this organization" });
      return;
    }

    // Anything touching the OWNER role — promoting a member TO owner, or changing
    // an existing OWNER's role — is OWNER-only. An ADMIN cannot self-promote to
    // OWNER or demote an owner (isOrgAdmin alone would allow both). This mirrors
    // the POST route, which never lets an ADMIN mint an OWNER.
    const targetIsOwner = existing.role === "OWNER";
    if ((role === "OWNER" || targetIsOwner) && !(await isOrgOwner(requesterId, orgId))) {
      res.status(403).json({ success: false, error: "Only an OWNER can grant or change the OWNER role" });
      return;
    }

    // Last-OWNER guard (mirrors DELETE): don't demote the sole OWNER and orphan
    // the org.
    if (targetIsOwner && role !== "OWNER") {
      const owners = await prisma.orgMember.count({ where: { orgId, role: "OWNER", leftAt: null } });
      if (owners <= 1) {
        res.status(409).json({ success: false, error: "Cannot demote the last OWNER of the organization" });
        return;
      }
    }

    const member = await prisma.orgMember.update({
      where: { userId_orgId: { userId: targetUserId, orgId } },
      data: { role },
    });

    log.info(`[organizations] role of ${targetUserId} in org ${orgId} set to ${role} by ${requesterId}`);
    res.json({ success: true, data: member });
  } catch (err) {
    log.error("[organizations] update member error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * DELETE /organizations/:id/members/:userId
 * Remove a member (soft — sets leftAt). Gated OWNER/ADMIN. Cannot remove the
 * last OWNER (org would be orphaned).
 */
router.delete("/:id/members/:userId", async (req: Request, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    const orgId = req.params["id"] as string;
    const targetUserId = req.params["userId"] as string;

    if (!(await isOrgAdmin(requesterId, orgId))) {
      res.status(403).json({ success: false, error: "Requires OWNER or ADMIN" });
      return;
    }

    const target = await prisma.orgMember.findUnique({
      where: { userId_orgId: { userId: targetUserId, orgId } },
      select: { role: true, leftAt: true },
    });
    if (!target || target.leftAt !== null) {
      res.status(404).json({ success: false, error: "Member not found in this organization" });
      return;
    }

    // Guard: don't strip the org of its last OWNER.
    if (target.role === "OWNER") {
      const owners = await prisma.orgMember.count({ where: { orgId, role: "OWNER", leftAt: null } });
      if (owners <= 1) {
        res.status(409).json({ success: false, error: "Cannot remove the last OWNER of the organization" });
        return;
      }
    }

    await prisma.orgMember.update({
      where: { userId_orgId: { userId: targetUserId, orgId } },
      data: { leftAt: new Date() },
    });

    log.info(`[organizations] ${targetUserId} removed from org ${orgId} by ${requesterId}`);
    res.json({ success: true });
  } catch (err) {
    log.error("[organizations] remove member error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export const organizationsRouter = router;
