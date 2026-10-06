/**
 * Backfill organization ownership for the org-scope migration.
 *
 * This script performs data changes only. Run the schema migration that adds
 * the nullable columns/tables first, then run this script, then apply the
 * enforcement migration that adds NOT NULL/FK/unique constraints.
 *
 * Backfills:
 *   - mcp_connector_edit_requests.orgId from the proposer user
 *   - error_buckets.orgId and copies every legacy rule to every organization
 *
 * Existing MCP connector definitions remain platform-global (orgId = NULL).
 * New org-owned connector templates are created through the scoped API.
 *
 * Usage:
 *   node scripts/backfill-org-scope.js --dry-run
 *   node scripts/backfill-org-scope.js
 */

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

function log(message) {
  console.log(`[backfill:org-scope] ${message}`);
}

async function main() {
  log(`starting dryRun=${dryRun}`);

  const organizations = await prisma.organization.findMany({
    select: { id: true, name: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (organizations.length === 0) {
    throw new Error("no organizations exist; cannot backfill organization ownership");
  }

  const activeMembershipDuplicates = await prisma.$queryRaw`
    SELECT "userId", COUNT(*)::int AS count
    FROM "org_members"
    WHERE "leftAt" IS NULL
    GROUP BY "userId"
    HAVING COUNT(*) > 1
  `;
  if (activeMembershipDuplicates.length > 0) {
    throw new Error(`found ${activeMembershipDuplicates.length} user(s) with multiple active organization memberships`);
  }

  const editRequests = await prisma.mcpConnectorEditRequest.findMany({
    where: { orgId: null },
    select: { id: true, proposedByUserId: true },
  });
  const proposerIds = [...new Set(editRequests.map((row) => row.proposedByUserId))];
  const proposers = proposerIds.length === 0
    ? []
    : await prisma.user.findMany({
        where: { id: { in: proposerIds } },
        select: { id: true, orgId: true },
      });
  const orgByUserId = new Map(proposers.map((user) => [user.id, user.orgId]));
  const unresolvedEditRequests = editRequests.filter((row) => !orgByUserId.get(row.proposedByUserId));
  if (unresolvedEditRequests.length > 0) {
    throw new Error(
      `cannot resolve organization for ${unresolvedEditRequests.length} MCP edit request(s) from their proposers`,
    );
  }

  const legacyBuckets = await prisma.errorBucket.findMany({
    where: { orgId: null },
    select: {
      id: true,
      name: true,
      description: true,
      keywords: true,
      markers: true,
      matchOrder: true,
      enabled: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  log(`organizations=${organizations.length} editRequests=${editRequests.length} legacyBuckets=${legacyBuckets.length}`);

  if (dryRun) {
    log(`would update ${editRequests.length} MCP edit request(s) from proposer organizations`);
    log(`would assign ${legacyBuckets.length} legacy bucket(s) to the first organization and copy them to ${organizations.length - 1} other organization(s)`);
    log("dry run complete");
    return;
  }

  await prisma.$transaction(async (tx) => {
    let editRequestsUpdated = 0;
    for (const request of editRequests) {
      const orgId = orgByUserId.get(request.proposedByUserId);
      const result = await tx.mcpConnectorEditRequest.updateMany({
        where: { id: request.id, orgId: null },
        data: { orgId },
      });
      editRequestsUpdated += result.count;
    }

    let bucketsAssigned = 0;
    let bucketCopiesCreated = 0;
    if (legacyBuckets.length > 0) {
      for (const bucket of legacyBuckets) {
        const assigned = await tx.errorBucket.updateMany({
          where: { id: bucket.id, orgId: null },
          data: { orgId: organizations[0].id },
        });
        bucketsAssigned += assigned.count;

        for (const organization of organizations.slice(1)) {
          const existing = await tx.errorBucket.findUnique({
            where: { orgId_name: { orgId: organization.id, name: bucket.name } },
            select: { id: true },
          });
          if (existing) continue;
          await tx.errorBucket.create({
            data: {
              orgId: organization.id,
              name: bucket.name,
              description: bucket.description,
              keywords: bucket.keywords,
              markers: bucket.markers,
              matchOrder: bucket.matchOrder,
              enabled: bucket.enabled,
              createdAt: bucket.createdAt,
              updatedAt: bucket.updatedAt,
            },
          });
          bucketCopiesCreated++;
        }
      }
    }

    // Final enforcement is deliberately applied only after the data has been
    // populated. All statements below are idempotent so the pod script can be
    // safely re-run after a partial deployment.
    await tx.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "org_members_one_active_org_per_user"
      ON "org_members" ("userId") WHERE "leftAt" IS NULL
    `);
    await tx.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "mcp_servers_type_orgId_key" ON "mcp_servers"("type", "orgId")`);
    await tx.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "mcp_servers_global_type_key" ON "mcp_servers"("type") WHERE "orgId" IS NULL`);
    await tx.$executeRawUnsafe(`ALTER TABLE "mcp_servers" DROP CONSTRAINT IF EXISTS "mcp_servers_orgId_fkey"`);
    await tx.$executeRawUnsafe(`ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
    await tx.$executeRawUnsafe(`ALTER TABLE "mcp_connector_edit_requests" ALTER COLUMN "orgId" SET NOT NULL`);
    await tx.$executeRawUnsafe(`ALTER TABLE "mcp_connector_edit_requests" DROP CONSTRAINT IF EXISTS "mcp_connector_edit_requests_orgId_fkey"`);
    await tx.$executeRawUnsafe(`ALTER TABLE "mcp_connector_edit_requests" ADD CONSTRAINT "mcp_connector_edit_requests_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE`);

    await tx.$executeRawUnsafe(`ALTER TABLE "error_buckets" ALTER COLUMN "orgId" SET NOT NULL`);
    await tx.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "error_buckets_orgId_name_key" ON "error_buckets"("orgId", "name")`);
    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "error_buckets_orgId_enabled_matchOrder_idx" ON "error_buckets"("orgId", "enabled", "matchOrder")`);
    await tx.$executeRawUnsafe(`ALTER TABLE "error_buckets" DROP CONSTRAINT IF EXISTS "error_buckets_orgId_fkey"`);
    await tx.$executeRawUnsafe(`ALTER TABLE "error_buckets" ADD CONSTRAINT "error_buckets_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE`);

    log(`updated editRequests=${editRequestsUpdated} bucketsAssigned=${bucketsAssigned} bucketCopiesCreated=${bucketCopiesCreated}`);
  });

  log("backfill complete");
}

main()
  .catch((error) => {
    console.error(`[backfill:org-scope] Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
