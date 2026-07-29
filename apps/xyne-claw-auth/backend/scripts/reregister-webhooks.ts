/**
 * Re-register Spaces app webhooks from legacy slug URLs to app-id URLs.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/reregister-webhooks.ts --dry-run
 *   SPACES_USER_TOKEN=... npx tsx --env-file=.env scripts/reregister-webhooks.ts
 *
 * Optional auth envs mirror routes/agents.ts configure-webhook:
 *   SPACES_USER_TOKEN / SPACES_SESSION_ID / SPACES_WORKSPACE_ID
 */
import { PrismaClient } from "@prisma/client";
import { CONFIG } from "../src/config.js";

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const prefix = `${name}=`;
  const hit = process.argv.slice(2).find((x) => x.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function authHeaders(userToken: string, sessionId?: string, workspaceId?: string): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${userToken}` };
  if (sessionId) headers["x-session-id"] = sessionId;
  if (workspaceId) headers["x-workspace-id"] = workspaceId;
  const cookieParts: string[] = [];
  if (sessionId) cookieParts.push(`xyne_session=${sessionId}`);
  if (workspaceId) cookieParts.push(`xyne_last_workspace=${workspaceId}`);
  if (cookieParts.length > 0) headers["Cookie"] = cookieParts.join("; ");
  return headers;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const userToken = arg("--user-token") ?? process.env["SPACES_USER_TOKEN"];
  const sessionId = arg("--session-id") ?? process.env["SPACES_SESSION_ID"];
  const workspaceId = arg("--workspace-id") ?? process.env["SPACES_WORKSPACE_ID"];

  if (!dryRun && !userToken) {
    throw new Error("SPACES_USER_TOKEN (or --user-token=...) is required unless --dry-run is set");
  }

  const agents = await prisma.agent.findMany({
    where: {
      spacesAppId: { not: null },
      spacesAppToken: { not: null },
    },
    select: { id: true, slug: true, spacesAppId: true },
    orderBy: { slug: "asc" },
  });

  let ok = 0;
  let spacesRejected = 0;
  let errors = 0;
  let skipped = 0;
  const skippedOrFailed: string[] = [];
  console.log(`[reregister-webhooks] agents=${agents.length} dryRun=${dryRun}`);

  for (const agent of agents) {
    if (!agent.spacesAppId) {
      skipped++;
      skippedOrFailed.push(`id=${agent.id} slug=${agent.slug} outcome=skipped reason=missing-spacesAppId`);
      continue;
    }
    const webhookUrl = `${CONFIG.selfUrl}/claw/api/v1/webhook/app/${agent.spacesAppId}`;
    if (dryRun) {
      ok++;
      console.log(`[ok] id=${agent.id} slug=${agent.slug} appId=${agent.spacesAppId} dryRun=true -> ${webhookUrl}`);
      continue;
    }

    try {
      const res = await fetch(`${CONFIG.spacesInternalUrl}/api/apps/configureWebhook/${agent.spacesAppId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(userToken!, sessionId, workspaceId) },
        body: JSON.stringify({ webhookUrl }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        spacesRejected++;
        const reason = `HTTP ${res.status} ${text.slice(0, 300)}`.trim();
        skippedOrFailed.push(`id=${agent.id} slug=${agent.slug} outcome=spaces-rejected reason=${reason}`);
        console.error(`[spaces-rejected] id=${agent.id} slug=${agent.slug} appId=${agent.spacesAppId}: ${reason}`);
        continue;
      }
      ok++;
      console.log(`[ok] id=${agent.id} slug=${agent.slug} appId=${agent.spacesAppId}`);
    } catch (err) {
      errors++;
      const reason = err instanceof Error ? err.message : String(err);
      skippedOrFailed.push(`id=${agent.id} slug=${agent.slug} outcome=error reason=${reason}`);
      console.error(`[error] id=${agent.id} slug=${agent.slug} appId=${agent.spacesAppId}: ${reason}`);
    }
  }

  console.log(`[reregister-webhooks] ok=${ok} spacesRejected=${spacesRejected} errors=${errors} skipped=${skipped}`);
  console.log(`[reregister-webhooks] skipped-or-failed=${skippedOrFailed.length > 0 ? skippedOrFailed.join("; ") : "none"}`);
  if (spacesRejected > 0 || errors > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(`[reregister-webhooks] fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
