import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { OrgRole } from "@prisma/client";
import { prisma, type AppPrismaClient, type AppTransactionClient } from "../db.js";
import { createLogger } from "../logger.js";

const log = createLogger("spaces-sync");
const router = Router();

class SyncError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type DbClient = AppPrismaClient | AppTransactionClient;

function stringField(body: Record<string, unknown>, key: string, required = true): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    if (required) throw new SyncError(400, `${key} is required`);
    return "";
  }
  return value.trim();
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Platform roles are privileged, so this intentionally accepts only a literal
 * boolean from the already-authenticated internal provisioning contract.
 */
export function optionalBoolean(body: Record<string, unknown>, key: string): boolean {
  const value = body[key];
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new SyncError(400, `${key} must be a boolean`);
  return value;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function mapOrgStatus(status: string | undefined): "ACTIVE" | "ARCHIVED" | "DELETED" {
  if (status === "ARCHIVED" || status === "DELETED") return status;
  return "ACTIVE";
}

function mapSurfaceStatus(status: string | undefined): "ACTIVE" | "INACTIVE" {
  return status === "ACTIVE" || !status ? "ACTIVE" : "INACTIVE";
}

function mapOrgRole(role: string | undefined): OrgRole {
  const normalized = role?.trim().toUpperCase();
  if (
    normalized === OrgRole.OWNER ||
    normalized === OrgRole.ADMIN ||
    normalized === OrgRole.MEMBER ||
    normalized === OrgRole.COMMUNITY_MEMBER
  ) {
    return normalized;
  }
  // Unrecognized or missing role falls back to MEMBER.
  return OrgRole.MEMBER;
}

async function ensureSpacesSurface(client: DbClient): Promise<void> {
  const byId = await client.surface.findUnique({ where: { id: "spaces" }, select: { id: true, key: true } });
  if (byId) {
    if (byId.key !== "spaces") {
      await client.surface.update({ where: { id: "spaces" }, data: { key: "spaces" } });
    }
    return;
  }

  const byKey = await client.surface.findUnique({ where: { key: "spaces" }, select: { id: true } });
  if (byKey && byKey.id !== "spaces") {
    throw new SyncError(409, `surface key "spaces" already exists with id ${byKey.id}; expected id "spaces"`);
  }

  await client.surface.create({
    data: {
      id: "spaces",
      key: "spaces",
      identityMode: "USER_ID",
      supportsUserResolution: true,
      status: "ACTIVE",
    },
  });
}

async function ensureOrgMapping(
  client: DbClient,
  input: {
    spacesOrgId: string;
    name?: string | undefined;
    description?: string | undefined;
    createdBySpacesUserId?: string | undefined;
    status?: string | undefined;
    metadata?: unknown;
  },
): Promise<{ orgId: string; created: boolean }> {
  await ensureSpacesSurface(client);

  const rows = await client.connectedSurface.findMany({
    where: {
      surfaceId: "spaces",
      surfaceTenantId: "",
      surfaceOrgId: input.spacesOrgId,
    },
    select: { id: true, orgId: true },
    orderBy: { createdAt: "asc" },
    take: 2,
  });

  const orgIds = [...new Set(rows.map((row) => row.orgId))];
  if (orgIds.length > 1) {
    throw new SyncError(409, `Spaces org ${input.spacesOrgId} maps to multiple Claw orgs: ${orgIds.join(",")}`);
  }

  if (rows[0]) {
    if (input.name || input.description || input.status) {
      await client.organization.update({
        where: { id: rows[0].orgId },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.status ? { status: mapOrgStatus(input.status) } : {}),
        },
      });
    }
    return { orgId: rows[0].orgId, created: false };
  }

  if (!input.name) {
    throw new SyncError(409, `No Claw org mapping exists for Spaces org ${input.spacesOrgId}`);
  }

  const nameCollision = await client.organization.findUnique({
    where: { name: input.name },
    select: { id: true },
  });
  if (nameCollision) {
    throw new SyncError(409, `Claw organization name "${input.name}" already exists without a Spaces mapping`);
  }

  const org = await client.organization.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      createdBy: input.createdBySpacesUserId || "spaces-sync",
      status: mapOrgStatus(input.status),
      metadata: {
        source: "spaces",
        spacesOrgId: input.spacesOrgId,
        spacesMetadata: input.metadata ?? null,
      },
    },
    select: { id: true },
  });

  await client.connectedSurface.create({
    data: {
      orgId: org.id,
      surfaceId: "spaces",
      surfaceTenantId: "",
      surfaceOrgId: input.spacesOrgId,
      status: "ACTIVE",
      config: { kind: "spaces-org" },
    },
  });

  return { orgId: org.id, created: true };
}

async function ensureWorkspaceMapping(
  client: DbClient,
  input: {
    spacesWorkspaceId: string;
    spacesOrgId: string;
    name?: string | undefined;
    orgName?: string | undefined;
    description?: string | undefined;
    createdBySpacesUserId?: string | undefined;
    status?: string | undefined;
    metadata?: unknown;
  },
): Promise<{ orgId: string; connectedSurfaceId: string; created: boolean }> {
  const org = await ensureOrgMapping(client, {
    spacesOrgId: input.spacesOrgId,
    name: input.orgName,
    createdBySpacesUserId: input.createdBySpacesUserId,
  });

  const existingRows = await client.connectedSurface.findMany({
    where: {
      surfaceId: "spaces",
      surfaceTenantId: input.spacesWorkspaceId,
    },
    select: { id: true, orgId: true, surfaceOrgId: true },
    orderBy: { createdAt: "asc" },
    take: 2,
  });
  const conflicting = existingRows.find((row) => row.orgId !== org.orgId);
  if (conflicting) {
    throw new SyncError(
      409,
      `Spaces workspace ${input.spacesWorkspaceId} is already mapped to Claw org ${conflicting.orgId}`,
    );
  }
  const mismatched = existingRows.find((row) => row.surfaceOrgId && row.surfaceOrgId !== input.spacesOrgId);
  if (mismatched) {
    throw new SyncError(
      409,
      `Spaces workspace ${input.spacesWorkspaceId} mapping has surfaceOrgId ${mismatched.surfaceOrgId}; Spaces says ${input.spacesOrgId}`,
    );
  }

  const before = await client.connectedSurface.findUnique({
    where: {
      orgId_surfaceId_surfaceTenantId: {
        orgId: org.orgId,
        surfaceId: "spaces",
        surfaceTenantId: input.spacesWorkspaceId,
      },
    },
    select: { id: true },
  });

  const row = await client.connectedSurface.upsert({
    where: {
      orgId_surfaceId_surfaceTenantId: {
        orgId: org.orgId,
        surfaceId: "spaces",
        surfaceTenantId: input.spacesWorkspaceId,
      },
    },
    create: {
      orgId: org.orgId,
      surfaceId: "spaces",
      surfaceTenantId: input.spacesWorkspaceId,
      surfaceOrgId: input.spacesOrgId,
      status: mapSurfaceStatus(input.status),
      config: {
        kind: "spaces-workspace",
        name: input.name ?? null,
        description: input.description ?? null,
        spacesMetadata: input.metadata ?? null,
      },
    },
    update: {
      surfaceOrgId: input.spacesOrgId,
      status: mapSurfaceStatus(input.status),
      config: {
        kind: "spaces-workspace",
        name: input.name ?? null,
        description: input.description ?? null,
        spacesMetadata: input.metadata ?? null,
      },
    },
    select: { id: true },
  });

  return { orgId: org.orgId, connectedSurfaceId: row.id, created: !before };
}

async function linkSpacesUserIdentity(
  client: DbClient,
  input: {
    orgId: string;
    userId: string;
    spacesUserId: string;
    spacesWorkspaceId: string;
    status?: string | undefined;
    /** Spaces org_members id — stored as the generic surface member key. */
    memberId?: string | undefined;
  },
): Promise<void> {
  const existing = await client.userSurfaceIdentity.findUnique({
    where: {
      surfaceId_surfaceWorkspaceId_surfaceUserId: {
        surfaceId: "spaces",
        surfaceWorkspaceId: input.spacesWorkspaceId,
        surfaceUserId: input.spacesUserId,
      },
    },
    select: { id: true, userId: true, orgId: true },
  });

  if (existing?.userId && existing.userId !== input.userId) {
    throw new SyncError(
      409,
      `Spaces user ${input.spacesUserId} in workspace ${input.spacesWorkspaceId} is already linked to Claw user ${existing.userId}`,
    );
  }
  if (existing?.orgId && existing.orgId !== input.orgId) {
    throw new SyncError(
      409,
      `Spaces user ${input.spacesUserId} in workspace ${input.spacesWorkspaceId} is already linked to Claw org ${existing.orgId}`,
    );
  }

  await client.userSurfaceIdentity.upsert({
    where: {
      surfaceId_surfaceWorkspaceId_surfaceUserId: {
        surfaceId: "spaces",
        surfaceWorkspaceId: input.spacesWorkspaceId,
        surfaceUserId: input.spacesUserId,
      },
    },
    create: {
      surfaceId: "spaces",
      surfaceWorkspaceId: input.spacesWorkspaceId,
      surfaceUserId: input.spacesUserId,
      orgId: input.orgId,
      userId: input.userId,
      ...(input.memberId ? { surfaceMemberId: input.memberId } : {}),
      status: mapSurfaceStatus(input.status),
      linkedAt: new Date(),
      lastSeenAt: new Date(),
    },
    update: {
      orgId: input.orgId,
      userId: input.userId,
      ...(input.memberId ? { surfaceMemberId: input.memberId } : {}),
      status: mapSurfaceStatus(input.status),
      lastSeenAt: new Date(),
      linkedAt: new Date(),
    },
  });
}

router.post("/org", async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;
    const spacesOrgId = stringField(body, "spacesOrgId");
    const name = stringField(body, "name");
    const result = await prisma.$transaction(async (tx) => {
      return ensureOrgMapping(tx, {
        spacesOrgId,
        name,
        description: optionalString(body, "description"),
        createdBySpacesUserId: optionalString(body, "createdBySpacesUserId"),
        status: optionalString(body, "status"),
        metadata: body["metadata"],
      });
    });
    res.json({ success: true, data: result });
  } catch (err) {
    handleSyncError(res, "org", err);
  }
});

router.post("/workspace", async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;
    const spacesWorkspaceId = stringField(body, "spacesWorkspaceId");
    const spacesOrgId = stringField(body, "spacesOrgId");
    const result = await prisma.$transaction(async (tx) => {
      return ensureWorkspaceMapping(tx, {
        spacesWorkspaceId,
        spacesOrgId,
        name: optionalString(body, "name"),
        orgName: optionalString(body, "orgName"),
        description: optionalString(body, "description"),
        createdBySpacesUserId: optionalString(body, "createdBySpacesUserId"),
        status: optionalString(body, "status"),
        metadata: body["metadata"],
      });
    });
    res.json({ success: true, data: result });
  } catch (err) {
    handleSyncError(res, "workspace", err);
  }
});

router.post("/user", async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;
    const spacesUserId = stringField(body, "spacesUserId");
    const spacesWorkspaceId = stringField(body, "spacesWorkspaceId");
    const spacesOrgId = stringField(body, "spacesOrgId");
    // Person resolution is EMAIL-PRIMARY (product decision): (email, orgId) is
    // the per-person identity invariant for this deployment. The payload MAY
    // carry spacesOrgMemberId; we store it only on surface identity rows
    // (generic surfaceMemberId) as the hard-refuse signal against
    // email-collision merges — the users table stays free of the key.
    const spacesOrgMemberId = optionalString(body, "spacesOrgMemberId")
      ?? optionalString(body, "orgMemberId");
    const email = normalizeEmail(stringField(body, "email"));
    const name = stringField(body, "name");
    const grantClawAdmin = optionalBoolean(body, "grantClawAdmin");
    const result = await prisma.$transaction(async (tx) => {
      const workspace = await ensureWorkspaceMapping(tx, {
        spacesWorkspaceId,
        spacesOrgId,
        name: optionalString(body, "workspaceName"),
        orgName: optionalString(body, "orgName"),
        createdBySpacesUserId: optionalString(body, "createdBySpacesUserId") ?? spacesUserId,
        status: "ACTIVE",
      });

      const exactUser = await tx.user.findUnique({
        where: { id: spacesUserId },
        select: { id: true, email: true, orgId: true },
      });
      const emailUser = await tx.user.findFirst({
        where: { orgId: workspace.orgId, email: { equals: email, mode: "insensitive" } },
        select: { id: true, email: true, orgId: true },
      });

      const memberIdentityUserIds = spacesOrgMemberId
        ? [...new Set(
            (await tx.userSurfaceIdentity.findMany({
              where: {
                surfaceId: "spaces",
                orgId: workspace.orgId,
                surfaceMemberId: spacesOrgMemberId,
                userId: { not: null },
              },
              select: { userId: true },
            })).map((row) => row.userId as string),
          )]
        : [];
      if (memberIdentityUserIds.length > 1) {
        throw new SyncError(
          409,
          `Spaces org member ${spacesOrgMemberId} is linked to multiple Claw users: ${memberIdentityUserIds.join(", ")}`,
        );
      }
      const memberUserId = memberIdentityUserIds[0];
      if (memberUserId && exactUser && memberUserId !== exactUser.id) {
        throw new SyncError(
          409,
          `Spaces org member ${spacesOrgMemberId} resolves to Claw user ${memberUserId}, ` +
            `but workspace user ${spacesUserId} resolves to ${exactUser.id}`,
        );
      }
      if (memberUserId && emailUser && memberUserId !== emailUser.id) {
        throw new SyncError(
          409,
          `Spaces org member ${spacesOrgMemberId} resolves to Claw user ${memberUserId}, ` +
            `but email ${email} resolves to ${emailUser.id} in org ${workspace.orgId}`,
        );
      }
      if (spacesOrgMemberId && emailUser && !memberUserId) {
        const knownMembers = await tx.userSurfaceIdentity.findMany({
          where: {
            surfaceId: "spaces", orgId: workspace.orgId, userId: emailUser.id, surfaceMemberId: { not: null },
          },
          select: { surfaceMemberId: true },
          distinct: ["surfaceMemberId"],
        });
        if (knownMembers.length > 0) {
          throw new SyncError(
            409,
            `Email ${email} in org ${workspace.orgId} already belongs to distinct member(s) ` +
              `${knownMembers.map((row) => row.surfaceMemberId).join(", ")}; received ${spacesOrgMemberId} — refusing merge`,
          );
        }
      }

      if (exactUser && exactUser.orgId !== workspace.orgId) {
        throw new SyncError(
          409,
          `Claw user id ${spacesUserId} already belongs to org ${exactUser.orgId}; Spaces says ${workspace.orgId}`,
        );
      }
      if (exactUser && emailUser && exactUser.id !== emailUser.id) {
        throw new SyncError(
          409,
          `Spaces user ${spacesUserId} conflicts with existing Claw user ${emailUser.id} for ${email} in org ${workspace.orgId}`,
        );
      }

      const role = mapOrgRole(optionalString(body, "role"));
      const existingCanonicalUser = memberUserId
        ? { id: memberUserId, email: emailUser?.email ?? email, orgId: workspace.orgId }
        : exactUser ?? emailUser;
      const canonicalUser = existingCanonicalUser ?? await tx.user.create({
        // Claw owns its primary key; Spaces' workspace membership id lives
        // only in the UserSurfaceIdentity row linked below.
        data: {
          id: `claw-user-${randomUUID()}`,
          email,
          name,
          orgId: workspace.orgId,
          ...(grantClawAdmin
            ? { roles: { create: { role: "CLAW_ADMIN", grantedBy: "spaces-sync" } } }
            : {}),
        },
        select: { id: true, email: true, orgId: true },
      });

      if (existingCanonicalUser) {
        await tx.user.update({
          where: { id: canonicalUser.id },
          data: { email, name },
        });
      }

      // Provisioning is idempotent: a person may already exist in Claw before
      // Spaces identifies them as an org admin. Preserve existing roles, and
      // add CLAW_ADMIN when this trusted provisioning request explicitly asks.
      if (grantClawAdmin) {
        await tx.userRole.upsert({
          where: { userId_role: { userId: canonicalUser.id, role: "CLAW_ADMIN" } },
          create: { userId: canonicalUser.id, role: "CLAW_ADMIN", grantedBy: "spaces-sync" },
          update: {},
        });
      }

      await tx.orgMember.upsert({
        where: { userId_orgId: { userId: canonicalUser.id, orgId: workspace.orgId } },
        create: {
          userId: canonicalUser.id,
          orgId: workspace.orgId,
          role,
          invitedBy: optionalString(body, "createdBySpacesUserId") ?? "spaces-sync",
        },
        update: { role, leftAt: null },
      });

      await linkSpacesUserIdentity(tx, {
        orgId: workspace.orgId,
        userId: canonicalUser.id,
        spacesUserId,
        spacesWorkspaceId,
        status: optionalString(body, "status"),
        ...(spacesOrgMemberId ? { memberId: spacesOrgMemberId } : {}),
      });

      return {
        orgId: workspace.orgId,
        userId: canonicalUser.id,
        spacesUserId,
        reusedExistingUser: Boolean(existingCanonicalUser),
      };
    });
    res.json({ success: true, data: result });
  } catch (err) {
    handleSyncError(res, "user", err);
  }
});

function handleSyncError(res: Response, scope: string, err: unknown): void {
  if (err instanceof SyncError) {
    log.warn(`[spaces-sync] ${scope} rejected: ${err.message}`);
    res.status(err.status).json({ success: false, error: err.message });
    return;
  }
  log.error(`[spaces-sync] ${scope} failed:`, err);
  res.status(500).json({ success: false, error: "Internal server error" });
}

export const spacesSyncRouter = router;
