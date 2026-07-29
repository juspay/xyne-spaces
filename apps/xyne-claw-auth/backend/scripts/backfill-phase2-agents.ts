/**
 * Backfill — PHASE 2 (slice 1). Stamps every existing Agent / Skill /
 * SubagentDefinition with the default org ("Juspay"), so the follow-up
 * migration can flip `orgId` to NOT NULL and swap the slug/name unique indexes
 * to composite ([orgId, slug]).
 *
 * Mirrors `scripts/backfill-default-org.ts`:
 *   - reuses the existing "Juspay" org (created by the phase-1 backfill),
 *   - idempotent — only touches rows with `orgId IS NULL`,
 *   - a fully-backfilled DB is a no-op.
 *
 * Prerequisite: the phase-1 backfill has run (the Juspay org exists) AND the
 * phase-2 slice-1 migration is applied (the `orgId` columns exist).
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/backfill-phase2-agents.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ORG_NAME = "Juspay";

async function main(): Promise<void> {
  console.log("[backfill:phase2] Starting…");

  const org = await prisma.organization.findFirst({ where: { name: ORG_NAME } });
  if (!org) {
    console.error(
      `[backfill:phase2] default org "${ORG_NAME}" not found — run scripts/backfill-default-org.ts (phase 1) first. Aborting.`,
    );
    process.exit(1);
  }
  console.log(`[backfill:phase2] using organization "${ORG_NAME}" (${org.id})`);

  const agents = await prisma.agent.updateMany({ where: { orgId: null }, data: { orgId: org.id } });
  const skills = await prisma.skill.updateMany({ where: { orgId: null }, data: { orgId: org.id } });
  const subagents = await prisma.subagentDefinition.updateMany({ where: { orgId: null }, data: { orgId: org.id } });
  console.log(`[backfill:phase2] agents=${agents.count} skills=${skills.count} subagents=${subagents.count} stamped with org ${org.id}`);

  // Sanity.
  const [aLeft, sLeft, subLeft] = await Promise.all([
    prisma.agent.count({ where: { orgId: null } }),
    prisma.skill.count({ where: { orgId: null } }),
    prisma.subagentDefinition.count({ where: { orgId: null } }),
  ]);
  console.log(`[backfill:phase2] remaining orgId IS NULL — agents=${aLeft} skills=${sLeft} subagents=${subLeft}`);
  if (aLeft || sLeft || subLeft) {
    console.warn("[backfill:phase2] WARNING: some rows still unassigned — do NOT run the NOT-NULL / composite-unique migration yet.");
  }
  console.log("[backfill:phase2] Done!");
}

main()
  .catch((err) => {
    console.error("[backfill:phase2] Error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
