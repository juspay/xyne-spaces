/**
 * Re-home users whose claw `users.orgId` disagrees with their Spaces-side org
 * ground truth. Run AFTER scripts/backfill-spaces-org-identities.ts has been
 * applied (it is what fills `connected_surfaces.surfaceOrgId` on the workspace
 * rows and stamps `user_surface_identities` rows — both of which this script
 * relies on as its source of truth).
 *
 * Why this exists: legacy code froze every user's org at creation time and
 * historically minted some users into the wrong org (the hint-first bug, and
 * the default-org fallback). The runtime refuses to relink implicitly; this
 * script is the explicit, operator-run repair.
 *
 * Ground-truth chain (fully claw-side post-backfill):
 *   user_surface_identities.surfaceUserId + surfaceWorkspaceId
 *     -> workspace ConnectedSurface row
 *        (surfaceId = "spaces", surfaceTenantId = <spaces workspace id>)
 *        reads orgId (the claw org the workspace is mapped to) and
 *        surfaceOrgId (the spaces org the workspace belongs to)
 *     -> org ConnectedSurface row
 *        (surfaceId = "spaces", surfaceTenantId = "",
 *         surfaceOrgId = <spaces org id>) reads orgId  === the correct claw
 *        org.
 * Both hops are written by the backfill; their claw-org answers are unioned
 * and must agree, otherwise the user is flagged MULTIPLE_TRUTH_ORGS.
 *
 * Per candidate the script reports: current claw org, ground-truth org, the
 * rows that would move (membership / surface identities / surface access
 * tokens / per-user agent config + instructions), plus informational counts
 * and the explicit warnings:
 *   - OWNS_N_AGENTS                -> agents stay in the old org; ops decides.
 *   - EMAIL_COLLIDES_IN_TARGET     -> another Claw user with the same email
 *                                     already exists in the target org
 *                                     (users.@@unique([email, orgId])) — the
 *                                     move is REFUSED; this is a
 *                                     merge/consolidation case.
 *   - AGENT_CONFIG_COLLIDES_IN_TARGET -> user_agent_configs /
 *                                     user_agent_instructions are
 *                                     @@unique([userId, orgId, agentSlug]) and
 *                                     the same agentSlug row already exists
 *                                     for this user in the target org — the
 *                                     move is REFUSED; dedupe the per-agent
 *                                     config first.
 *   - MULTIPLE_TRUTH_ORGS          -> the person's identities span more than
 *                                     one ground-truth org — manually
 *                                     adjudicate.
 *
 * Not moved, by design:
 *   - org-stamped history (runs/messages/eval hits) — rewrites would corrupt
 *     audit trails.
 *   - user_roles: global per user, no orgId — nothing to move.
 *   - session tokens: stateless HMAC JWTs, no table — nothing to move.
 *   - shared_provider_credentials: org-scoped (no userId) — stay in the old
 *     org; re-share into the target org manually if still needed.
 *   - user_mcp_connections / user_provider_credentials: keyed by userId only —
 *     they follow the user automatically, no orgId to rewrite.
 *
 * Default is DRY-RUN. `--apply` executes candidates with no warnings and
 * leaves flagged candidates untouched for ops. Output is CSV-on-stdout with
 * the JSON moves payload RFC4180-quoted in the last column.
 *
 * Usage:
 *   node --import tsx/esm scripts/rehome-users-org.ts                     # dry-run
 *   node --import tsx/esm scripts/rehome-users-org.ts --apply             # apply
 *   node --import tsx/esm scripts/rehome-users-org.ts --apply --only-user=<id | email>  # subset
 */

import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/// The Spaces surface row is created with the literal id "spaces" by the
/// backfill (`ensureSpacesSurface`) and self-healed the same way by the
/// runtime (`src/lib/users-jit.ts`), so the id is safe to use directly.
const SPACES_SURFACE_ID = "spaces";

type CliArgs = {
  apply: boolean;
  onlyUsers: string[];
};

type Candidate = {
  userId: string;
  email: string;
  currentOrgId: string;
  truthOrgId: string | null;
  truthOrgIds: string[];
  warnings: string[];
  moves: {
    orgMemberOld: boolean;
    identities: number;
    surfaceAccessTokens: number;
    userAgentConfigs: number;
    userAgentInstructions: number;
    agentConfigCollisions: number;
    ownedAgents: number;
    ownedSharedCredentials: number;
  };
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { apply: false, onlyUsers: [] };
  for (const raw of argv) {
    const normalized = raw.trim();
    if (!normalized.startsWith("--")) throw new Error(`unknown argument: ${raw}`);
    // Split on the FIRST "=" only — values may legitimately contain "=".
    const eq = normalized.indexOf("=");
    const key = eq === -1 ? normalized.slice(2) : normalized.slice(2, eq);
    const value = eq === -1 ? undefined : normalized.slice(eq + 1);
    switch (key) {
      case "apply":
        args.apply = true;
        break;
      case "only-user": {
        const v = (value ?? "").trim();
        if (!v) throw new Error("--only-user requires a value (id or email)");
        args.onlyUsers.push(v);
        break;
      }
      default:
        throw new Error(`unknown flag: --${key}`);
    }
  }
  return args;
}

async function collectCandidates(onlyUsers: string[]): Promise<Candidate[]> {
  // All users that carry at least one Spaces identity (people we can verify).
  const identities = await prisma.userSurfaceIdentity.findMany({
    where: { surfaceId: SPACES_SURFACE_ID, userId: { not: null } },
    select: { userId: true, surfaceWorkspaceId: true },
  });
  const byUser = new Map<string, Set<string>>();
  for (const row of identities) {
    const uid = row.userId as string;
    const set = byUser.get(uid) ?? new Set<string>();
    set.add(row.surfaceWorkspaceId);
    byUser.set(uid, set);
  }

  const candidates: Candidate[] = [];
  const users = await prisma.user.findMany({
    where: { id: { in: [...byUser.keys()] } },
    select: { id: true, email: true, orgId: true },
  });

  for (const user of users) {
    if (onlyUsers.length > 0 && !onlyUsers.includes(user.id) && !onlyUsers.includes(user.email)) continue;
    const workspaceIds = [...(byUser.get(user.id) ?? [])];
    if (workspaceIds.length === 0) continue;

    // (a) Workspace rows: surfaceTenantId = the spaces workspace id; each row
    // tells us both the claw org it is mapped to (orgId) and the spaces org
    // it belongs to (surfaceOrgId).
    const wsRows = await prisma.connectedSurface.findMany({
      where: { surfaceId: SPACES_SURFACE_ID, surfaceTenantId: { in: workspaceIds } },
      select: { orgId: true, surfaceOrgId: true },
    });
    const spacesOrgIds = [...new Set(wsRows.map((r) => r.surfaceOrgId).filter((v): v is string => Boolean(v)))];
    if (spacesOrgIds.length === 0) continue; // org knowledge not yet filled
    // (b) Org rows: surfaceTenantId = "" keyed by the spaces org id; their
    // orgId is the ground-truth claw org for that spaces org.
    const orgRows = await prisma.connectedSurface.findMany({
      where: { surfaceId: SPACES_SURFACE_ID, surfaceTenantId: "", surfaceOrgId: { in: spacesOrgIds } },
      select: { orgId: true },
    });
    const truthOrgIds = [...new Set([...wsRows.map((r) => r.orgId), ...orgRows.map((r) => r.orgId)])];
    if (truthOrgIds.length === 0) continue;

    const truthOrgId = truthOrgIds.length === 1 ? truthOrgIds[0] ?? null : null;
    if (truthOrgId && truthOrgId === user.orgId) continue; // already correctly homed

    const [identitiesCount, tokens, configs, instructions, spcOwned, ownedAgents, targetConfigs, targetInstructions] =
      await Promise.all([
        prisma.userSurfaceIdentity.count({ where: { userId: user.id, orgId: user.orgId } }),
        prisma.surfaceAccessToken.count({ where: { userId: user.id, orgId: user.orgId } }),
        prisma.userAgentConfig.findMany({ where: { userId: user.id, orgId: user.orgId }, select: { agentSlug: true } }),
        prisma.userAgentInstruction.findMany({ where: { userId: user.id, orgId: user.orgId }, select: { agentSlug: true } }),
        // Informational only: shared credentials are org-scoped (no userId) —
        // these are the ones the user CONNECTED in the old org; they stay.
        prisma.sharedProviderCredential.count({ where: { ownerUserId: user.id, orgId: user.orgId } }),
        prisma.agent.count({ where: { ownerUserId: user.id, orgId: user.orgId } }),
        // @@unique([userId, orgId, agentSlug]) conflicts projected onto the
        // target org.
        truthOrgId
          ? prisma.userAgentConfig.findMany({ where: { userId: user.id, orgId: truthOrgId }, select: { agentSlug: true } })
          : Promise.resolve([] as { agentSlug: string }[]),
        truthOrgId
          ? prisma.userAgentInstruction.findMany({
              where: { userId: user.id, orgId: truthOrgId },
              select: { agentSlug: true },
            })
          : Promise.resolve([] as { agentSlug: string }[]),
      ]);

    const warnings: string[] = [];
    const targetSlugs = new Set([...targetConfigs, ...targetInstructions].map((row) => row.agentSlug));
    const collidingSlugs = new Set(
      [...configs, ...instructions].filter((row) => targetSlugs.has(row.agentSlug)).map((row) => row.agentSlug),
    );
    if (collidingSlugs.size > 0) warnings.push("AGENT_CONFIG_COLLIDES_IN_TARGET");
    if (ownedAgents > 0) warnings.push(`OWNS_${ownedAgents}_AGENTS`);
    if (!truthOrgId) warnings.push("MULTIPLE_TRUTH_ORGS");
    if (truthOrgId) {
      const collision = await prisma.user.findFirst({
        where: { orgId: truthOrgId, email: { equals: user.email, mode: "insensitive" }, NOT: { id: user.id } },
        select: { id: true },
      });
      if (collision) warnings.push(`EMAIL_COLLIDES_IN_TARGET:${collision.id}`);
    }

    candidates.push({
      userId: user.id,
      email: user.email,
      currentOrgId: user.orgId,
      truthOrgId,
      truthOrgIds,
      warnings,
      moves: {
        orgMemberOld: true,
        identities: identitiesCount,
        surfaceAccessTokens: tokens,
        userAgentConfigs: configs.length,
        userAgentInstructions: instructions.length,
        agentConfigCollisions: collidingSlugs.size,
        ownedAgents,
        ownedSharedCredentials: spcOwned,
      },
    });
  }
  return candidates;
}

function isApplicable(c: Candidate): boolean {
  return c.warnings.length === 0 && c.truthOrgId !== null && c.truthOrgId !== c.currentOrgId;
}

async function applyOne(c: Candidate): Promise<void> {
  const orgId = c.truthOrgId as string;
  await prisma.$transaction(async (tx) => {
    // Entitlements/org-scoped user rows move wholesale (they're "the user
    // belongs to THIS org" pointers, not history). Historical org-stamped
    // activity (Category 1: runs/messages/eval hits etc.) is intentionally
    // untouched — rewrites of history would corrupt audit trails.
    await tx.user.update({ where: { id: c.userId }, data: { orgId } });
    // Preserve audit on the old membership; create the new one.
    await markMembershipLeft(tx, c.userId, c.currentOrgId);
    await tx.orgMember.upsert({
      where: { userId_orgId: { userId: c.userId, orgId } },
      create: { userId: c.userId, orgId, role: "MEMBER", invitedBy: "rehome-users-org" },
      update: {},
    });
    await tx.userSurfaceIdentity.updateMany({ where: { userId: c.userId, orgId: c.currentOrgId }, data: { orgId } });
    // SurfaceAccessToken's only unique keys are its id and tokenHash, both
    // untouched here, so this orgId rewrite cannot collide with anything.
    await tx.surfaceAccessToken.updateMany({ where: { userId: c.userId, orgId: c.currentOrgId }, data: { orgId } });
    // These two are @@unique([userId, orgId, agentSlug]): target-org
    // collisions are refused up front (AGENT_CONFIG_COLLIDES_IN_TARGET).
    await tx.userAgentConfig.updateMany({ where: { userId: c.userId, orgId: c.currentOrgId }, data: { orgId } });
    await tx.userAgentInstruction.updateMany({ where: { userId: c.userId, orgId: c.currentOrgId }, data: { orgId } });
    // Deliberately NOT moved: user_roles (global per user, no orgId),
    // shared_provider_credentials (org-scoped, no userId), and
    // user_mcp_connections / user_provider_credentials (keyed by userId only).
  });
}

async function markMembershipLeft(
  tx: Prisma.TransactionClient,
  userId: string,
  orgId: string,
): Promise<void> {
  await tx.orgMember.updateMany({
    where: { userId, orgId, leftAt: null },
    data: { leftAt: new Date() },
  });
}

/// RFC4180 quoting so the JSON payload's commas/quotes don't break the CSV
/// column structure.
function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const candidates = await collectCandidates(args.onlyUsers);

  const applicable = candidates.filter(isApplicable);
  const flagged = candidates.filter((c) => !isApplicable(c));

  console.log("[rehome] mode=" + (args.apply ? "APPLY" : "DRY-RUN"));
  console.log(`[rehome] candidates=${candidates.length} applicable=${applicable.length} flagged=${flagged.length}`);
  console.log("[rehome] note: user_roles are global per user (no orgId) — nothing to move.");
  console.log("[rehome] note: session tokens are stateless HMAC JWTs (no table) — nothing to move.");
  console.log("[rehome] note: shared_provider_credentials are org-scoped — owned rows stay in the old org.");
  console.log("userId,email,currentOrg,truthOrg,warnings,moves");
  for (const c of candidates) {
    console.log(
      [
        c.userId,
        c.email,
        c.currentOrgId,
        c.truthOrgId ?? c.truthOrgIds.join("|"),
        c.warnings.join("+") || "-",
        csvField(JSON.stringify(c.moves)),
      ].join(","),
    );
  }

  if (!args.apply || applicable.length === 0) {
    if (applicable.length > 0) {
      console.log(`[rehome] DRY-RUN only: re-run with --apply to move ${applicable.length} user(s).`);
    } else {
      console.log("[rehome] nothing to move.");
    }
    return;
  }

  for (const c of applicable) {
    await applyOne(c);
    console.log(`[rehome] MOVED ${c.userId} (${c.email}) ${c.currentOrgId} -> ${c.truthOrgId}`);
  }
  console.log(`[rehome] applied: moved ${applicable.length} user(s); flagged rows above remain for ops.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
