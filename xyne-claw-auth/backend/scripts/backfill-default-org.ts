/**
 * Backfill — PHASE 1 (org-only foundation).
 *
 * Places every pre-tenancy user into the single default org ("Juspay") with
 * one OrgMember row each, so that after this phase every `users.orgId` is set
 * and the follow-up migration can flip the column to NOT NULL.
 *
 * Scope: USERS only. Agents/skills/subagents (phase 2) and job/run/chat rows
 * (phase 3) stay global here and are handled by those phases' own backfills.
 *
 * Design (differs from the abandoned workspace draft):
 *   - NO workspace. One org, org-only.
 *   - OrgMember is keyed by (userId, orgId) — NOT email.
 *   - We set `user.orgId` (we do NOT add workspaceId / orgMemberId / role to User).
 *
 * Idempotent: only touches users with `orgId IS NULL`; reuses an existing
 * "Juspay" org; upserts OrgMember on the (userId, orgId) unique key. A fresh,
 * fully-backfilled DB is a no-op.
 *
 * Usage:
 *   DEFAULT_ADMIN_EMAIL=<john.doe@gmail.com> npx tsx --env-file=.env scripts/backfill-default-org.ts
 * Prerequisite: `prisma migrate deploy` through the phase-1 migration.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ORG_NAME = "Juspay";

async function main(): Promise<void> {
  console.log("[backfill:phase1] Starting…");

  // 1. Reuse (or create) the default org.
  let org = await prisma.organization.findFirst({ where: { name: ORG_NAME } });
  if (!org) {
    org = await prisma.organization.create({
      data: { name: ORG_NAME, createdBy: "system" },
    });
    console.log(`[backfill:phase1] created organization "${ORG_NAME}" (${org.id})`);
  } else {
    console.log(`[backfill:phase1] reusing organization "${ORG_NAME}" (${org.id})`);
  }

  const adminEmail = (process.env["DEFAULT_ADMIN_EMAIL"] ?? "").trim().toLowerCase();
  if (adminEmail) {
    console.log(`[backfill:phase1] platform admin (promoted to OWNER): ${adminEmail}`);
  } else {
    console.warn("[backfill:phase1] DEFAULT_ADMIN_EMAIL unset — no OWNER will be promoted.");
  }

  // 2. Assign every unassigned user to the org (one OrgMember each).
  const orphans = await prisma.user.findMany({
    where: { orgId: null },
    select: { id: true, email: true },
  });

  let usersPlaced = 0;
  let membersUpserted = 0;
  for (const u of orphans) {
    const isAdmin = adminEmail !== "" && u.email.toLowerCase() === adminEmail;
    const role = isAdmin ? "OWNER" : "MEMBER";

    // Upsert the membership on the (userId, orgId) unique key so re-runs and
    // concurrent invocations don't double-insert. On an existing row we DO NOT
    // downgrade an already-elevated role — only ever promote toward OWNER.
    await prisma.orgMember.upsert({
      where: { userId_orgId: { userId: u.id, orgId: org.id } },
      create: { orgId: org.id, userId: u.id, role, invitedBy: "system" },
      update: isAdmin ? { role: "OWNER" } : {},
    });
    membersUpserted++;

    await prisma.user.update({ where: { id: u.id }, data: { orgId: org.id } });
    usersPlaced++;
  }
  console.log(`[backfill:phase1] placed ${usersPlaced} user(s); upserted ${membersUpserted} org member(s).`);

  // 3. Sanity.
  const usersLeft = await prisma.user.count({ where: { orgId: null } });
  console.log(`[backfill:phase1] remaining users with orgId IS NULL: ${usersLeft}`);
  if (usersLeft > 0) {
    console.warn("[backfill:phase1] WARNING: some users are still unassigned — do NOT run the NOT-NULL migration yet.");
  }
  console.log("[backfill:phase1] Done!");
}

main()
  .catch((err) => {
    console.error("[backfill:phase1] Error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
