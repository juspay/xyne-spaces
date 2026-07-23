import type { ConnectedSurface, Surface } from "@prisma/client";
import { CONFIG } from "../config.js";
import { decrypt, encrypt } from "../crypto.js";
import { prisma } from "../db.js";
import { verify as verifyCliToken } from "./cli-tokens.js";

export type SurfaceResolverErrorCode =
  | "UNKNOWN_SURFACE"
  | "UNKNOWN_TENANT"
  | "AMBIGUOUS_TENANT"
  | "INVALID_ACCESS_TOKEN"
  | "INVALID_SIGNING_SECRET";

export class SurfaceResolverError extends Error {
  constructor(
    public readonly code: SurfaceResolverErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SurfaceResolverError";
  }
}

export interface ResolvedSurfaceTenant {
  surface: Surface;
  connectedSurface: ConnectedSurface;
}

export interface ResolvedInbound {
  surface: Surface;
  connectedSurface: ConnectedSurface | null;
  orgId: string;
  userId: string | null;
  publicOnly: boolean;
  surfaceAgentId?: string;
  agentId?: string;
  agentSlug?: string;
}

export interface SurfaceAgentInboundContext {
  surfaceAgentId: string;
  agentId: string;
  agentSlug: string;
}

export type ResolveInboundInput =
  | {
      surfaceKey: string;
      surfaceTenantId: string;
      surfaceUserId?: string;
      accessToken?: never;
    }
  | {
      surfaceKey: string;
      accessToken?: string;
      surfaceTenantId?: never;
      surfaceUserId?: never;
    };

async function findActiveSurface(surfaceKey: string): Promise<Surface> {
  const surface = await prisma.surface.findUnique({ where: { key: surfaceKey } });
  if (!surface || surface.status !== "ACTIVE") {
    throw new SurfaceResolverError("UNKNOWN_SURFACE", `Unknown or inactive surface: ${surfaceKey}`);
  }
  return surface;
}

export async function resolveSurfaceTenant(
  surfaceKey: string,
  surfaceTenantId: string,
): Promise<ResolvedSurfaceTenant> {
  const surface = await findActiveSurface(surfaceKey);
  const matches = await prisma.connectedSurface.findMany({
    where: { surfaceId: surface.id, surfaceTenantId, status: "ACTIVE" },
    take: 2,
  });

  if (matches.length === 0) {
    throw new SurfaceResolverError("UNKNOWN_TENANT", `Unknown tenant for surface ${surfaceKey}`);
  }
  if (matches.length > 1) {
    throw new SurfaceResolverError(
      "AMBIGUOUS_TENANT",
      `Multiple active organizations own tenant ${surfaceTenantId} on surface ${surfaceKey}`,
    );
  }

  return { surface, connectedSurface: matches[0]! };
}

export async function resolveInboundForTenant(
  tenant: ResolvedSurfaceTenant,
  surfaceUserId?: string,
  surfaceAgent?: SurfaceAgentInboundContext,
): Promise<ResolvedInbound> {
  const { surface, connectedSurface } = tenant;
  if (surface.identityMode !== "USER_ID") {
    throw new SurfaceResolverError("INVALID_ACCESS_TOKEN", "An access token is required for this surface");
  }

  if (!surfaceUserId) {
    return {
      surface,
      connectedSurface,
      orgId: connectedSurface.orgId,
      userId: null,
      publicOnly: true,
      ...surfaceAgent,
    };
  }

  const identity = await prisma.userSurfaceIdentity.findUnique({
    where: {
      surfaceId_surfaceWorkspaceId_surfaceUserId: {
        surfaceId: surface.id,
        surfaceWorkspaceId: connectedSurface.surfaceTenantId,
        surfaceUserId,
      },
    },
  });

  const userId = identity?.status === "ACTIVE"
    && identity.orgId === connectedSurface.orgId
    && identity.userId
    ? identity.userId
    : null;

  return {
    surface,
    connectedSurface,
    orgId: connectedSurface.orgId,
    userId,
    publicOnly: userId === null,
    ...surfaceAgent,
  };
}

export async function resolveInbound(input: ResolveInboundInput): Promise<ResolvedInbound> {
  const surface = await findActiveSurface(input.surfaceKey);

  if (surface.identityMode === "ACCESS_TOKEN") {
    const verified = await verifyCliToken(input.accessToken);
    if (!verified) {
      throw new SurfaceResolverError("INVALID_ACCESS_TOKEN", "Invalid surface access token");
    }
    return {
      surface,
      connectedSurface: null,
      orgId: verified.orgId,
      userId: verified.userId,
      publicOnly: false,
    };
  }

  if (!("surfaceTenantId" in input) || !input.surfaceTenantId) {
    throw new SurfaceResolverError("UNKNOWN_TENANT", `No tenant supplied for surface ${input.surfaceKey}`);
  }
  const tenant = await resolveSurfaceTenant(input.surfaceKey, input.surfaceTenantId);
  return resolveInboundForTenant(tenant, input.surfaceUserId);
}

/** Pack a per-install secret using the same AES-256-GCM tuple used by Spaces secrets. */
export function encryptSurfaceSecret(plaintext: string): string {
  const encrypted = encrypt(plaintext, CONFIG.encryptionKey);
  return `${encrypted.ciphertext}:${encrypted.iv}:${encrypted.authTag}`;
}

/** Unpack a secret written by encryptSurfaceSecret. */
export function decryptSurfaceSecret(blob: string, label = "surface secret"): string {
  const parts = blob.split(":");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new SurfaceResolverError("INVALID_SIGNING_SECRET", `Malformed ${label}`);
  }
  try {
    return decrypt(parts[0]!, parts[1]!, parts[2]!, CONFIG.encryptionKey);
  } catch {
    throw new SurfaceResolverError("INVALID_SIGNING_SECRET", `${label} could not be decrypted`);
  }
}

/** Decrypt ConnectedSurface.config.signingSecret without consulting any other org's row. */
export function getConnectedSurfaceSigningSecret(connectedSurface: ConnectedSurface): string | null {
  const config = connectedSurface.config;
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const blob = (config as Record<string, unknown>)["signingSecret"];
  if (typeof blob !== "string" || blob.length === 0) return null;

  return decryptSurfaceSecret(blob, "connected-surface signing secret");
}
