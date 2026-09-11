#!/usr/bin/env tsx
/**
 * XYNE-55089 — De-duplicate DM / GROUP_DM channels before applying the
 * `channels_workspaceId_name_dm_key` partial unique index.
 *
 * A past check-then-create race could produce two channels that share the same
 * normalized participant key (`channels.name`) within a workspace. The unique
 * index migration will FAIL if any such duplicates still exist, so run this
 * FIRST.
 *
 * Behaviour:
 *   - Groups DM/GROUP_DM channels by (workspaceId, name) with COUNT(*) > 1.
 *   - Picks a canonical channel per group: the one that actually holds
 *     conversations; if none (or more than one) do, the OLDEST channel wins.
 *   - EMPTY losers (zero conversations) are safe race orphans — this script can
 *     delete them (with --apply). Their participant / status / stats rows are
 *     removed first so the channel row can be deleted.
 *   - CONTENT-BEARING losers (have conversations) are NOT auto-merged — merging
 *     across the many channelId-referencing tables is a manual, reviewed
 *     operation. They are reported and the script exits non-zero so the operator
 *     resolves them before the migration runs.
 *
 * Usage:
 *   npx tsx scripts/backfill/dedup-dm-channels.ts --dry-run   # audit only (default)
 *   npx tsx scripts/backfill/dedup-dm-channels.ts --apply     # delete empty orphans
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');

interface DupGroup {
  workspaceId: string;
  name: string;
  count: number;
}

async function main() {
  console.log(`🔎 dedup-dm-channels — mode: ${APPLY ? 'APPLY (will delete empty orphans)' : 'DRY-RUN (no writes)'}`);

  // Find (workspaceId, name) groups with more than one DM/GROUP_DM channel.
  const groups = await prisma.$queryRaw<DupGroup[]>`
    SELECT "workspaceId", "name", COUNT(*)::int AS count
    FROM "public"."channels"
    WHERE "scopeType" IN ('DM', 'GROUP_DM')
    GROUP BY "workspaceId", "name"
    HAVING COUNT(*) > 1
  `;

  if (groups.length === 0) {
    console.log('✅ No duplicate DM/GROUP_DM channels found — safe to apply the unique index.');
    return;
  }

  console.log(`⚠️  Found ${groups.length} duplicate participant-key group(s).`);

  let deletedOrphans = 0;
  let manualMergeRequired = 0;

  for (const g of groups) {
    const channels = await prisma.channel.findMany({
      where: { workspaceId: g.workspaceId, name: g.name, scopeType: { in: ['DM', 'GROUP_DM'] } },
      orderBy: { createdAt: 'asc' },
    });

    const withCounts = await Promise.all(
      channels.map(async (c) => ({
        channel: c,
        conversationCount: await prisma.conversation.count({ where: { channelId: c.id } }),
      })),
    );

    const contentful = withCounts.filter((c) => c.conversationCount > 0);
    // Canonical: the single content-bearing channel if unambiguous, else oldest.
    const canonical = contentful.length === 1 ? contentful[0].channel : withCounts[0].channel;
    const losers = withCounts.filter((c) => c.channel.id !== canonical.id);

    console.log(`\n• ws=${g.workspaceId} name="${g.name}" — ${channels.length} channels; canonical=${canonical.id}`);

    for (const loser of losers) {
      if (loser.conversationCount === 0) {
        console.log(`   - orphan (empty) loser ${loser.channel.id} → deletable`);
        if (APPLY) {
          await prisma.$transaction([
            prisma.channelUserStatus.deleteMany({ where: { channelId: loser.channel.id } }),
            prisma.channelParticipant.deleteMany({ where: { channelId: loser.channel.id } }),
            prisma.channelStats.deleteMany({ where: { channelId: loser.channel.id } }),
            prisma.channel.delete({ where: { id: loser.channel.id } }),
          ]);
          deletedOrphans++;
        } else {
          deletedOrphans++;
        }
      } else {
        manualMergeRequired++;
        console.log(
          `   - ⛔ loser ${loser.channel.id} has ${loser.conversationCount} conversation(s) — MANUAL MERGE required into ${canonical.id} before the migration can run`,
        );
      }
    }
  }

  console.log(
    `\n📊 Summary: ${deletedOrphans} empty orphan(s) ${APPLY ? 'deleted' : 'would be deleted'}; ${manualMergeRequired} content-bearing loser(s) need manual merge.`,
  );

  if (manualMergeRequired > 0) {
    console.error('\n❌ Content-bearing duplicates remain — resolve them manually, then re-run. Migration will fail until clean.');
    process.exitCode = 1;
  } else if (!APPLY && deletedOrphans > 0) {
    console.log('\nℹ️  Re-run with --apply to delete the empty orphans, then apply the migration.');
  } else if (APPLY && manualMergeRequired === 0) {
    console.log('\n✅ All duplicates were empty orphans and have been removed — safe to apply the unique index.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
