/**
 * Backfill Claw's Spaces organization, workspace, and user-identity mappings.
 *
 * Use this when Claw already contains production data from before
 * `20260826000000_spaces_user_identity_resolution` and no Spaces sync worker
 * has populated ConnectedSurface/UserSurfaceIdentity records.
 *
 * Prerequisite: run `prisma migrate deploy` through
 * `20260826000000_spaces_user_identity_resolution` first.
 *
 * The script reads Spaces directly (SPACES_DB_URL) and writes only to Claw
 * (DATABASE_URL). It is idempotent and defaults to a non-mutating dry run.
 *
 * It creates/repairs:
 * - one ConnectedSurface org row:     (spaces, "", spacesOrgId) -> Claw org
 * - one ConnectedSurface workspace row per Spaces workspace
 * - one UserSurfaceIdentity per workspace-scoped Spaces user
 * - one Claw User per Spaces person (email-primary within the org),
 * - the corresponding Claw OrgMember and legacy SurfaceTenantLink rows
 *
 * Spaces BOT users are deliberately excluded. They are workspace-local service
 * accounts rather than people who authenticate to or use Claw, and must not
 * determine human identity mappings.
 *
 * It deliberately does NOT create LiteLLM teams or credentials. Those are
 * secrets/provider resources and must be provisioned separately after this
 * identity backfill. The later provisioning worker can then safely use the
 * canonical `(spacesOrgId, orgMemberId)` principal.
 *
 * Required Spaces DB grants (in addition to the existing users grant):
 *   GRANT SELECT ON public.organizations, public.workspaces,
 *                 public.org_members, public.users TO <claw_reader>;
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/backfill-spaces-org-identities.ts
 *   npx tsx --env-file=.env scripts/backfill-spaces-org-identities.ts --apply --org=<spacesOrgId>
 *   npx tsx --env-file=.env scripts/backfill-spaces-org-identities.ts --apply \
 *         --map=<spacesOrgId1>:<clawOrgId1> --map=<spacesOrgId2>:<clawOrgId2>   # all orgs in ONE run
 *
 * An unmapped Spaces org is only auto-created when Claw is empty, or when
 * `--create-unmapped-orgs` is explicitly supplied. This protects existing
 * agent ownership from an unsafe "best guess" mapping. --apply requires every
 * targeted Spaces org to have a trusted mapping; unmapped plans are rejected.
 */

import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

type SpacesOrg = {
  orgId: string;
  name: string;
  description: string | null;
  createdBy: string;
  status: string;
};

type SpacesWorkspace = {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  createdBy: string;
  status: string;
};

type SpacesWorkspaceUser = {
  id: string;
  email: string;
  name: string;
  workspaceId: string;
  orgId: string;
  orgMemberId: string;
  userStatus: string;
  memberOrgId: string | null;
  memberEmail: string | null;
  memberRole: string | null;
  userLeftAt: Date | null;
  memberLeftAt: Date | null;
};

type OrgPlan = {
  spacesOrg: SpacesOrg;
  clawOrgId?: string;
  createClawOrg: boolean;
};

type Args = {
  apply: boolean;
  spacesOrgId?: string;
  orgMappings: Map<string, string>;
  createUnmappedOrgs: boolean;
};

const claw = new PrismaClient();
let spaces: PrismaClient | undefined;

function parseArgs(argv: string[]): Args {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("Usage: backfill-spaces-org-identities.ts [--apply] [--org=<spacesOrgId>] [--map=<spacesOrgId>:<clawOrgId>] [--create-unmapped-orgs]");
    process.exit(0);
  }

  let spacesOrgId: string | undefined;
  const orgMappings = new Map<string, string>();
  let createUnmappedOrgs = false;
  for (const arg of argv) {
    if (arg.startsWith("--org=")) {
      spacesOrgId = arg.slice("--org=".length).trim() || undefined;
      continue;
    }
    if (arg.startsWith("--map=")) {
      const value = arg.slice("--map=".length);
      const separator = value.lastIndexOf(":");
      const sourceOrgId = value.slice(0, separator).trim();
      const clawOrgId = value.slice(separator + 1).trim();
      if (separator < 1 || !sourceOrgId || !clawOrgId) {
        throw new Error(`Invalid --map value: ${value}. Expected <spacesOrgId>:<clawOrgId>`);
      }
      if (orgMappings.has(sourceOrgId) && orgMappings.get(sourceOrgId) !== clawOrgId) {
        throw new Error(`Conflicting --map values for Spaces org ${sourceOrgId}`);
      }
      orgMappings.set(sourceOrgId, clawOrgId);
      continue;
    }
    if (arg === "--create-unmapped-orgs") {
      createUnmappedOrgs = true;
      continue;
    }
    if (arg !== "--apply") {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return {
    apply: argv.includes("--apply"),
    orgMappings,
    createUnmappedOrgs,
    ...(spacesOrgId ? { spacesOrgId } : {}),
  };
}

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

function sourceStatusIsActive(status: string, leftAt: Date | null = null): boolean {
  return status === "ACTIVE" && leftAt === null;
}

function surfaceStatus(status: string, ...leftAt: Array<Date | null>): "ACTIVE" | "INACTIVE" {
  return sourceStatusIsActive(status) && leftAt.every((value) => value === null) ? "ACTIVE" : "INACTIVE";
}

function orgStatus(status: string): "ACTIVE" | "ARCHIVED" {
  return status === "ACTIVE" ? "ACTIVE" : "ARCHIVED";
}

function clawOrgRole(role: string | null): "OWNER" | "ADMIN" | "MEMBER" | "COMMUNITY_MEMBER" {
  if (role === "OWNER" || role === "ADMIN" || role === "MEMBER" || role === "COMMUNITY_MEMBER") return role;
  // Claw has no VIEWER/GUEST role. MEMBER is the existing sync endpoint's
  // conservative compatibility fallback for unknown Spaces roles.
  return "MEMBER";
}

function key(...parts: string[]): string {
  return parts.join("\u0000");
}

function addIssue(issues: string[], message: string): void {
  issues.push(message);
  console.error(`[backfill:spaces-identities] ERROR: ${message}`);
}

async function ensureSpacesSurface(client: PrismaClient | Prisma.TransactionClient = claw): Promise<void> {
  const byId = await client.surface.findUnique({ where: { id: "spaces" }, select: { id: true, key: true } });
  const byKey = await client.surface.findUnique({ where: { key: "spaces" }, select: { id: true } });
  if (byKey && byKey.id !== "spaces") {
    throw new Error(`surface key "spaces" belongs to ${byKey.id}, expected id "spaces"`);
  }
  if (byId) {
    if (byId.key !== "spaces") {
      await client.surface.update({ where: { id: "spaces" }, data: { key: "spaces" } });
    }
    return;
  }
  await client.surface.create({
    data: { id: "spaces", key: "spaces", identityMode: "USER_ID", supportsUserResolution: true },
  });
}

async function readSpacesSnapshot(args: Args): Promise<{
  orgs: SpacesOrg[];
  workspaces: SpacesWorkspace[];
  users: SpacesWorkspaceUser[];
  ignoredBotUsers: number;
}> {
  const spacesDbUrl = process.env["SPACES_DB_URL"]?.trim();
  if (!spacesDbUrl) throw new Error("SPACES_DB_URL is required");
  spaces = new PrismaClient({ datasourceUrl: spacesDbUrl, log: ["error"] });

  const orgFilter = args.spacesOrgId
    ? Prisma.sql`WHERE o."orgId" = ${args.spacesOrgId}`
    : Prisma.empty;
  const orgs = await spaces.$queryRaw<SpacesOrg[]>`
    SELECT o."orgId", o."name", o."description", o."createdBy", o."status"::text AS "status"
    FROM public.organizations o
    ${orgFilter}
    ORDER BY o."createdAt", o."orgId"
  `;
  if (orgs.length === 0) {
    throw new Error(args.spacesOrgId ? `Spaces org ${args.spacesOrgId} was not found` : "No Spaces organizations found");
  }

  const orgIds = orgs.map((org) => org.orgId);
  const workspaces = await spaces.$queryRaw<SpacesWorkspace[]>`
    SELECT w."id", w."orgId", w."name", w."description", w."createdBy", w."status"::text AS "status"
    FROM public.workspaces w
    WHERE w."orgId" IN (${Prisma.join(orgIds)})
    ORDER BY w."orgId", w."createdAt", w."id"
  `;
  const [botCount] = await spaces.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::integer AS "count"
    FROM public.users u
    JOIN public.workspaces w ON w."id" = u."workspaceId"
    WHERE w."orgId" IN (${Prisma.join(orgIds)})
      AND COALESCE(u."userType", 'USER') = 'BOT'
  `;
  const users = await spaces.$queryRaw<SpacesWorkspaceUser[]>`
    SELECT
      u."id", u."email", u."name", u."workspaceId", w."orgId", u."orgMemberId",
      u."status"::text AS "userStatus",
      m."orgId" AS "memberOrgId", m."email" AS "memberEmail", m."role"::text AS "memberRole",
      u."leftAt" AS "userLeftAt", m."leftAt" AS "memberLeftAt"
    FROM public.users u
    JOIN public.workspaces w ON w."id" = u."workspaceId"
    LEFT JOIN public.org_members m ON m."memberId" = u."orgMemberId"
    WHERE w."orgId" IN (${Prisma.join(orgIds)})
      AND COALESCE(u."userType", 'USER') <> 'BOT'
    ORDER BY w."orgId", u."orgMemberId", u."createdAt", u."id"
  `;
  return { orgs, workspaces, users, ignoredBotUsers: botCount?.count ?? 0 };
}

async function planOrgMappings(
  orgs: SpacesOrg[],
  users: SpacesWorkspaceUser[],
  args: Args,
): Promise<{ plans: OrgPlan[]; issues: string[] }> {
  const issues: string[] = [];
  const existingMappings = await claw.connectedSurface.findMany({
    where: { surfaceId: "spaces", surfaceTenantId: "", surfaceOrgId: { not: null } },
    select: { orgId: true, surfaceOrgId: true },
  });
  const existingBySpacesOrg = new Map<string, Set<string>>();
  for (const row of existingMappings) {
    if (!row.surfaceOrgId) continue;
    const ids = existingBySpacesOrg.get(row.surfaceOrgId) ?? new Set<string>();
    ids.add(row.orgId);
    existingBySpacesOrg.set(row.surfaceOrgId, ids);
  }

  const sourceEmailsByOrg = new Map<string, Set<string>>();
  const sourceUserIdsByOrg = new Map<string, Set<string>>();
  for (const user of users) {
    const emails = sourceEmailsByOrg.get(user.orgId) ?? new Set<string>();
    emails.add(normalizedEmail(user.email));
    sourceEmailsByOrg.set(user.orgId, emails);
    const ids = sourceUserIdsByOrg.get(user.orgId) ?? new Set<string>();
    ids.add(user.id);
    sourceUserIdsByOrg.set(user.orgId, ids);
  }

  const clawUsers = await claw.user.findMany({ select: { id: true, email: true, orgId: true } });
  const clawOrgs = await claw.organization.findMany({ select: { id: true } });
  const validClawOrgIds = new Set(clawOrgs.map((org) => org.id));
  const plans: OrgPlan[] = [];
  for (const spacesOrg of orgs) {
    const mapped = existingBySpacesOrg.get(spacesOrg.orgId) ?? new Set<string>();
    if (mapped.size > 1) {
      addIssue(issues, `Spaces org ${spacesOrg.orgId} maps to multiple Claw orgs: ${[...mapped].join(", ")}`);
      continue;
    }

    const explicitClawOrgId = args.orgMappings.get(spacesOrg.orgId);
    if (explicitClawOrgId && !validClawOrgIds.has(explicitClawOrgId)) {
      addIssue(issues, `--map for Spaces org ${spacesOrg.orgId} references missing Claw org ${explicitClawOrgId}`);
      continue;
    }
    const candidateClawOrgs = new Set(mapped);
    const sourceEmails = sourceEmailsByOrg.get(spacesOrg.orgId) ?? new Set<string>();
    const sourceUserIds = sourceUserIdsByOrg.get(spacesOrg.orgId) ?? new Set<string>();
    for (const user of clawUsers) {
      if (sourceUserIds.has(user.id) || sourceEmails.has(normalizedEmail(user.email))) {
        candidateClawOrgs.add(user.orgId);
      }
    }
    if (explicitClawOrgId) {
      if (candidateClawOrgs.size > 0 && !candidateClawOrgs.has(explicitClawOrgId)) {
        addIssue(
          issues,
          `--map says Spaces org ${spacesOrg.orgId} belongs to ${explicitClawOrgId}, but existing data resolves it to ${[...candidateClawOrgs].join(", ")}`,
        );
        continue;
      }
      plans.push({ spacesOrg, clawOrgId: explicitClawOrgId, createClawOrg: false });
      continue;
    }
    if (candidateClawOrgs.size > 1) {
      addIssue(
        issues,
        `Cannot infer one Claw org for Spaces org ${spacesOrg.orgId}; matching Claw users belong to ${[...candidateClawOrgs].join(", ")}`,
      );
      continue;
    }
    const clawOrgId = [...candidateClawOrgs][0];
    if (clawOrgId) {
      plans.push({ spacesOrg, clawOrgId, createClawOrg: false });
    } else if (clawOrgs.length === 1 && orgs.length === 1) {
      // A one-org pre-migration Claw deployment has exactly one safe target.
      plans.push({ spacesOrg, clawOrgId: clawOrgs[0]!.id, createClawOrg: false });
    } else if (clawOrgs.length === 0 || args.createUnmappedOrgs) {
      plans.push({ spacesOrg, createClawOrg: true });
    } else {
      addIssue(
        issues,
        `Cannot infer Claw org for Spaces org ${spacesOrg.orgId}; use --map=<spacesOrgId>:<clawOrgId> or --create-unmapped-orgs`,
      );
    }
  }

  const claimedClawOrgs = new Map<string, string>();
  for (const plan of plans) {
    if (!plan.clawOrgId) continue;
    const alreadyClaimedBy = claimedClawOrgs.get(plan.clawOrgId);
    if (alreadyClaimedBy && alreadyClaimedBy !== plan.spacesOrg.orgId) {
      addIssue(
        issues,
        `Claw org ${plan.clawOrgId} would map to both Spaces orgs ${alreadyClaimedBy} and ${plan.spacesOrg.orgId}; split/migrate it explicitly before running this backfill`,
      );
    }
    claimedClawOrgs.set(plan.clawOrgId, plan.spacesOrg.orgId);
  }
  return { plans, issues };
}

async function preflight(
  plans: OrgPlan[],
  workspaces: SpacesWorkspace[],
  users: SpacesWorkspaceUser[],
): Promise<string[]> {
  const issues: string[] = [];
  const knownOrgIds = new Set(plans.map((plan) => plan.spacesOrg.orgId));
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));

  // Existing identity rows are authoritative links, not hints. Read them
  // before any write so a conflict is reported by dry-run instead of halfway
  // through an apply run. Querying by both dimensions can return a harmless
  // cross-product; the composite-key map below filters it to source rows.
  const sourceIdentityKeys = new Set(users.map((user) => key(user.workspaceId, user.id)));
  const sourceWorkspaceIds = [...new Set(users.map((user) => user.workspaceId))];
  const sourceUserIds = [...new Set(users.map((user) => user.id))];
  const existingIdentities = await claw.userSurfaceIdentity.findMany({
    where: {
      surfaceId: "spaces",
      surfaceWorkspaceId: { in: sourceWorkspaceIds },
      surfaceUserId: { in: sourceUserIds },
    },
    select: { surfaceWorkspaceId: true, surfaceUserId: true, orgId: true, userId: true },
  });
  const identityBySource = new Map(
    existingIdentities
      .filter((identity) => sourceIdentityKeys.has(key(identity.surfaceWorkspaceId, identity.surfaceUserId)))
      .map((identity) => [key(identity.surfaceWorkspaceId, identity.surfaceUserId), identity]),
  );

  for (const user of users) {
    const workspace = workspaceById.get(user.workspaceId);
    if (!workspace || workspace.orgId !== user.orgId || !knownOrgIds.has(user.orgId)) {
      addIssue(issues, `Spaces user ${user.id} has an invalid workspace/org relationship`);
    }
    if (!user.memberOrgId || user.memberOrgId !== user.orgId) {
      addIssue(issues, `Spaces user ${user.id} has orgMemberId ${user.orgMemberId} outside workspace org ${user.orgId}`);
    }
    if (!user.memberEmail || normalizedEmail(user.memberEmail) !== normalizedEmail(user.email)) {
      addIssue(issues, `Spaces user ${user.id} email does not match org member ${user.orgMemberId}`);
    }
  }

  const expectedOrgByWorkspace = new Map<string, string>();
  for (const plan of plans) {
    for (const workspace of workspaces.filter((item) => item.orgId === plan.spacesOrg.orgId)) {
      if (plan.clawOrgId) expectedOrgByWorkspace.set(workspace.id, plan.clawOrgId);
    }
  }
  const existingWorkspaceMappings = await claw.connectedSurface.findMany({
    where: { surfaceId: "spaces", surfaceTenantId: { not: "" } },
    select: { orgId: true, surfaceTenantId: true, surfaceOrgId: true },
  });
  for (const mapping of existingWorkspaceMappings) {
    const expected = expectedOrgByWorkspace.get(mapping.surfaceTenantId);
    if (expected && mapping.orgId !== expected) {
      addIssue(issues, `Spaces workspace ${mapping.surfaceTenantId} already maps to Claw org ${mapping.orgId}, expected ${expected}`);
    }
    if (!expected && workspaceById.has(mapping.surfaceTenantId)) {
      addIssue(
        issues,
        `Spaces workspace ${mapping.surfaceTenantId} has an existing Claw mapping but its org has no trusted org-level mapping; add the org mapping explicitly before backfill`,
      );
    }
  }
  const legacyWorkspaceMappings = await claw.surfaceTenantLink.findMany({
    where: { surfaceType: "spaces" },
    select: { orgId: true, surfaceTenantId: true },
  });
  for (const mapping of legacyWorkspaceMappings) {
    const expected = expectedOrgByWorkspace.get(mapping.surfaceTenantId);
    if (expected && mapping.orgId !== expected) {
      addIssue(issues, `Legacy Spaces workspace link ${mapping.surfaceTenantId} maps to Claw org ${mapping.orgId}, expected ${expected}`);
    }
    if (!expected && workspaceById.has(mapping.surfaceTenantId)) {
      addIssue(
        issues,
        `Legacy Spaces workspace link ${mapping.surfaceTenantId} exists but its org has no trusted org-level mapping; add the org mapping explicitly before backfill`,
      );
    }
  }

  // Email-primary matching: one person == one (orgId, email). Two distinct
  // Spaces people sharing one email in an org is a HARD preflight issue
  // (checked below), so the first map is effectively unambiguous here.
  const usersByEmail = new Map<string, Set<string>>();
  const existingUsers = await claw.user.findMany({
    select: { id: true, orgId: true, email: true },
  });
  const userById = new Map(existingUsers.map((user) => [user.id, user]));
  const userByOrgEmail = new Map<string, typeof existingUsers[number]>();
  for (const user of existingUsers) {
    userByOrgEmail.set(key(user.orgId, normalizedEmail(user.email)), user);
  }
  // Email-primary safety gate: if two DISTINCT Spaces org-members share one
  // email in an org, first-contact resolution would collapse them into one
  // Claw user. Refuse loudly instead — the operator must fix Spaces data.
  {
    const membersByEmail = new Map<string, Set<string>>();
    for (const u of users) {
      const k = key(u.orgId, normalizedEmail(u.email));
      const set = membersByEmail.get(k) ?? new Set<string>();
      if (u.memberOrgId) set.add(u.memberOrgId);
      membersByEmail.set(k, set);
    }
    for (const [emailKey, members] of membersByEmail) {
      if (members.size > 1) {
        addIssue(
          issues,
          `Email ${emailKey.replace("\u0000", "/")} is shared by ${members.size} distinct Spaces people in that org — email-primary resolution cannot disambiguate them`,
        );
      }
    }
  }
  const planBySpacesOrg = new Map(plans.map((plan) => [plan.spacesOrg.orgId, plan]));
  for (const sourceUser of users) {
    const plan = planBySpacesOrg.get(sourceUser.orgId);
    const identity = identityBySource.get(key(sourceUser.workspaceId, sourceUser.id));
    if (!plan) continue;
    if (!plan.clawOrgId) {
      if (identity) {
        addIssue(
          issues,
          `Spaces identity ${sourceUser.id}/${sourceUser.workspaceId} already maps to Claw org ${identity.orgId}; use --map instead of creating a new org`,
        );
      }
      continue;
    }
    const targetOrgId = plan.clawOrgId;
    const candidateIds = new Set<string>();
    const direct = userById.get(sourceUser.id);
    if (direct && direct.orgId !== targetOrgId) {
      addIssue(issues, `Spaces user ${sourceUser.id} belongs to Claw org ${direct.orgId}, expected ${targetOrgId}`);
    }
    if (direct?.orgId === targetOrgId) candidateIds.add(direct.id);
    const byEmail = userByOrgEmail.get(key(targetOrgId, normalizedEmail(sourceUser.email)));
    if (byEmail) candidateIds.add(byEmail.id);
    if (identity) {
      if (identity.orgId !== targetOrgId) {
        addIssue(
          issues,
          `Spaces identity ${sourceUser.id}/${sourceUser.workspaceId} already maps to Claw org ${identity.orgId}, expected ${targetOrgId}`,
        );
      }
      if (identity.userId) {
        const identityUser = userById.get(identity.userId);
        if (!identityUser) {
          addIssue(issues, `Spaces identity ${sourceUser.id}/${sourceUser.workspaceId} references missing Claw user ${identity.userId}`);
        } else if (identityUser.orgId !== targetOrgId) {
          addIssue(
            issues,
            `Spaces identity ${sourceUser.id}/${sourceUser.workspaceId} references Claw user ${identity.userId} in org ${identityUser.orgId}, expected ${targetOrgId}`,
          );
        } else {
          candidateIds.add(identity.userId);
        }
      }
    }
    const emailCandidates = usersByEmail.get(key(targetOrgId, normalizedEmail(sourceUser.email))) ?? new Set<string>();
    for (const candidateId of candidateIds) emailCandidates.add(candidateId);
    usersByEmail.set(key(targetOrgId, normalizedEmail(sourceUser.email)), emailCandidates);
  }
  for (const [emailKey, candidateIds] of usersByEmail) {
    if (candidateIds.size > 1) {
      addIssue(issues, `One email resolves to multiple Claw users: ${emailKey.replace("\u0000", "/")} -> ${[...candidateIds].join(", ")}`);
    }
  }
  return issues;
}

async function createClawOrgInTransaction(
  client: Prisma.TransactionClient,
  spacesOrg: SpacesOrg,
): Promise<string> {
  const baseName = spacesOrg.name.trim() || `Spaces organization ${spacesOrg.orgId}`;
  let name = baseName;
  let suffix = 0;
  while (await client.organization.findUnique({ where: { name }, select: { id: true } })) {
    suffix += 1;
    name = `${baseName} (Spaces ${spacesOrg.orgId.slice(-8)}${suffix === 1 ? "" : `-${suffix}`})`;
  }
  const org = await client.organization.create({
    data: {
      name,
      description: spacesOrg.description,
      createdBy: `spaces:${spacesOrg.createdBy}`,
      status: orgStatus(spacesOrg.status),
      metadata: { source: "spaces-backfill", spacesOrgId: spacesOrg.orgId },
    },
    select: { id: true },
  });
  console.log(`[backfill:spaces-identities] created Claw org ${org.id} for Spaces org ${spacesOrg.orgId}`);
  return org.id;
}

async function backfillOrg(
  plan: OrgPlan,
  allWorkspaces: SpacesWorkspace[],
  allUsers: SpacesWorkspaceUser[],
): Promise<{ workspaces: number; users: number; identities: number }> {
  const workspaces = allWorkspaces.filter((workspace) => workspace.orgId === plan.spacesOrg.orgId);
  const users = allUsers.filter((user) => user.orgId === plan.spacesOrg.orgId);

  await claw.$transaction(async (tx) => {
    await ensureSpacesSurface(tx);
    // Creating the Claw org belongs to the same transaction as its mappings;
    // a failed user/identity write must not leave an orphaned organization.
    const orgId = plan.clawOrgId ?? await createClawOrgInTransaction(tx, plan.spacesOrg);
    await tx.connectedSurface.upsert({
      where: { orgId_surfaceId_surfaceTenantId: { orgId, surfaceId: "spaces", surfaceTenantId: "" } },
      create: {
        orgId,
        surfaceId: "spaces",
        surfaceTenantId: "",
        surfaceOrgId: plan.spacesOrg.orgId,
        status: surfaceStatus(plan.spacesOrg.status),
        config: { kind: "spaces-org", name: plan.spacesOrg.name, source: "spaces-backfill" },
      },
      update: {
        surfaceOrgId: plan.spacesOrg.orgId,
        status: surfaceStatus(plan.spacesOrg.status),
      },
    });

    for (const workspace of workspaces) {
      const status = surfaceStatus(workspace.status);
      await tx.connectedSurface.upsert({
        where: { orgId_surfaceId_surfaceTenantId: { orgId, surfaceId: "spaces", surfaceTenantId: workspace.id } },
        create: {
          orgId,
          surfaceId: "spaces",
          surfaceTenantId: workspace.id,
          surfaceOrgId: workspace.orgId,
          status,
          config: { kind: "spaces-workspace", name: workspace.name, description: workspace.description, source: "spaces-backfill" },
        },
        update: { surfaceOrgId: workspace.orgId, status },
      });
      await tx.surfaceTenantLink.upsert({
        where: { surfaceType_surfaceTenantId: { surfaceType: "spaces", surfaceTenantId: workspace.id } },
        create: { surfaceType: "spaces", surfaceTenantId: workspace.id, orgId },
        update: { orgId },
      });
    }

    // Email-primary person resolution: one Claw person per (org, email).
    // No Spaces-derived keys are stored on the users table.
    const canonicalByEmail = new Map<string, string>();
    for (const sourceUser of users) {
      const emailKey = key(orgId, normalizedEmail(sourceUser.email));
      let canonicalUserId = canonicalByEmail.get(emailKey);
      if (!canonicalUserId) {
        const byId = await tx.user.findUnique({ where: { id: sourceUser.id }, select: { id: true, orgId: true, email: true } });
        const byEmail = await tx.user.findFirst({
          where: { orgId, email: { equals: sourceUser.email, mode: "insensitive" } },
          select: { id: true, email: true },
        });
        const candidates = new Map<string, { email: string }>();
        if (byId?.orgId === orgId) candidates.set(byId.id, byId);
        if (byEmail) candidates.set(byEmail.id, byEmail);
        if (byId && byId.orgId !== orgId) {
          throw new Error(`Spaces user ${sourceUser.id} already belongs to Claw org ${byId.orgId}, expected ${orgId}`);
        }
        if (candidates.size > 1) {
          throw new Error(`Spaces user ${sourceUser.email} resolves to multiple Claw users: ${[...candidates.keys()].join(", ")}`);
        }
        const existing = [...candidates.entries()][0];
        if (existing) {
          canonicalUserId = existing[0];
          await tx.user.update({
            where: { id: canonicalUserId },
            data: { email: sourceUser.email, name: sourceUser.name },
          });
        } else {
          canonicalUserId = `claw-user-${randomUUID()}`;
          await tx.user.create({
            data: {
              id: canonicalUserId,
              email: sourceUser.email,
              name: sourceUser.name,
              orgId,
            },
          });
        }
        canonicalByEmail.set(emailKey, canonicalUserId);
        await tx.orgMember.upsert({
          where: { userId_orgId: { userId: canonicalUserId, orgId } },
          create: {
            userId: canonicalUserId,
            orgId,
            role: clawOrgRole(sourceUser.memberRole),
            invitedBy: "spaces-backfill",
            leftAt: sourceUser.memberLeftAt,
          },
          update: { role: clawOrgRole(sourceUser.memberRole), leftAt: sourceUser.memberLeftAt },
        });
      }

      const workspace = workspaces.find((item) => item.id === sourceUser.workspaceId);
      if (!workspace) {
        throw new Error(`Spaces user ${sourceUser.id} references missing workspace ${sourceUser.workspaceId}`);
      }
      const identityStatus = sourceStatusIsActive(plan.spacesOrg.status)
        && sourceStatusIsActive(workspace.status)
        && sourceStatusIsActive(sourceUser.userStatus, sourceUser.userLeftAt)
        && sourceUser.memberLeftAt === null
        ? "ACTIVE"
        : "INACTIVE";
      const existingIdentity = await tx.userSurfaceIdentity.findUnique({
        where: {
          surfaceId_surfaceWorkspaceId_surfaceUserId: {
            surfaceId: "spaces",
            surfaceWorkspaceId: sourceUser.workspaceId,
            surfaceUserId: sourceUser.id,
          },
        },
        select: { userId: true, orgId: true },
      });
      if (existingIdentity?.orgId && existingIdentity.orgId !== orgId) {
        throw new Error(`Spaces identity ${sourceUser.id}/${sourceUser.workspaceId} belongs to Claw org ${existingIdentity.orgId}`);
      }
      if (existingIdentity?.userId && existingIdentity.userId !== canonicalUserId) {
        throw new Error(`Spaces identity ${sourceUser.id}/${sourceUser.workspaceId} belongs to Claw user ${existingIdentity.userId}`);
      }
      await tx.userSurfaceIdentity.upsert({
        where: {
          surfaceId_surfaceWorkspaceId_surfaceUserId: {
            surfaceId: "spaces",
            surfaceWorkspaceId: sourceUser.workspaceId,
            surfaceUserId: sourceUser.id,
          },
        },
        create: {
          surfaceId: "spaces",
          surfaceWorkspaceId: sourceUser.workspaceId,
          surfaceUserId: sourceUser.id,
          orgId,
          userId: canonicalUserId,
          ...(sourceUser.orgMemberId ? { surfaceMemberId: sourceUser.orgMemberId } : {}),
          status: identityStatus,
          linkedAt: new Date(),
          lastSeenAt: new Date(),
        },
        update: {
          orgId,
          userId: canonicalUserId,
          ...(sourceUser.orgMemberId ? { surfaceMemberId: sourceUser.orgMemberId } : {}),
          status: identityStatus,
          linkedAt: new Date(),
          lastSeenAt: new Date(),
        },
      });
    }
  });
  return { workspaces: workspaces.length, users: new Set(users.map((user) => user.orgMemberId)).size, identities: users.length };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const snapshot = await readSpacesSnapshot(args);
  const { plans, issues: planningIssues } = await planOrgMappings(snapshot.orgs, snapshot.users, args);
  const preflightIssues = await preflight(plans, snapshot.workspaces, snapshot.users);
  const issues = [...planningIssues, ...preflightIssues];
  if (issues.length > 0) {
    throw new Error(`Refusing to run: ${issues.length} mapping conflict(s) require operator resolution`);
  }

  const creates = plans.filter((plan) => plan.createClawOrg).length;
  console.log(
    `[backfill:spaces-identities] plan: ${plans.length} org(s), ${snapshot.workspaces.length} workspace(s), ` +
      `${snapshot.users.length} human workspace-user identity row(s), ${snapshot.ignoredBotUsers} BOT user(s) ignored, ` +
      `${creates} new Claw org(s)`,
  );
  if (!args.apply) {
    console.log("[backfill:spaces-identities] dry run only. Re-run with --apply to write Claw mappings.");
    return;
  }

  // Each organization is applied in its OWN transaction (backfillOrg), and the
  // global preflight above has already aborted on any cross-org conflict, so
  // processing several orgs in one run is safe: a failure mid-run leaves earlier
  // orgs applied and untouched orgs for an idempotent re-run. The one
  // non-negotiable requirement is that EVERY targeted org has a complete,
  // trusted mapping — the script never guesses an org pairing.
  const unresolved = plans.filter((plan) => !plan.clawOrgId && !plan.createClawOrg);
  if (unresolved.length > 0) {
    throw new Error(
      `Refusing --apply: ${unresolved.length} Spaces org(s) have no trusted Claw org mapping: ` +
        `${unresolved.map((plan) => plan.spacesOrg.orgId).join(", ")}. ` +
        `Provide --map=<spacesOrgId>:<clawOrgId> (repeatable) or --create-unmapped-orgs, or scope with --org=<spacesOrgId>.`,
    );
  }

  let workspaceCount = 0;
  let userCount = 0;
  let identityCount = 0;
  for (const plan of plans) {
    const result = await backfillOrg(plan, snapshot.workspaces, snapshot.users);
    workspaceCount += result.workspaces;
    userCount += result.users;
    identityCount += result.identities;
  }
  console.log(
    `[backfill:spaces-identities] complete: ${plans.length} org(s), ${workspaceCount} workspace mapping(s), ` +
      `${userCount} canonical user(s), ${identityCount} workspace identity row(s)`,
  );
}

main()
  .catch((error: unknown) => {
    console.error("[backfill:spaces-identities] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all([claw.$disconnect(), spaces?.$disconnect()]);
  });
