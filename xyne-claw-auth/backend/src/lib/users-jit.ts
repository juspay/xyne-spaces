/**
 * Just-in-time user mirroring.
 *
 * claw-auth's `users` table is a read-only mirror of Spaces' `public.users`,
 * keyed on the same id. Historically the mirror was populated only when the
 * frontend POSTed `/users` after a successful Google login. That meant any
 * other entry point (webhook, scheduled job, MCP call resolved purely from
 * the Spaces session cookie) failed if the user had never opened the
 * dashboard.
 *
 * `ensureUserExists(userId, caller)` plugs that gap: when a request lands
 * for a `userId` we don't have a row for, we look the profile up in the
 * Spaces DB and upsert it locally. Idempotent — repeat calls are cheap.
 * Returns true if the local row is present after the call, false if Spaces
 * doesn't know this user either (caller should treat that as a hard miss
 * and surface a normal 4xx).
 */

import { prisma } from "../db.js";
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

/**
 * Resolve which claw org a NEWLY-mirrored Spaces user belongs to (§13.2).
 * Order:
 *   1. `orgHint` — an explicit org (e.g. the invoked agent's org, passed by the
 *      webhook path). Most robust: a second-tenant agent's callers land in that
 *      tenant even before a mapping row exists. Ignored if the org doesn't exist.
 *   2. `ConnectedSurface` — map the user's Spaces `workspaceId` → claw org.
 *      Falls back to legacy `SurfaceTenantLink` during the Slice 0 transition.
 *      Serves the browser/requireAuth path (no agent in hand).
 *   3. Fallback — the default org (Juspay). Once a second tenant is live, set
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
  // 1. Explicit hint.
  const hint = (orgHint ?? "").trim();
  if (hint) {
    const org = await prisma.organization.findUnique({ where: { id: hint }, select: { id: true } });
    if (org) return org.id;
    log.warn(`[users-jit] orgHint "${hint}" not found — falling through to workspace mapping`);
  }

  // 2. Spaces workspace → org mapping.
  if (spacesUser.workspaceId) {
    const connected = await prisma.connectedSurface.findFirst({
      where: {
        surfaceTenantId: spacesUser.workspaceId,
        surface: { key: "spaces" },
      },
      select: { orgId: true },
    });
    if (connected) return connected.orgId;

    const link = await prisma.surfaceTenantLink.findUnique({
      where: {
        surfaceType_surfaceTenantId: {
          surfaceType: "spaces",
          surfaceTenantId: spacesUser.workspaceId,
        },
      },
      select: { orgId: true },
    });
    if (link) return link.orgId;
  }

  // 3. Fallback (policy-gated).
  const policy = (process.env["JIT_UNMAPPED_WORKSPACE_POLICY"] ?? "default").trim().toLowerCase();
  if (policy === "reject") {
    log.warn(
      `[users-jit] unmapped workspace "${spacesUser.workspaceId ?? "(none)"}" for user ${spacesUser.id}; ` +
        `JIT_UNMAPPED_WORKSPACE_POLICY=reject → refusing JIT (no default-org fallback)`,
    );
    return null;
  }
  return getDefaultOrgId();
}

export async function ensureUserExists(
  userId: string,
  caller: SpacesAuthCaller = "unknown",
  orgHint?: string,
): Promise<boolean> {
  if (!userId) return false;

  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (existing) return true;

  const spacesUser = await getSpacesUserById(userId, caller);
  if (!spacesUser) return false;

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

  // Upsert by id so concurrent JIT requests for the same user don't double-
  // insert. Update branch keeps the local copy in sync with email/name changes
  // on the Spaces side (rare but free); it does NOT touch orgId (an existing
  // row's org is authoritative).
  await prisma.user.upsert({
    where: { id: spacesUser.id },
    create: { id: spacesUser.id, email: spacesUser.email, name: spacesUser.name, orgId },
    update: { email: spacesUser.email, name: spacesUser.name },
  });
  await ensureOrgMembership(spacesUser.id, orgId);

  log.info(`[users-jit] created local user ${spacesUser.email} (id=${spacesUser.id}) org=${orgId} caller=${caller}`);
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
  const row = await prisma.user.findUnique({ where: { id }, select: { orgId: true } });
  return row?.orgId ?? undefined;
}
