/**
 * Just-in-time user mirroring.
 *
 * claw-auth's `users` table mirrors Spaces people and memberships without
 * reusing Spaces' workspace-scoped `public.users.id` as its primary key.
 * Historically the mirror was populated only when the frontend POSTed
 * `/users` after a successful Google login. That meant any other entry point
 * (webhook, scheduled job, MCP call resolved purely from the Spaces session
 * cookie) failed if the user had never opened the dashboard.
 *
 * `ensureUserExists(userId, caller)` plugs that gap: when a request lands
 * for a `userId` we don't have a row for, we look the profile up in the
 * Spaces DB and upsert it locally. Idempotent — repeat calls are cheap.
 * Returns true if the local row is present after the call, false if Spaces
 * doesn't know this user either (caller should treat that as a hard miss
 * and surface a normal 4xx).
 */

import { randomUUID } from "node:crypto";
import { Prisma, type User } from "@prisma/client";
import { prisma } from "../db.js";
import { resolveSurfacePerson } from "./identity-resolution.js";
import { getSpacesUserById, type SpacesAuthCaller, type SpacesUserProfile } from "./spaces-db.js";

import { createLogger } from "../logger.js";
const log = createLogger("users-jit");

/**
 * Phase-1 default org name. MUST stay in sync with
 * `scripts/backfill-default-org.ts` (same literal). New JIT-mirrored users are
 * attached here so they gain org context immediately, without waiting for a
 * backfill re-run.
 */
const DEFAULT_ORG_NAME = "Juspay";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Resolve the default org's id, or null if it doesn't exist yet (fresh DB
 * before the phase-1 backfill has created it). Shared by every user-creation
 * path so a `users` row is NEVER inserted without an `orgId` — which is what
 * lets `users.orgId` be NOT NULL.
 */
export async function getDefaultOrgId(): Promise<string | null> {
  const org = await prisma.organization.findFirst({
    where: { name: DEFAULT_ORG_NAME },
    select: { id: true },
  });
  return org?.id ?? null;
}

/** Ensure a MEMBER `OrgMember` row for (userId, orgId). Idempotent; never downgrades. */
export async function ensureOrgMembership(userId: string, orgId: string): Promise<void> {
  await prisma.orgMember.upsert({
    where: { userId_orgId: { userId, orgId } },
    create: { orgId, userId, role: "MEMBER", invitedBy: "system" },
    update: {},
  });
}

export async function resolveClawUserIdForSpacesIdentity(
  spacesUserId: string,
  workspaceId?: string | null,
): Promise<string | undefined> {
  const id = spacesUserId.trim();
  if (!id) {
    return undefined;
  }

  // Check the workspace identity first. During the org-member migration a
  // legacy Claw row can have the same id as this workspace-scoped Spaces user,
  // while the identity correctly points to the member's canonical Claw user.
  // Preferring the identity repairs that legacy shape lazily and is also the
  // normal path for a second workspace membership.
  const identity = await prisma.userSurfaceIdentity.findFirst({
    where: {
      surfaceId: "spaces",
      surfaceUserId: id,
      status: "ACTIVE",
      ...(workspaceId ? { surfaceWorkspaceId: workspaceId } : {}),
      userId: { not: null },
    },
    select: { userId: true },
    orderBy: { updatedAt: "desc" },
  });
  if (identity?.userId) {
    return identity.userId;
  }

  const exact = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  return exact?.id;
}

/**
 * "Id-or-alias → canonical Claw user id, else the input unchanged": the shared
 * one-liner for admin routes that accept either Claw ids or Spaces workspace
 * aliases. Resolution failures degrade to the input id (fail-open) so a
 * transient DB hiccup is a not-found, never a 500.
 */
export async function resolveCanonicalUserIdOrSelf(
  spacesUserId: string,
  workspaceId?: string | null,
): Promise<string> {
  return (await resolveClawUserIdForSpacesIdentity(spacesUserId, workspaceId).catch(() => undefined)) ?? spacesUserId;
}

/**
 * Admin-facing "any wire id" row lookup: the id may be a canonical Claw user
 * id OR a Spaces workspace-scoped alias (the two forms an admin console can
 * plausibly copy from either system). Resolves through the identity/
 * exact-id ladder and returns the canonical Claw users row (or null).
 */
export async function findUserByAnyId(rawId: string): Promise<User | null> {
  const canonicalId = await resolveClawUserIdForSpacesIdentity(rawId).catch((err) => {
    log.warn(`[users-jit] findUserByAnyId: identity resolution failed for "${rawId}":`, err instanceof Error ? err.message : err);
    return undefined;
  });
  return canonicalId ? prisma.user.findUnique({ where: { id: canonicalId } }) : null;
}

async function linkSpacesIdentity(spacesUser: SpacesUserProfile, orgId: string, userId: string): Promise<void> {
  if (!spacesUser.workspaceId) return;

  // The `surfaces` registry row for "spaces" is seeded by migration
  // 20260706205659_slice0_surface_foundation. Read-only here: a missing or
  // mismatched row means migrations have not run — a hard deployment failure
  // this request path must not self-heal over.
  const surface = await prisma.surface.findUnique({ where: { id: "spaces" }, select: { id: true, key: true } });
  if (!surface || surface.key !== "spaces") {
    log.error(
      `[users-jit] cannot link Spaces identity: surface row id="spaces" ${surface ? `has key "${surface.key}"` : "is missing"} — ` +
        `expected migration 20260706205659_slice0_surface_foundation to seed it`,
    );
    return;
  }

  const existing = await prisma.userSurfaceIdentity.findUnique({
    where: {
      surfaceId_surfaceWorkspaceId_surfaceUserId: {
        surfaceId: "spaces",
        surfaceWorkspaceId: spacesUser.workspaceId,
        surfaceUserId: spacesUser.id,
      },
    },
    select: { userId: true, orgId: true },
  });
  if (existing?.userId && existing.userId !== userId) {
    log.warn(
      `[users-jit] Spaces identity conflict user=${spacesUser.id} workspace=${spacesUser.workspaceId} ` +
        `existingClawUser=${existing.userId} canonicalClawUser=${userId}`,
    );
    return;
  }
  if (existing?.orgId && existing.orgId !== orgId) {
    log.warn(
      `[users-jit] Spaces identity org conflict user=${spacesUser.id} workspace=${spacesUser.workspaceId} ` +
        `existingOrg=${existing.orgId} canonicalOrg=${orgId}`,
    );
    return;
  }

  await prisma.userSurfaceIdentity.upsert({
    where: {
      surfaceId_surfaceWorkspaceId_surfaceUserId: {
        surfaceId: "spaces",
        surfaceWorkspaceId: spacesUser.workspaceId,
        surfaceUserId: spacesUser.id,
      },
    },
    create: {
      surfaceId: "spaces",
      surfaceWorkspaceId: spacesUser.workspaceId,
      surfaceUserId: spacesUser.id,
      orgId,
      userId,
      ...(spacesUser.spacesOrgMemberId?.trim()
        ? { surfaceMemberId: spacesUser.spacesOrgMemberId.trim() }
        : {}),
      status: "ACTIVE",
      linkedAt: new Date(),
      lastSeenAt: new Date(),
    },
    update: {
      orgId,
      userId,
      ...(spacesUser.spacesOrgMemberId?.trim()
        ? { surfaceMemberId: spacesUser.spacesOrgMemberId.trim() }
        : {}),
      status: "ACTIVE",
      linkedAt: new Date(),
      lastSeenAt: new Date(),
    },
  });
}

/**
 * Resolve which claw org a NEWLY-mirrored Spaces user belongs to (§13.2).
 * Order:
 *   1. `ConnectedSurface` — map the user's Spaces `workspaceId` -> claw org
 *      and, when populated, verify `surfaceOrgId` against Spaces
 *      `workspaces.orgId`.
 *   2. Legacy `SurfaceTenantLink` — deprecated fallback while mappings are
 *      being moved to `connected_surfaces`.
 *   3. `orgHint` — an explicit org (e.g. the invoked agent's org), used only
 *      when there is no workspace mapping and fail-closed policy is not active.
 *   4. Fallback — the default org (Juspay). Once a second tenant is live, set
 *      `JIT_UNMAPPED_WORKSPACE_POLICY=reject` to FAIL CLOSED for unmapped
 *      workspaces so a new Spaces tenant can't silently pollute the default org.
 *
 * Returns null only when nothing resolves AND the policy refuses a fallback —
 * the caller treats null as "skip JIT" (a normal hard miss).
 */
async function resolveOrgForNewUser(
  spacesUser: SpacesUserProfile,
  orgHint?: string,
): Promise<string | null> {
  const policy = (process.env["JIT_UNMAPPED_WORKSPACE_POLICY"] ?? "default").trim().toLowerCase();

  // 1. Spaces workspace -> org mapping.
  if (spacesUser.workspaceId) {
    const connectedRows = await prisma.connectedSurface.findMany({
      where: {
        surfaceId: "spaces",
        surfaceTenantId: spacesUser.workspaceId,
      },
      select: { id: true, orgId: true, surfaceOrgId: true },
      orderBy: { createdAt: "asc" },
      take: 2,
    });
    if (connectedRows.length > 1) {
      const orgIds = [...new Set(connectedRows.map((row) => row.orgId))];
      log.warn(
        `[users-jit] tenant conflict: workspace=${spacesUser.workspaceId} has multiple connected_surfaces org mappings orgIds=${orgIds.join(",")}`,
      );
      if (orgIds.length > 1) return null;
    }

    const connected = connectedRows[0];
    if (connected) {
      if (connected.surfaceOrgId) {
        if (spacesUser.spacesOrgId && connected.surfaceOrgId !== spacesUser.spacesOrgId) {
          log.warn(
            `[users-jit] tenant conflict: workspace=${spacesUser.workspaceId} Spaces org=${spacesUser.spacesOrgId} ` +
              `connected_surface=${connected.id} surfaceOrgId=${connected.surfaceOrgId} clawOrgId=${connected.orgId}`,
          );
          return null;
        }
        if (!spacesUser.spacesOrgId) {
          log.warn(
            `[users-jit] cannot validate connected_surface=${connected.id} workspace=${spacesUser.workspaceId}: Spaces workspaces.orgId missing`,
          );
        }
      } else {
        log.warn(
          `[users-jit] connected_surface=${connected.id} workspace=${spacesUser.workspaceId} missing surfaceOrgId; allowing temporarily`,
        );
      }

      if (spacesUser.spacesOrgId) {
        const orgRows = await prisma.connectedSurface.findMany({
          where: {
            surfaceId: "spaces",
            surfaceOrgId: spacesUser.spacesOrgId,
          },
          select: { orgId: true },
          distinct: ["orgId"],
          take: 2,
        });
        if (orgRows.length > 1) {
          log.warn(
            `[users-jit] tenant warning: Spaces org=${spacesUser.spacesOrgId} maps to multiple claw orgs ` +
              `orgIds=${orgRows.map((row) => row.orgId).join(",")}`,
          );
        }
      }

      return connected.orgId;
    }

    const link = await prisma.surfaceTenantLink.findUnique({
      where: {
        surfaceType_surfaceTenantId: {
          surfaceType: "spaces",
          surfaceTenantId: spacesUser.workspaceId,
        },
      },
      select: { orgId: true },
    });
    if (link) {
      log.warn(
        `[users-jit] workspace=${spacesUser.workspaceId} used deprecated surface_tenant_links fallback orgId=${link.orgId}`,
      );
      return link.orgId;
    }
  }

  if (policy === "reject") {
    log.warn(
      `[users-jit] unmapped workspace "${spacesUser.workspaceId ?? "(none)"}" for user ${spacesUser.id}; ` +
        `JIT_UNMAPPED_WORKSPACE_POLICY=reject -> refusing JIT (no default-org fallback)`,
    );
    return null;
  }

  // 3. Explicit hint, after workspace source-of-truth checks.
  const hint = (orgHint ?? "").trim();
  if (hint) {
    const org = await prisma.organization.findUnique({ where: { id: hint }, select: { id: true } });
    if (org) {
      log.warn(
        `[users-jit] user=${spacesUser.id} workspace=${spacesUser.workspaceId ?? "(none)"} has no surface mapping; using orgHint=${hint}`,
      );
      return org.id;
    }
    log.warn(`[users-jit] orgHint "${hint}" not found - falling through to default org`);
  }

  // 4. Fallback (policy-gated above).
  return getDefaultOrgId();
}

export async function ensureUserExists(
  userId: string,
  caller: SpacesAuthCaller = "unknown",
  orgHint?: string,
): Promise<boolean> {
  if (!userId) return false;

  // Do not return early just because a legacy Claw user exists. Reading their
  // live Spaces profile lets this path create the missing workspace
  // UserSurfaceIdentity (cross-workspace alias) on their next authenticated
  // request. Only skip once an ACTIVE identity row proves the linkage exists.
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (existing) {
    const identity = await prisma.userSurfaceIdentity.findFirst({
      where: {
        surfaceId: "spaces",
        surfaceUserId: userId,
        status: "ACTIVE",
        userId: { not: null },
      },
      select: { id: true },
    });
    // This raw, workspace-scoped user has already been migrated. Avoid a
    // Spaces DB round-trip on every subsequent authenticated request.
    if (identity) return true;
  }
  const spacesUser = await getSpacesUserById(userId, caller);
  if (!spacesUser) return Boolean(existing);

  // The user row must carry an orgId at INSERT time (orgId is NOT NULL). Resolve
  // via §13.2 (hint → workspace mapping → default). Fail closed if nothing
  // resolves rather than attempting an org-less insert that would violate the
  // constraint. Downstream treats a false return as a normal hard miss.
  const orgId = await resolveOrgForNewUser(spacesUser, orgHint);
  if (!orgId) {
    log.error(
      `[users-jit] could not resolve an org for user ${spacesUser.id} (workspace=${spacesUser.workspaceId ?? "none"}). ` +
        `Check ConnectedSurface/SurfaceTenantLink mapping / JIT_UNMAPPED_WORKSPACE_POLICY / that scripts/backfill-default-org.ts ran.`,
    );
    return false;
  }

  // Person resolution is shared with the spaces-sync provisioning route —
  // see src/lib/identity-resolution.ts for the email-primary rule and the
  // fail-closed refusal rails. A refusal here is a hard miss (no throw): the
  // webhook/S2S entrypoints treat it as "user not mirrorable right now".
  const email = normalizeEmail(spacesUser.email);
  const resolution = await resolveSurfacePerson(prisma, {
    orgId,
    email,
    ...(existing ? { exactUserId: existing.id } : {}),
    ...(spacesUser.spacesOrgMemberId?.trim()
      ? { memberId: spacesUser.spacesOrgMemberId.trim() }
      : {}),
  });
  if (resolution.kind === "refused") {
    log.error(
      `[users-jit] identity conflict for Spaces user ${spacesUser.id} ` +
        `(workspace=${spacesUser.workspaceId ?? "none"}) org=${orgId} caller=${caller}: ${resolution.reason}`,
    );
    return false;
  }

  let canonicalUserId = resolution.kind === "reuse" ? resolution.userId : undefined;

  if (canonicalUserId) {
    await prisma.user.update({
      where: { id: canonicalUserId },
      data: { email, name: spacesUser.name },
    });
    log.info(
      `[users-jit] linked Spaces user ${spacesUser.id} to existing local user ${canonicalUserId} ` +
        `(${email}) org=${orgId} caller=${caller}`,
    );
  } else {
    try {
      const created = await prisma.user.create({
        data: {
          id: `claw-user-${randomUUID()}`,
          email,
          name: spacesUser.name,
          orgId,
        },
        select: { id: true },
      });
      canonicalUserId = created.id;
      log.info(`[users-jit] created local user ${email} (id=${canonicalUserId}) org=${orgId} caller=${caller}`);
    } catch (err) {
      // Two concurrent first-contact JITs race on User's @@unique([email,
      // orgId]): the loser hits P2002. Re-resolve to the winner's row and
      // continue linking instead of propagating — orgIdForSpacesUser only
      // wants a clean miss-or-result, never a race exception.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) {
        throw err;
      }
      const winner = await prisma.user.findFirst({
        where: { orgId, email: { equals: email, mode: "insensitive" } },
        select: { id: true },
      });
      if (!winner) {
        throw err;
      }
      canonicalUserId = winner.id;
      log.info(
        `[users-jit] concurrent JIT create for ${email} raced another request; ` +
          `linking to winner ${canonicalUserId} org=${orgId} caller=${caller}`,
      );
    }
  }

  await ensureOrgMembership(canonicalUserId, orgId);
  await linkSpacesIdentity(spacesUser, orgId, canonicalUserId);

  return true;
}

/**
 * Phase-2 (Design A) org resolution for the EXTERNAL Spaces entrypoints
 * (webhook / signature verify / automations) where there is no `x-org-id`
 * header — only a Spaces user id on the wire. JIT-mirrors the user if needed,
 * then returns their `orgId`.
 *
 * Returns undefined if the user can't be resolved (no Spaces row, fresh DB).
 * Callers pass the result to `findBySlug(slug, orgId)`, which safely falls back
 * to the global lookup when undefined — non-breaking while slug is still
 * globally unique. Once slug becomes composite-unique (slice 5), an undefined
 * here must be treated as a hard miss.
 */
export async function orgIdForSpacesUser(
  userId: string | undefined | null,
  caller: SpacesAuthCaller = "unknown",
  orgHint?: string,
): Promise<string | undefined> {
  const id = (userId ?? "").trim();
  if (!id) return undefined;
  const ok = await ensureUserExists(id, caller, orgHint);
  if (!ok) return undefined;
  const clawUserId = await resolveClawUserIdForSpacesIdentity(id);
  const row = clawUserId
    ? await prisma.user.findUnique({ where: { id: clawUserId }, select: { orgId: true } })
    : null;
  return row?.orgId ?? undefined;
}
