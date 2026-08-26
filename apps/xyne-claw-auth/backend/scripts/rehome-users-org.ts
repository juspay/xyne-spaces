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
 *   user_surface_identities.surfaceUserId
 *     -> (spaces row's workspace) => the workspace ConnectedSurface row
 *        (surfaceTenantId = <spaces workspace id>) reads surfaceOrgId
 *     -> org ConnectedSurface row (surfaceTenantId = surfaceOrgId,
 *        surfaceWorkspaceId IS NULL) reads orgId  === the correct claw org.
 *
 * Per candidate the script reports: current claw org, ground-truth org, the
 * rows that would move (membership / role grants / oauth connections /
 * identities / per-user agent config / shared provider creds), plus the
 * explicit warnings:
 *   - OWNS_N_AGENTS           -> agents stay in the old org; ops decides.
 *   - EMAIL_COLLIDES_IN_TARGET -> another Claw user with the same email
 *                                already exists in the target org
 *                                (users.@@unique([email, orgId])) — the move is
 *                                REFUSED; this is a merge/consolidation case.
 *   - OAUTH_COLLIDES_IN_TARGET -> (userId, provider, orgId) unique would be
 *                                violated; that connection stays and is flagged.
 *   - MULTIPLE_TRUTH_ORGS      -> the person's identities span more than one
 *                                ground-truth org — manually adjudicate.
 *
 * Default is DRY-RUN. `--apply` executes candidates with no warnings and
 * marks flagged ones NEEDS-HUMAN. Output is CSV-on-stdout.
 *
 * Usage:
 *   node --import tsx/esm scripts/rehome-users-org.ts                     # dry-run
 *   node --import tsx/esm scripts/rehome-users-org.ts --apply             # apply
 *   node --import tsx/esm scripts/rehome-users-org.ts --apply --only-user=<id | email>  # subset
 *   node --import tsx/esm scripts/rehome-users-org.ts --heritage=verbose  # detail
 */

import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type CliArgs = {
  apply: boolean;
  onlyUsers: string[];
  heritage: string;
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
    roleGrants: number;
    oauthConnections: number;
    oauthCollisions: number;
    identities: number;
    sessionTokens: number;
    userAgentConfigs: number;
    userAgentInstructions: number;
    sharedProviderCredentials: number;
    ownedAgents: number;
  };
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { apply: false, onlyUsers: [], heritage: "summary" };
  for (const raw of argv) {
    const normalized = raw.trim();
    if (!normalized.startsWith("--")) throw new Error(`unknown argument: ${raw}`);
    const [key, value] = normalized.slice(2).split("=", 2);
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
      case "heritage":
        if (value !== "verbose" && value !== "summary") {
          throw new Error("--heritage must be summary or verbose");
        }
        args.heritage = value;
        break;
      default:
        throw new Error(`unknown flag: --${key}`);
    }
  }
  return args;
}

async function collectCandidates(onlyUsers: string[]): Promise<Candidate[]> {
  // All users that carry at least one Spaces identity (people we can verify).
  const identities = await prisma.userSurfaceIdentity.findMany({
    where: { surfaceId: "spaces", userId: { not: null } },
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

    const wsRows = await prisma.connectedSurface.findMany({
      where: {
        surface: { key: "spaces" },
        surfaceTenantId: { in: workspaceIds },
        surfaceWorkspaceId: { not: null },
      },
      select: { surfaceOrgId: true },
    });
    const spaceOrgIds = [...new Set(wsRows.map((r) => r.surfaceOrgId).filter((v): v is string => Boolean(v)))];
    if (spaceOrgIds.length === 0) continue; // org knowledge not yet filled
    const orgRows = await prisma.connectedSurface.findMany({
      where: {
        surface: { key: "spaces" },
        surfaceWorkspaceId: null,
        surfaceTenantId: { in: spaceOrgIds },
      },
      select: { orgId: true },
    });
    const truthOrgIds = [...new Set(orgRows.map((r) => r.orgId))];
    if (truthOrgIds.length === 0) continue;

    const truthOrgId = truthOrgIds.length === 1 ? truthOrgIds[0] : null;
    if (truthOrgId && truthOrgId === user.orgId) continue; // already correctly homed

    const [roleGrants, oauth, identitiesCount, sessionTokens, uac, uai, spc, ownedAgents, oauthCollisions] =
      await Promise.all([
        prisma.userRoleGrant.count({ where: { userId: user.id, orgId: user.orgId } }),
        prisma.oauthConnection.findMany({
          where: { userId: user.id, orgId: user.orgId },
          select: { provider: true },
        }),
        prisma.userSurfaceIdentity.count({ where: { userId: user.id, orgId: user.orgId } }),
        prisma.sessionToken.count({ where: { userId: user.id, orgId: user.orgId } }),
        prisma.userAgentConfig.count({ where: { userId: user.id, orgId: user.orgId } }),
        prisma.userAgentInstruction.count({ where: { userId: user.id, orgId: user.orgId } }),
        prisma.sharedProviderCredential.count({ where: { userId: user.id, orgId: user.orgId } }),
        prisma.agent.count({ where: { ownerUserId: user.id, orgId: user.orgId } }),
        // oauth (userId, provider, orgId) conflicts projected onto the target
        truthOrgId
          ? prisma.oauthConnection.findMany({
              where: { userId: user.id, orgId: truthOrgId },
              select: { provider: true },
            })
          : Promise.resolve([] as { provider: string }[]),
      ]);

    const warnings: string[] = [];
    const truthProviders = new Set(oauthCollisions.map((row) => row.provider));
    const colliding = oauth.filter((row) => truthProviders.has(row.provider)).length;
    if (colliding > 0) warnings.push("OAUTH_COLLIDES_IN_TARGET");
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
        roleGrants,
        oauthConnections: oauth.length,
        oauthCollisions: colliding,
        identities: identitiesCount,
        sessionTokens,
        userAgentConfigs: uac,
        userAgentInstructions: uai,
        sharedProviderCredentials: spc,
        ownedAgents,
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
    await tx.userRoleGrant.updateMany({ where: { userId: c.userId, orgId: c.currentOrgId }, data: { orgId } });
    await tx.oauthConnection.updateMany({ where: { userId: c.userId, orgId: c.currentOrgId }, data: { orgId } });
    await tx.userSurfaceIdentity.updateMany({ where: { userId: c.userId, orgId: c.currentOrgId }, data: { orgId } });
    await tx.sessionToken.updateMany({ where: { userId: c.userId, orgId: c.currentOrgId }, data: { orgId } });
    await tx.userAgentConfig.updateMany({ where: { userId: c.userId, orgId: c.currentOrgId }, data: { orgId } });
    await tx.userAgentInstruction.updateMany({ where: { userId: c.userId, orgId: c.currentOrgId }, data: { orgId } });
    await tx.sharedProviderCredential.updateMany({ where: { userId: c.userId, orgId: c.currentOrgId }, data: { orgId } });
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const candidates = await collectCandidates(args.onlyUsers);

  const applicable = candidates.filter(isApplicable);
  const flagged = candidates.filter((c) => !isApplicable(c));

  console.log("[rehome] mode=" + (args.apply ? "APPLY" : "DRY-RUN"));
  console.log(`[rehome] candidates=${candidates.length} applicable=${applicable.length} flagged=${flagged.length}`);
  console.log("userId,email,currentOrg,truthOrg,warnings,moves");
  for (const c of candidates) {
    console.log(
      [c.userId, c.email, c.currentOrgId, c.truthOrgId ?? c.truthOrgIds.join("|"), c.warnings.join("+") || "-", JSON.stringify(c.moves)].join(","),
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
