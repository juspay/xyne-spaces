/**
 * Backfill SurfaceAgent + SurfaceAgentInstall rows from the inline
 * Agent.spacesAppToken / spacesAppUserId columns — NO schema change; the
 * tables already exist (same shape the Slack surface uses).
 *
 * Why: the inline columns hold only ONE (the latest) workspace's bot token;
 * installing an agent into a second workspace overwrote the first. The
 * per-workspace rows this script creates are what
 * src/lib/spaces-agent-install.ts resolves at read time; the inline columns
 * stay as the fallback, so this backfill is purely additive.
 *
 * For each agent with an inline token it creates/repairs:
 *   - SurfaceAgent(surfaceId="spaces", surfaceTenantId="", agentId,
 *     externalAppId=spacesAppId, signingSecret copied from
 *     Agent.signingSecret — same AES-GCM `ciphertext:iv:authTag` format)
 *   - SurfaceAgentInstall(surfaceTenantId=<current workspace>,
 *     encryptedBotToken, botUserId) for the workspace Spaces reports for the
 *     inline bot user — i.e. the workspace the latest install belongs to.
 *
 * Idempotent upserts; safe to re-run. Defaults to a dry run, pass --apply to
 * write. Exits non-zero if any agent had to be skipped.
 *
 * Requires SPACES_DB_URL (read-only Spaces DB, SELECT on workflow.user_sessions
 * or wherever getSpacesUserWorkspaceId reads) plus the usual DATABASE_URL /
 * ENCRYPTION_KEY.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/backfill-spaces-agent-installs.ts
 *   npx tsx --env-file=.env scripts/backfill-spaces-agent-installs.ts --apply
 */

import { prisma } from "../src/db.js";
import { disconnectSpacesDb, getSpacesUserWorkspaceId } from "../src/lib/spaces-db.js";
import { upsertSpacesInstall } from "../src/lib/spaces-agent-install.js";

async function main(): Promise<void> {
  const apply = process.argv.slice(2).includes("--apply");

  const agents = await prisma.agent.findMany({
    where: { spacesAppToken: { not: null } },
    select: {
      id: true,
      slug: true,
      orgId: true,
      spacesAppId: true,
      spacesAppToken: true,
      spacesAppUserId: true,
      signingSecret: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(
    `[backfill:agent-installs] ${agents.length} agent(s) with an inline Spaces app token, apply=${apply}`,
  );

  let planned = 0;
  let skipped = 0;
  for (const agent of agents) {
    if (!agent.spacesAppId || !agent.spacesAppToken) {
      console.warn(`[backfill:agent-installs] skip ${agent.slug}: has a token but no spacesAppId`);
      skipped++;
      continue;
    }
    // The inline pair is the LATEST install's credential; the workspace it
    // belongs to is the one Spaces reports for that install's bot user.
    const workspaceId = agent.spacesAppUserId
      ? await getSpacesUserWorkspaceId(agent.spacesAppUserId).catch(() => null)
      : null;
    if (!workspaceId) {
      console.warn(
        `[backfill:agent-installs] skip ${agent.slug}: could not resolve a workspace for bot user ` +
          `${agent.spacesAppUserId ?? "(none)"} — is SPACES_DB_URL set with the right grants?`,
      );
      skipped++;
      continue;
    }

    planned++;
    console.log(
      `  ${agent.slug} (${agent.id}) app=${agent.spacesAppId} ws=${workspaceId} ` +
        `botUser=${agent.spacesAppUserId ?? "-"} secret=${agent.signingSecret ? "yes" : "no"}`,
    );
    if (apply) {
      await upsertSpacesInstall({
        agentId: agent.id,
        spacesAppId: agent.spacesAppId,
        workspaceId,
        encryptedBotToken: agent.spacesAppToken,
        botUserId: agent.spacesAppUserId,
        signingSecret: agent.signingSecret,
      });
    }
  }

  console.log(
    `[backfill:agent-installs] ${apply ? "wrote" : "planned"} ${planned} install row(s), skipped ${skipped}` +
      (apply ? "." : ". Re-run with --apply to write."),
  );
  if (skipped > 0) process.exitCode = 1;
}

main()
  .catch((err: unknown) => {
    console.error("[backfill:agent-installs] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all([prisma.$disconnect(), disconnectSpacesDb()]);
  });
