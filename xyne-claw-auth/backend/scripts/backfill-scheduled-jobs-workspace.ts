/**
 * Backfill scheduled_jobs.workspaceId from Spaces public.users.workspaceId.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/backfill-scheduled-jobs-workspace.ts --dry-run
 *   npx tsx --env-file=.env scripts/backfill-scheduled-jobs-workspace.ts
 */

import { PrismaClient } from "@prisma/client";
import { getWorkspaceIdForUser } from "../src/lib/spaces-db.js";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const rows = await prisma.scheduledJob.findMany({
    where: { workspaceId: null },
    select: { id: true, userId: true },
    orderBy: { id: "asc" },
  });

  let resolved = 0;
  let updated = 0;
  let missed = 0;
  let raced = 0;

  console.log(`[backfill:scheduled-jobs-workspace] rowsWithNullWorkspaceId=${rows.length} dryRun=${dryRun}`);

  for (const row of rows) {
    const workspaceId = await getWorkspaceIdForUser(row.userId, "scheduled-job");
    if (!workspaceId) {
      missed++;
      console.log(`[miss] job=${row.id} userId=${row.userId}`);
      continue;
    }

    resolved++;
    if (dryRun) {
      console.log(`[dry-run] job=${row.id} userId=${row.userId} workspaceId=${workspaceId}`);
      continue;
    }

    const result = await prisma.scheduledJob.updateMany({
      where: { id: row.id, workspaceId: null },
      data: { workspaceId },
    });
    if (result.count === 1) {
      updated++;
      console.log(`[updated] job=${row.id} userId=${row.userId} workspaceId=${workspaceId}`);
    } else {
      raced++;
      console.log(`[skip] job=${row.id} userId=${row.userId} reason=already-updated`);
    }
  }

  console.log(
    `[backfill:scheduled-jobs-workspace] summary scanned=${rows.length} resolved=${resolved} updated=${updated} missed=${missed} raced=${raced} dryRun=${dryRun}`,
  );
}

main()
  .catch((err) => {
    console.error("[backfill:scheduled-jobs-workspace] Error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
