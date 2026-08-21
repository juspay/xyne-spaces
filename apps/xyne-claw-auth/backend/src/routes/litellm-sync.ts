import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { createLogger } from "../logger.js";
import {
  LiteLLMProvisioningError,
  storeTeamMappingForOrg,
  storeUserCredentialsForUser,
  storeOrgCredentialsForOrg,
} from "../services/litellmProvisioning.js";

const log = createLogger("litellm-sync");
const router = Router();

class SyncError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new SyncError(400, `${key} is required`);
  }
  return value.trim();
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function litellmErrorStatus(err: LiteLLMProvisioningError): number {
  switch (err.code) {
    case "CONFLICT":
      return 409;
    case "NOT_FOUND":
      return 409;
    case "BAD_REQUEST":
      return 400;
    default:
      return 502;
  }
}

/**
 * Resolve the claw-auth org ID from a Spaces org ID via the ConnectedSurface
 * row created by /internal/spaces-sync/org. Returns null when no mapping
 * exists (spaces-sync hasn't been called yet for this spacesOrgId).
 */
async function resolveClawOrgId(spacesOrgId: string): Promise<string | null> {
  const rows = await prisma.connectedSurface.findMany({
    where: {
      surfaceId: "spaces",
      surfaceTenantId: "",        // org-level row; workspace rows have a non-empty surfaceTenantId
      surfaceOrgId: spacesOrgId,
    },
    select: { orgId: true },
    orderBy: { createdAt: "asc" },
    take: 2,
  });
  if (rows.length > 1) {
    const orgIds = [...new Set(rows.map((r) => r.orgId))];
    if (orgIds.length > 1) {
      log.error(`[litellm-sync] spacesOrgId ${spacesOrgId} maps to multiple claw orgs: ${orgIds.join(",")}`);
      throw new SyncError(409, `Spaces org ${spacesOrgId} maps to multiple claw orgs (${orgIds.join(", ")}) — resolve the conflict before provisioning`);
    }
  }
  return rows[0]?.orgId ?? null;
}

/**
 * Resolve a user-key recipient to the canonical Claw user. During the rollout
 * callers may still pass the workspace-scoped Spaces user id, but a trusted
 * Spaces org-member id always wins: one org member owns one Claw user/key,
 * irrespective of the number of workspace memberships.
 */
export async function resolveCanonicalClawUserId(input: {
  clawOrgId: string;
  spacesUserId: string;
  spacesWorkspaceId?: string;
  spacesOrgMemberId?: string;
}): Promise<string | null> {
  if (input.spacesOrgMemberId) {
    const memberUser = await prisma.user.findUnique({
      where: {
        orgId_spacesOrgMemberId: {
          orgId: input.clawOrgId,
          spacesOrgMemberId: input.spacesOrgMemberId,
        },
      },
      select: { id: true },
    });
    if (memberUser) return memberUser.id;

    // Once a caller supplies the stable org-member identity it is an
    // assertion, not a hint. Falling back to the workspace-scoped user id
    // could store a key for the wrong person while preserving the bad member
    // id only in credential metadata.
    return null;
  }

  const exact = await prisma.user.findUnique({
    where: { id: input.spacesUserId },
    select: { id: true, orgId: true },
  });
  if (exact?.orgId === input.clawOrgId) return exact.id;
  if (exact && exact.orgId !== input.clawOrgId) return null;

  const identity = await prisma.userSurfaceIdentity.findFirst({
    where: {
      surfaceId: "spaces",
      surfaceUserId: input.spacesUserId,
      ...(input.spacesWorkspaceId ? { surfaceWorkspaceId: input.spacesWorkspaceId } : {}),
      orgId: input.clawOrgId,
      status: "ACTIVE",
      userId: { not: null },
    },
    select: { userId: true },
    orderBy: { updatedAt: "desc" },
  });
  return identity?.userId ?? null;
}

router.post("/team", async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;
    // orgId here is the Spaces org ID — resolve it to the claw org ID via connected_surfaces
    const spacesOrgId = stringField(body, "orgId");
    const teamId = stringField(body, "teamId");

    const orgId = await resolveClawOrgId(spacesOrgId);
    if (!orgId) {
      throw new SyncError(409, `No claw org mapped to Spaces org ${spacesOrgId} — call /internal/spaces-sync/org first`);
    }

    const result = await storeTeamMappingForOrg(
      orgId,
      teamId,
      optionalString(body, "teamAlias"),
      optionalString(body, "status"),
    );
    res.json({ success: true, data: { orgId, teamId: result.teamId, created: result.created } });
  } catch (err) {
    handleSyncError(res, "team", err);
  }
});

router.post("/user-key", async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;
    const spacesUserId = stringField(body, "userId");
    // orgId here is the Spaces org ID — resolve it to the claw org ID via connected_surfaces
    const spacesOrgId = stringField(body, "orgId");
    const key = optionalString(body, "key") ?? optionalString(body, "token");
    if (!key) {
      throw new SyncError(400, "key (or token) is required");
    }

    const orgId = await resolveClawOrgId(spacesOrgId);
    if (!orgId) {
      throw new SyncError(409, `No claw org mapped to Spaces org ${spacesOrgId} — call /internal/spaces-sync/org first`);
    }

    const spacesWorkspaceId = optionalString(body, "spacesWorkspaceId")
      ?? optionalString(body, "workspaceId");
    const spacesOrgMemberId = optionalString(body, "spacesOrgMemberId")
      ?? optionalString(body, "orgMemberId");
    const userId = await resolveCanonicalClawUserId({
      clawOrgId: orgId,
      spacesUserId,
      ...(spacesWorkspaceId ? { spacesWorkspaceId } : {}),
      ...(spacesOrgMemberId ? { spacesOrgMemberId } : {}),
    });
    if (!userId) {
      throw new SyncError(
        409,
        `No canonical Claw user found for Spaces user ${spacesUserId} in org ${spacesOrgId}`,
      );
    }

    const result = await storeUserCredentialsForUser({
      userId,
      orgId,
      key,
      spacesOrgId,
      spacesOrgMemberId,
      litellmUserId: optionalString(body, "litellmUserId"),
      teamId: optionalString(body, "teamId"),
      tokenId: optionalString(body, "tokenId"),
      keyName: optionalString(body, "keyName"),
      keyAlias: optionalString(body, "keyAlias"),
      expires: optionalString(body, "expires"),
    });
    res.json({ success: true, data: { userId, ...result } });
  } catch (err) {
    handleSyncError(res, "user-key", err);
  }
});

router.post("/org-key", async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;
    // orgId here is the Spaces org ID — resolve it to the claw org ID via
    // connected_surfaces, exactly as /team and /user-key do.
    const spacesOrgId = stringField(body, "orgId");
    const key = optionalString(body, "key") ?? optionalString(body, "token");
    if (!key) {
      throw new SyncError(400, "key (or token) is required");
    }

    const orgId = await resolveClawOrgId(spacesOrgId);
    if (!orgId) {
      throw new SyncError(409, `No claw org mapped to Spaces org ${spacesOrgId} — call /internal/spaces-sync/org first`);
    }

    const result = await storeOrgCredentialsForOrg({
      orgId,
      key,
      spacesOrgId,
      teamId: optionalString(body, "teamId"),
      tokenId: optionalString(body, "tokenId"),
      keyName: optionalString(body, "keyName"),
      keyAlias: optionalString(body, "keyAlias"),
      expires: optionalString(body, "expires"),
    });
    res.json({ success: true, data: { orgId, ...result } });
  } catch (err) {
    handleSyncError(res, "org-key", err);
  }
});

function handleSyncError(res: Response, scope: string, err: unknown): void {
  if (err instanceof SyncError) {
    log.warn(`[litellm-sync] ${scope} rejected: ${err.message}`);
    res.status(err.status).json({ success: false, error: err.message });
    return;
  }
  if (err instanceof LiteLLMProvisioningError) {
    const status = litellmErrorStatus(err);
    log.warn(`[litellm-sync] ${scope} provisioning error: ${err.message}`);
    res.status(status).json({ success: false, error: err.message });
    return;
  }
  log.error(`[litellm-sync] ${scope} failed:`, err);
  res.status(500).json({ success: false, error: "Internal server error" });
}

export const litellmSyncRouter = router;
